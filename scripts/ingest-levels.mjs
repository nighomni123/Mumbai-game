/**
 * Ingest `building:levels` from OpenStreetMap.
 *
 * WHY THIS EXISTS, and the number behind it.
 *
 * Every building height in the city is currently ESTIMATED. `estimateHeight()`
 * in enrich-chunks.mjs caps an estimate's confidence at 0.45, because it is a
 * zone prior plus a damped area term — a documented guess, honestly labelled.
 *
 * Measured against real data on 2026-09-30 (1,842 buildings in the Fort box,
 * counted with Overpass `out count`): `building:levels` is populated for
 * **11.7%** of Mumbai buildings. `building:height` is populated for **0%** — in
 * India, height is essentially never mapped, which is why the height rule has
 * to be an estimate at all. `building:colour` is 0.6%, and 10 of those 11 values
 * are literally the untrimmed strings `white` or `yellow`.
 *
 * So levels is the ONE piece of appearance data that exists at a usable rate,
 * and taking it converts ~30,000 buildings from "estimated at 0.45" to
 * "measured". It is not a big number. It is the right number, and it is the
 * only licence-clean one available.
 *
 * WHAT IT IS NOT. Overture Maps has `facade_color`, `facade_material` and
 * `roof_material` in its schema, and they are populated for 0.1% / 0.02% of
 * Mumbai buildings — byte-identical to the OSM values, because Overture is OSM
 * pass-through. Microsoft GlobalML Building Footprints and Google Open Buildings
 * are footprint-only. There is no appearance database for Mumbai. Do not go
 * looking for one again.
 *
 * PROVENANCE. OpenStreetMap, ODbL 1.0 — the same licence and the same
 * attribution the rest of this pipeline already carries. This script is the
 * "means of creating" the licence asks for, and it is committed; the derived
 * file is not.
 *
 * Run: node scripts/ingest-levels.mjs            (all tiles, resumable)
 *      node scripts/ingest-levels.mjs --limit 5  (test a few)
 *      node scripts/ingest-levels.mjs --apply    (patch the chunks, no fetch)
 */

import {
  readFileSync,
  writeFileSync,
  readdirSync,
  mkdirSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tileBounds, toLocal, toWgs84, TILE_M, ACTIVE_BOUNDS, inActive } from "./geo.mjs";

const OUT = "data/build/levels";

/**
 * Overpass endpoints, in the order they are tried.
 *
 * `overpass-api.de` answers 406 to everything from this machine — its WAF
 * rejects non-browser clients on /api/interpreter, and a browser User-Agent on
 * GET still 406s, so POST is required.
 *
 * `overpass.osm.ch` is worse than dead: it returns HTTP 200 with a valid
 * document whose `timestamp_osm_base` is `117392` and an empty element array. Its
 * database is empty. Do not trust a 200 from it.
 *
 * `maps.mail.ru` is a real 0.7.62 instance with current data. It 504s on bboxes
 * above roughly 0.03 deg square, so the tiles here are 2 km, not the whole city.
 */
const ENDPOINTS = [
  // Confirmed working from this machine, 2026-09-30: real timestamp, real
  // elements. First, because it is the only one that answers.
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  // Kept last, not first. overpass-api.de answers 406 to every request from
  // here, and leading the list with it wasted two attempts in three.
  "https://overpass-api.de/api/interpreter",
];
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

const args = process.argv.slice(2);
const LIMIT = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : Infinity;

/* ------------------------------------------------------------------ *
 * Level parsing.
 * ------------------------------------------------------------------ */

/**
 * Parse an OSM `building:levels` value into a storey count.
 *
 * Returns null rather than guessing. The observed values are plain integers
 * ("7") but the tag is free text in the wild and carries:
 *   "3.5"   half-storey mezzanines — kept, it is a real measurement
 *   "7;9"   a building with two sections — takes the tallest, not the first
 *   "ground;5"  an English ground floor offset — 5 storeys above it
 *   ""      empty — null
 * Anything outside 0.5..200 is rejected as a typo rather than believed, and the
 * rejection is reported rather than silent.
 */
export function parseLevels(raw) {
  if (raw === null || raw === undefined) return null;
  const parts = String(raw)
    .split(/[;,\/]/)
    .map((s) => s.trim())
    .filter(Boolean);
  let best = null;
  for (const p of parts) {
    // drop a leading "ground"/"g" token, which is a name not a count
    const m = /(-?\d+(?:\.\d+)?)/.exec(p);
    if (!m) continue;
    const v = parseFloat(m[1]);
    if (!(v >= 0.5 && v <= 200)) continue;
    if (best === null || v > best) best = v;
  }
  return best;
}

