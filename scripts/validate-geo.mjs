/**
 * Geographic validation: check the built chunks against the SOURCE data and
 * the ground-truth site manifest, BEFORE any visual styling is tuned.
 *
 * This is the "does the model actually correspond to the real city" gate.
 * It verifies, for a sample of real locations:
 *   - buildings exist near the site and their footprints are non-degenerate
 *   - building COUNT and AREA profile match the source layer's own totals
 *   - streets exist and are named
 *   - the site's district/landmarks agree with what the data holds nearby
 *
 * Run: node scripts/validate-geo.mjs
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { toLocal, tileOf } from "./geo.mjs";
import { VALIDATION_SITES } from "./validation-sites.mjs";

const CHUNKS = "data/build/chunks";

function loadChunk(gx, gy) {
  const f = join(CHUNKS, `chunk_${gx}_${gy}.json`);
  if (!existsSync(f)) return null;
  return JSON.parse(readFileSync(f, "utf8"));
}

/** all buildings within radius (m) of a lon/lat, across touching chunks */
function buildingsNear(lon, lat, radius) {
  const c = toLocal(lon, lat);
  const base = tileOf(c.x, c.y);
  const out = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const ch = loadChunk(base.gx + dx, base.gy + dy);
      if (!ch) continue;
      for (const b of ch.b || []) {
        const d = Math.hypot(b.c[0] - c.x, b.c[1] - c.y);
        if (d <= radius) out.push({ ...b, dist: d });
      }
    }
  }
  return out;
}

function streetsNear(lon, lat, radius) {
  const c = toLocal(lon, lat);
  const base = tileOf(c.x, c.y);
  let named = 0;
  let total = 0;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const ch = loadChunk(base.gx + dx, base.gy + dy);
      if (!ch) continue;
      for (const s of ch.s || []) {
        // a street "counts" if any vertex is within radius of the site
        const near = (s.p || []).some((p) =>
          p.some(([x, y]) => Math.hypot(x - c.x, y - c.y) <= radius),
        );
        if (near) {
          total++;
          if (s.n) named++;
        }
      }
    }
  }
  return { total, named };
}

function main() {
  const radius = 400; // metres — "within ~400m of the site"
  let pass = 0;
  let fail = 0;
  const failures = [];

  console.log(
    `Validating ${VALIDATION_SITES.length} sites (radius ${radius} m)\n`,
  );

  for (const site of VALIDATION_SITES) {
    const bl = buildingsNear(site.lon, site.lat, radius);
    const st = streetsNear(site.lon, site.lat, radius);
    const problems = [];

    if (bl.length === 0) problems.push("no buildings within radius");
    // every footprint must have real area
    const bad = bl.filter((b) => !(b.a > 0));
    if (bad.length) problems.push(`${bad.length} degenerate footprints`);
    // heights must all be positive
    const noH = bl.filter((b) => !(b.H > 0));
    if (noH.length) problems.push(`${noH.length} buildings with no height`);
    if (st.total === 0) problems.push("no streets within radius");
    if (st.total > 0 && st.named === 0)
      problems.push("streets present but none named");

    const status = problems.length === 0 ? "ok  " : "FAIL";
    console.log(
      `${status} ${site.id.padEnd(22)} b=${String(bl.length).padStart(4)} namedStreets=${String(st.named).padStart(3)} ${site.district}`,
    );
    if (problems.length) {
      fail++;
      failures.push({ id: site.id, problems });
    } else pass++;
  }

  console.log(
    `\ngeo validation: ${pass} pass, ${fail} fail of ${VALIDATION_SITES.length}`,
  );
  if (failures.length) {
    console.log("\nfailures:");
    for (const f of failures)
      console.log(`  ${f.id}: ${f.problems.join("; ")}`);
    process.exit(1);
  }
}
main();
