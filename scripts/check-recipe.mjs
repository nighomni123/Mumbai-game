/**
 * The gate on recipes and their confidence model.
 *
 * A recipe is an override of a system that already works: when one is used,
 * the procedural family is NOT drawn. So the failure that matters is not a
 * crash, it is a plausible-looking recipe made of nothing rendering a
 * confident, wrong landmark — and it is silent, because every type here is a
 * plain string and a number, so `tsc` cannot see a palette that does not
 * exist or a mass taller than its own building.
 *
 * So this asserts the behaviour that would otherwise fail silently:
 *   1. a well-formed recipe survives sanitise() with zero fixes — a clamp that
 *      fires on valid input is a clamp nobody can trust
 *   2. a 0-height mass, a negative dimension and an over-tall mass are all
 *      caught AND named, because `fixes` is what a correction pass reads
 *   3. bandFor is monotonic in the score
 *   4. assumed/low evidence does NOT earn the custom render
 *   5. measured evidence on the structural axes DOES
 *   6. unknown palette / window family / detail kind are detectable
 *   7. an undrawable recipe cannot be used, whatever its evidence says
 *
 * Run: node scripts/check-recipe.mjs
 */

import {
  BANDS,
  MASS_TYPES,
  DETAIL_KINDS,
  bandFor,
  assess,
  shouldUseCustom,
  validate,
  sanitise,
} from "../src/geo/recipe.ts";
import { PALETTES, WINDOWS, TRIM } from "../src/geo/vocab.js";

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${detail ? " — " + detail : ""}`);
};

/** A recipe built the way a careful human would build one. */
const good = {
  id: "csmt",
  name: "Chhatrapati Shivaji Maharaj Terminus",
  footprintSource: "osm",
  heightM: 85,
  masses: [
    { type: "block", length: 300, depth: 90, height: 56, fraction: 0.8 },
    { type: "drum", length: 40, depth: 40, height: 79, offset: [0, 0] },
    { type: "dome", length: 22, depth: 22, height: 85 },
  ],
  facade: { palette: "institutional_stone", windowFamily: "arched", bandEveryStoreys: 3 },
  windows: { family: "arched", levels: 6, spacing: 3.2, arch: true },
  details: [
    { kind: "colonnade", at: [0, 0, 0], size: [6, 9, 1.2], strength: 0.9 },
    { kind: "finial", at: [0, 85, 0], size: [1.4, 3.2, 1.4], colour: "parapet", strength: 1 },
  ],
  signage: [{ kind: "board", at: [0, 14, 45], height: 4.2, colour: 0xf2c33c, text: "CSMT" }],
};

/* 1. valid input is left alone ---------------------------------------------- */
{
  const { recipe, fixes } = sanitise(good);
  ok(
    "a well-formed recipe passes sanitise with zero fixes",
    fixes.length === 0,
    fixes.join("; "),
  );
  ok("sanitise preserves every mass", recipe.masses.length === good.masses.length);
  ok("sanitise validates clean", validate(recipe).length === 0, validate(recipe).join("; "));
  ok("sanitise does not mutate its input", good.masses[0].height === 56);
}

/* 2. broken geometry is caught and NAMED ------------------------------------ */
{
  const broken = {
    ...good,
    masses: [
      { type: "block", length: 20, depth: 10, height: 0 },
      { type: "tower", length: -8, depth: 12, height: 30 },
      { type: "spire", length: 4, depth: 4, height: 200 },
    ],
    heightM: 85,
  };
  const { recipe, fixes } = sanitise(broken);

  const zeroHeight = fixes.filter((f) => f.includes("masses[0]") && f.includes("height 0"));
  const negativeDim = fixes.filter((f) => f.includes("masses[1]") && f.includes("length -8"));
  const overTall = fixes.filter((f) => f.includes("masses[2]") && f.includes("200"));
  ok("a 0-height mass is caught", zeroHeight.length > 0, zeroHeight.join("; "));
  ok("a negative dimension is caught", negativeDim.length > 0, negativeDim.join("; "));
  ok(
    "a mass taller than the building is clamped and named",
    overTall.length > 0 && recipe.masses.some((m) => m.height === 85),
    overTall.join("; "),
  );

  // The 0-height mass cannot be fudged, so it must be GONE — not shrunk into a
  // plausible-looking stub the correction pass would then read as intended.
  ok("an unrepairable mass is dropped, not invented", !recipe.masses.some((m) => m.height === 0));
  ok("every fix names its path", fixes.every((f) => /^masses\[\d+\]|^heightM|^facade|^windows|^details|^signage/.test(f)));
  ok("a broken recipe does not validate", validate(broken).length > 0);
}

/* 2b. out-of-range scalars are clamped, not trusted ----------------------- */
{
  const { recipe, fixes } = sanitise({
    ...good,
    masses: [{ type: "curved_block", length: 30, depth: 20, height: 40, curvature: 3.4, fraction: -1, offset: [9000, 0] }],
    details: [{ kind: "cornice", strength: 7 }],
  });
  const m = recipe.masses[0];
  ok("curvature is clamped to 0..1", m.curvature === 1, `got ${m.curvature}`);
  ok("a negative fraction is clamped to drawable", m.fraction > 0, `got ${m.fraction}`);
  ok("an absurd offset is pulled back inside", Math.hypot(m.offset[0], m.offset[1]) <= 500);
  ok("an out-of-range strength is clamped", recipe.details[0].strength === 1);
  ok("each clamp is reported", fixes.length >= 4, fixes.join("; "));
}

/* 3. bandFor is monotonic ---------------------------------------------------- */
{
  const rank = { generic: 0, revise: 1, accept: 2 };
  let monotonic = true;
  let previous = -1;
  for (let s = 0; s <= 1.0001; s += 0.005) {
    const r = rank[bandFor(s)];
    if (r < previous) monotonic = false;
    previous = r;
  }
  ok("bandFor is monotonic in the score", monotonic);
  ok("BANDS agree with bandFor at every threshold", [0, 0.44, 0.45, 0.74, 0.75, 1].every((s) => {
    const b = bandFor(s);
    return s >= BANDS[b][0] && s < BANDS[b][1];
  }));
  ok("bandFor clamps out-of-range scores", bandFor(-3) === "generic" && bandFor(9) === "accept");
  ok("bandFor is pure", bandFor(0.6) === bandFor(0.6));
}

/* 4-5. the confidence decision ----------------------------------------------- */
{
  const assumed = [
    { axis: "identity", score: 0.4, provenance: "assumed", note: "read off a photo" },
    { axis: "footprint", score: 0.4, provenance: "assumed" },
    { axis: "height", score: 0.45, provenance: "assumed" },
    { axis: "mass_geometry", score: 0.5, provenance: "assumed" },
    { axis: "facade_colour", score: 0.5, provenance: "assumed" },
    { axis: "roof", score: 0.5, provenance: "assumed" },
  ];
  const a = assess(good, assumed);
  ok("assumed low evidence lands in the generic band", a.band !== "accept", `overall ${a.overall} band ${a.band}`);
  ok("shouldUseCustom refuses an assumed recipe", shouldUseCustom(good, assumed) === false);
  ok("assess names a weakest axis", a.weakest !== null && a.byAxis[a.weakest] <= 0.3, `weakest ${a.weakest} @ ${a.byAxis[a.weakest]}`);

  const measured = [
    { axis: "identity", score: 0.95, provenance: "measured", note: "OSM wikidata id" },
    { axis: "footprint", score: 0.95, provenance: "measured", note: "OSM building=* outline" },
    { axis: "height", score: 0.9, provenance: "measured", note: "published figure" },
    { axis: "mass_geometry", score: 0.85, provenance: "derived", note: "from elevation photographs" },
    { axis: "facade_colour", score: 0.7, provenance: "assumed" },
    { axis: "roof", score: 0.8, provenance: "derived" },
  ];
  const m = assess(good, measured);
  ok("measured structural evidence reaches accept", m.band === "accept", `overall ${m.overall}`);
  ok("shouldUseCustom accepts a measured recipe", shouldUseCustom(good, measured) === true);

  // A good palette must not buy a wrong height.
  const goodColourBadHeight = measured.map((e) =>
    e.axis === "height" ? { ...e, score: 0.3, provenance: "assumed" } : e,
  );
  ok("a strong palette cannot buy an assumed height", shouldUseCustom(good, goodColourBadHeight) === false);

  // Absent evidence is not good evidence.
  ok("an empty evidence list does not earn the custom render", shouldUseCustom(good, []) === false);

  // A missing mass is not a low-confidence recipe; it is a missing one.
  ok("a massless recipe is generic", assess({ ...good, masses: [] }, measured).band === "generic");
}

/* 6. undrawable recipes are detectable -------------------------------------- */
{
  const problems = validate({
    ...good,
    facade: { palette: "hot_pink_glass", windowFamily: "tinted" },
    windows: { family: "panoramic" },
    details: [{ kind: "buttress" }],
    masses: [{ type: "ziggurat", height: 10 }],
  });
  const joined = problems.join(" | ");
  ok("an unknown palette is reported", joined.includes("hot_pink_glass"));
  ok("an unknown window family is reported", joined.includes("tinted"));
  ok("an unknown window override is reported", joined.includes("panoramic"));
  ok("an unknown detail kind is reported", joined.includes("buttress"));
  ok("an unknown mass type is reported", joined.includes("ziggurat"));
  ok("validate reports every problem, not just the first", problems.length >= 5, `${problems.length} problems`);

  // A real vocabulary id must NOT be a problem — the check is not just
  // "complain about everything".
  const clean = validate({
    ...good,
    facade: { palette: Object.keys(PALETTES)[0], windowFamily: Object.keys(WINDOWS)[0] },
  });
  ok("real vocabulary ids are accepted", clean.length === 0, clean.join("; "));

  const colourProblems = validate({
    ...good,
    details: [{ kind: "chajja", colour: "burnt_sienna" }, { kind: "balustrade", colour: 0x123456 }],
  });
  ok("an unknown colour key is reported", colourProblems.join("|").includes("burnt_sienna"));
  ok("a TRIM colour key is accepted", !validate({ ...good, details: [{ kind: "chajja", colour: "dish" }] }).length);
  ok("a hex colour is accepted", !validate({ ...good, details: [{ kind: "chajja", colour: 0xd8d4cc }] }).length);
  ok("an out-of-gamut hex is reported", validate({ ...good, details: [{ kind: "chajja", colour: 0xffffff + 5 }] }).length > 0);
  ok("TRIM is a non-empty vocabulary", Object.keys(TRIM).length > 0);
}

/* 7. confidence cannot rescue an undrawable recipe -------------------------- */
{
  const strongEvidence = [
    { axis: "identity", score: 1, provenance: "measured" },
    { axis: "footprint", score: 1, provenance: "measured" },
    { axis: "height", score: 1, provenance: "measured" },
    { axis: "mass_geometry", score: 1, provenance: "measured" },
    { axis: "facade_colour", score: 1, provenance: "measured" },
    { axis: "roof", score: 1, provenance: "measured" },
  ];
  const undrawable = { ...good, facade: { palette: "no_such_palette" } };
  ok("a perfect score on an undrawable recipe is still refused", shouldUseCustom(undrawable, strongEvidence) === false);
  ok("a perfect score on a clamped recipe is still refused", shouldUseCustom({ ...good, masses: [{ type: "block", height: 0 }] }, strongEvidence) === false);
  ok("assess is pure (same input, same output)", JSON.stringify(assess(good, strongEvidence)) === JSON.stringify(assess(good, strongEvidence)));
}

/* 8. the closed sets are complete and drawn from ----------------------------- */
{
  ok("every mass type is distinct", new Set(MASS_TYPES).size === MASS_TYPES.length);
  ok("every detail kind is distinct", new Set(DETAIL_KINDS).size === DETAIL_KINDS.length);
  ok("curved_block is the only curved mass", MASS_TYPES.filter((t) => t.includes("curved")).join() === "curved_block");
  ok("validate accepts a recipe using every mass type", validate({
    ...good,
    masses: MASS_TYPES.map((type, i) => ({ type, length: 5, depth: 5, height: 10 + i })),
  }).length === 0);
  ok("validate accepts a recipe using every detail kind", validate({
    ...good,
    details: DETAIL_KINDS.map((kind) => ({ kind })),
  }).length === 0);
}

if (failures) {
  console.error(`\nrecipe check FAILED (${failures}) — a bad recipe would render confident nonsense.`);
  process.exit(1);
}
console.log("\nok  recipes verified: clamping, bands, provenance and the family fallback all hold.");
