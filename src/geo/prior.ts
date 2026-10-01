/**
 * Visual priors: the honest layer between measured geography and the
 * procedural renderer.
 *
 * ------------------------------------------------------------------ *
 * Why this file exists
 * ------------------------------------------------------------------ *
 * Measured over 1,842 real buildings in Fort, 2026-09-30:
 *
 *   building:levels     11.7%     building:height     0%
 *   building:colour      0.6%     building:facade     0%
 *   building:material    0.1%
 *
 *   and 10 of the 11 that DO carry `building:colour` are the literal
 *   strings "white" or "yellow". There is no appearance database for Mumbai.
 *
 * So for ~99% of buildings the facade, the colour, the openings and the roof
 * are an INFERENCE from what we do know: where it is, which macro-zone, how
 * big the footprint is, what OSM called it, how many storeys were measured,
 * whether it fronts a street, and what is architecturally characteristic of
 * that part of the city. That inference is worth having — a Fort street of
 * flat grey boxes is less useful than a Fort street of plausible buildings —
 * but it must never be presented as a sourced fact, and that is the entire
 * job of this module.
 *
 * Three commitments, in priority order:
 *
 *  1. A researched landmark is never second-guessed. `EvidenceIn.landmark`
 *     carries values someone looked up, so they come back documented rather
 *     than inferred, and the model contributes only the openings the family
 *     itself defines. Override this and the research is wasted.
 *
 *  2. Provenance is recorded PER FIELD, not per building. A building whose
 *     class came from `building=apartments` but whose paint is a guess must
 *     not be reported as if the paint were known. A single blanket
 *     "model_prior" would throw away the only distinction that matters, and
 *     `priorForChunk` would then be unable to report how much of a chunk is
 *     inference. Fields inherit the family's provenance only for the parts the
 *     family itself dictates (openings, balcony, roof); colour never inherits
 *     anything, because nothing in our data ever fixes a colour.
 *
 *  3. Confidence falls as inference rises, and is never uniform. It is a
 *     weighted mean of five per-field scores, each multiplied by a discount
 *     for that field's provenance. Weighting (rather than a mean) reflects
 *     that the family decides whether the building reads correctly at all,
 *     and that the palette is the least load-bearing of the five and also the
 *     one we are least entitled to.
 *
 * ------------------------------------------------------------------ *
 * What this layer is NOT
 * ------------------------------------------------------------------ *
 * It never invents geometry. Footprint, position and height stay exactly as
 * OSM gave them; this only names a visual grammar from `vocab.js`. It also
 * never widens the vocabulary: every id it can emit is taken from an existing
 * `FAMILIES` entry or its `palettes` list, so there is no path by which a typo
 * silently drops a building back to the default family.
 *
 * Pure data and pure functions — no three.js, no DOM — so `scripts/check-prior.mjs`
 * can assert the whole thing from Node and so a chunk can be enriched without
 * a renderer.
 */

import {
  BALCONIES,
  FAMILIES,
  PALETTES,
  REGION_PRIORS,
  ROOFS,
  WINDOWS,
  hash01,
} from "./vocab.js";
import type { Family } from "./vocab.js";

/* ------------------------------------------------------------------ *
 * Provenance.
 * ------------------------------------------------------------------ */

export type Provenance =
  /** counted in OSM: the storey count itself */
  | "osm:building:levels"
  /** OSM `name` says what this is, or a landmark record was researched */
  | "osm:name"
  /** OSM `building=*` type says what this is */
  | "osm:building"
  /** arithmetic on measured data, or a documented family's own grammar */
  | "derived"
  /** this is the model's own architectural knowledge of this part of Mumbai */
  | "model_prior"
  /** a placeholder, to be replaced once evidence arrives */
  | "assumed";

/** Every provenance value, in descending order of trust. */
export const PROVENANCES: readonly Provenance[] = [
  "osm:building:levels",
  "osm:name",
  "osm:building",
  "derived",
  "model_prior",
  "assumed",
];

