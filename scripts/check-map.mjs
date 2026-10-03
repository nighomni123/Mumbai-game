/**
 * Check the map's geometry.
 *
 * The minimap and the /map page are the only views of the whole city, so a
 * silent error in either is expensive: a wrong stride over the flat land mask
 * renders a plausible-looking map that is not the map, and nothing else in the
 * project would notice. This asserts the two pieces of maths both renderers
 * depend on, with no browser and no canvas — the drawing itself is a
 * drawImage away from these numbers being right.
 *
 * Run:  node scripts/check-map.mjs
 */

import { readFileSync, existsSync } from "node:fs";
import { landRuns, projectorFor } from "../src/geo/citymap-math.js";
import { METRO_BOUNDS, DEV_BOUNDS, toLocal } from "./geo.mjs";
import { VALIDATION_SITES } from "./validation-sites.mjs";

let failures = 0;
const ok = (cond, what) => {
  if (!cond) failures++;
  console.log(`  ${cond ? "ok  " : "FAIL"} ${what}`);
};

const WATER = "data/build/landmask.json";
const MAP = "data/build/citymap.json";
for (const f of [WATER, MAP]) {
  if (!existsSync(f)) {
    console.error(
      `FAIL — ${f} missing. Run: node scripts/ingest-water.mjs && node scripts/citymap.mjs`,
    );
    process.exit(1);
  }
}
const water = JSON.parse(readFileSync(WATER, "utf8"));
const map = JSON.parse(readFileSync(MAP, "utf8"));

console.log("land mask decomposition");
const runs = landRuns(water);
ok(
  runs.length === water.land.length / 3,
  `${runs.length} runs for ${water.land.length / 3} entries`,
);
{
  let bad = 0;
  for (const r of runs) {
    if (!(r.x1 > r.x0) || !(r.y1 > r.y0)) bad++;
  }
  ok(bad === 0, `every run is a non-degenerate box (${bad} bad)`);
  // The first run's row must land at the bounds' own y0, not at the origin.
  const first = runs[0];
  ok(
    Math.abs(first.y0 - METRO_BOUNDS.y0 - water.land[0] * water.cellM) < 1e-6,
    "run y is derived from the row index and bounds.y0",
  );
}

console.log("projector");
const W = 188;
const H = 230;
const p = projectorFor(METRO_BOUNDS, W, H);
{
  const corners = [
    [METRO_BOUNDS.x0, METRO_BOUNDS.y1],
    [METRO_BOUNDS.x1, METRO_BOUNDS.y1],
    [METRO_BOUNDS.x0, METRO_BOUNDS.y0],
    [METRO_BOUNDS.x1, METRO_BOUNDS.y0],
  ].map(([x, y]) => [p.x(x), p.y(y)]);
  const inside = corners.every(
    ([px, py]) => px >= -1 && px <= W + 1 && py >= -1 && py <= H + 1,
  );
  ok(inside, `all four bounds corners land inside a ${W}x${H} canvas`);
  // Aspect preserved: a 67 x 82 km metro in a 188 x 230 box is limited by width.
  ok(
    Math.abs(p.scale - W / (METRO_BOUNDS.x1 - METRO_BOUNDS.x0)) < 1e-9,
    "width-limited, as expected for a portrait canvas",
  );
  // North is up.
  const north = p.y(METRO_BOUNDS.y1);
  const south = p.y(METRO_BOUNDS.y0);
  ok(north < south, "north is up (smaller y is further up the canvas)");
  // Round trip.
  const probe = 12345;
  ok(Math.abs(p.invX(p.x(probe)) - probe) < 1e-6, "invX undoes x");
  ok(Math.abs(p.invY(p.y(probe)) - probe) < 1e-6, "invY undoes y");
}

