/**
 * Recipes: a parameter graph for the few buildings that are individually
 * important, plus the confidence model that decides whether one may be drawn
 * at all.
 *
 * A recipe is not a mesh. It is a small, named, editable description of a
 * building's massing, facade, details and signage, fitted onto the real OSM
 * footprint at `footprintSource`. The reason to store that rather than a mesh
 * is that a mesh cannot be corrected: an automated pass that finds the
 * Chhatrapati Shivaji Maharaj Terminus three storeys too short would have to
 * regenerate it. With a recipe it edits `masses[0].height` and the building
 * changes. The GIS stays the ground truth for the plan — a recipe never
 * invents a footprint, it only describes what stands on the one OSM gave us.
 *
 * Pure data and validation, no three.js, so `scripts/check-recipe.mjs` can
 * read it from Node and so a correction pass can run it without a renderer.
 *
 * ------------------------------------------------------------------ *
 * Why the confidence model is the interesting half
 * ------------------------------------------------------------------ *
 * A recipe is only allowed to override the procedural family when somebody has
 * evidence for the things it asserts. The failure this guards against is
 * specific and silent: a plausible-looking recipe built from nothing renders a
 * confident, wrong, hand-authored landmark where a well-drawn family building
 * would have been honest. So the evidence is per-AXIS rather than per-recipe —
 * knowing a building's height to the metre says nothing about its colour, and
 * the two should be able to disagree.
 *
 * Three decisions in here, each of which could reasonably have gone the other
 * way:
 *
 *  1. `overall` is a weighted mean, weighted by how much each axis changes
 *     whether the building reads correctly. Structural axes (identity,
 *     footprint, height, mass geometry) carry 0.75 between them; colour,
 *     roof, detail and signage carry 0.25. A mean treats a wrong height and a
 *     wrong signage board as equally wrong, and they are not: a recipe with
 *     the right mass and the wrong paint job is still a recognisable building,
 *     while the reverse is a featureless slab wearing a crown.
 *
 *  2. `weakest` is the lowest ADJUSTED score across the axes a correction pass
 *     can act on, and it is the axis most worth a human's attention — not the
 *     axis that happens to be most uncertain. Provenance is folded into the
 *     score first (below), so "assumed, 0.9" does not outrank "derived, 0.6".
 *
 *  3. Provenance discounts the score rather than gating on its own. A single
 *     hard gate on provenance is brittle — it cannot express "measured, but
 *     measured badly" — whereas a discount composes: `measured` is taken at
 *     face value, `derived` is trusted slightly less, `assumed` is trusted
 *     about half, and `unknown` is worth almost nothing. Multiplication is
 *     used rather than a subtraction so an axis with a low score AND assumed
 *     provenance cannot be rescued by the other factor.
 *
 * `shouldUseCustom` is deliberately hard to satisfy. It requires the overall
 * score to clear the ACCEPT band, requires every structural axis to clear the
 * REVISE floor, refuses any structural axis whose provenance is `assumed` or
 * `unknown`, and refuses a recipe that does not validate against the
 * vocabulary. Anything short of all four returns false, and the caller draws
 * the procedural family instead. A recipe is an override of a system that
 * already works; the fallback is not a failure state, it is the default, and
 * "false when in doubt" is the whole design.
 *
 * The bands are thresholds on the overall score, and are deliberately
 * asymmetric about how much they cluster near the top. Two-thirds of the range
 * is generic and revise; only the last quarter is accept. Passing accept means
 * a renderer will assert this building's architecture in place of evidence it
 * trusts more, which should be rare and should be earned.
 */

import { PALETTES, WINDOWS, TRIM } from "./vocab.js";

/* ------------------------------------------------------------------ *
 * The parameter graph.
 * ------------------------------------------------------------------ */

/** The massing primitives a recipe may compose. */
export type MassType =
  | "block" | "curved_block" | "tower" | "setback_stack" | "wing"
  | "drum" | "dome" | "spire" | "gable_block";

export interface Mass {
  type: MassType;
  /** metres, in the building's own frame; origin is the footprint centroid */
  offset?: [number, number]; // metres from centroid
  length?: number;
  depth?: number;
  height: number; // metres above the plinth
  curvature?: number; // 0..1, for curved_block
  storeys?: number; // if set, height is derived from storeys
  fraction?: number; // 0..1 of the building's footprint this mass covers
}

