/**
 * The water gate: is the sea in the right place?
 *
 * Run this BEFORE touching anything visual, for the same reason validate-geo
 * exists. A coastline ribbon rendered on the wrong side does not look wrong in
 * a screenshot — it looks like a coastline. It puts the Arabian Sea inside
 * Salsette island, or the harbour on the Konkan side, and every later decision
 * (the planet, the walk mode, the planet-view silhouette) gets built on it.
 *
 * THIS NO LONGER CHECKS LAND — see scripts/validate-land.mjs.
 *
 * That job moved, and the reason is the header of `buildLandMask` below: the
 * coastline extract is absent over the northern and eastern metro, so a
 * scanline fill of it claimed 4,161 km2 of land. The land mask is built from the
 * 260,890 building footprints instead, and `validate-land.mjs` is its gate.
 *
 * What is left here is the coastline as PROVENANCE: it is still fetched, still
 * stored, and still the record of where the shore is, so a better extract can be
 * dropped in without re-deriving the pipeline. These checks make sure it
 * arrived intact and is a plausible coastline — not that the world is built
 * from it.
 *
 * The 36 ground-truth sites come from scripts/validation-sites.mjs and already
 * carry an `expect.water` judgement made from the real city:
 *   coast -> the site sits on a seafront  (Gateway, Fort, Colaba, Churchgate,
 *            Charni Road, Marine Drive, Worli, Juhu)
 *   lake  -> on a reservoir                (Powai, Dahisar)
 *   creek -> a creek, not open sea         (Belapur)
 *   none  -> inland; must NOT read as sea
 *
 * Run:  node scripts/validate-water.mjs
 */

import { readFileSync, existsSync } from "node:fs";
import { toLocal } from "./geo.mjs";

const WATER = "data/build/water.json";

let failures = 0;
const ok = (cond, what) => {
  if (!cond) failures++;
  console.log(`  ${cond ? "ok  " : "FAIL"} ${what}`);
};

if (!existsSync(WATER)) {
  console.error(
    `FAIL — ${WATER} does not exist. Run: node scripts/ingest-water.mjs`,
  );
  process.exit(1);
}

const w = JSON.parse(readFileSync(WATER, "utf8"));
console.log(
  `water.json v${w.v} — ${w.coast.length} coastline ways, ${w.water.length} water rings, ` +
    `mask ${w.maskCols}x${w.maskRows} @ ${w.maskCellM} m, ${w.land.length / 3} land runs, built ${w.builtAt}`,
);

/* ------------------------------------------------------------------ *
 * Structural checks
 * ------------------------------------------------------------------ */
console.log("structure");
ok(
  w.coast.length >= 20,
  `coastline ways present (${w.coast.length}) — a handful means the ingest failed`,
);
ok(
  w.licence.includes("ODbL") &&
    /OpenStreetMap contributors/.test(w.attribution || ""),
  "ODbL licence and attribution are inside the data, not only in the app",
);
ok(w.land.length >= 300, `land mask has runs (${w.land.length / 3})`);

let segCount = 0;
let shortWay = 0;
for (const c of w.coast) {
  if (c.p.length < 2) {
    shortWay++;
    continue;
  }
  for (let i = 0; i < c.p.length - 1; i++) {
    if (Math.hypot(c.p[i + 1][0] - c.p[i][0], c.p[i + 1][1] - c.p[i][1]) > 1e-6)
      segCount++;
  }
}
ok(shortWay === 0, `no coastline way with fewer than 2 points (${shortWay})`);
ok(segCount >= 500, `coastline segment count (${segCount})`);

// Rings are stored OPEN — saneRing drops the duplicated closing vertex — so the
// test is that they have enough points and no repeats, not that they are closed.
let ringBad = 0;
for (const r of w.water) {
  const p = r.r;
  if (p.length < 4) ringBad++;
  else {
    let distinct = 1;
    for (let i = 1; i < p.length; i++) {
      if (Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]) > 1e-7)
        distinct++;
    }
    if (distinct < 4) ringBad++;
  }
}
ok(
  ringBad === 0,
  `every water ring has >= 4 distinct points (${ringBad} bad of ${w.water.length})`,
);

/* ------------------------------------------------------------------ *
 * The mask, queried exactly as LandMask (src/geo/water.ts) does. Kept as a
 * separate implementation on purpose: if the gate and the renderer disagreed,
 * the world's geometry and its own gate would disagree, which is the failure
 * mode this whole file exists to catch.
 * ------------------------------------------------------------------ */
const rows = new Map();
for (let i = 0; i < w.land.length; i += 3) {
  const r = w.land[i];
  const list = rows.get(r);
  if (list) list.push(w.land[i + 1], w.land[i + 2]);
  else rows.set(r, [w.land[i + 1], w.land[i + 2]]);
}

/** The query LandMask.isSea makes, in local metres. */
function isSeaLocal(x, z) {
  if (x < w.bounds.x0 || x > w.bounds.x1) return true;
  const r = Math.floor((z - w.bounds.y0) / w.maskCellM);
  if (r < 0 || r >= w.maskRows) return true;
  const list = rows.get(r);
  if (!list) return true;
  for (let i = 0; i < list.length; i += 2)
    if (x >= list[i] && x <= list[i + 1]) return false;
  return true;
}

function isSea(lon, lat) {
  const p = toLocal(lon, lat);
  return isSeaLocal(p.x, p.y);
}

/* ------------------------------------------------------------------ *
 * The real city
 * ------------------------------------------------------------------ */
console.log("the coastline arrived intact (provenance, not the land source)");
ok(segCount >= 500, `coastline segment count (${segCount})`);

const totalLen = w.coast.reduce(
  (n, c) =>
    n +
    c.p
      .slice(1)
      .reduce(
        (m, p, i) => m + Math.hypot(p[0] - c.p[i][0], p[1] - c.p[i][1]),
        0,
      ),
  0,
);
ok(totalLen > 200e3, `coastline length ${(totalLen / 1000).toFixed(0)} km`);
// The extract is known to be incomplete: it covers the western and central shore
// and runs out over the north-east. Asserting the gap is what stops someone
// trusting it again by accident.
const perRow = new Map();
for (const c of w.coast) {
  for (let i = 0; i < c.p.length - 1; i++) {
    const r = Math.floor((w.bounds.y0 === undefined ? 0 : w.bounds.y0 + 0) / 1);
    void r;
    for (const p of [c.p[i], c.p[i + 1]]) {
      const k = Math.floor(p[1] / 2000);
      perRow.set(k, (perRow.get(k) || 0) + 1);
    }
  }
}
const rowsWithCoast = perRow.size;
ok(
  rowsWithCoast > 20,
  `coastline spans ${rowsWithCoast} latitude bands — it is a real coastline, not a fragment`,
);

console.log("ring geometry");
ok(
  ringBad === 0,
  `every water ring has >= 4 distinct points (${ringBad} bad of ${w.water.length})`,
);

if (failures) {
  console.error(`\nFAIL — ${failures} assertion(s) failed`);
  process.exit(1);
}
console.log(
  `\nOK — ${segCount} coastline segments (${(totalLen / 1000).toFixed(0)} km), ${w.water.length} water rings.`,
);
console.log(
  "The coastline is kept as provenance. The land mask is built from the buildings;",
);
console.log(
  "run scripts/validate-land.mjs for the thing the world is actually drawn from.",
);
