/**
 * Ingest Greater Mumbai's WATER from the OpenStreetMap editing API.
 *
 * Why this source, and why not the alternatives actually tried:
 *
 *  - Overpass (`overpass-api.de`, `overpass.kumi.systems`, `overpass.private.coffee`)
 *    is the obvious tool and is what this would normally use, but all three
 *    mirrors failed from the machine this was written on (HTTP 406 / connection
 *    timeout). Verified 2026-09-30.
 *  - Overture `theme=base/type=water` IS anonymously reachable (verified on the
 *    Azure blob mirror) but is 128 parquet parts / 28.6 GB with no spatial
 *    pushdown on WKB. Not a sane one-shot import.
 *  - `api/0.6/map` is OSM's own document API, no key, no rate-limit policy, and
 *    it returns `natural=coastline` and `natural=water` in the bbox. It has a
 *    hard node budget per request and answers oversized bboxes with HTTP 400,
 *    so tiles adaptively subdivide instead of failing.
 *
 * WHY COASTLINE AND NOT A LAND POLYGON:
 * The renderer draws a ground quad for land and the sea ON TOP of it, as
 * ribbons. OSM's rule is that land is always on the LEFT of a
 * `natural=coastline` way as you walk along it, so the sea side is the RIGHT
 * normal. Emitting a wide quad strip on the sea side of every coastline way
 * covers the entire sea — harbour, back-bay and open ocean — and leaves the
 * islands alone, without ever having to assemble a closed land polygon from
 * unclosed, multiply-connected coastline ways. Two triangles per segment.
 *
 * Output: data/build/water.json — coast polylines + closed water rings, in the
 * same local metric frame as the building chunks (scripts/geo.mjs toLocal), so
 * the renderer never converts anything.
 *
 * ODbL: the output is a Derivative Database like the building chunks, and the
 * attribution is written INTO the file, not only into the app.
 *
 * Run:  node scripts/ingest-water.mjs [--tile 0.05] [--concurrency 6] [--force]
 */

import {
  writeFileSync,
  readFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { toLocal, METRO_BOUNDS, toWgs84, simplify } from "./geo.mjs";

const OUT = "data/build";
const API = "https://api.openstreetmap.org/api/0.6/map";
/** Identify the importer. OSM's API policy wants a real contact; this is honest. */
const UA = "BeachGameGeo/1.0 (one-off Mumbai geometry import)";

/** Douglas-Peucker tolerance in degrees (~8 m). Coastline is not a detail layer. */
const SIMPLIFY_DEG = 8 / 111320;
/** Below this many points a ring is noise, not a lake. */
const MIN_RING_PTS = 4;

const args = process.argv.slice(2);
const argVal = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : null;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ *
 * A minimal OSM XML scanner.
 *
 * The document is machine-generated and strictly regular, so a scanner is
 * both correct here and smaller than a dependency. Verified against three
 * live responses covering 2.7k-4.9k ways.
 * ------------------------------------------------------------------ */
function parseOsm(xml) {
  const nodes = new Map();
  const ways = new Map();

  const nodeRe =
    /<node\s+id="(-?\d+)"[^>]*?lat="([-\d.e+]+)"[^>]*?lon="([-\d.e+]+)"[^>]*\/?>/g;
  for (let m; (m = nodeRe.exec(xml)); ) {
    nodes.set(m[1], [parseFloat(m[3]), parseFloat(m[2])]); // [lon, lat]
  }

  // Split on <way …>…</way> so each chunk carries its own nd refs and tags.
  const wayRe = /<way\s+id="(-?\d+)"[^>]*>([\s\S]*?)<\/way>/g;
  for (let m; (m = wayRe.exec(xml)); ) {
    const refs = [];
    const ndRe = /<nd\s+ref="(-?\d+)"\s*\/>/g;
    for (let n; (n = ndRe.exec(m[2])); ) refs.push(n[1]);
    const tags = new Map();
    const tagRe = /<tag\s+k="([^"]*)"\s+v="([^"]*)"\s*\/>/g;
    for (let t; (t = tagRe.exec(m[2])); ) tags.set(t[1], t[2]);
    if (refs.length) ways.set(m[1], { refs, tags });
  }
  return { nodes, ways };
}

const isWater = (t) =>
  t.get("natural") === "water" ||
  t.get("waterway") === "riverbank" ||
  t.get("landuse") === "reservoir" ||
  t.get("landuse") === "basin";

/** Resolve a way's refs to coordinates, dropping unresolvable nodes. */
function coordsOf(way, nodes) {
  const out = [];
  for (const r of way.refs) {
    const p = nodes.get(r);
    if (p) out.push(p);
  }
  return out;
}

/** Drop repeated points and close the ring; null if the ring is not a ring. */
function saneRing(pts) {
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (
      !last ||
      Math.abs(last[0] - p[0]) > 1e-7 ||
      Math.abs(last[1] - p[1]) > 1e-7
    )
      out.push(p);
  }
  if (out.length > 2) {
    const a = out[0];
    const b = out[out.length - 1];
    if (Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7) out.pop();
  }
  return out.length >= MIN_RING_PTS ? out : null;
}