/**
 * How much a field is worth once provenance has had its say.
 *
 * A measured storey count is taken at face value. A researched landmark is
 * nearly as good, because someone checked it. An OSM type is a map tagging
 * habit, not a survey, so it is discounted. `derived` is trusted more than
 * `model_prior` because arithmetic on a measurement is at least anchored, and
 * `assumed` is barely worth anything. Multiplied rather than subtracted, so a
 * weak field with poor provenance cannot be rescued by the other factor —
 * the same reasoning as `recipe.ts`.
 */
const PROVENANCE_DISCOUNT: Record<Provenance, number> = {
  "osm:building:levels": 1,
  "osm:name": 1,
  "osm:building": 0.9,
  derived: 0.72,
  model_prior: 0.5,
  assumed: 0.3,
};

/* ------------------------------------------------------------------ *
 * Field weights and base scores.
 * ------------------------------------------------------------------ */

/**
 * How much each field contributes to `confidence`. Sums to 1.
 *
 * The family dominates because it is what decides whether the massing, the
 * floor band and the roof line all read as the right sort of building. The
 * palette is the smallest weight and the lowest base score, which is the
 * honest ordering: we are least entitled to a colour and a wrong one costs
 * least. Opening rhythm, balcony and roof come out of the family definition,
 * so they are worth more than the colour even though they are no more directly
 * observed — a wrong roof line is a wrong silhouette, a wrong paint is a
 * different street.
 */
const FIELD_WEIGHT: Record<PriorField, number> = {
  family: 0.35,
  palette: 0.15,
  windows: 0.15,
  balconies: 0.1,
  roof: 0.25,
};

export type PriorField = "family" | "palette" | "windows" | "balconies" | "roof";
export const PRIOR_FIELDS: readonly PriorField[] = [
  "family", "palette", "windows", "balconies", "roof",
];

/** How well each field is known before provenance discounts it, 0..1. */
const FIELD_BASE_SCORE: Record<PriorField, number> = {
  family: 0.62, // zone prior + footprint + class; rarely better than that
  palette: 0.45, // there is no colour data in Mumbai, full stop
  windows: 0.72, // the family dictates its own openings
  balconies: 0.7,
  roof: 0.68,
};

/** Confidence below this means the prior is doing more work than the data. */
const NEEDS_THRESHOLD = 0.7;

/* ------------------------------------------------------------------ *
 * Evidence and result.
 * ------------------------------------------------------------------ */

/** What we know for certain about a building. */
export interface EvidenceIn {
  id: string;
  lon: number;
  lat: number;
  /** the macro-zone, as enrich-chunks.mjs zoneOf() names it */
  zone: string;
  /** facade class from classify(): residential|apartments|commercial|... */
  cls: string;
  /** footprint area, m2 */
  areaM2: number;
  /** height, metres */
  heightM: number;
  /** measured storey count, or null when OSM did not give one */
  levels: number | null;
  /** true when the building fronts a street */
  streetFacing: boolean;
  name: string | null;
  /** set when this building is a researched landmark */
  landmark?: { id: string; tier: number; family: string; palette: string; roof: string };
}

export interface VisualPrior {
  /** key into vocab FAMILIES */
  family: string;
  /** key into vocab PALETTES */
  palette: string;
  /** key into vocab WINDOWS */
  windows: string;
  /** key into vocab BALCONIES */
  balconies: string;
  /** key into vocab ROOFS */
  roof: string;
  /** per-field provenance — a palette can be inferred while the family is documented */
  provenance: Record<PriorField, Provenance>;
  /** 0..1 — how much of this is inference */
  confidence: number;
  /** one human-readable line: WHY this building looks like this */
  rationale: string;
  /** what would raise the confidence */
  needs: string[];
}

/* ------------------------------------------------------------------ *
 * Inference.
 * ------------------------------------------------------------------ */

/** A class classify() returns for a building it could not actually identify. */
const BARE_CLASS = "residential";

