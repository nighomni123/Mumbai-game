/**
 * The gate on the enrichment vocabulary.
 *
 * Everything downstream draws buildings from FAMILIES/PALETTES/WINDOWS/ROOFS
 * and the renderer resolves ids the enrichment script wrote, so a dangling id
 * does not fail a build — it fails silently as a building that quietly falls
 * back to the default family. That is the worst possible failure for a system
 * whose entire purpose is to stop looking generic, and `tsc` cannot catch it
 * because the ids are plain strings.
 *
 * So this asserts the things that would actually break, without a browser:
 *   1. every family resolves its window/balcony/roof/palette ids
 *   2. every region prior names a real family, and its weights sum to ~1
 *   3. the priors are genuinely DIFFERENT between zones (a prior that is the
 *      same everywhere is not a prior)
 *   4. pickFamily is deterministic in the building id, and actually spreads
 *      across families rather than collapsing to one
 *   5. facadeTone is deterministic and never returns an out-of-gamut colour
 *   6. the landmark registry agrees with the vocabularies
 *   7. every profile written into data/build/chunks is drawable
 *
 * Run: node scripts/check-vocab.mjs
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  FAMILIES,
  PALETTES,
  WINDOWS,
  BALCONIES,
  ROOFS,
  REGION_PRIORS,
  pickFamily,
  facadeTone,
  hash01,
} from "../src/geo/vocab.js";

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${detail ? " — " + detail : ""}`);
};

/* 1. internal references ---------------------------------------------------- */
const dangling = [];
for (const [k, f] of Object.entries(FAMILIES)) {
  if (!WINDOWS[f.window]) dangling.push(`${k}.window=${f.window}`);
  if (!BALCONIES[f.balcony]) dangling.push(`${k}.balcony=${f.balcony}`);
  if (!ROOFS[f.roof]) dangling.push(`${k}.roof=${f.roof}`);
  for (const p of f.palettes) if (!PALETTES[p]) dangling.push(`${k}.palette=${p}`);
  if (f.floors[0] > f.floors[1]) dangling.push(`${k}.floors inverted`);
}
ok(`all ${Object.keys(FAMILIES).length} families resolve their vocabulary`, !dangling.length, dangling.join(", "));

const badPalette = [];
for (const [k, p] of Object.entries(PALETTES)) {
  if (!p.base?.length || !p.trim?.length) badPalette.push(`${k} empty`);
  for (const hex of [...p.base, ...p.trim, p.accent]) {
    if (!Number.isInteger(hex) || hex < 0 || hex > 0xffffff) badPalette.push(`${k} bad hex ${hex}`);
  }
}
ok(`all ${Object.keys(PALETTES).length} palettes are well formed`, !badPalette.length, badPalette.join(", "));

/* 2. region priors --------------------------------------------------------- */
const unknown = [];
for (const [zone, table] of Object.entries(REGION_PRIORS)) {
  for (const fam of Object.keys(table)) if (!FAMILIES[fam]) unknown.push(`${zone}:${fam}`);
  const sum = Object.values(table).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > 0.02) unknown.push(`${zone} sums to ${sum.toFixed(2)}`);
}
ok("every region prior names real families and sums to 1", !unknown.length, unknown.join(", "));

/* 3. the priors must actually differ --------------------------------------- */
const spread = {};
for (const zone of Object.keys(REGION_PRIORS)) {
  const top = Object.entries(REGION_PRIORS[zone]).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k).join("|");
  spread[zone] = top;
}
const distinct = new Set(Object.values(spread));
ok(
  "region priors differ between zones",
  distinct.size >= Object.keys(REGION_PRIORS).length - 1,
  `${distinct.size} distinct top-3 sets across ${Object.keys(REGION_PRIORS).length} zones`,
);

/* 4. pickFamily ------------------------------------------------------------- */
const ids = Array.from({ length: 600 }, (_, i) => `b_${i}`);
const again = ids.map((id) => pickFamily("residential", "south_mumbai", 120, 4, id));
const repeat = ids.map((id) => pickFamily("residential", "south_mumbai", 120, 4, id));
ok("pickFamily is deterministic in the building id", again.join() === repeat.join());

for (const [zone, cls] of [["south_mumbai", "residential"], ["western_suburb", "residential"], ["central", "residential"]]) {
  const counts = {};
  for (const id of ids) {
    const f = pickFamily(cls, zone, 120, 4, id);
    counts[f] = (counts[f] || 0) + 1;
  }
  const n = Object.keys(counts).length;
  const biggest = Math.max(...Object.values(counts)) / ids.length;
  // A prior that collapses to one family, or that hands everything to one
  // family, is not a prior — it is a constant that looks like one.
  ok(
    `${zone} ${cls} spreads across families`,
    n >= 3 && biggest < 0.6,
    `${n} families, largest ${(biggest * 100).toFixed(0)}%`,
  );
}
ok(
  "pickFamily never returns an unknown family",
  ids.every((id) => FAMILIES[pickFamily("residential", "central", 120, 4, id)] !== undefined),
);

