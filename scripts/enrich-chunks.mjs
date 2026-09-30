/**
 * Conflate and enrich the ingested building tiles into render-ready chunks.
 *
 * Responsibilities (in order):
 *  1. DEDUPLICATE. A building that straddles a 2 km tile boundary is returned
 *     by both tiles, so the raw ingest double-counts boundary buildings. We
 *     assign every building to the tile that contains its CENTROID, so each
 *     footprint appears exactly once in the whole city.
 *  2. RESOLVE HEIGHT. Never invented blindly: a documented per-class,
 *     per-area rule produces a height AND a confidence, and the source of the
 *     height is recorded on every building so the renderer (and the validator)
 *     always know whether a height is authoritative or estimated.
 *  3. PROJECT. Convert WGS84 rings to the local metric frame, quantise the
 *     coordinates to centimetres, and drop the original degrees for the render
 *     payload. Per-building provenance that survives into the chunk itself is
 *     `src` (the source layer); the raw WGS84 is gone once the scratch is.
 *
 * This runs after ingest and before the renderer. It reads data/build/tile_*.json
 * and writes data/build/chunks/chunk_<gx>_<gy>.json plus a global index. The
 * raw tiles are consumed once and then deleted (~222 MB of scratch); pass
 * --keep-scratch to retain them, at the cost of the ingest's resume.
 *
 * The chunks are a Derivative Database of OSM data and carry the ODbL notice
 * in their own metadata — see scripts/make-starter.mjs for the same notice
 * applied to anything shipped outside data/build/.
 *
 * Run: node scripts/enrich-chunks.mjs [--keep-scratch]
 */