export interface RecipeFacade {
  palette?: string; // a key into PALETTES
  windowFamily?: string; // a key into WINDOWS
  bandEveryStoreys?: number;
  rustication?: boolean;
}

export interface RecipeDetail {
  kind:
    | "rustication" | "balustrade" | "cornice" | "string_course"
    | "arched_entrance" | "colonnade" | "chajja" | "cornice_overhang"
    | "dome" | "finial" | "signage_board";
  /** metres, relative to the building origin */
  at?: [number, number, number];
  size?: [number, number, number];
  /** a key into TRIM or PALETTES, else a hex */
  colour?: string | number;
  strength?: number; // 0..1
}

export interface SignageSpec {
  kind: string;
  at: [number, number, number];
  /** metres; the sign's height */
  height: number;
  colour?: string | number;
  text?: string;
}

export interface Recipe {
  id: string;
  name: string;
  /** the real footprint this must be fitted onto — the GIS is the ground truth */
  footprintSource: "osm";
  heightM: number;
  masses: Mass[];
  facade?: RecipeFacade;
  windows?: { family?: string; levels?: number; spacing?: number; arch?: boolean };
  details?: RecipeDetail[];
  signage?: SignageSpec[];
}

/** Every massing primitive, for the validator and for a correction pass. */
export const MASS_TYPES: readonly MassType[] = [
  "block", "curved_block", "tower", "setback_stack", "wing",
  "drum", "dome", "spire", "gable_block",
];

/** Every detail primitive. `validate` compares against this, not a restatement. */
export const DETAIL_KINDS: readonly RecipeDetail["kind"][] = [
  "rustication", "balustrade", "cornice", "string_course",
  "arched_entrance", "colonnade", "chajja", "cornice_overhang",
  "dome", "finial", "signage_board",
];

/* ------------------------------------------------------------------ *
 * Plausibility bounds. Shared by sanitise() and validate() so the clamp
 * and the complaint can never disagree about what "sane" means.
 * ------------------------------------------------------------------ */

/** A mass may not be pushed further from the centroid than this, in metres. */
const MAX_MASS_OFFSET_M = 500;
/** The smallest mass worth drawing; below this it is a modelling error. */
const MIN_MASS_DIM_M = 0.5;
/** The tallest recipe we will treat as a building rather than a typo. */
const MAX_HEIGHT_M = 400;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const round2 = (v: number) => Math.round(v * 100) / 100;

/* ------------------------------------------------------------------ *
 * Confidence.
 * ------------------------------------------------------------------ */

export type ConfidenceBand = "accept" | "revise" | "generic";

/** Half-open [lo, hi) score ranges, one per band. */
export const BANDS: Record<ConfidenceBand, [number, number]> = {
  accept: [0.75, 1.01],
  revise: [0.45, 0.75],
  generic: [0, 0.45],
};

/** How much each axis is worth in the overall score. Sums to 1. */
const AXIS_WEIGHT: Record<Evidence["axis"], number> = {
  identity: 0.2,
  footprint: 0.15,
  height: 0.2,
  mass_geometry: 0.2,
  roof: 0.1,
  facade_colour: 0.08,
  detail: 0.04,
  signage: 0.03,
};

/**
 * The axes that decide whether the building is a building at all. These are
 * the ones `shouldUseCustom` refuses to let be assumed.
 */
const STRUCTURAL_AXES: readonly Evidence["axis"][] = [
  "identity", "footprint", "height", "mass_geometry",
];

/** What a score is worth once provenance has had its say. */
const PROVENANCE_DISCOUNT: Record<Evidence["provenance"], number> = {
  measured: 1,
  derived: 0.9,
  assumed: 0.55,
  unknown: 0.25,
};

/** An axis with no evidence entry is not zero-knowledge, it is forgotten. */
const ABSENT_SCORE = 0.3;

export interface Evidence {
  axis:
    | "identity" | "footprint" | "height" | "mass_geometry"
    | "facade_colour" | "roof" | "detail" | "signage";
  /** 0..1 */
  score: number;
  /** where this number came from — "osm", "survey", "derived", "assumed" */
  provenance: "measured" | "derived" | "assumed" | "unknown";
  /** one line, human readable */
  note?: string;
}

export interface Assessment {
  overall: number;
  band: ConfidenceBand;
  weakest: Evidence["axis"] | null;
  byAxis: Record<string, number>;
}