/** Floor-to-floor height assumed when a height exists but no storey count. */
const DEFAULT_FTF = 3.1;

/**
 * The inferred family, and why that family survived the constraints.
 *
 * `storeys` is the number actually used for reasoning: the measured count when
 * OSM gave one, otherwise the storey count implied by the height. It is always
 * returned so `rationale` can be honest about which of the two it used.
 */
interface FamilyChoice {
  family: string;
  storeys: number;
  measured: boolean;
  /** why this family and not another, in one clause */
  because: string;
}

/**
 * Infer the appearance of one building.
 *
 * Deterministic in `e.id`: the same evidence always yields the same prior, on
 * every machine and every reload, and two buildings with identical evidence
 * differ only because their ids differ. Nothing here is random in the
 * `Math.random` sense — a prior that changed on reload would make a street
 * unfixable, because there would be no prior to correct.
 *
 * @param e what is measured or documented about the building
 * @returns the visual prior, its per-field provenance, a confidence, and what would improve it
 */
export function inferPrior(e: EvidenceIn): VisualPrior {
  if (e.landmark) return landmarkPrior(e);

  const choice = chooseFamily(e);
  const spec = FAMILIES[choice.family] ?? FAMILIES.mixed_use;

  // The family may arrive from an OSM tag rather than from the prior; the
  // openings, balcony and roof are then documented consequences of a
  // documented family, and colour is still nobody's guess but the model's.
  const familyProvenance: Provenance = familyTagProvenance(e);
  const inherited: Provenance =
    familyProvenance === "model_prior" ? "model_prior" : "derived";

  const palette = pickPalette(choice.family, spec, e.id);
  const windows = realWindow(spec.window);
  const balconies = realBalcony(spec.balcony);
  const roof = realRoof(spec.roof);

  const provenance: Record<PriorField, Provenance> = {
    family: familyProvenance,
    palette: "model_prior",
    windows: inherited,
    balconies: inherited,
    roof: inherited,
  };

  const scores: Record<PriorField, number> = { ...FIELD_BASE_SCORE };
  // A measured storey count is the single strongest per-building fact about
  // what kind of thing this is; it lifts the family score and, through the
  // family, the openings and the roof that follow from it.
  if (choice.measured) {
    scores.family = 0.9;
    scores.windows = 0.85;
    scores.roof = 0.8;
  } else if (e.heightM > 0) {
    scores.family = 0.72; // a storey count implied by a real height is better than a zone prior
    scores.windows = 0.78;
  }
  if (e.cls !== BARE_CLASS) scores.family = Math.max(scores.family, 0.85);
  if (e.streetFacing) scores.family = Math.max(scores.family, scores.family + 0.05);

  const confidence = scoreConfidence(scores, provenance);
  const rationale = bareRationale(e, choice, familyProvenance);

  return {
    family: choice.family,
    palette,
    windows,
    balconies,
    roof,
    provenance,
    confidence,
    rationale,
    needs: bareNeeds(e, choice, confidence),
  };
}

/**
 * A researched landmark's own record, unchanged.
 *
 * Nothing here is inferred, and nothing may contradict it: the family, the
 * palette and the roof are what somebody looked up, and the openings and
 * balcony are that documented family's own grammar rather than a fresh guess.
 * A landmark is therefore the only thing in the system that can reach
 * confidence 1 and carry no `needs` at all, which is the correct outcome —
 * there is genuinely nothing left to ask for.
 */