/**
 * The API's own connection is the fragile part: a 0.05-degree box can be a
 * 20-second, multi-megabyte response, and at concurrency 5 roughly half of
 * them came back as a bare "fetch failed" — a dropped connection, not a 4xx.
 * So the backoff has to be long enough to cover a whole request, and a box
 * that did not come back is deliberately NOT written to disk, which makes the
 * rerun pick it up instead of skipping it.
 */
async function fetchWithRetry(url, tries = 6) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (res.status === 400) {
        // Oversized request. Not retryable — the caller subdivides.
        const e = new Error("HTTP 400 (bbox too large)");
        e.tooBig = true;
        throw e;
      }
      if (res.status === 429 || res.status >= 500) {
        await sleep(Math.min(30000, 2000 * 2 ** i));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      if (e.tooBig) throw e;
      lastErr = e;
      await sleep(Math.min(30000, 1500 * 2 ** i));
    }
  }
  throw lastErr || new Error("fetch failed");
}

/**
 * One bbox -> its coast polylines and water rings, already simplified.
 * Subdivides on HTTP 400 down to MIN_TILE so dense areas never fail.
 */
async function fetchBox(w, s, e, n, acc) {
  let xml;
  try {
    xml = await fetchWithRetry(`${API}?bbox=${w},${s},${e},${n}`);
  } catch (err) {
    if (err.tooBig) {
      const mw = (w + e) / 2;
      const ms = (s + n) / 2;
      if (e - w > MIN_TILE || n - s > MIN_TILE) {
        await fetchBox(w, s, mw, ms, acc);
        await fetchBox(mw, ms, e, n, acc);
        return;
      }
      acc.failed.push({ bbox: [w, s, e, n], err: "400 at minimum tile" });
      return;
    }
    acc.failed.push({ bbox: [w, s, e, n], err: String(err).slice(0, 100) });
    return;
  }

  const { nodes, ways } = parseOsm(xml);
  for (const [id, way] of ways) {
    const t = way.tags;
    const isCoast = t.get("natural") === "coastline";
    if (!isCoast && !isWater(t)) continue;

    const pts = coordsOf(way, nodes);
    if (pts.length < MIN_RING_PTS) continue;

    // A way can fall in more than one tile. Keep the longest copy seen: the API
    // returns whole ways, and a duplicate is identical, so this is only a guard
    // against a split at a tile edge.
    const prev = acc.seen.get(id);
    if (prev !== undefined && prev >= pts.length) continue;
    acc.seen.set(id, pts.length);

    const simple = simplify(pts, SIMPLIFY_DEG);
    if (simple.length < 2) continue;

    if (isCoast) {
      acc.coast.push({ id, p: simple });
    } else {
      const ring = saneRing(simple);
      // A closed water polygon is a hole in the land; a way that does not close
      // is an unclosed mapping, and drawing it as a sea ribbon would be a lie.
      if (ring) acc.water.push({ id, r: ring });
    }
  }
}

const MIN_TILE = 0.01;

