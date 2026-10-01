/**
 * Asserts the build scope is coherent.
 *
 * ACTIVE_BOUNDS exists in two files that must not drift — scripts/geo.mjs (the
 * ingest) and src/geo/geo-constants.ts (the render). Nothing in `tsc` or
 * `build` can catch them disagreeing: the symptom would be a city that is
 * quietly built somewhere else than the map says it is, which is exactly the
 * class of bug the mirrored-Z footprint transform shipped as.
 *
 * It also asserts the scope is a usable subset of METRO_BOUNDS, and pins the
 * three WGS84 limits it came from, so a future edit has to justify itself.
 *
 * Run: node scripts/check-active-bounds.mjs
 */
import { readFileSync } from "node:fs";
import { ACTIVE_BOUNDS, METRO_BOUNDS, inActive, tileInActive, TILE_M } from "./geo.mjs";

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${detail ? " — " + detail : ""}`);
};

// 1. the two copies agree, field for field
const ts = readFileSync(new URL("../src/geo/geo-constants.ts", import.meta.url), "utf8");
for (const k of ["x0", "x1", "y0", "y1"]) {
  const m = ts.match(new RegExp(`ACTIVE_BOUNDS[^\\n]*\\{[\\s\\S]*?${k}:\\s*(-?\\d+)`));
  ok(
    `geo-constants.ts ACTIVE_BOUNDS.${k} == geo.mjs (${ACTIVE_BOUNDS[k]})`,
    m && Number(m[1]) === ACTIVE_BOUNDS[k],
    m ? `ts has ${m[1]}` : "not found in ts",
  );
}

// 2. a subset with positive area
ok(
  "ACTIVE_BOUNDS is inside METRO_BOUNDS",
  ACTIVE_BOUNDS.x0 >= METRO_BOUNDS.x0 &&
    ACTIVE_BOUNDS.x1 <= METRO_BOUNDS.x1 &&
    ACTIVE_BOUNDS.y0 >= METRO_BOUNDS.y0 &&
    ACTIVE_BOUNDS.y1 <= METRO_BOUNDS.y1,
  `active ${JSON.stringify(ACTIVE_BOUNDS)} vs metro ${JSON.stringify(METRO_BOUNDS)}`,
);
ok(
  "ACTIVE_BOUNDS has area",
  ACTIVE_BOUNDS.x1 > ACTIVE_BOUNDS.x0 && ACTIVE_BOUNDS.y1 > ACTIVE_BOUNDS.y0,
);

// 3. it actually clips something on all three cut sides, and nothing on the west
const dropped = [
  ["east of 12,148 m is deferred", !inActive(12_149, 0) && inActive(12_147, 0)],
  ["north of 26,673 m is deferred", !inActive(0, 26_674) && inActive(0, 26_672)],
  ["south of -20,622 m is deferred", !inActive(0, -20_623) && inActive(0, -20_621)],
  ["the city itself is in scope", inActive(0, 0)],
  ["west edge is not cut", inActive(METRO_BOUNDS.x0, 0)],
];
for (const [label, cond] of dropped) ok(label, cond);

// 4. the tile predicate agrees with the point predicate at the boundary, which
//    is the part that would silently stop loading a ring of chunks
ok(
  "tileInActive agrees with inActive on a straddling tile",
  tileInActive(Math.floor(ACTIVE_BOUNDS.x1 / TILE_M), 0) &&
    !tileInActive(Math.floor(ACTIVE_BOUNDS.x1 / TILE_M) + 1, 0),
);
ok(
  "tileInActive rejects a far-east tile",
  !tileInActive(Math.floor(20_000 / TILE_M), 0),
);

// 6. the scope is the mainland, not a sliver. Only three sides are cut, so the
//    west edge stays at METRO_BOUNDS.x0 — 27 km E-W, 47 km N-S, ~1,270 km2,
//    roughly a quarter of the metro box. Assert the share of the metro rather
//    than a size: that is the number the decision actually changes.
const kmE = (ACTIVE_BOUNDS.x1 - ACTIVE_BOUNDS.x0) / 1000;
const kmN = (ACTIVE_BOUNDS.y1 - ACTIVE_BOUNDS.y0) / 1000;
const metroArea = (METRO_BOUNDS.x1 - METRO_BOUNDS.x0) * (METRO_BOUNDS.y1 - METRO_BOUNDS.y0);
const share = ((ACTIVE_BOUNDS.x1 - ACTIVE_BOUNDS.x0) * (ACTIVE_BOUNDS.y1 - ACTIVE_BOUNDS.y0)) / metroArea;
ok(
  `scope is the mainland: ${kmE.toFixed(0)} x ${kmN.toFixed(0)} km, ${(share * 100).toFixed(0)}% of the metro box`,
  share > 0.15 && share < 0.35 && kmE > 20 && kmN > 20,
);

if (failures) {
  console.error(`\nactive-bounds check FAILED (${failures}) — the build scope is not what the map says it is.`);
  process.exit(1);
}
console.log(`\nok  build scope verified: ${kmE.toFixed(0)} x ${kmN.toFixed(0)} km, both copies agree, all three cuts bite.`);