function landmarkPrior(e: EvidenceIn): VisualPrior {
  const lm = e.landmark!;
  const spec = FAMILIES[lm.family] ?? FAMILIES.mixed_use;
  const palette = lm.palette in spec.palettes || isPalette(lm.palette)
    ? lm.palette
    : spec.palettes[0] ?? "plaster_warm";

  const provenance: Record<PriorField, Provenance> = {
    family: "osm:name",
    palette: "osm:name",
    windows: "osm:name",
    balconies: "osm:name",
    roof: "osm:name",
  };
  const full: Record<PriorField, number> = {
    family: 1,
    palette: 1,
    windows: 1,
    balconies: 1,
    roof: 1,
  };

  return {
    family: isFamily(lm.family) ? lm.family : "mixed_use",
    palette: isPalette(palette) ? palette : "plaster_warm",
    windows: realWindow(spec.window),
    balconies: realBalcony(spec.balcony),
    roof: isRoof(lm.roof) ? lm.roof : realRoof(spec.roof),
    provenance,
    confidence: scoreConfidence(full, provenance),
    rationale:
      `${lm.id.replace(/-/g, " ")} is a researched landmark (tier ${lm.tier}); ` +
      `its family, palette and roof are the researched record and the openings are that family's own grammar`,
    needs: [],
  };
}

/**
 * Choose the family, under the constraints that actually rule families out.
 *
 * Order matters: the hard exclusions run first, because they are the ones a
 * wrong answer would be embarrassing about. A 24-storey building is not a
 * chawl and a 60 m2 two-storey building is not a modern tower, and neither
 * fact is a matter of taste.
 */
function chooseFamily(e: EvidenceIn): FamilyChoice {
  const storeys = e.levels ?? storeysFromHeight(e.heightM);
  const measured = e.levels !== null && e.levels > 0;

  // 1. an OSM type that names something drawable wins outright
  const byClass = classFamily(e.cls, storeys, e.areaM2);
  if (byClass) {
    return {
      family: byClass,
      storeys,
      measured,
      because: e.levels !== null && e.levels > 0
        ? `${e.levels} measured storeys sit inside the ${FAMILIES[byClass].floors[0]}-${FAMILIES[byClass].floors[1]} band this family is drawn for`
        : `it is a ${e.cls} footprint`,
    };
  }

  // 2. the region prior, minus everything the evidence rules out
  const zone = REGION_PRIORS[e.zone] ? e.zone : "central";
  const excluded = new Set<string>();
  for (const fid of Object.keys(REGION_PRIORS[zone])) {
    if (!familyPlausible(fid, storeys, e.areaM2)) excluded.add(fid);
  }
  // A family absent from the zone's prior is not excluded by the evidence, so
  // it stays available at a reduced weight rather than being forbidden.
  for (const fid of Object.keys(FAMILIES)) {
    if (!(fid in REGION_PRIORS[zone]) && familyPlausible(fid, storeys, e.areaM2)) {
      excluded.delete(fid);
    }
  }

  const implied = e.levels !== null && e.levels > 0 ? e.levels : storeysFromHeight(e.heightM);
  const family = seededDraw(zone, excluded, e.id, implied, e.areaM2);
  return {
    family,
    storeys,
    measured,
    because: exclusionReason(e, zone, family, excluded),
  };
}

/** What an OSM class means, as a family, or null when the class is uninformative. */
function classFamily(cls: string, storeys: number, areaM2: number): string | null {
  switch (cls) {
    case "industrial":
    case "infrastructure":
      return "industrial_shed";
    case "religious":
      return "religious";
    case "commercial":
      // A named commercial building is a tower only if it is one by its size.
      return storeys >= 14 || areaM2 > 3200 ? "modern_tower" : "mixed_use";
    case "institutional":
      return storeys >= 6 ? "midrise_concrete" : "victorian_institutional";
    case "apartments":
      return storeys >= 14 ? "modern_tower" : storeys >= 8 ? "midrise_concrete" : "mumbai_apartment";
    default:
      // `residential` is classify()'s fallback for a bare "Building" tag, so it
      // is not evidence of anything and must not be treated as a decision.
      return null;
  }
}