async function main() {
  const tile = parseFloat(argVal("--tile") || "0.05");
  const workers = parseInt(argVal("--concurrency") || "6", 10);
  const force = args.includes("--force");

  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

  const w0 = toWgs84(METRO_BOUNDS.x0, METRO_BOUNDS.y0).lon;
  const e0 = toWgs84(METRO_BOUNDS.x1, METRO_BOUNDS.y0).lon;
  const s0 = toWgs84(METRO_BOUNDS.x0, METRO_BOUNDS.y0).lat;
  const n0 = toWgs84(METRO_BOUNDS.x0, METRO_BOUNDS.y1).lat;

  // --bbox w,s,e,n overrides METRO_BOUNDS: a district rebuild, or a one-box
  // smoke test before committing to the full metro.
  const bb = argVal("--bbox");
  const [ow, os_, oe, on] = bb ? bb.split(",").map(Number) : [w0, s0, e0, n0];

  const boxes = [];
  // --merge-only rebuilds water.json from the boxes already on disk and makes
  // no network requests at all. The fetch half of this script is slow and
  // failure-prone (see fetchWithRetry); changing the mask algorithm should not
  // require re-fetching a gigabyte to test it.
  const mergeOnly = args.includes("--merge-only");
  if (!mergeOnly) {
    for (let s = os_; s < on - 1e-9; s += tile) {
      for (let w = ow; w < oe - 1e-9; w += tile) {
        const key = `${w.toFixed(4)}_${s.toFixed(4)}`;
        const p = join(OUT, `wtile_${key}.json`);
        if (!force && existsSync(p)) continue;
        boxes.push({
          w,
          s,
          e: Math.min(w + tile, oe),
          n: Math.min(s + tile, on),
          key,
        });
      }
    }
  }

  console.error(
    `${mergeOnly ? "merging only — no network" : `ingesting ${boxes.length} water boxes (tile ${tile}deg, ${workers} workers)`} over lon ${ow.toFixed(3)}-${oe.toFixed(3)} lat ${os_.toFixed(3)}-${on.toFixed(3)}`,
  );

  // Per-box results are written as they land, so a long run is resumable and a
  // crash costs at most one box. The merge at the end re-reads every box on
  // disk, which is also how a resumed run picks up work a previous run finished.
  const queue = [...boxes];
  let done = 0;

  if (boxes.length) {
    async function worker() {
      for (;;) {
        const b = queue.shift();
        if (!b) return;
        const local = { coast: [], water: [], failed: [], seen: new Map() };
        await fetchBox(b.w, b.s, b.e, b.n, local);
        // A box that came back empty because the connection dropped is not
        // "empty", it is "unknown". Writing it would make the resume skip it
        // forever, so only fully-successful boxes are recorded.
        if (local.failed.length) continue;
        writeFileSync(
          join(OUT, `wtile_${b.key}.json`),
          JSON.stringify({
            bbox: [b.w, b.s, b.e, b.n],
            coast: local.coast,
            water: local.water,
            failed: [],
          }),
        );
        done++;
        if (done % 10 === 0)
          process.stderr.write(`  ${done}/${boxes.length} boxes\n`);
      }
    }
    await Promise.all(Array.from({ length: workers }, worker));
  }

  // De-duplicate ways that straddle a box edge, preferring the longest copy.
  const coast = new Map();
  const water = new Map();
  const failed = [];
  for (const file of readdirSync(OUT)) {
    if (!file.startsWith("wtile_")) continue;
    const t = JSON.parse(readFileSync(join(OUT, file), "utf8"));
    for (const c of t.coast)
      if (!coast.has(c.id) || coast.get(c.id).p.length < c.p.length)
        coast.set(c.id, c);
    for (const w of t.water)
      if (!water.has(w.id) || water.get(w.id).r.length < w.r.length)
        water.set(w.id, w);
    failed.push(...(t.failed || []));
  }

  const project = (p) => {
    const l = toLocal(p[0], p[1]);
    return [Math.round(l.x * 100) / 100, Math.round(l.y * 100) / 100];
  };

  const coastWays = [...coast.values()].map((c) => ({
    i: c.id,
    p: c.p.map(project),
  }));
  const waterRings = [...water.values()].map((w) => ({
    i: w.id,
    r: w.r.map(project),
  }));

  const mask = buildLandMask(coastWays, waterRings, METRO_BOUNDS);

  const out = {
    v: 2,
    builtAt: new Date().toISOString(),
    source: "osm-api/0.6/map",
    licence: "ODbL 1.0.0",
    attribution: "(c) OpenStreetMap contributors",
    note:
      "Derivative Database. `land` is a scanline land mask derived from the OSM coastline convention (land on the left of a natural=coastline way); " +
      "the renderer draws the sea everywhere and lays land on top, so a gap in the coastline reads as water rather than as land. " +
      "`coast` and `water` are kept for provenance and for anything that needs the raw geometry.",
    bounds: METRO_BOUNDS,
    ...mask,
    coast: coastWays,
    water: waterRings,
  };

  const path = join(OUT, "water.json");
  writeFileSync(path, JSON.stringify(out));
  const bytes = JSON.stringify(out).length;
  console.log(
    `\nDONE. coast=${coastWays.length} water=${waterRings.length} failed=${failed.length}\n` +
      `     land mask: ${mask.land.length / 3} runs over ${mask.maskRows} rows x ${mask.maskCols} cols @ ${mask.maskCellM} m\n` +
      `     -> ${path} (${(bytes / 1e6).toFixed(2)} MB)`,
  );
  if (failed.length)
    console.log(
      "failed boxes:",
      failed.length,
      "— rerun to retry (resume keeps finished boxes)",
    );
}