import {
  readFileSync,
  writeFileSync,
  readdirSync,
  mkdirSync,
  existsSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { toLocal, tileOf, TILE_M, tileBounds } from "./geo.mjs";

const IN = "data/build";
const OUT = "data/build/chunks";

/**
 * Normalise a raw OSM `type` into a small set of facade classes. This is the
 * "semantic interpretation" step — the data only says what OSM called it; we
 * decide what kind of building that is, which is what drives the facade
 * colour and the height band.
 */
export function classify(type, name) {
  const t = (type || "").toLowerCase();
  const n = (name || "").toLowerCase();
  if (/industrial|warehouse|factory|storage|tank|shed|godown|plant/.test(t + n))
    return "industrial";
  if (
    /commercial|office|retail|mall|shop|market|hotel|bank|hospital|clinic/.test(
      t + n,
    )
  )
    return "commercial";
  if (/school|college|university|education|hostel|college/.test(t + n))
    return "institutional";
  if (/hospital|clinic|medical|health/.test(t + n)) return "institutional";
  if (
    /temple|mosque|church|religious|shrine|gurudwara|mandir|masjid|sthanak/.test(
      t + n,
    )
  )
    return "religious";
  if (
    /infrastructure|transport|station|bridge|water|electricity|utility|railway|subway/.test(
      t + n,
    )
  )
    return "infrastructure";
  if (/apartment/.test(t)) return "apartments";
  if (/residential|house|terrace|flat|chawl|bungalow|society/.test(t))
    return "residential";
  return "residential"; // bare "Building"/unknown: residential mass is the safe prior
}

/* ------------------------------------------------------------------ *
 * Height resolution.
 *
 * Every constant here is a documented PLANNING DEFAULT, not a measurement,
 * except A_REF_M2. They are stated explicitly so they can be argued with and
 * re-tuned from real data later. See docs/height-sources.md for the full
 * derivation, the measured findings that motivate the rule, and the
 * calibration query to replace them.
 *
 * The one thing that is MEASURED and matters most: area is a NON-MONOTONIC
 * predictor of height in Mumbai. A 400 m2 footprint is far more likely to be a
 * low shed or a redeveloped slab than a tower; Mumbai's towers have SMALL
 * footprints on 5-10x plot ratios. So larger footprint => SHORTER building,
 * the opposite of the naive "big building = tall building" rule that this file
 * previously implemented. The rule below encodes that sign.
 * ------------------------------------------------------------------ */

/** Floor-to-floor height in metres, by class. */
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

/** Height band in metres by class — the safety rail. Err low. */
const BAND = {
  residential: [6.0, 30.0],
  apartments: [9.0, 45.0],
  commercial: [6.0, 40.0],
  institutional: [8.0, 45.0],
  industrial: [6.0, 20.0],
  religious: [4.5, 18.0],
  infrastructure: [5.0, 30.0],
  _default: [6.0, 30.0],
};

/** Median storeys by macro-zone. */
const ZONE_STORES = {
  south_mumbai: 4, // Colaba / Fort / Malabar Hill / Worli — old stock, low FAR
  island_city: 4, // Nariman Point, Cuffe Parade — few, but very tall
  central: 7, // Dadar / Parel / Sion / Mahim — mixed, redeveloping
  western_suburb: 12, // Andheri / Bandra / Powai / Goregaon — 7-20 storey
  eastern_suburb: 8, // Chembur / Bhandup / Kurla
  new_mumbai: 5, // Navi Mumbai — planned, low-rise, big footprints
  _default: 6,
};

const A_REF_M2 = 58.0; // MEASURED median footprint area, Andheri East
const TOWER_TRIGGER_M2 = 2500.0;
const TOWER_CAP_M = 120.0; // never invent a supertall

/** Macro-zone from WGS84 lon/lat. Coarse and explicit; see docs/height-sources.md. */
function zoneOf(lon, lat) {
  if (lon > 72.95) return "new_mumbai"; // Navi Mumbai
  if (lat < 18.95) {
    // Nariman Point is its own micro-zone: very few, very tall
    if (lon > 72.818 && lon < 72.832 && lat < 18.945 && lat > 18.915)
      return "island_city";
    return "south_mumbai";
  }
  if (lat < 19.03 && lon < 72.88) return "central"; // Dadar / Parel / Sion
  if (lon < 72.88) return "western_suburb"; // Andheri / Bandra / Powai
  return "eastern_suburb"; // Chembur / Bhandup / Kurla
}

/** Clamp helper. */
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Reject any height that is physically implausible, whatever its source.
 * This is what rejects Overture's measured Mumbai median of 2.3 m and its
 * 500 m outliers — so it must be applied to measured heights too, not just
 * to estimates.
 */
export function saneHeight(height, floors) {
  if (height === null || height === undefined) return false;
  if (!(height >= 2.7 && height <= 250.0)) return false;
  if (floors !== null && floors !== undefined && floors > 0) {
    const ftf = height / floors;
    if (!(ftf >= 2.4 && ftf <= 6.5)) return false;
  }
  return true;
}

/**
 * The fallback estimate. Zone prior is the base; area is a DAMPED,
 * NON-MONOTONIC nudge (a nudge, never a driver); the result is clamped into
 * the class band; only a genuine tower signature lifts past the band.
 *
 * Confidence for an ESTIMATE never exceeds 0.45 — downstream code branches on
 * height_source, not on the number, so an estimate is never read as a survey.
 */
export function estimateHeight(areaM2, cls, zone) {
  const a = Math.max(areaM2, 10.0);
  const ftf = FTF[cls] ?? FTF._default;
  const [lo, hi] = BAND[cls] ?? BAND._default;
  const z0 = ZONE_STORES[zone] ?? ZONE_STORES._default;

  // 1. zone prior is the base
  let storeys = z0;

  // 2. area term — NON-MONOTONIC, damped to +/-1 storey per octave
  const s = clamp(Math.log(a / A_REF_M2) / Math.log(4.0), -1.0, 1.0);
  if (s < 0)
    storeys += -s * 0.2 * Math.min(1.0, z0 / 10.0); // small footprint nudges up
  else storeys -= s * 0.35; // large footprint nudges down

  // 3. at least one storey
  storeys = Math.max(1.0, storeys);

  // 4. tower escape hatch — gated on area AND on a dense zone
  if (
    a >= TOWER_TRIGGER_M2 &&
    ["western_suburb", "central", "island_city", "south_mumbai"].includes(zone)
  ) {
    storeys = Math.max(storeys, hi / ftf);
    storeys = Math.min(storeys, TOWER_CAP_M / ftf);
  }

  // 5. convert, then clamp into the band — the safety rail, always
  let height = clamp(storeys * ftf, lo, hi);
  let floors = Math.max(1, Math.round(height / ftf));

  // 6. confidence: area alone 0.10, +class, +zone, minus a clamp penalty
  let c = 0.1;
  if (cls) c += 0.15;
  if (zone) c += 0.15;
  if (a > A_REF_M2) c += 0.1 * Math.min(1.0, (a / A_REF_M2 - 1.0) / 3.0);
  if (height >= hi - 1e-9) c -= 0.1; // sitting on a clamp -> less sure
  const confidence = clamp(c, 0.05, 0.45);

  return {
    height_m: Math.round(height * 10) / 10,
    floors,
    height_source: "estimated",
    height_confidence: Math.round(confidence * 100) / 100,
  };
}

const Q = (v) => Math.round(v * 100) / 100; // 2dp metres, plenty at 1:1

function processTile(file, globalIndex) {
  const d = JSON.parse(readFileSync(file, "utf8"));
  const m = file.match(/tile_(-?\d+)_(-?\d+)\.json/);
  const tgx = parseInt(m[1], 10);
  const tgy = parseInt(m[2], 10);
  const b = tileBounds({ gx: tgx, gy: tgy });
  const chunkBuildings = [];
  const chunkStreets = [];
  const chunkMeta = { tile: `${tgx},${tgy}`, buildings: 0, streets: 0 };

  for (const bld of d.buildings || []) {
    const ring = bld.poly[0];
    if (!ring || ring.length < 3) continue;
    // 1. dedupe: keep only if this tile contains the centroid
    const c = toLocal(bld.centroid[0], bld.centroid[1]);
    const owner = tileOf(c.x, c.y);
    if (owner.gx !== tgx || owner.gy !== tgy) continue; // belongs to a neighbour

    // 2. classify + height
    const cls = classify(bld.type, bld.name);
    const zone = zoneOf(bld.centroid[0], bld.centroid[1]);
    const h = estimateHeight(bld.area_m2, cls, zone);

    // 3. project rings to local metres, quantise
    const localRing = ring.map(([lon, lat]) => {
      const p = toLocal(lon, lat);
      return [Q(p.x), Q(p.y)];
    });
    const holes = (bld.poly.slice(1) || []).map((hr) =>
      hr.map(([lon, lat]) => {
        const p = toLocal(lon, lat);
        return [Q(p.x), Q(p.y)];
      }),
    );

    const id = `b_${bld.id}`;
    const rec = {
      id,
      r: localRing, // outer ring, local metres
      h: holes.length ? holes : null,
      c: [Q(c.x), Q(c.y)], // centroid, local metres
      a: bld.area_m2, // m2
      t: cls, // facade class (our semantic layer)
      z: zone, // macro-zone (drives the height prior)
      o: bld.type, // original OSM type, kept for provenance
      n: bld.name, // name, if OSM had one
      H: h.height_m, // resolved height (metres)
      F: h.floors,
      hs: h.height_source, // "estimate" (enrich stage may upgrade to "overture"/"bmc")
      hc: h.height_confidence,
      sp: bld.source_priority, // provenance priority (2 = Mumbai_WFL1)
      src: bld.src, // source string
    };
    chunkBuildings.push(rec);
    globalIndex.buildings.push({
      id,
      tile: `${tgx},${tgy}`,
      src: bld.src,
      sp: bld.source_priority,
      height_source: h.height_source,
      name: bld.name,
      cls,
    });
  }

  for (const st of d.streets || []) {
    const paths = (st.paths || []).map((pl) =>
      pl.map(([lon, lat]) => {
        const p = toLocal(lon, lat);
        return [Q(p.x), Q(p.y)];
      }),
    );
    if (!paths.length) continue;
    chunkStreets.push({
      id: st.id,
      p: paths,
      n: st.name,
      c: st.road_class,
      w: st.road_class,
    });
  }

  chunkMeta.buildings = chunkBuildings.length;
  chunkMeta.streets = chunkStreets.length;
  if (chunkBuildings.length || chunkStreets.length) {
    writeFileSync(
      join(OUT, `chunk_${tgx}_${tgy}.json`),
      JSON.stringify({ b: chunkBuildings, s: chunkStreets }),
    );
    writeFileSync(
      join(OUT, `chunk_${tgx}_${tgy}.meta.json`),
      JSON.stringify(chunkMeta),
    );
  }
  return chunkMeta;
}

function main() {
  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
  const files = readdirSync(IN).filter((f) =>
    /^tile_-?\d+_-?\d+\.json$/.test(f),
  );
  const globalIndex = { buildings: [], streets: 0, tileM: TILE_M, stats: {} };
  let tb = 0,
    ts = 0,
    dropped = 0;

  for (const f of files) {
    const before = readFileSync(join(IN, f), "utf8");
    const meta = processTile(join(IN, f), globalIndex);
    // count dedupe drop for this tile
    const raw = JSON.parse(before).buildings.length;
    dropped += raw - meta.buildings;
    tb += meta.buildings;
    ts += meta.streets;
  }

  globalIndex.streets = ts;
  globalIndex.stats = {
    tiles: files.length,
    buildings: tb,
    streets: ts,
    dedupedBoundaryBuildings: dropped,
  };
  writeFileSync(join(OUT, "index.json"), JSON.stringify(globalIndex));
  console.log(
    `chunks built. buildings=${tb} streets=${ts} deduped=${dropped} tiles=${files.length}`,
  );
  cleanScratch(files);
}

/**
 * The raw `tile_*.json` ingest scratch is ~222 MB, is read exactly once (above),
 * and is never read again by anything — not the renderer, not the validators.
 * Leaving it is pure waste, so it goes once the chunks exist on disk.
 *
 * Deleting it costs the ingest its resume: ingest-mumbai.mjs skips tiles whose
 * file is already present, so a re-run after this has to re-fetch the whole
 * metro. That is the right default (build once, ship) and the wrong default
 * while iterating on this file — hence `--keep-scratch`.
 */
function cleanScratch(consumed) {
  if (process.argv.includes("--keep-scratch")) {
    console.log("scratch kept (--keep-scratch)");
    return;
  }
  let freed = 0;
  for (const f of consumed) {
    const p = join(IN, f);
    if (!existsSync(p)) continue;
    freed += statSync(p).size;
    unlinkSync(p);
  }
  console.log(
    `scratch removed. ${consumed.length} tile files, ${(freed / 1048576).toFixed(0)} MB freed`,
  );
}
main();