/**
 * Can this family be this building at all?
 *
 * The storey band is the dominant test because a measured `building:levels` is
 * the hardest number we have and the eye reads storey count before anything
 * else. `FAMILIES[].floors` is a sanity band, not a law: a band is extended by
 * one storey low and three high, so a 9-storey building can still be an
 * Art Deco apartment (band 5..9) and a 12-storey one can still be a midrise
 * (band 7..12) without either being absurd.
 *
 * Area is the second test, and it only bites at the extremes: a tower's
 * footprint is not 40 m2, and a bungalow's is not 6,000 m2. `FAMILIES` says
 * nothing about plan size, so these are this module's own bounds — the same
 * numbers `vocab.pickFamily` uses, kept in step deliberately.
 */
function familyPlausible(fid: string, storeys: number, areaM2: number): boolean {
  const spec = FAMILIES[fid];
  if (!spec) return false;
  if (storeys < spec.floors[0] - 1 || storeys > spec.floors[1] + 3) return false;
  // ~10 m2 per storey is the smallest sane plate; below it the "building" is a
  // projection or a canopy, and above 1,400 m2 a low-rise is a shed not a home.
  if (areaM2 > 0 && areaM2 < 10) return false;
  if (areaM2 < 120 && (fid === "modern_tower" || fid === "midrise_concrete" || fid === "institutional_campus")) {
    return false;
  }
  if (areaM2 > 3000 && (fid === "bungalow" || fid === "informal_basti" || fid === "chawl" || fid === "colonial_townhouse")) {
    return false;
  }
  return true;
}

/**
 * Storey count implied by a height. `derived` at best — the floor-to-floor
 * height is an assumption, which is why a measured count is preferred.
 */
function storeysFromHeight(heightM: number): number {
  if (!(heightM > 0)) return 2;
  return Math.max(1, Math.round(heightM / DEFAULT_FTF));
}

/**
 * The best-fitting family across the WHOLE vocabulary, by storey count.
 *
 * Used only when a zone's prior is exhausted — a 24-storey footprint in
 * south_mumbai rules out every family that zone normally has. The old fallback
 * returned a hard-coded "mixed_use", whose own band is 3-6 storeys, so the one
 * case where plausibility mattered most got the least plausible answer. Here the
 * evidence is explicit (measured or implied storeys), so the right answer is
 * simply the family whose band contains it.
 */
function bestFitFamily(storeys: number, areaM2: number): string {
  let best = "modern_tower";
  let bestCost = Infinity;
  for (const [fid, f] of Object.entries(FAMILIES)) {
    const [lo, hi] = f.floors;
    // distance from the storey band, 0 inside it
    const cost =
      storeys < lo ? lo - storeys : storeys > hi ? storeys - hi : 0;
    // a family whose plan is wildly wrong for the footprint is worse even if
    // the storey count fits — a 25 m2 footprint is not a modern tower
    const mid = (lo + hi) / 2;
    const expectArea = mid <= 2 ? 120 : mid <= 5 ? 260 : mid <= 10 ? 700 : 1400;
    const areaCost = Math.abs(Math.log(Math.max(areaM2, 20) / expectArea));
    const total = cost * 3 + areaCost;
    if (total < bestCost) {
      bestCost = total;
      best = fid;
    }
  }
  return best;
}

/** Seeded draw over a zone's prior, minus the excluded families. */
function seededDraw(
  zone: string,
  excluded: Set<string>,
  id: string,
  storeys: number,
  areaM2: number,
): string {
  const table = REGION_PRIORS[zone] ?? REGION_PRIORS.central;
  const entries = Object.entries(table).filter(([fid]) => !excluded.has(fid));
  if (!entries.length) {
    // Every family in the zone is contradicted by the evidence. The evidence
    // still points somewhere — it is just pointing outside this zone's usual
    // vocabulary — so fall back on the whole vocabulary rather than on a
    // constant.
    return bestFitFamily(storeys, areaM2);
  }
  const total = entries.reduce((a, [, w]) => a + w, 0);
  const r = hash01(id + "|" + zone) * total;
  let acc = r;
  for (const [fid, w] of entries) {
    acc -= w;
    if (acc <= 0) return fid;
  }
  return entries[entries.length - 1][0];
}

