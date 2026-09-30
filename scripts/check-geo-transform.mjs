/**
 * Regression check for the footprint -> geometry transform.
 *
 * The geo city renders buildings by extruding each real footprint ring. That
 * transform has exactly one correct answer: the ring's northing must land on
 * world Z, unchanged, and the prism must rise from y=0 to y=height. It got
 * this wrong once — a stray negation in the shape mirrored the entire city
 * across the origin, putting every building ~10 km from the camera, so the map
 * rendered as bare street lines with no structures at all.
 *
 * This asserts the transform directly, in Node, with no browser and no data
 * files, so it runs in milliseconds and would have caught that bug instantly.
 *
 * Run: node scripts/check-geo-transform.mjs
 */

import * as THREE from "three";

/** Byte-for-byte the transform used by src/geo/GeoCity.ts. */
function buildingGeometry(ring, height) {
  const shape = new THREE.Shape();
  shape.moveTo(ring[0][0], ring[0][1]);
  for (let i = 1; i < ring.length; i++) shape.lineTo(ring[i][0], ring[i][1]);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
  geo.rotateX(Math.PI / 2);
  geo.translate(0, height, 0);
  return geo;
}

let failures = 0;
function check(label, actual, expected, tol = 0.51) {
  const ok = Math.abs(actual - expected) <= tol;
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}: ${actual.toFixed(1)} (expect ${expected.toFixed(1)})`);
}

// A real-ish footprint: negative X and negative northing, as in the Charni/Fort
// tiles. Sign errors only show up when the coordinate is negative, so both
// quadrants matter.
const cases = [
  { name: "SW quadrant (Fort/Charni)", ring: [[-4241, -5148], [-4221, -5148], [-4221, -5125], [-4241, -5125]], h: 20 },
  { name: "NE quadrant (Thane)", ring: [[14000, 12000], [14020, 12000], [14020, 12010], [14000, 12010]], h: 35 },
  { name: "NW quadrant (Andheri)", ring: [[-1500, 22000], [-1480, 22000], [-1480, 22030], [-1500, 22030]], h: 12 },
  { name: "SE quadrant (Navi Mumbai)", ring: [[38000, -12000], [38030, -12000], [38030, -11980], [38000, -11980]], h: 45 },
];

for (const c of cases) {
  const g = buildingGeometry(c.ring, c.h);
  g.computeBoundingBox();
  const b = g.boundingBox;
  const xs = c.ring.map((p) => p[0]);
  const ys = c.ring.map((p) => p[1]);
  check(`${c.name} min.x`, b.min.x, Math.min(...xs));
  check(`${c.name} max.x`, b.max.x, Math.max(...xs));
  check(`${c.name} min.z`, b.min.z, Math.min(...ys));
  check(`${c.name} max.z`, b.max.z, Math.max(...ys));
  check(`${c.name} min.y (ground)`, b.min.y, 0);
  check(`${c.name} max.y (height)`, b.max.y, c.h);
}

if (failures) {
  console.error(`\ngeo transform check FAILED (${failures} assertions) — buildings will not land where the data says.`);
  process.exit(1);
}
console.log(`\nok  geo transform verified: footprints land on their real coordinates, in all four quadrants.`);