/**
 * The band a score falls in. Monotonic: a higher score never lands in a lower
 * band, which is what makes the bands usable as thresholds at all.
 *
 * @param score 0..1, clamped
 * @returns the band
 */
export function bandFor(score: number): ConfidenceBand {
  const s = clamp01(score);
  if (s >= BANDS.accept[0]) return "accept";
  if (s >= BANDS.revise[0]) return "revise";
  return "generic";
}

/** score x provenance discount, in 0..1. */
function adjusted(e: Evidence): number {
  return clamp01(e.score) * PROVENANCE_DISCOUNT[e.provenance];
}

/** The evidence for one axis, or the absent-evidence stand-in. */
function evidenceFor(axis: Evidence["axis"], evidence: Evidence[]): Evidence {
  return evidence.find((e) => e.axis === axis) ?? { axis, score: ABSENT_SCORE, provenance: "unknown" };
}

/**
 * Score a recipe against its evidence.
 *
 * The per-axis numbers in `byAxis` are ADJUSTED (score x provenance discount),
 * not the raw scores, because that is the number a correction pass should act
 * on: an assumed 0.95 is not more actionable than a derived 0.6.
 *
 * @param recipe the recipe under assessment; used only for its id-bearing shape
 * @param evidence one entry per axis that is known
 * @returns the overall score, its band, the weakest actable axis, and every axis
 */
export function assess(recipe: Recipe, evidence: Evidence[]): Assessment {
  const byAxis: Record<string, number> = {};
  let total = 0;
  let weakest: Evidence["axis"] | null = null;
  let weakestScore = Infinity;

  for (const axis of Object.keys(AXIS_WEIGHT) as Evidence["axis"][]) {
    const a = adjusted(evidenceFor(axis, evidence));
    byAxis[axis] = round2(a);
    total += a * AXIS_WEIGHT[axis];
    if (a < weakestScore) {
      weakestScore = a;
      weakest = axis;
    }
  }

  // An empty recipe is not a low-confidence recipe, it is a missing one; the
  // family fallback is the only honest answer and the axes say so.
  if (!recipe.masses.length) total = 0;

  return { overall: round2(clamp01(total)), band: bandFor(total), weakest, byAxis };
}

/**
 * May this recipe be drawn in place of the procedural family?
 *
 * All four must hold, and the ordering is cheapest-first:
 *   1. it validates against the vocabulary — an unknown palette is not a
 *      low-confidence recipe, it is an undrawable one
 *   2. the overall score reaches the ACCEPT band
 *   3. every structural axis reaches the REVISE floor — a great palette does
 *      not buy a wrong height
 *   4. no structural axis is assumed or unknown
 *
 * @param recipe the recipe
 * @param evidence one entry per axis that is known
 * @returns true only when the recipe is better than the family fallback
 */
export function shouldUseCustom(recipe: Recipe, evidence: Evidence[]): boolean {
  if (validate(recipe).length) return false;
  if (sanitise(recipe).fixes.length) return false;

  const a = assess(recipe, evidence);
  if (a.band !== "accept") return false;

  for (const axis of STRUCTURAL_AXES) {
    if (a.byAxis[axis] < BANDS.revise[0]) return false;
    const e = evidenceFor(axis, evidence);
    if (e.provenance === "assumed" || e.provenance === "unknown") return false;
  }
  return true;
}

/* ------------------------------------------------------------------ *
 * Validation and clamping.
 * ------------------------------------------------------------------ */

/** A colour is a TRIM key, a PALETTES key, or an 0xRRGGBB integer. */
function colourProblem(where: string, colour: string | number): string | null {
  if (typeof colour === "number") {
    if (!Number.isInteger(colour) || colour < 0 || colour > 0xffffff) {
      return `${where}: colour ${colour} is not an 0xRRGGBB integer`;
    }
    return null;
  }
  if (colour in TRIM || colour in PALETTES) return null;
  return `${where}: colour "${colour}" is neither a TRIM key, a palette id, nor a hex`;
}

/**
 * Everything wrong with a recipe that would make it undrawable, or draw it as
 * something it is not. Returns problem strings rather than throwing: a
 * correction pass wants the whole list, not the first failure.
 *
 * Vocabulary lookups go through the real vocab.js tables, never a local copy,
 * so a palette added there is accepted here without touching this file.
 *
 * @param recipe the recipe to check
 * @returns one string per problem; empty means the recipe is drawable
 */