/** One clause naming the evidence that actually did the choosing. */
function exclusionReason(
  e: EvidenceIn,
  zone: string,
  family: string,
  excluded: Set<string>,
): string {
  if (excluded.size >= Object.keys(REGION_PRIORS[zone]).length) {
    return `the footprint contradicts every family ${zone} normally has, so it takes the closest match in the whole vocabulary`;
  }
  if (e.levels !== null && e.levels > 0) {
    return `measured ${e.levels} storeys rule out ${excluded.size} of the ${zone} families`;
  }
  if (e.heightM > 0) {
    return `a ${e.heightM} m height implies about ${storeysFromHeight(e.heightM)} storeys, which rules out ${excluded.size} of the ${zone} families`;
  }
  return `nothing but a footprint, so it draws the ${zone} prior`;
}

/** Where this building's family claim comes from. */
function familyTagProvenance(e: EvidenceIn): Provenance {
  if (e.name) return "osm:name";
  if (e.cls !== BARE_CLASS) return "osm:building";
  return "model_prior";
}

/** The family's own palette list, drawn deterministically from the building id. */
function pickPalette(family: string, spec: Family, id: string): string {
  const allowed = spec.palettes.filter(isPalette);
  if (!allowed.length) return "plaster_warm";
  return allowed[Math.floor(hash01(id + "|p") * allowed.length) % allowed.length];
}

/**
 * Weighted mean of the per-field scores, each discounted by its provenance.
 *
 * @param scores how well each field is known, 0..1
 * @param provenance where each field came from
 * @returns 0..1, rounded to two places
 */
function scoreConfidence(
  scores: Record<PriorField, number>,
  provenance: Record<PriorField, Provenance>,
): number {
  let total = 0;
  for (const field of PRIOR_FIELDS) {
    const raw = Math.max(0, Math.min(1, scores[field]));
    total += raw * PROVENANCE_DISCOUNT[provenance[field]] * FIELD_WEIGHT[field];
  }
  return round2(Math.max(0, Math.min(1, total)));
}

/* ------------------------------------------------------------------ *
 * Rationale and needs.
 * ------------------------------------------------------------------ */

function bareRationale(e: EvidenceIn, choice: FamilyChoice, prov: Provenance): string {
  const count = choice.measured
    ? `${e.levels} measured storeys`
    : e.heightM > 0
      ? `a ${e.heightM} m height and no measured storey count`
      : "no height and no storey count";
  const front = e.streetFacing
    ? "it fronts a street, so shopfronts and signage are likely at ground level"
    : "it fronts no street, so the facade is likely service-side and unadorned";
  const how =
    prov === "osm:name"
      ? "OSM names it"
      : prov === "osm:building"
        ? "OSM types it"
        : "nothing in OSM says what it is, so";
  return `${choice.family}: ${how} this is a ${zoneWord(e.zone)} building and ${choice.because}, while ${front}; colour is a prior, not a fact`;
}

function bareNeeds(e: EvidenceIn, choice: FamilyChoice, confidence: number): string[] {
  const needs: string[] = [];
  if (!choice.measured) {
    needs.push(
      `building:levels for this footprint (${e.id}) would replace a storey count inferred from ` +
        `${e.heightM > 0 ? `${e.heightM} m of height` : "nothing"} and would narrow the family`,
    );
  }
  if (e.cls === BARE_CLASS && !e.name) {
    needs.push(`a name or a building=* type for ${e.id} would make the family documented rather than drawn from the ${e.zone} prior`);
  }
  if (!e.streetFacing) {
    needs.push(`street frontage for ${e.id} — without it the shopfront and signage treatment is a guess in either direction`);
  }
  if (e.areaM2 <= 0) {
    needs.push(`a footprint area for ${e.id} would constrain the family on plan size alone`);
  }
  needs.push(
    `the palette for ${e.id} is the weakest field and there is no open data that fixes it: building:colour is 0.6% populated and building:material 0.1% for all of Mumbai, so appearance is a prior and only ever will be`,
  );
  if (choice.measured && confidence < NEEDS_THRESHOLD) {
    needs.push(`a storey count alone will not raise this above ${NEEDS_THRESHOLD}; the colour and the plan size are the limiting evidence`);
  }
  return needs;
}

