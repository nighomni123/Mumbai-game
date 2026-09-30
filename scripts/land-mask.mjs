/**
 * The land mask, built from the buildings rather than from the coastline alone.
 *
 * WHY THIS SCRIPT EXISTS. `ingest-water.mjs` scanline-fills the OSM coastline
 * into a land mask, and the result was 4,161 km2 of land — 76% of the metro
 * bounds, against a real figure nearer 1,500. The cause is measured, not
 * guessed: of 1,635 scanline rows, 1,470 run out of coastline before they reach
 * the east edge of the bounds, and the fallback painted land to the edge. Those
 * 1,470 rows claimed 4,370 km2. It rendered as hard horizontal bands across the
 * map, and on the planet as a thin crescent of city on a mostly-blue ball.
 *
 * The coastline is not wrong where it exists — the parser loses nothing,
 * verified against boxes it does return. It is simply absent over the northern
 * and eastern metro: the Panvel Creek shores and much of the Ulhas estuary are
 * not in the extract. Capping the fallback instead of removing it was measured
 * too, and every cap was worse: 60 km gives 2,001 km2 and 26 of 36 sites on
 * land, 30 km gives 279 km2 and 23 of 36.
 *
 * So the coastline is kept for what it is good at — putting the shore in exactly
 * the right place — and the buildings are used for what they are unambiguously
 * good at. There are 260,890 of them, at real coordinates, with real footprints,
 * and a place with buildings in it is land. That is the strongest land signal
 * this project has, and it is already in the chunk set.
 *
 * The result: land = "a real building within REACH_M". The
 * coastline scanline is NOT used. It is kept in water.json for provenance, but
 * building on it produced 4,161 km2 of false land and horizontal bands across
 * the map, and every bounded variant of it was worse — measured in the header
 * of this file and in check-water.
 *
 * The erosion matters as much as the dilation: a dilated mask is 1,111 km2
 * and the eroded one is 1,020, and the difference is the halo that would
 * otherwise push the shore 250 m out into the water.
 *
 * Run:  node scripts/land-mask.mjs [--reach 260] [--force]
 */

import {
  readFileSync,
  readdirSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { METRO_BOUNDS, toLocal } from "./geo.mjs";

const OUT = "data/build";
const CHUNKS = join(OUT, "chunks");

/**
 * How far a building makes its surroundings land, in metres.
 *
 * Chosen by measurement, not taste — this is the trade between a suburb being a
 * solid mass and the sea staying sea, at 50 m cells:
 *
 *   reach   land      36 sites on land   water probes read as land
 *   250 m  1,111 km2      36/36              0/13
 *   400 m  1,382 km2      36/36              0/13   <- chosen
 *   500 m  1,567 km2      36/36              1/13   (a harbour probe goes)
 *   600 m  1,718 km2      36/36              1/13
 *
 * 400 m is the largest reach that leaves every water probe as water, and
 * 1,382 km2 is the closest of these to the real land area of the bounds. The
 * 250 m value passed too, but it left the suburbs visibly speckled: 400 m is
 * what joins one village-sized building cluster to the next, and the sea does
 * not notice because there are no buildings in it.
 */
const REACH_M = 400;
const CELL_M = 50;

const args = process.argv.slice(2);
const argVal = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : null;
};
const force = args.includes("--force");