export function validate(recipe: Recipe): string[] {
  const out: string[] = [];
  const at = `recipe ${recipe.id}`;

  if (!recipe.id) out.push("id is empty");
  if (!recipe.name) out.push(`${at}: name is empty`);
  if (recipe.footprintSource !== "osm") {
    out.push(`${at}: footprintSource=${recipe.footprintSource}, the only source is "osm"`);
  }
  if (!(recipe.heightM > 0)) out.push(`${at}: heightM=${recipe.heightM}, must be > 0`);
  if (recipe.heightM > MAX_HEIGHT_M) out.push(`${at}: heightM=${recipe.heightM} exceeds ${MAX_HEIGHT_M}`);

  if (!recipe.masses.length) out.push(`${at}: has no masses`);

  recipe.masses.forEach((m, i) => {
    const where = `${at}.masses[${i}]`;
    if (!MASS_TYPES.includes(m.type)) out.push(`${where}: unknown mass type "${m.type}"`);
    if (!(m.height > 0)) out.push(`${where}: height=${m.height}, must be > 0`);
    if (m.length !== undefined && m.length <= 0) out.push(`${where}: length=${m.length}, must be > 0`);
    if (m.depth !== undefined && m.depth <= 0) out.push(`${where}: depth=${m.depth}, must be > 0`);
    if (m.curvature !== undefined && (m.curvature < 0 || m.curvature > 1)) {
      out.push(`${where}: curvature=${m.curvature}, must be 0..1`);
    }
    if (m.fraction !== undefined && (m.fraction <= 0 || m.fraction > 1)) {
      out.push(`${where}: fraction=${m.fraction}, must be in (0, 1]`);
    }
    if (m.storeys !== undefined && m.storeys <= 0) {
      out.push(`${where}: storeys=${m.storeys}, must be > 0`);
    }
    const off = m.offset ?? [0, 0];
    if (Math.hypot(off[0], off[1]) > MAX_MASS_OFFSET_M) {
      out.push(`${where}: offset ${off} is beyond ${MAX_MASS_OFFSET_M} m from the centroid`);
    }
    if (m.height > recipe.heightM) {
      out.push(`${where}: height=${m.height} exceeds the recipe height ${recipe.heightM}`);
    }
  });

  const f = recipe.facade;
  if (f) {
    if (f.palette && !(f.palette in PALETTES)) {
      out.push(`${at}.facade: unknown palette "${f.palette}"`);
    }
    if (f.windowFamily && !(f.windowFamily in WINDOWS)) {
      out.push(`${at}.facade: unknown window family "${f.windowFamily}"`);
    }
    if (f.bandEveryStoreys !== undefined && f.bandEveryStoreys <= 0) {
      out.push(`${at}.facade: bandEveryStoreys=${f.bandEveryStoreys}, must be > 0`);
    }
  }

  if (recipe.windows) {
    if (recipe.windows.family && !(recipe.windows.family in WINDOWS)) {
      out.push(`${at}.windows: unknown family "${recipe.windows.family}"`);
    }
    if (recipe.windows.levels !== undefined && recipe.windows.levels <= 0) {
      out.push(`${at}.windows: levels=${recipe.windows.levels}, must be > 0`);
    }
    if (recipe.windows.spacing !== undefined && recipe.windows.spacing <= 0) {
      out.push(`${at}.windows: spacing=${recipe.windows.spacing}, must be > 0`);
    }
  }

  recipe.details?.forEach((d, i) => {
    const where = `${at}.details[${i}]`;
    if (!DETAIL_KINDS.includes(d.kind)) out.push(`${where}: unknown detail kind "${d.kind}"`);
    if (d.strength !== undefined && (d.strength < 0 || d.strength > 1)) {
      out.push(`${where}: strength=${d.strength}, must be 0..1`);
    }
    if (d.colour !== undefined) {
      const p = colourProblem(where, d.colour);
      if (p) out.push(p);
    }
    if (d.size && d.size.some((v) => v < 0)) out.push(`${where}: size has a negative component`);
  });

  recipe.signage?.forEach((s, i) => {
    const where = `${at}.signage[${i}]`;
    if (!s.kind) out.push(`${where}: kind is empty`);
    if (!(s.height > 0)) out.push(`${where}: height=${s.height}, must be > 0`);
    if (s.at[1] < 0) out.push(`${where}: at[1]=${s.at[1]}, signage below ground`);
    if (s.colour !== undefined) {
      const p = colourProblem(where, s.colour);
      if (p) out.push(p);
    }
  });

  return out;
}