console.log("the minimap can actually see the roads");
// The projector block above tests METRO_BOUNDS, which is the /map page. The
// HUD minimap uses a DIFFERENT one — playableProjector over DEV_BOUNDS — and
// nothing checked that the road network survives it. A minimap whose viewport
// misses the roads draws land and sea perfectly and looks like a finished
// product, which is exactly how the road network went missing on 2026-10-02.
// This is the headless half of that guard: it catches a viewport that no longer
// contains the city. It CANNOT catch the render side — a map published with
// `data: null`, or a cache that keeps a road-less bitmap — because those need
// a browser and a canvas.
{
  const MM_W = 224, MM_H = 326, SCALE = 4;
  const pv = projectorFor(DEV_BOUNDS, MM_W * SCALE, MM_H * SCALE);
  const q = map.q ?? 1;
  let onCanvas = 0;
  for (const flat of map.roads) {
    let hit = false;
    for (let i = 0; i < flat.length && !hit; i += 2) {
      const px = pv.x(flat[i] * q), py = pv.y(flat[i + 1] * q);
      if (px >= 0 && px <= MM_W * SCALE && py >= 0 && py <= MM_H * SCALE) hit = true;
    }
    if (hit) onCanvas++;
  }
  const share = onCanvas / map.roads.length;
  ok(
    share > 0.15,
    `roads land inside the minimap viewport (${onCanvas}/${map.roads.length} = ${(share * 100).toFixed(1)}%, need >15%)`,
  );
  // The named arterials are drawn thicker than the network; if they are the
  // only roads on the canvas the viewport is roughly right, and if none are,
  // the whole thing is off screen and the check above passed by luck.
  const namedOn = (map.named ?? []).filter((r) => {
    const f = r.p;
    for (let i = 0; i < f.length; i += 2) {
      const px = pv.x(f[i] * q), py = pv.y(f[i + 1] * q);
      if (px >= 0 && px <= MM_W * SCALE && py >= 0 && py <= MM_H * SCALE) return true;
    }
    return false;
  }).length;
  ok(
    namedOn > 0,
    `a named arterial is on the minimap (${namedOn} of ${(map.named ?? []).length})`,
  );
}

console.log("the map covers the city the world covers");
const onLandBox = (x, z) =>
  runs.some((r) => x >= r.x0 && x <= r.x1 && z >= r.y0 && z <= r.y1);
{
  let onLand = 0;
  for (const s of VALIDATION_SITES) {
    const l = toLocal(s.lon, s.lat);
    if (
      onLandBox(l.x, l.y) ||
      onLandBox(l.x + 60, l.y) ||
      onLandBox(l.x - 60, l.y) ||
      onLandBox(l.x, l.y + 60) ||
      onLandBox(l.x, l.y - 60)
    )
      onLand++;
  }
  ok(
    onLand === VALIDATION_SITES.length,
    `all ${VALIDATION_SITES.length} ground-truth sites fall on drawn land (${onLand})`,
  );
  // And the open sea must NOT, or the map is showing land where the water is.
  const seaProbes = [
    [72.55, 19.1],
    [72.79, 18.94],
    [72.9, 18.97],
    [72.8, 18.86],
  ];
  const wet = seaProbes.filter(([lon, lat]) => {
    const l = toLocal(lon, lat);
    return onLandBox(l.x, l.y);
  });
  ok(
    wet.length === 0,
    `open sea is not drawn as land (${wet.length} of ${seaProbes.length} wrong)`,
  );
}

console.log("the road skeleton projects inside the canvas");
{
  const q = map.q;
  let outside = 0;
  let total = 0;
  for (const flat of map.roads) {
    for (let i = 0; i < flat.length; i += 2) {
      const px = p.x(flat[i] * q);
      const py = p.y(flat[i + 1] * q);
      total++;
      if (px < -2 || px > W + 2 || py < -2 || py > H + 2) outside++;
    }
  }
  ok(
    outside === 0,
    `every road vertex projects inside the canvas (${outside} of ${total} outside)`,
  );
  ok(
    map.roads.length >= 15000,
    `road skeleton has ${map.roads.length} polylines (class >= 3 plus named)`,
  );
  ok(
    map.roads.length < map.of,
    `and is a subset of the ${map.of} streets, not all of them`,
  );
}

if (failures) {
  console.error(`\nFAIL — ${failures} assertion(s) failed`);
  process.exit(1);
}
console.log(
  "\nOK — the map's land decomposition, projector and road skeleton are all consistent.",
);