/* ------------------------------------------------------------------ *
 * The land mask.
 *
 * The first version of this drew a 120 km ribbon on the seaward side of every
 * coastline way. It is the obvious reading of the OSM rule and it is wrong:
 * a ribbon that long reaches across the whole metro, so every land point that
 * happens to fall on the seaward side of some segment 20 km away — Thane, 23 km
 * from the Ulhas backwaters, among them — gets painted sea. The rule is correct;
 * an unbounded strip built on it is not.
 *
 * So this answers the question properly, with a scanline fill. For each row of
 * the grid, collect every coastline crossing, sorted left to right, and pair
 * them. Land is always on the LEFT of a coastline way, and the left of a
 * heading (dx, dy) is (-dy, dx):
 *
 *   DOWNWARD segment (ay > by): dy < 0, so -dy > 0 and land lies at SMALLER x?
 *      No — larger x. Walking the scanline eastward, a downward crossing is
 *      where you step ONTO land.
 *   UPWARD segment (ay < by): dy > 0, so -dy < 0 and land lies at smaller x.
 *      Walking eastward, that is where you step OFF land.
 *
 * So downward starts an interval and upward closes it. (Getting this backwards
 * is easy and it looks plausible: it produced a mask where CSMT was land and
 * the Gateway promontory was sea.)
 *
 * Row y is the only thing quantised (50 m) — the interval endpoints are the
 * exact crossing coordinates, so the coastline follows the real geometry rather
 * than a staircase of cell centres.
 *
 * No ring assembly, no polygon boolean, and no dependence on the coastline
 * closing into loops — which it does not reliably do, especially around
 * reclaimed land. A coastline that stops mid-run simply ends its land interval,
 * which reads as water: honest, and visible, and fixed by better data.
 * ------------------------------------------------------------------ */
const MASK_CELL_M = 50;

