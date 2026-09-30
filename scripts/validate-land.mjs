/**
 * The land gate: is the city where the city is?
 *
 * This exists because the coastline is not enough, and finding that out cost a
 * full milestone. `ingest-water.mjs` scanline-fills the OSM coastline into a
 * land mask, and the result claimed 4,161 km2 — 76% of the metro bounds, and
 * full of hard horizontal bands in the map. The cause was measured: 1,470 of
 * 1,635 scanline rows run out of coastline before reaching the east edge of the
 * bounds, because the extract has no coastline over the northern and eastern
 * metro, and the fallback painted land to the edge.
 *
 * So the land mask is built from the buildings instead — 260,890 real footprints
 * at real coordinates — and this checks the result against the same 36
 * ground-truth sites the geographic gate already uses, plus the water that has
 * to stay water.
 *
 * Run:  node scripts/validate-land.mjs
 */

import { readFileSync, existsSync } from "node:fs";
import { toLocal } from "./geo.mjs";
import { VALIDATION_SITES } from "./validation-sites.mjs";

const MASK = "data/build/landmask.json";

let failures = 0;
const ok = (cond, what) => {
  if (!cond) failures++;
  console.log(`  ${cond ? "ok  " : "FAIL"} ${what}`);
};

if (!existsSync(MASK)) {
  console.error(
    `FAIL — ${MASK} does not exist. Run: node scripts/land-mask.mjs`,
  );
  process.exit(1);
}
const m = JSON.parse(readFileSync(MASK, "utf8"));
const b = m.bounds;

const rows = new Map();
for (let i = 0; i < m.land.length; i += 3) {
  const r = m.land[i];
  const list = rows.get(r);
  if (list) list.push(m.land[i + 1], m.land[i + 2]);
  else rows.set(r, [m.land[i + 1], m.land[i + 2]]);
}
const isLand = (x, z) => {
  if (x < b.x0 || x > b.x1) return false;
  const r = Math.floor((z - b.y0) / m.cellM);
  if (r < 0 || r >= m.rows) return false;
  const list = rows.get(r);
  if (!list) return false;
  for (let i = 0; i < list.length; i += 2)
    if (x >= list[i] && x <= list[i + 1]) return true;
  return false;
};
/** The cell the mask actually made, with a 60 m tolerance for the 50 m grid. */
const nearLand = (lon, lat, tol = 60) => {
  const p = toLocal(lon, lat);
  for (const [dx, dy] of [
    [0, 0],
    [tol, 0],
    [-tol, 0],
    [0, tol],
    [0, -tol],
  ]) {
    if (isLand(p.x + dx, p.y + dy)) return true;
  }
  return false;
};

console.log(
  `land mask — ${m.buildings} buildings, reach ${m.reachM} m, ${m.cellM} m cells, ` +
    `${m.land.length / 3} runs, ${m.areaKm2} km2 of a ${(((b.x1 - b.x0) * (b.y1 - b.y0)) / 1e6).toFixed(0)} km2 box`,
);

console.log("the land is the right size");
const boxKm2 = ((b.x1 - b.x0) * (b.y1 - b.y0)) / 1e6;
ok(
  m.areaKm2 > 700,
  `land area ${m.areaKm2} km2 — Greater Mumbai is nearer 1,500 than the 4,161 the coastline claimed`,
);
ok(
  m.areaKm2 < 1800,
  `land area ${m.areaKm2} km2 — and it is not most of the bounding box`,
);
ok(
  m.areaKm2 / boxKm2 < 0.35,
  `land is under a third of the ${boxKm2.toFixed(0)} km2 box`,
);

console.log("every ground-truth site is on land");
let wrong = 0;
for (const s of VALIDATION_SITES) {
  if (!nearLand(s.lon, s.lat)) {
    wrong++;
    console.log(`  FAIL ${s.id} (${s.name}) is water`);
  }
}
ok(wrong === 0, `${VALIDATION_SITES.length} sites on land (${wrong} wrong)`);

console.log("the water is still water");
const SEA = [
  ["Arabian Sea, 25 km west of Juhu", 72.55, 19.1],
  ["Arabian Sea, off Juhu", 72.7, 19.1],
  // Mid-bay, between the Marine Drive shore and the Juhu shore. An earlier
  // probe sat at 72.79, which is the Juhu back-beach, not the water.
  ["Back Bay, mid-bay", 72.812, 18.95],
  ["the harbour, east of Salsette", 72.9, 18.97],
  ["Arabian Sea, south of the Gateway", 72.8, 18.86],
  ["Vasai Creek, north of the metro", 72.85, 19.6],
  ["Panvel Creek, north-east", 72.9, 19.45],
  ["Thane Creek, east of the island", 72.95, 19.03],
  ["open sea west of Worli", 72.6, 18.9],
  ["open sea, 25 km west of Alibag", 72.45, 19.15],
  ["open sea south of the Gateway", 72.6, 18.85],
];
let wet = 0;
for (const [what, lon, lat] of SEA) {
  if (nearLand(lon, lat)) {
    wet++;
    console.log(`  FAIL ${what} reads as land`);
  }
}
ok(wet === 0, `${SEA.length} open-water probes are water (${wet} wrong)`);

console.log("the harbour has water in it, not a bridge of land");
// A cut across the harbour, west to east through the island's widest water.
const CUT = [
  [72.868, 18.97],
  [72.888, 18.97],
  [72.908, 18.97],
  [72.925, 18.975],
];
const bridged = CUT.filter(([lon, lat]) => nearLand(lon, lat, 0));
ok(
  bridged.length === 0,
  `the harbour is open water along its length (${bridged.length} of ${CUT.length} blocked)`,
);

if (failures) {
  console.error(`\nFAIL — ${failures} assertion(s) failed`);
  process.exit(1);
}
console.log(
  `\nOK — ${m.areaKm2} km2 of land, all ${VALIDATION_SITES.length} sites on it, and the sea still where it was.`,
);
