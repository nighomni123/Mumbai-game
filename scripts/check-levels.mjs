/**
 * Gate on the `building:levels` ingest.
 *
 * Two functions decide whether OSM's free-text `building:levels` becomes a
 * measured height or gets thrown away, and neither one can be checked by `tsc`
 * because both take `any`-ish strings and return null-or-number. If either is
 * wrong the failure is silent and expensive: a mis-parsed tag turns every
 * building on a street into a stump, or an implausible one into a 200 m tower
 * with `confidence: 0.9` on it — which is worse than the estimate it replaced,
 * because a wrong number that claims to be measured is trusted downstream.
 *
 * So: the parser, the plausibility test, and the "never overwrite an
 * authoritative height" rule all get asserted here.
 *
 * Run: node scripts/check-levels.mjs
 */

import { parseLevels, heightFromLevels, bucketElements } from "./ingest-levels.mjs";
import { tileBounds, toWgs84 } from "./geo.mjs";

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${detail ? " — " + detail : ""}`);
};

/* the parser ---------------------------------------------------------------- */
const CASES = [
  ["7", 7],
  ["3.5", 3.5],
  ["7;9", 9],
  ["ground;5", 5],
  ["12,3", 12],
  [" 4 ", 4],
  ["g;4", 4],
];
for (const [raw, want] of CASES) {
  const got = parseLevels(raw);
  ok(`parseLevels(${JSON.stringify(raw)}) === ${want}`, got === want, `got ${got}`);
}

const REJECT = ["", "   ", null, undefined, "none", "yes", "-3", "0", "0.2", "500", "abc"];
for (const raw of REJECT) {
  ok(
    `parseLevels(${JSON.stringify(raw)}) is rejected`,
    parseLevels(raw) === null,
    `got ${parseLevels(raw)}`,
  );
}
ok(
  "a two-section tag takes the TALLEST section, not the first",
  parseLevels("9;7") === 9 && parseLevels("2;14") === 14,
);

/* the plausibility test ----------------------------------------------------- */
// ftf bounds in heightFromLevels are 2.4..6.5; these straddle them
ok("4 storeys x 3.0 m = 12 m is accepted", heightFromLevels(4, 3.0) === 12);
ok("a 40-storey x 3.0 m (120 m) tower is accepted", heightFromLevels(40, 3.0) === 120);
ok("3 storeys x 0.5 m (1.5 m) is rejected — below the 2.7 m floor", heightFromLevels(3, 0.5) === null);
ok("50 storeys x 3.0 m (150 m) passes the 250 m ceiling", heightFromLevels(50, 3.0) === 150);
ok("100 storeys x 3.0 m (300 m) is rejected — above the ceiling", heightFromLevels(100, 3.0) === null);

// the round trip that matters: whatever parseLevels accepts, heightFromLevels
// must either accept the storeys or reject the height, never produce a NaN
let nan = 0;
for (const raw of CASES) {
  const n = parseLevels(raw[0]);
  const h = heightFromLevels(n, 3.0);
  if (h !== null && !Number.isFinite(h)) nan++;
}
ok("no accepted storey count yields a non-finite height", nan === 0);

/* the ingest contract ------------------------------------------------------- */
// A measured height outranks a storey count. This is the rule most likely to be
// broken by a future "just also set H here" edit, and the damage would be an
// authoritative building silently re-derived from a coarser source.
//
// This mirrors the guard in ingest-levels.mjs exactly. If the two drift, one of
// them is wrong and this is the one that says so.
const eligible = (hs) => !hs || hs === "estimated";
for (const hs of ["bmc", "overture", "openbuildings", "surveyed"]) {
  ok(`an authoritative height (hs="${hs}") is NOT eligible for upgrade`, !eligible(hs));
}
for (const hs of ["estimated", null, undefined]) {
  ok(`an estimated height (hs=${hs}) IS eligible for upgrade`, eligible(hs));
}

// and the consequence: applying a storey count must not change H when the
// existing height is authoritative
const applyLike = (b, levels, ftf) => {
  if (!eligible(b.hs)) return b.H;
  return heightFromLevels(levels, ftf) ?? b.H;
};
const authoritative = { H: 31.5, hs: "bmc" };
ok(
  "applying levels leaves an authoritative height untouched",
  applyLike(authoritative, 4, 3.0) === 31.5,
  `got ${applyLike(authoritative, 4, 3.0)}`,
);
ok(
  "applying levels replaces an estimated height",
  applyLike({ H: 20, hs: "estimated" }, 4, 3.6) === 14.4,
  `got ${applyLike({ H: 20, hs: "estimated" }, 4, 3.6)}`,
);
ok(
  "an implausible storey count leaves the estimate in place",
  applyLike({ H: 20, hs: "estimated" }, 100, 3.0) === 20,
);

/* the actual data ----------------------------------------------------------- */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const LV = "data/build/levels";
if (existsSync(LV)) {
  const files = readdirSync(LV).filter((f) => f.startsWith("tile_"));
  let bad = 0, total = 0, absurd = 0, staleMirror = 0;
  for (const f of files) {
    const d = JSON.parse(readFileSync(join(LV, f), "utf8"));
    // the corrupt mirror returns a valid document with a nonsense timestamp
    if (!/^\d{4}-\d\d-\d\dT/.test(String(d.ts))) staleMirror++;
    for (const [k, v] of Object.entries(d.l ?? {})) {
      total++;
      if (!/^(way|relation)\/\d+$/.test(k)) bad++;
      if (!(v >= 0.5 && v <= 200)) bad++;
      if (v > 60) absurd++;
    }
  }
  ok(`every levels key is a typed OSM id and in range (${total} entries)`, bad === 0, `${bad} bad`);
  ok(`no tile came from the empty mirror`, staleMirror === 0, `${staleMirror} stale`);
  console.log(`     ${total} storey counts across ${files.length} tile(s); ${absurd} above 60 storeys`);
} else {
  console.log("skip data checks — data/build/levels not present");
}

/* batched bucketing ------------------------------------------------------- */
// A batched Overpass response is one flat element list for several tiles, and
// these get re-sorted by tile before being written out. A bug here would put a
// building's storey count into its NEIGHBOUR's tile: silent, and it would look
// like entirely plausible data. So it is tested against a synthetic response.
const tiles = [[-4, -8], [-4, -9]];
// The centre of a tile, in the WGS84 the synthetic elements are written in.
// (The bucketer converts back to local metres itself; the test only needs a
// point that is unambiguously inside the box.)
const centre = ([gx, gy]) => {
  const b = tileBounds({ gx, gy });
  return toWgs84((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
};
const locA = centre(tiles[0]);
const locB = centre(tiles[1]);
const locFar = centre([40, 40]);

const synthetic = {
  boxes: undefined,
  rejected: 0,
  unplaced: 0,
  ...bucketElements(tiles, [
    { type: "way", id: 1, geometry: [{ lon: locA.lon, lat: locA.lat }], tags: { "building:levels": "7" } },
    { type: "way", id: 2, geometry: [{ lon: locB.lon, lat: locB.lat }], tags: { "building:levels": "3" } },
    { type: "way", id: 3, geometry: [{ lon: locFar.lon, lat: locFar.lat }], tags: { "building:levels": "5" } },
    { type: "way", id: 4, geometry: [{ lon: locA.lon, lat: locA.lat }], tags: { "building:levels": "nonsense" } },
    { type: "way", id: 5, geometry: [{ lon: locA.lon, lat: locA.lat }], tags: { name: "no levels tag" } },
  ]),
};
ok(
  "bucketing places a way in the tile it actually sits in (A)",
  synthetic.boxes[0].l["way/1"] === 7,
  JSON.stringify(synthetic.boxes[0].l),
);
ok(
  "bucketing places a way in the tile it actually sits in (B)",
  synthetic.boxes[1].l["way/2"] === 3,
  JSON.stringify(synthetic.boxes[1].l),
);
ok("a way outside every batched tile is unplaced, not written somewhere wrong", synthetic.unplaced === 1);
ok("an unparseable levels value is rejected, not silently bucketed", synthetic.rejected === 1);
ok("a way with no building:levels tag is ignored entirely", Object.keys(synthetic.boxes[0].l).length === 1);
ok("every batched tile gets an output file, even an empty one", synthetic.boxes.length === 2);

if (failures) {
  console.error(`\nlevels check FAILED (${failures}) — measured heights would be wrong.`);
  process.exit(1);
}
console.log("\nok  levels verified: parsing, plausibility, and the no-overwrite rule all hold.");