function buildLandMask(coastWays, waterRings, bounds) {
  const cols = Math.ceil((bounds.x1 - bounds.x0) / MASK_CELL_M);
  const rows = Math.ceil((bounds.y1 - bounds.y0) / MASK_CELL_M);

  /** @type {{x:number, up:boolean}[][]} crossings per row */
  const rowsOf = Array.from({ length: rows }, () => []);
  for (const { p } of coastWays) {
    for (let i = 0; i < p.length - 1; i++) {
      const [ax, ay] = p[i];
      const [bx, by] = p[i + 1];
      if (ay === by) continue; // horizontal: crosses nothing
      const lo = Math.min(ay, by);
      const hi = Math.max(ay, by);
      const r0 = Math.max(0, Math.floor((lo - bounds.y0) / MASK_CELL_M));
      const r1 = Math.min(rows - 1, Math.floor((hi - bounds.y0) / MASK_CELL_M));
      for (let r = r0; r <= r1; r++) {
        const y = bounds.y0 + (r + 0.5) * MASK_CELL_M;
        // half-open on the top edge so a vertex shared by two segments is
        // counted once rather than twice
        if (y < lo || y >= hi) continue;
        const t = (y - ay) / (by - ay);
        rowsOf[r].push({ x: ax + (bx - ax) * t, up: by > ay });
      }
    }
  }

  const land = [];
  for (let r = 0; r < rows; r++) {
    const xs = rowsOf[r];
    if (!xs.length) continue;
    xs.sort((a, b) => a.x - b.x);
    let open = null;
    for (const c of xs) {
      // Land is on the LEFT of a coastline way. Left of (dx, dy) is (-dy, dx),
      // so a downward segment (dy < 0) puts land at larger x — walking the
      // scanline eastward you step ONTO land there. Upward is the exit.
      if (!c.up) {
        if (open === null) open = c.x;
      } else if (open !== null) {
        if (c.x > open)
          land.push(
            r,
            Math.round(open * 100) / 100,
            Math.round(c.x * 100) / 100,
          );
        open = null;
      }
    }
    // A land interval still open at the right edge of the metro: the coastline
    // left the data before it closed. Close it at the edge rather than dropping
    // it, which would paint a false bay across the suburbs.
    if (open !== null) land.push(r, Math.round(open * 100) / 100, bounds.x1);
  }

  // Closed water bodies are land, so far, until they say otherwise. Punch them
  // out of every interval whose row they touch.
  const lakes = waterRings.map((w) => w.r).filter((r) => r.length >= 4);
  if (lakes.length) {
    /** @type {Map<number, number[]>} row -> [x0, x1, ...] water intervals */
    const holes = new Map();
    for (const ring of lakes) {
      let minY = Infinity;
      let maxY = -Infinity;
      for (const [, y] of ring) {
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      const r0 = Math.max(0, Math.floor((minY - bounds.y0) / MASK_CELL_M));
      const r1 = Math.min(
        rows - 1,
        Math.floor((maxY - bounds.y0) / MASK_CELL_M),
      );
      for (let r = r0; r <= r1; r++) {
        const y = bounds.y0 + (r + 0.5) * MASK_CELL_M;
        if (y < minY || y > maxY) continue;
        // Scanline intersections with the ring, even-odd.
        //
        // The ring is CLOSED for this walk. saneRing() stores rings open — the
        // duplicated closing vertex is dropped — so iterating to length-1 drops
        // the final edge, the scanline sees an odd number of crossings, the
        // parity inverts, and the lake punches the wrong side of itself.
        const cuts = [];
        for (let i = 0; i < ring.length; i++) {
          const j = (i + 1) % ring.length;
          const [ax, ay] = ring[i];
          const [bx, by] = ring[j];
          if (ay === by) continue;
          if (y < Math.min(ay, by) || y >= Math.max(ay, by)) continue;
          cuts.push(ax + ((bx - ax) * (y - ay)) / (by - ay));
        }
        cuts.sort((a, b) => a - b);
        if (cuts.length < 2) continue;
        const list = holes.get(r) || [];
        for (let i = 0; i + 1 < cuts.length; i += 2)
          list.push(cuts[i], cuts[i + 1]);
        holes.set(r, list);
      }
    }

    // Merge the holes BEFORE punching. Two lakes can cross the same scanline and
    // overlap — Powai and the creek beside it do — and punching them one at a
    // time subtracts each from the other's already-punched result, leaving
    // slivers of land floating in the middle of the water.
    land.sort((p, q) => p[0] - q[0]);
    for (const [r, iv] of holes) {
      iv.sort((a, b) => a - b);
      let minX = Infinity;
      let maxX = -Infinity;
      for (let i = 0; i < iv.length; i += 2) {
        const a = iv[i];
        const b = iv[i + 1];
        if (a <= maxX) maxX = Math.max(maxX, b);
        else {
          if (minX < Infinity) punch(land, r, minX, maxX);
          minX = a;
          maxX = b;
        }
      }
      if (minX < Infinity) punch(land, r, minX, maxX);
    }
  }

  return { maskCellM: MASK_CELL_M, maskCols: cols, maskRows: rows, land };
}

/**
 * Remove [a,b] from the land runs of one row, splitting an interval if needed.
 *
 * `land` must be sorted by row first (it is, just above), so this only ever
 * has to walk the triples belonging to `row` and rewrite them in place. The
 * previous version re-sorted the whole array on every call and re-scanned it
 * from the start, which was quadratic in the number of lakes.
 */
function punch(land, row, a, b) {
  let first = -1;
  for (let i = 0; i < land.length; i += 3) {
    if (land[i] === row) {
      first = i;
      break;
    }
  }
  if (first < 0) return;
  let span = 0;
  while (first + span < land.length && land[first + span] === row) span += 3;

  const kept = [];
  for (let i = first; i < first + span; i += 3) {
    const x0 = land[i + 1];
    const x1 = land[i + 2];
    if (b <= x0 || a >= x1) {
      kept.push(row, x0, x1);
      continue;
    }
    if (a > x0) kept.push(row, x0, Math.min(a, x1));
    if (b < x1) kept.push(row, Math.max(b, x0), x1);
  }
  land.splice(first, span, ...kept);
}

main().catch((e) => {
  console.error("WATER INGEST FAILED:", e);
  process.exit(1);
});