/* 5. facadeTone ------------------------------------------------------------ */
let toneBad = [];
for (const pid of Object.keys(PALETTES)) {
  const a = facadeTone(pid, "b_42");
  const b = facadeTone(pid, "b_42");
  if (a.base !== b.base) toneBad.push(`${pid} not deterministic`);
  for (const hex of [a.base, a.trim]) if (!Number.isInteger(hex) || hex < 0 || hex > 0xffffff) toneBad.push(`${pid} -> ${hex}`);
}
ok("facadeTone is deterministic and in gamut", !toneBad.length, toneBad.join(", "));
ok(
  "facadeTone gives neighbouring buildings different tones",
  new Set(Array.from({ length: 40 }, (_, i) => facadeTone("plaster_warm", `b_${i}`).base)).size >= 3,
);

/* 6. landmarks agree with the vocabulary ----------------------------------- */
const lmFile = join("src/geo/landmarks.ts");
if (existsSync(lmFile)) {
  const { LANDMARKS } = await import("../src/geo/landmarks.ts");
  const bad = [];
  const seen = new Set();
  for (const l of LANDMARKS) {
    if (seen.has(l.id)) bad.push(`duplicate id ${l.id}`);
    seen.add(l.id);
    if (!FAMILIES[l.family]) bad.push(`${l.id} family=${l.family}`);
    if (!PALETTES[l.palette]) bad.push(`${l.id} palette=${l.palette}`);
    if (!ROOFS[l.roof]) bad.push(`${l.id} roof=${l.roof}`);
    if (l.tier === 3 && l.importance < 8) bad.push(`${l.id} is hero but importance ${l.importance}`);
    if (l.lat < 18.85 || l.lat > 19.3) bad.push(`${l.id} lat ${l.lat} outside Greater Mumbai`);
    if (l.lon < 72.8 || l.lon > 73.05) bad.push(`${l.id} lon ${l.lon} outside Greater Mumbai`);
    if (!(l.heightM > 0 && l.heightM <= 350)) bad.push(`${l.id} height ${l.heightM}`);
  }
  const tiers = [0, 0, 0, 0];
  for (const l of LANDMARKS) tiers[l.tier]++;
  ok(
    `${LANDMARKS.length} landmarks use only real vocabulary ids`,
    !bad.length,
    bad.slice(0, 6).join(", "),
  );
  ok(
    "the landmark registry has heroes and some breadth",
    tiers[3] >= 5 && LANDMARKS.length >= 20,
    `tiers: ${tiers.join("/")}`,
  );
} else {
  console.log("skip landmark checks — src/geo/landmarks.ts not present yet");
}

/* 7. every profile already written into data/build is drawable -------------- */
const chunkDir = "data/build/chunks";
let scanned = 0;
let enriched = 0;
const undrawable = [];
if (existsSync(chunkDir)) {
  const files = readdirSync(chunkDir).filter((f) => /^chunk_-?\d+_-?\d+\.json$/.test(f) && !f.includes(".meta."));
  for (const f of files) {
    const d = JSON.parse(readFileSync(join(chunkDir, f), "utf8"));
    scanned++;
    for (const b of d.b ?? []) {
      if (!b.e) continue;
      enriched++;
      if (!FAMILIES[b.e.f]) undrawable.push(`${b.id} family=${b.e.f}`);
      else if (!PALETTES[b.e.p]) undrawable.push(`${b.id} palette=${b.e.p}`);
      if (b.e.r && !ROOFS[b.e.r]) undrawable.push(`${b.id} roof=${b.e.r}`);
      if (b.e.b && !BALCONIES[b.e.b]) undrawable.push(`${b.id} balcony=${b.e.b}`);
    }
  }
}
if (enriched) {
  ok(
    `all ${enriched} enriched buildings are drawable`,
    !undrawable.length,
    undrawable.slice(0, 6).join(", "),
  );
} else {
  console.log(`skip chunk scan — ${scanned} chunks present but none enriched yet`);
}

if (failures) {
  console.error(`\nvocab check FAILED (${failures}) — buildings will silently fall back to the default family.`);
  process.exit(1);
}
console.log("\nok  vocabulary verified: every family, palette, prior and landmark is drawable.");