const zoneWord = (zone: string) => zone.replace(/_/g, " ");

/* ------------------------------------------------------------------ *
 * Vocabulary guards.
 *
 * The family may in principle be replaced by hand, so every id that leaves
 * this module is checked against the real vocabulary. Falling back is
 * deliberate: a bad id here would make the renderer pick a default family
 * silently, which is the exact failure the rest of this design prevents. The
 * check in scripts/check-prior.mjs asserts against the module, not a copy.
 * ------------------------------------------------------------------ */

/**
 * Own-key test. The tsconfig target is ES2020, which predates
 * `Object.hasOwn`, and `in` would answer `true` for `toString`.
 *
 * @param o the object to test
 * @param k the key
 * @returns true only when `k` is an own property of `o`
 */
function own(o: object, k: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, k);
}

const isFamily = (id: string): boolean => own(FAMILIES, id);
const isPalette = (id: string): boolean => own(PALETTES, id);
const isRoof = (id: string): boolean => own(ROOFS, id);

const realWindow = (id: string): string => (own(WINDOWS, id) ? id : "shuttered");
const realBalcony = (id: string): string => (own(BALCONIES, id) ? id : "none");
const realRoof = (id: string): string => (own(ROOFS, id) ? id : "flat_parapet");

/* ------------------------------------------------------------------ *
 * Chunk aggregation.
 * ------------------------------------------------------------------ */

export interface ChunkStats {
  n: number;
  byFamily: Record<string, number>;
  byProvenance: Record<Provenance, number>;
  meanConfidence: number;
  /** how many priors are majority model_prior — the headline honest number */
  inferred: number;
}

/**
 * Infer every building in a chunk, and report how much of the chunk is guess.
 *
 * `inferred` is the number worth putting in a status line: priors whose
 * provenance is majority `model_prior`. It is deliberately not a confidence
 * threshold, because a prior can be mostly `model_prior` and still confident
 * (a well-constrained midrise) or mostly documented and still shaky.
 *
 * @param evidence one entry per building, in any order
 * @returns the priors keyed by building id, plus counts and the mean confidence
 */
export function priorForChunk(evidence: EvidenceIn[]): {
  priors: Map<string, VisualPrior>;
  stats: ChunkStats;
} {
  const priors = new Map<string, VisualPrior>();
  const byFamily: Record<string, number> = {};
  const byProvenance = Object.fromEntries(
    PROVENANCES.map((p) => [p, 0]),
  ) as Record<Provenance, number>;

  let confidenceSum = 0;
  let inferred = 0;

  for (const e of evidence) {
    const p = inferPrior(e);
    // A repeated id would otherwise double-count; the first occurrence is the
    // one the enricher wrote, which is the only defensible choice without a
    // rule for which duplicate wins.
    if (priors.has(e.id)) continue;
    priors.set(e.id, p);
    byFamily[p.family] = (byFamily[p.family] ?? 0) + 1;
    for (const field of PRIOR_FIELDS) byProvenance[p.provenance[field]]++;
    confidenceSum += p.confidence;
    if (isMajorityModelPrior(p)) inferred++;
  }

  return {
    priors,
    stats: {
      n: priors.size,
      byFamily,
      byProvenance,
      meanConfidence: priors.size ? round2(confidenceSum / priors.size) : 0,
      inferred,
    },
  };
}

/** Is more than half of this prior's field provenance `model_prior`? */
function isMajorityModelPrior(p: VisualPrior): boolean {
  let n = 0;
  for (const field of PRIOR_FIELDS) {
    if (p.provenance[field] === "model_prior") n++;
  }
  return n * 2 > PRIOR_FIELDS.length;
}

const round2 = (v: number): number => Math.round(v * 100) / 100;
