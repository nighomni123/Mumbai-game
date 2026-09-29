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
 *     coordinates to centimetres, and drop the original degrees for the
 *     render payload (the raw WGS84 stays in data/build for provenance).
 *
 * This runs after ingest and before the renderer. It reads data/build/tile_*.json
 * and writes data/build/chunks/chunk_<gx>_<gy>.bin-ish JSON plus a global
 * index. Provenance is preserved in a parallel .meta file.
 *
 * Run: node scripts/enrich-chunks.mjs
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { toLocal, tileOf, TILE_M, tileBounds } from "./geo.mjs";

const IN = "data/build";
const OUT = "data/build/chunks";

/** Floor-to-floor and default storey heights for Greater Mumbai, in metres. */
const STOREY = { resi: 3.0, comm: 3.6, ind: 5.0 };

/**
 * Normalise a raw `type` string into a small set of facade classes. This is
 * the "semantic interpretation" step — the model decides what a building IS,
 * the data only says what OSM called it.
 */
export function classify(type, name) {
  const t = (type || "").toLowerCase();
  const n = (name || "").toLowerCase();
  if (/industrial|warehouse|factory|storage|tank|shed|godown|plant/.test(t + n)) return "industrial";
  if (/commercial|office|retail|mall|shop|market|hotel|bank|hospital|clinic|mall/.test(t + n)) return "commercial";
  if (/school|college|university|education|hostel/.test(t + n)) return "institutional";
  if (/temple|mosque|church|religious|shrine|gurudwara|mandir|masjid/.test(t + n)) return "religious";
  if (/apartment|residential|house|terrace|flat|chawl|bunglow|bungalow|society/.test(t)) return "residential";
  if (/infrastructure|transport|station|bridge|water|electricity|utility/.test(t + n)) return "infrastructure";
  return "residential"; // bare "Building"/unknown default to residential mass
}

/**
 * Conservative height heuristic. Given a footprint area (m2) and a facade
 * class, return a plausible Greater-Mumbai height. This is the documented
 * fallback used when no authoritative height exists; every result carries a
 * low `height_confidence` and `height_source: "estimate"` so nothing
 * downstream mistakes it for survey data.
 *
 * The rules encode real Mumbai stock: a 2-3 storey chawl ~9 m, a midrise
 * ~15-25 m, a residential tower 40-100 m, industrial sheds are tall and
 * flat. We are deliberately conservative (biased low) so the skyline never
 * over-claims.
 */
export function estimateHeight(areaM2, cls) {
  const A = Math.max(1, areaM2);
  const s = STOREY[cls] ?? STOREY.resi;
  let floors;
  if (cls === "industrial") {
    // large-footprint industrial is a shed, not a tower
    floors = A > 4000 ? 2 : A > 800 ? 3 : 1;
  } else if (cls === "commercial" || cls === "institutional") {
    floors = A > 6000 ? 14 : A > 2000 ? 8 : A > 600 ? 5 : 3;
  } else if (cls === "religious") {
    floors = 1; // temples/shrines are low, wide
  } else {
    // residential: small footprint => chawl/low-rise; large => tower
    floors = A > 5000 ? 26 : A > 2500 ? 16 : A > 1200 ? 10 : A > 500 ? 6 : A > 150 ? 3 : 2;
  }
  return { height_m: +(floors * s).toFixed(1), floors, height_source: "estimate", height_confidence: 0.3 };
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
    const h = estimateHeight(bld.area_m2, cls);

    // 3. project rings to local metres, quantise
    const localRing = ring.map(([lon, lat]) => {
      const p = toLocal(lon, lat);
      return [Q(p.x), Q(p.y)];
    });
    const holes = (bld.poly.slice(1) || []).map((hr) => hr.map(([lon, lat]) => {
      const p = toLocal(lon, lat);
      return [Q(p.x), Q(p.y)];
    }));

    const id = `b_${bld.id}`;
    const rec = {
      id,
      r: localRing,            // outer ring, local metres
      h: holes.length ? holes : null,
      c: [Q(c.x), Q(c.y)],     // centroid, local metres
      a: bld.area_m2,          // m2
      t: cls,                  // facade class (our semantic layer)
      o: bld.type,            // original OSM type, kept for provenance
      n: bld.name,            // name, if OSM had one
      H: h.height_m,          // resolved height (metres)
      F: h.floors,
      hs: h.height_source,    // "estimate" (enrich stage may upgrade to "overture"/"bmc")
      hc: h.height_confidence,
      sp: bld.source_priority, // provenance priority (2 = Mumbai_WFL1)
      src: bld.src,           // source string
    };
    chunkBuildings.push(rec);
    globalIndex.buildings.push({ id, tile: `${tgx},${tgy}`, src: bld.src, sp: bld.source_priority, height_source: h.height_source, name: bld.name, cls });
  }

  for (const st of d.streets || []) {
    const paths = (st.paths || []).map((pl) =>
      pl.map(([lon, lat]) => {
        const p = toLocal(lon, lat);
        return [Q(p.x), Q(p.y)];
      })
    );
    if (!paths.length) continue;
    chunkStreets.push({ id: st.id, p: paths, n: st.name, c: st.road_class, w: st.road_class });
  }

  chunkMeta.buildings = chunkBuildings.length;
  chunkMeta.streets = chunkStreets.length;
  if (chunkBuildings.length || chunkStreets.length) {
    writeFileSync(join(OUT, `chunk_${tgx}_${tgy}.json`), JSON.stringify({ b: chunkBuildings, s: chunkStreets }));
    writeFileSync(join(OUT, `chunk_${tgx}_${tgy}.meta.json`), JSON.stringify(chunkMeta));
  }
  return chunkMeta;
}

function main() {
  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
  const files = readdirSync(IN).filter((f) => /^tile_-?\d+_-?\d+\.json$/.test(f));
  const globalIndex = { buildings: [], streets: 0, tileM: TILE_M, stats: {} };
  let tb = 0, ts = 0, dropped = 0;

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
  globalIndex.stats = { tiles: files.length, buildings: tb, streets: ts, dedupedBoundaryBuildings: dropped };
  writeFileSync(join(OUT, "index.json"), JSON.stringify(globalIndex));
  console.log(`chunks built. buildings=${tb} streets=${ts} deduped=${dropped} tiles=${files.length}`);
}
main();