/**
 * Clamp a recipe to a plausible building: no zero or negative masses, no mass
 * taller than the recipe height, everything within a sane radius.
 *
 * Every change is named in `fixes` in the form `<path>: <what> -> <why>`, so a
 * correction pass reading the list can see that it was violating the
 * invariant and which field to go and re-source, rather than seeing a
 * silently different building. Clamping rather than throwing is the point: a
 * recipe that is 95% right should still render 95% right.
 *
 * A mass that cannot be repaired without inventing geometry — one with no
 * usable height, or one whose plan lands outside the building — is DROPPED,
 * not fudged, and the drop is reported. A dropped mass is a visible hole and a
 * reported fix; a fudged one is an invisible wrong building.
 *
 * @param recipe the recipe to clamp
 * @returns a new recipe (the input is not mutated) and the list of fixes
 */
export function sanitise(recipe: Recipe): { recipe: Recipe; fixes: string[] } {
  const fixes: string[] = [];
  const fix = (path: string, what: string, why: string) =>
    fixes.push(`${path}: ${what} — ${why}`);

  // --- the envelope itself ---------------------------------------------------
  let heightM = recipe.heightM;
  if (!(heightM > 0)) {
    fix("heightM", `${heightM} -> ${MIN_MASS_DIM_M}`, "a building has no height; clamped to the minimum drawable");
    heightM = MIN_MASS_DIM_M;
  }
  if (heightM > MAX_HEIGHT_M) {
    fix("heightM", `${heightM} -> ${MAX_HEIGHT_M}`, `above ${MAX_HEIGHT_M} m is a typo, not a building`);
    heightM = MAX_HEIGHT_M;
  }

  // --- masses ----------------------------------------------------------------
  const masses: Mass[] = [];
  recipe.masses.forEach((m, i) => {
    const path = `masses[${i}]`;

    // Plan first: a mass with no usable position cannot be drawn at all, and
    // dropping it before touching its height means the height fix is not
    // reported for a mass that no longer exists.
    let offset = m.offset;
    if (offset) {
      const r = Math.hypot(offset[0], offset[1]);
      if (!Number.isFinite(r) || r > MAX_MASS_OFFSET_M) {
        const k = Number.isFinite(r) && r > 0 ? MAX_MASS_OFFSET_M / r : 0;
        const clamped: [number, number] = [round2(offset[0] * k), round2(offset[1] * k)];
        fix(path, `offset [${offset}] -> [${clamped}]`, `beyond ${MAX_MASS_OFFSET_M} m of the footprint centroid`);
        offset = clamped;
      }
    }

    const next: Mass = { ...m };
    if (offset) next.offset = offset;

    if (m.length !== undefined && !(m.length > 0)) {
      fix(path, `length ${m.length} -> ${MIN_MASS_DIM_M}`, "a mass with no length has no plan");
      next.length = MIN_MASS_DIM_M;
    }
    if (m.depth !== undefined && !(m.depth > 0)) {
      fix(path, `depth ${m.depth} -> ${MIN_MASS_DIM_M}`, "a mass with no depth has no plan");
      next.depth = MIN_MASS_DIM_M;
    }
    if (m.curvature !== undefined) {
      const c = clamp01(m.curvature);
      if (c !== m.curvature) {
        fix(path, `curvature ${m.curvature} -> ${c}`, "curvature is a 0..1 blend, not metres");
        next.curvature = c;
      }
    }
    if (m.fraction !== undefined) {
      const f = clamp01(m.fraction);
      if (f !== m.fraction) {
        fix(path, `fraction ${m.fraction} -> ${f}`, "a mass cannot cover zero or more than all of the footprint");
        next.fraction = f === 0 ? MIN_MASS_DIM_M : f;
      }
    }
    if (m.storeys !== undefined && !(m.storeys > 0)) {
      fix(path, `storeys ${m.storeys} -> dropped`, "storeys are what height is derived from; a bad count has no derived height");
      delete next.storeys;
    }

    if (!(m.height > 0)) {
      fix(path, `height ${m.height} -> dropped`, "a mass with no height is not drawable and cannot be fudged");
      return;
    }
    if (m.height > heightM) {
      fix(path, `height ${m.height} -> ${heightM}`, `no mass may stand taller than the building (${heightM} m)`);
      next.height = heightM;
    }

    masses.push(next);
  });

  // --- facade and windows ----------------------------------------------------
  let facade = recipe.facade;
  if (facade) {
    const f: RecipeFacade = { ...facade };
    if (f.palette && !(f.palette in PALETTES)) {
      fix("facade.palette", `"${f.palette}" -> dropped`, "not a palette id, so the facade falls back to the family's own palette");
      delete f.palette;
    }
    if (f.windowFamily && !(f.windowFamily in WINDOWS)) {
      fix("facade.windowFamily", `"${f.windowFamily}" -> dropped`, "not a window family, so the family's own is used");
      delete f.windowFamily;
    }
    if (f.bandEveryStoreys !== undefined && !(f.bandEveryStoreys > 0)) {
      fix("facade.bandEveryStoreys", `${f.bandEveryStoreys} -> dropped`, "banding every zero storeys would band the whole facade");
      delete f.bandEveryStoreys;
    }
    facade = f;
  }

  let windows = recipe.windows;
  if (windows) {
    const w = { ...windows };
    if (w.family && !(w.family in WINDOWS)) {
      fix("windows.family", `"${w.family}" -> dropped`, "not a window family");
      delete w.family;
    }
    for (const k of ["levels", "spacing"] as const) {
      if (w[k] !== undefined && !(w[k] > 0)) {
        fix(`windows.${k}`, `${w[k]} -> dropped`, "a non-positive count or spacing has no layout");
        delete w[k];
      }
    }
    windows = w;
  }

  // --- details ---------------------------------------------------------------
  const details: RecipeDetail[] = [];
  recipe.details?.forEach((d, i) => {
    const path = `details[${i}]`;
    if (!DETAIL_KINDS.includes(d.kind)) {
      fix(path, `kind "${d.kind}" -> dropped`, "a renderer cannot draw a detail primitive it does not know");
      return;
    }
    const next: RecipeDetail = { ...d };
    if (d.strength !== undefined) {
      const s = clamp01(d.strength);
      if (s !== d.strength) {
        fix(path, `strength ${d.strength} -> ${s}`, "strength is a 0..1 blend");
        next.strength = s;
      }
    }
    if (d.size) {
      const size = d.size.map((v) => Math.abs(v)) as [number, number, number];
      if (size.some((v, j) => v !== d.size![j])) {
        fix(path, `size [${d.size}] -> [${size}]`, "a detail cannot be smaller than the plane it sits on");
        next.size = size;
      }
    }
    if (d.at && d.at[1] < 0) {
      next.at = [d.at[0], 0, d.at[2]];
      fix(path, `at.y ${d.at[1]} -> 0`, "detail below the plinth is not visible");
    }
    // A colour naming a vocabulary key that no longer exists is dropped, not
    // guessed: the renderer would fall back to a tone chosen by someone else.
    if (typeof d.colour === "string" && !(d.colour in TRIM) && !(d.colour in PALETTES)) {
      fix(path, `colour "${d.colour}" -> dropped`, "not a TRIM key, a palette id, or a hex");
      delete next.colour;
    }
    details.push(next);
  });

  // --- signage ---------------------------------------------------------------
  const signage: SignageSpec[] = [];
  recipe.signage?.forEach((s, i) => {
    const path = `signage[${i}]`;
    if (!s.kind) {
      fix(path, "empty kind -> dropped", "signage with no kind is not a sign");
      return;
    }
    const next: SignageSpec = { ...s };
    if (!(s.height > 0)) {
      fix(path, `height ${s.height} -> 0.4`, "a sign with no height is not a sign; 0.4 m is the smallest legible board");
      next.height = 0.4;
    }
    if (s.at[1] < 0) {
      next.at = [s.at[0], 0, s.at[2]];
      fix(path, `at.y ${s.at[1]} -> 0`, "signage below ground is not visible");
    }
    if (typeof s.colour === "string" && !(s.colour in TRIM) && !(s.colour in PALETTES)) {
      fix(path, `colour "${s.colour}" -> dropped`, "not a TRIM key, a palette id, or a hex");
      delete next.colour;
    }
    signage.push(next);
  });

  return {
    recipe: { ...recipe, heightM, masses, facade, windows, details, signage },
    fixes,
  };
}