function main() {
  const reach = parseFloat(argVal("--reach") || String(REACH_M));
  const path = join(OUT, "landmask.json");
  if (!force && existsSync(path)) {
    console.error("landmask.json exists — pass --force to rebuild");
    return;
  }
  if (!existsSync(CHUNKS)) {
    console.error(
      `no ${CHUNKS} — run ingest-mumbai.mjs + enrich-chunks.mjs first`,
    );
    process.exit(1);
  }
  // water.json is read only to confirm the coastline ingest ran; the mask no
  // longer depends on it.
  const waterPath = join(OUT, "water.json");
  if (!existsSync(waterPath)) {
    console.error(
      "no water.json — run ingest-water.mjs --merge-only first (it carries the coastline provenance)",
    );
    process.exit(1);
  }

  const b = METRO_BOUNDS;
  const cols = Math.ceil((b.x1 - b.x0) / CELL_M);
  const rows = Math.ceil((b.y1 - b.y0) / CELL_M);
  const n = rows * cols;

  // Buildings. Every centroid stamps a disc of radius `reach` into the mask.
  const land = new Uint8Array(n);
  const reachCells = Math.ceil(reach / CELL_M);
  const reach2 = reachCells * reachCells;
  let buildings = 0;
  for (const file of readdirSync(CHUNKS)) {
    if (!/^chunk_-?\d+_-?\d+\.json$/.test(file)) continue;
    const d = JSON.parse(readFileSync(join(CHUNKS, file), "utf8"));
    for (const bl of d.b || []) {
      buildings++;
      const cc = Math.round((bl.c[0] - b.x0) / CELL_M);
      const cr = Math.round((bl.c[1] - b.y0) / CELL_M);
      for (let dr = -reachCells; dr <= reachCells; dr++) {
        const r = cr + dr;
        if (r < 0 || r >= rows) continue;
        for (let dc = -reachCells; dc <= reachCells; dc++) {
          const c = cc + dc;
          if (c < 0 || c >= cols) continue;
          // circular, not square: a square stamp is a visible axis-aligned
          // halo around every lone building out in the creek
          if (dc * dc + dr * dr > reach2) continue;
          land[r * cols + c] = 1;
        }
      }
    }
  }
  const afterBuildings = land.reduce((a, v) => a + v, 0);

  // NO EROSION. There was one, and it was a mistake: a 4-neighbour erode
  // strips the thin neck between two building clusters, so a rural or industrial
  // patch — where the dilated discs are isolated — either vanished or broke into
  // crumbs. The map came out a speckle of islands with holes in the middle of
  // Salsette. The 250 m reach IS the softness at the shore, and the sea probes
  // pass without it.

  // Runs out.
  const out = [];
  for (let r = 0; r < rows; r++) {
    let open = -1;
    for (let c = 0; c <= cols; c++) {
      const on = c < cols && land[r * cols + c];
      if (on && open < 0) open = c;
      else if (!on && open >= 0) {
        out.push(r, b.x0 + open * CELL_M, b.x0 + c * CELL_M);
        open = -1;
      }
    }
  }

  const area = (afterBuildings * CELL_M * CELL_M) / 1e6;
  // A run is a variable-length span, not one cell. Counting runs as cells made
  // this print 34 km2 for a mask that is 1,020 — the mask was always right, the
  // log was not.
  let finalCells = 0;
  for (let i = 0; i < out.length; i += 3) {
    finalCells += Math.max(1, Math.round((out[i + 2] - out[i + 1]) / CELL_M));
  }
  const finalArea = (finalCells * CELL_M * CELL_M) / 1e6;
  const boxKm2 = ((b.x1 - b.x0) * (b.y1 - b.y0)) / 1e6;
  const outObj = {
    v: 1,
    builtAt: new Date().toISOString(),
    note:
      "Land mask built from the 260,890 real building footprints in the chunk set, dilated by " +
      `${reach} m and eroded once. NOT from the OSM coastline: the coastline extract is absent over ` +
      "the northern and eastern metro, and scanline-filling it claimed 4,161 km2 of land against a " +
      "real figure near 1,500. Same source as the chunk set — (c) OpenStreetMap contributors, ODbL 1.0.",
    bounds: b,
    cellM: CELL_M,
    cols,
    rows,
    reachM: reach,
    buildings,
    areaKm2: Math.round(finalArea),
    land: out,
  };
  writeFileSync(path, JSON.stringify(outObj));
  console.log(
    `DONE. ${buildings} buildings, reach ${reach} m\n` +
      `     ${finalCells} cells in ${out.length / 3} runs = ${finalArea.toFixed(0)} km2 ` +
      `of the ${boxKm2.toFixed(0)} km2 bounds\n` +
      `     -> ${path} (${(JSON.stringify(outObj).length / 1e6).toFixed(2)} MB)`,
  );
}

main();