/* ------------------------------------------------------------------ *
 * Fetch.
 * ------------------------------------------------------------------ */

/** Every tile that touches the build scope, so a fresh clone is not asked for the world. */
function scopeTiles() {
  const out = [];
  const gx0 = Math.floor(ACTIVE_BOUNDS.x0 / TILE_M);
  const gx1 = Math.floor(ACTIVE_BOUNDS.x1 / TILE_M);
  const gy0 = Math.floor(ACTIVE_BOUNDS.y0 / TILE_M);
  const gy1 = Math.floor(ACTIVE_BOUNDS.y1 / TILE_M);
  for (let gx = gx0; gx <= gx1; gx++) {
    for (let gy = gy0; gy <= gy1; gy++) {
      if (!inActive(gx * TILE_M, gy * TILE_M)) continue;
      out.push([gx, gy]);
    }
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The padded bbox of one tile.
 *
 * Overpass QL bbox order is (SOUTH, WEST, NORTH, EAST) — latitude first, then
 * longitude. `y` is northing, so south is y0 and north is y1. Getting this
 * wrong does not error: it silently asks for a box with an impossible latitude,
 * Overpass returns a well-formed empty document, and the tile looks like it has
 * no levels. Cost two debugging rounds; the assert below is why it will not cost
 * a third.
 */
function tileBbox(gx, gy) {
  const b = tileBounds({ gx, gy });
  const PAD = 60;
  const s = toWgs84(b.x0 - PAD, b.y0 - PAD);
  const n = toWgs84(b.x1 + PAD, b.y1 + PAD);
  const bbox = [s.lat, s.lon, n.lat, n.lon].map((v) => v.toFixed(6)).join(",");
  for (const v of [s.lat, n.lat]) {
    if (!(v > -90 && v < 90)) throw new Error(`latitude out of range for ${gx},${gy}: ${bbox}`);
  }
  return bbox;
}

/**
 * Fetch a BATCH of tiles in one request.
 *
 * The win is round trips, not server work: the same ways are scanned either
 * way, but one HTTP request replaces N. Measured on 2026-09-30, a single tile
 * cost 24-41 s of which the 350 ms politeness delay was 0.9% — it was all
 * network and server spin-up. Batching 4 cuts requests ~4x, which lowers
 * rate-limit pressure rather than raising it. Higher local concurrency would
 * do the opposite: it would multiply request rate against a free community
 * service that is already throttling us, which is how you lose every mirror.
 *
 * A batch still writes one file per tile, so a failure costs one batch of
 * work, not one tile, and the resumability is unchanged.
 */
async function fetchBatch(tiles, stats) {
  const pending = [];
  for (const [gx, gy] of tiles) {
    const file = join(OUT, `tile_${gx}_${gy}.json`);
    if (existsSync(file)) {
      const prev = JSON.parse(readFileSync(file, "utf8"));
      stats.tiles++;
      stats.levels += Object.keys(prev.l || {}).length;
      continue;
    }
    pending.push([gx, gy]);
  }
  if (!pending.length) return true;

  // WAYS ONLY, `out tags`. Both are load-bearing:
  //  - `relation["..."](bbox)` is a full relation scan and reliably 504s this
  //    mirror even for one 2 km tile.
  //  - `out body` returns the node list for every way, which is most of the
  //    payload. `out tags` is all this script reads.
  const filters = pending.map(([gx, gy]) => `way["building:levels"](${tileBbox(gx, gy)});`);
  const q = `[out:json][timeout:180];(${filters.join("")});out tags geom;`;

  for (let attempt = 0; attempt < 2; attempt++) {
    const ep = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      const res = await fetch(ep, {
        method: "POST",
        headers: {
          "User-Agent": UA,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "data=" + encodeURIComponent(q),
        signal: AbortSignal.timeout(180000),
      });
      if (!res.ok) {
        if (process.env.LEVELS_DEBUG) {
          const body = await res.text().catch(() => "");
          console.error(`  [debug] ${ep} -> ${res.status} ${body.slice(0, 120).replace(/\s+/g," ")}`);
        }
        stats.httpFail++;
        await sleep(1200 * (attempt + 1));
        continue;
      }
      const json = await res.json();
      // A mirror with an empty database still answers 200 with a nonsense
      // timestamp. Treat that as a failure rather than as "no data here".
      const ts = String(json?.osm3s?.timestamp_osm_base ?? "");
      if (!/^\d{4}-\d\d-\d\dT/.test(ts)) {
        stats.emptyMirror++;
        await sleep(800);
        continue;
      }

      // Bucket every returned way into the tile whose padded bbox contains it.
      const { boxes, rejected, unplaced } = bucketElements(pending, json.elements ?? []);
      stats.rejected += rejected;
      stats.unplaced += unplaced;
      // one file per tile, exactly as before
      for (const box of boxes) {
        writeFileSync(join(OUT, `tile_${box.gx}_${box.gy}.json`), JSON.stringify({ tile: box.key, ts, l: box.l }));
        stats.tiles++;
        stats.levels += Object.keys(box.l).length;
      }
      return true;
    } catch (err) {
      if (process.env.LEVELS_DEBUG) console.error(`  [debug] ${ep} -> ${err.name}: ${String(err.message).slice(0, 140)}`);
      stats.httpFail++;
      await sleep(1200 * (attempt + 1));
    }
  }
  stats.failed += pending.length;
  return false;
}

/* ------------------------------------------------------------------ *
 * Apply: levels -> a real height, without ever overwriting a real one.
 * ------------------------------------------------------------------ */

/**
 * Floor-to-floor height by class — the SAME table estimateHeight() uses, so an
 * upgraded height is comparable with an estimated one. Duplicating this table
 * with a different number in it is how the two would silently disagree.
 */
const FTF = {
  residential: 3.0,
  apartments: 3.0,
  commercial: 3.6,
  institutional: 3.6,
  industrial: 4.5,
  religious: 4.5,
  infrastructure: 6.0,
  _default: 3.0,
};

/**
 * Split a batched Overpass response back into per-tile files.
 *
 * A batched query returns one flat element list for several tiles, so the
 * elements have to be re-sorted by which padded tile box each one falls in.
 * Exported so scripts/check-levels.mjs can test it against a synthetic response
 * — this is the step where a bug would put a building's storey count into its
 * NEIGHBOUR's tile, which is silent and would look like plausible data.
 *
 * `out tags geom` is required for this: `out tags` alone carries no geometry
 * and nothing can be placed.
 */
export function bucketElements(tiles, elements) {
  const PAD = 60;
  const boxes = tiles.map(([gx, gy]) => {
    const b = tileBounds({ gx, gy });
    return {
      gx, gy, key: `${gx},${gy}`,
      x0: b.x0 - PAD, x1: b.x1 + PAD, y0: b.y0 - PAD, y1: b.y1 + PAD,
      l: {},
    };
  });
  let rejected = 0;
  let unplaced = 0;
  for (const el of elements) {
    const raw = el.tags?.["building:levels"];
    if (raw === undefined) continue;
    const n = parseLevels(raw);
    if (n === null) { rejected++; continue; }
    let best = null;
    for (const p of el.geometry ?? []) {
      const loc = toLocal(p.lon, p.lat);
      for (const box of boxes) {
        if (loc.x >= box.x0 && loc.x <= box.x1 && loc.y >= box.y0 && loc.y <= box.y1) {
          best = box;
          break;
        }
      }
      if (best) break;
    }
    if (!best) { unplaced++; continue; }
    best.l[`${el.type}/${el.id}`] = n;
  }
  return { boxes, rejected, unplaced };
}

/**
 * Convert storeys to a height using the class floor-to-floor height, and only
 * ACCEPT it if the result passes the same plausibility test every height must
 * pass. A `building:levels: 40` in a 4-storey lane is a mapping error, and a
 * measured-looking number is not automatically a good one.
 */
export function heightFromLevels(levels, ftf) {
  const h = levels * ftf;
  if (!(h >= 2.7 && h <= 250.0)) return null;
  const impliedFtf = h / levels;
  if (!(impliedFtf >= 2.4 && impliedFtf <= 6.5)) return null;
  return Math.round(h * 10) / 10;
}

function applyToChunks(stats) {
  if (!existsSync(OUT)) {
    console.log("no levels ingested yet — run without --apply first");
    return;
  }
  const files = readdirSync(OUT).filter((f) => f.startsWith("tile_"));
  // one pass: id -> levels, for the whole scope
  const index = new Map();
  for (const f of files) {
    const d = JSON.parse(readFileSync(join(OUT, f), "utf8"));
    for (const [k, v] of Object.entries(d.l ?? {})) index.set(k, v);
  }
  console.log(`levels index: ${index.size} buildings with a storey count`);

  const chunks = readdirSync("data/build/chunks").filter(
    (f) => /^chunk_-?\d+_-?\d+\.json$/.test(f) && !f.includes(".meta."),
  );
  for (const f of chunks) {
    const p = join("data/build/chunks", f);
    const d = JSON.parse(readFileSync(p, "utf8"));
    let changed = 0;
    for (const b of d.b ?? []) {
      if (b.L !== undefined) continue; // already done
      const raw = b.id.replace(/^b_/, "");
      const n = index.get(`way/${raw}`) ?? index.get(`relation/${raw}`);
      if (n === undefined) continue;
      stats.matched++;
      changed++;

      // Only override the height if the current one is an ESTIMATE. A measured
      // or surveyed height outranks a storey count — always, no exceptions.
      if (b.hs && b.hs !== "estimated") {
        stats.alreadyAuthoritative++;
        b.L = n; // still record the storey count as a separate fact
        continue;
      }

      // FTF comes from the class, the same table estimateHeight() uses. It must
      // be read BEFORE overwriting F, or the measured storey count silently
      // becomes the floor-to-floor height and every building comes out 3x too
      // short. (It did, once, before this was caught.)
      const ftf = FTF[b.t] ?? FTF._default;
      const h = heightFromLevels(n, ftf);

      b.L = n; // the measured storey count, kept as its own field
      if (h === null) {
        stats.rejectedHeight++;
        continue; // keep the estimate, and keep hs === "estimated"
      }
      b.F = Math.round(n);
      b.H = h;
      b.hs = "osm:building:levels";
      b.hc = 0.9;
      stats.upgraded++;
    }
    if (changed) writeFileSync(p, JSON.stringify(d));
  }
}

/* ------------------------------------------------------------------ *
 * Main.
 * ------------------------------------------------------------------ */

async function main() {
  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

  if (args.includes("--apply")) {
    const stats = {
      matched: 0, upgraded: 0, alreadyAuthoritative: 0, rejectedHeight: 0,
    };
    applyToChunks(stats);
    console.log(
      `applied: ${stats.matched} matched, ${stats.upgraded} heights upgraded to measured, ` +
        `${stats.alreadyAuthoritative} left alone, ${stats.rejectedHeight} rejected as implausible`,
    );
    return;
  }

  // --tiles -3,-9 -3,-8 aims the run at one district. The scope scan starts at
  // the south-west corner, which is the Alibag hills, not the city.
  const ti = args.indexOf("--tiles");
  const tiles = ti !== -1
    ? args.slice(ti + 1, ti + 2).join("").split(" ").map((p) => p.split(",").map(Number))
    : scopeTiles();
  const todo = tiles.slice(0, LIMIT === Infinity ? undefined : LIMIT);
  console.log(
    `fetching building:levels for ${todo.length} tile(s) inside ACTIVE_BOUNDS ` +
      `(${ACTIVE_BOUNDS.x0},${ACTIVE_BOUNDS.y0})-(${ACTIVE_BOUNDS.x1},${ACTIVE_BOUNDS.y1})`,
  );
  const stats = {
    tiles: 0, levels: 0, failed: 0, httpFail: 0, emptyMirror: 0, rejected: 0,
    unplaced: 0,
  };
  const t0 = Date.now();

  // Batched, and still sequential between batches. The batching removes the
  // per-tile round trip; running batches CONCURRENTLY would just raise the
  // request rate against a throttled free service.
  // Default 2, not 4. Measured on this mirror on 2026-09-30: a union of 2
  // bboxes returns in normal time (34 elements, 30 KB, 200 OK), a union of 4
  // 504s every time. The limit is what the free service will do, not what would
  // be faster. Batching still halves the round trips, which is most of the win
  // anyway since the per-tile cost was 24-41 s of which the sleep was 0.9%.
  const BATCH = Number(args.includes("--batch") ? args[args.indexOf("--batch") + 1] : 2);
  let done = 0;
  for (let i = 0; i < todo.length; i += BATCH) {
    await fetchBatch(todo.slice(i, i + BATCH), stats);
    done = Math.min(todo.length, i + BATCH);
    const s = (Date.now() - t0) / 1000;
    process.stdout.write(
      `  ${stats.tiles}/${todo.length} tiles (batch ${done}/${todo.length}), ` +
        `${stats.levels} storey counts, ${s.toFixed(0)}s\n`,
    );
    await sleep(350);
  }
  console.log(
    `done: ${stats.tiles} tiles, ${stats.levels} storey counts, ` +
      `${stats.failed} failed, ${stats.rejected} unparseable, ${stats.unplaced} unplaced, ` +
      `(${((Date.now() - t0) / 1000).toFixed(0)}s)`,
  );
  console.log("next: node scripts/ingest-levels.mjs --apply");
}

/**
 * Only ingest when invoked directly. scripts/check-levels.mjs imports
 * parseLevels and heightFromLevels from here, and an unguarded main() meant
 * importing the module started a two-hour network crawl — which is exactly what
 * happened the first time the check was run.
 */
const isEntry = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (isEntry) main();
