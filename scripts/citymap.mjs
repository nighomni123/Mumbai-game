/**
 * Build the whole-city map layer: the road skeleton, and nothing else.
 *
 * This exists so you can SEE Greater Mumbai. The 3D world streams ~13k buildings
 * around the camera out of 260k, which means a lot of the city is only ever
 * present as a number in a manifest. A map of the whole thing, renderable in a
 * few milliseconds and readable at 300 pixels wide, changes that: you can point
 * at a district and say what is wrong with it.
 *
 * WHY SO FEW ROADS. The chunk set has 239,157 street polylines. Drawing all of
 * them at map scale is wasted work — at 4.5 m per pixel a local lane is a third
 * of a pixel, and 239k of them make the file ~40 MB and the frame unreadable.
 * The road_class histogram is the reason this is cheap:
 *
 *   class 1 (local lane)  218,599
 *   class 6 (arterial)     15,348
 *   class 3                 3,106
 *   class 5                 1,786
 *   class 2                   282
 *   class 4                    36
 *
 * So: every class >= 5, plus class 3. That is the network a city map is actually
 * made of, and it is ~20k polylines. Each is simplified to 150 m, which is about
 * one pixel at map scale, and clipped to 100 m quantisation.
 *
 * Named roads are worth keeping for the full-screen map even when unnamed ones
 * are not, so those are kept whole (still simplified) and tagged, so the map can
 * label the Sea Link and Sir Mathuradas Vasanji Road instead of the grid.
 *
 * Run:  node scripts/citymap.mjs [--force]
 */

import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { METRO_BOUNDS, simplify, pathLength } from "./geo.mjs";

const OUT = "data/build";
const CHUNKS = join(OUT, "chunks");
/** Simplify tolerance in metres — roughly one pixel on the 320 px map. */
const MAP_TOL_M = 150;
/** Quantise map coordinates to this, in metres. */
const MAP_Q_M = 10;
/** Road classes worth drawing. 1 is 91% of the network and is invisible here. */
const KEEP_CLASSES = new Set([3, 5, 6]);

const args = process.argv.slice(2);
const force = args.includes("--force");

function main() {
  const path = join(OUT, "citymap.json");
  if (!force && existsSync(path)) {
    console.error("citymap.json exists — pass --force to rebuild");
    return;
  }
  if (!existsSync(CHUNKS)) {
    console.error(`no ${CHUNKS} — run ingest + enrich first`);
    process.exit(1);
  }

  const q = (v) => Math.round(v / MAP_Q_M);
  /** Length of a flat [x0,y0,x1,y1,...] array, in QUANTISED units. */
  const lengthOf = (flat) => {
    let n = 0;
    for (let i = 0; i + 3 < flat.length; i += 2)
      n += Math.hypot(flat[i + 2] - flat[i], flat[i + 3] - flat[i + 1]);
    return n;
  };
  const roads = [];
  const named = [];
  let seen = 0;
  let kept = 0;
  let namedSeen = 0;

  for (const file of readdirSync(CHUNKS)) {
    if (!/^chunk_-?\d+_-?\d+\.json$/.test(file)) continue;
    const d = JSON.parse(readFileSync(join(CHUNKS, file), "utf8"));
    for (const s of d.s || []) {
      seen++;
      const cls = s.c ?? 1;
      if (!KEEP_CLASSES.has(cls)) continue;
      for (const p of s.p || []) {
        if (p.length < 2) continue;
        const flat = [];
        for (const pt of simplify(p, MAP_TOL_M)) flat.push(q(pt[0]), q(pt[1]));
        if (flat.length < 4) continue;
        kept++;
        roads.push(flat);
        // A name is worth carrying only for a road you could actually find on a
        // map. An earlier version of this kept every named road and pulled in
        // 85,760 of them — nearly all class-1 local lanes, which is 91% of the
        // network and, at map scale, invisible.
        if (!s.n) continue;
        namedSeen++;
        const len = lengthOf(flat) * MAP_Q_M;
        if (len >= 1200)
          named.push({
            i: s.id,
            n: s.n,
            len: Math.round(len),
            p: flat,
            c: cls,
          });
      }
    }
  }

  const longest = named.sort((a, b) => b.len - a.len).slice(0, 3000);

  const out = {
    v: 1,
    builtAt: new Date().toISOString(),
    note:
      "Road skeleton for the map view. Same ODbL 1.0 source as the chunk set — (c) OpenStreetMap contributors. " +
      "Road classes >= 3 and every named road; local lanes are omitted because at map scale they are sub-pixel.",
    bounds: METRO_BOUNDS,
    q: MAP_Q_M,
    of: seen,
    kept,
    roads,
    named: longest.map((r) => ({ i: r.i, n: r.n, len: r.len, p: r.p })),
  };

  writeFileSync(path, JSON.stringify(out));
  console.log(
    `DONE. ${kept} road polylines of ${seen} streets; ${namedSeen} of them named, ` +
      `${named.length} over 1.2 km kept for labels -> ${path} (${(JSON.stringify(out).length / 1e6).toFixed(2)} MB)`,
  );
  const top = longest
    .slice(0, 8)
    .map((r) => `${r.n} (${(r.len / 1000).toFixed(0)} km)`);
  if (top.length) console.log("longest named roads: " + top.join(", "));
}

main();
