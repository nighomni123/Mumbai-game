/**
 * The visual vocabulary: what a building IS, in terms a renderer can draw.
 *
 * Plain JS on purpose, for the same reason as citymap-math.js: the enrichment
 * script is Node and the renderer is TypeScript, and a duplicated vocabulary is
 * one that drifts. Everything here is data — no three.js, no canvas, no DOM —
 * so both sides can read it and neither can disagree about what "art_deco"
 * means.
 *
 * The idea underneath: geographic evidence goes in, this decides WHAT KIND OF
 * MUMBAI THING a building is, and the deterministic renderer decides how that
 * class looks. No PNG per building, no bespoke mesh per building.
 */

/* ------------------------------------------------------------------ *
 * Palettes. Named, never per-building hex.
 *
 * Each is a small set of tones; the renderer picks one deterministically from
 * the building id and jitters it, so a street reads as a family rather than as
 * one flat colour repeated. Values sit inside the existing engine PAL range
 * (src/engine/palette.js) — same cream/khaki/navy world, more of it.
 * ------------------------------------------------------------------ */

/** @typedef {{ base: number[], trim: number[], accent: number }} Palette */

/**
 * The SATURATED half is the important half. Measured on 2026-09-30, a palette
 * set of nothing but cream/khaki/grey produced street frames with `magenta` at
 * literally 0% and `mixed` at 0%, against the reference build's 9% magenta
 * across 9 hue families. A facade cannot carry an accent that is not in the
 * set. These are the sari reds, the taxi yellow, the gulmohar orange, the
 * Indian Railways green and the signage colours — they are what stops a street
 * looking like a sandcastle.
 */
/**
 * PALETTE VERSION.
 *
 * V1 is the 2026-09-30 baseline: nineteen near-neutral palettes, which measured
 * 2-3 tones covering half the frame against the reference's 16-33. V2 adds the
 * hues V1 lacked — restrained SATURATION, wide HUE. The reference reaches chroma
 * 0.950 and we reached 0.305; the fix is more hue families, not a saturation
 * slider, or the city reads as a toy. `?palette=v1` forces the old behaviour,
 * `?palette=v2` the new one, unset means v2.
 *
 * The switch is deterministic and reversible so the experiment answers exactly
 * one question: can colour-region work alone close the gap?
 */
export const PALETTE_VERSION =
  (typeof location !== "undefined" &&
    new URLSearchParams(location.search).get("palette")) || "v2";
export const isV2 = PALETTE_VERSION === "v2";

export const PALETTES = {
  // --- saturated accents: rare on purpose, decisive when they appear -------
  accent_saffron: { base: [0xe0a038, 0xd69634, 0xe8ae52, 0xcc8c2e], trim: [0xa8763a], accent: 0x8a1a2a },
  accent_indigo: { base: [0x4a5f92, 0x425684, 0x53689c, 0x3c4e79], trim: [0x2c3a5c], accent: 0xf2c33c },
  accent_maroon: { base: [0x8a3a44, 0x7d333d, 0x94424d, 0x722e37], trim: [0x54222a], accent: 0xf6d27a },
  accent_mint: { base: [0x6f9e8c, 0x659383, 0x7aa896, 0x5c8a7a], trim: [0x456b5d], accent: 0xf4efe0 },
  accent_terracotta: { base: [0xb5613f, 0xa85738, 0xc06b48, 0x9c4f33], trim: [0x7a3e28], accent: 0x2f6b52 },
  // --- the neutrals -------------------------------------------------------
  plaster_warm: { base: [0xd6c4a4, 0xcdb894, 0xd2bd98, 0xc9b28c], trim: [0xb9a180, 0xa89070], accent: 0xf2c33c },
  plaster_faded: { base: [0xd9c6ab, 0xe0cdb0, 0xd3bda3, 0xcdb9a4], trim: [0xb8a488, 0xa99a80], accent: 0xe8a020 },
  plaster_pink: { base: [0xdcc0ae, 0xd4b3a4, 0xe0c6b2, 0xcfab9d], trim: [0xb89a8c], accent: 0xd94f6a },
  painted_teal: { base: [0x9dbdb4, 0x8fb0a8, 0xa6c4ba, 0x86a9a1], trim: [0x6f8f89], accent: 0xf2ede0 },
  painted_blue: { base: [0x9fb0c4, 0x93a7bd, 0xa9b8c9, 0x8b9fb6], trim: [0x6d8098], accent: 0xf4efe0 },
  painted_ochre: { base: [0xd9b877, 0xd2ae68, 0xe0c288, 0xc9a45e], trim: [0xa8874a], accent: 0x8a1a2a },
  painted_saffron: { base: [0xe0a85c, 0xd89c4e, 0xe8b571, 0xcf9445], trim: [0xa8763a], accent: 0x2e5a3a },
  colonial_stone: { base: [0xc0b49c, 0xb5a88f, 0xc9bda6, 0xaa9d84], trim: [0x8f8269, 0x7d7059], accent: 0x6f6396 },
  art_deco_cream: { base: [0xe4d9c4, 0xdcd0ba, 0xe9dfcc, 0xd5c8b1], trim: [0xb8a98f, 0xa2947a], accent: 0x2b5f9e },
  institutional_stone: { base: [0xcec2a8, 0xc5b89e, 0xd5cab2, 0xbdb096], trim: [0x9d9179], accent: 0x1f4f3a },
  concrete_grey: { base: [0xbdb3a2, 0xb3a999, 0xc4baa9, 0xaba191], trim: [0x8d8478], accent: 0x4d5a63 },
  brick_laterite: { base: [0xa9613f, 0x9c5a3b, 0xb06846, 0x92533a], trim: [0x74412e], accent: 0x2f6b52 },
  // --- V2: the hues V1 had almost none of -----------------------------------
  // Restrained SATURATION, wide HUE. The reference reaches chroma 0.950 and we
  // reached 0.305; the fix is more hue families, not a saturation slider, or it
  // reads as a toy city. Every one of these is a real Mumbai wall colour.
  v2_ochre:       { base: [0xc9a558, 0xbf9a4c, 0xd3b064, 0xb8913f], trim: [0x8f7030], accent: 0x7a2e1e },
  v2_dusty_rose:  { base: [0xc9a08e, 0xc29784, 0xd0a996, 0xbb8d7a], trim: [0x8f6a5a], accent: 0x2f6b52 },
  v2_muted_red:   { base: [0xb2685c, 0xa75c50, 0xbd7468, 0x9d5245], trim: [0x75392f], accent: 0xe8d8b8 },
  v2_sage:        { base: [0x8f9c82, 0x85937a, 0x99a68b, 0x7b8a70], trim: [0x5d6b52], accent: 0xd8c9a0 },
  v2_pale_blue:   { base: [0x9aacb8, 0xa8b8c4, 0x9aabb8, 0xb2c0c9], trim: [0x6c7f8d], accent: 0xc23a2c },
  v2_turquoise:   { base: [0x6f9e9c, 0x669490, 0x7baba8, 0x5c8a87], trim: [0x446a67], accent: 0xf2c33c },
  v2_stone_brown: { base: [0x9a8b76, 0x91826d, 0xa3937f, 0x877965], trim: [0x665a4b], accent: 0x2b5f9e },
  v2_bright_cream:{ base: [0xefe6cc, 0xe8dfc4, 0xf4ecd6, 0xe1d7bb], trim: [0xc0b599], accent: 0xc23a2c },
  industrial_rust: { base: [0x9aa39f, 0x8a8175, 0xa3aaa4, 0x807a72], trim: [0x5f6a68, 0x6b5a4e], accent: 0xc23a2c },
  modern_glass: { base: [0x8f9bb0, 0x8494aa, 0x9aa5b8, 0x7d8b9c], trim: [0x5c6a7e, 0x4a5568], accent: 0xe8a020 },
};

/** Roof clutter and trim accents that belong to the engine PAL. */
export const TRIM = {
  parapet: 0xb0a695,
  waterTank: 0x4a5b52,
  waterTankBlue: 0x3d5a72,
  tarpaulin: 0x2f6f86,
  dish: 0xd8d4cc,
  laundry: 0xf2ede0,
  balconyRail: 0x8f6f52,
};

/* ------------------------------------------------------------------ *
 * Windows, balconies, roofs. Small closed sets — the renderer only has
 * to know how to draw these, and adding one is a deliberate act.
 * ------------------------------------------------------------------ */

/**
 * rhythm: openings per floor along the frontage.
 * inset: how far the reveal is cut into the wall, in metres (0 = flush).
 */
export const WINDOWS = {
  none:        { rhythm: 0,  inset: 0,    w: 0,   h: 0,   shade: 0x2b2733 },
  shuttered:   { rhythm: 0.55, inset: 0.18, w: 0.95, h: 1.5, shade: 0x3a4150 },
  arched:      { rhythm: 0.5,  inset: 0.22, w: 1.1,  h: 2.1, shade: 0x2f3540 },
  horizontal:  { rhythm: 1.0,  inset: 0.14, w: 1.5,  h: 1.15, shade: 0x3a4150 },
  bay:         { rhythm: 0.8,  inset: 0.45, w: 2.2,  h: 1.6,  shade: 0x33405a },
  grid:        { rhythm: 0.7,  inset: 0.12, w: 1.1,  h: 1.3,  shade: 0x33405a },
  narrow_slit: { rhythm: 0.35, inset: 0.1,  w: 0.5,  h: 1.2,  shade: 0x2b2733 },
  glass_band:  { rhythm: 1.0,  inset: 0.1,  w: 2.4,  h: 1.5,  shade: 0x4a5568 },
};

export const BALCONIES = {
  none:         { prob: 0,    depth: 0,    style: "none" },
  recessed:     { prob: 0.35, depth: 0.5,  style: "recessed" },
  slab:         { prob: 0.5,  depth: 1.1,  style: "slab" },
  curved_corner:{ prob: 0.9,  depth: 0.8,  style: "curved" },
  verandah:     { prob: 0.95, depth: 1.6,  style: "verandah" },
};

export const ROOFS = {
  flat_parapet: { pitch: 0,  clutter: 0.45, parapet: 0.9 },
  pitched_tile: { pitch: 0.34, clutter: 0.1, parapet: 0 },
  slab:        { pitch: 0,  clutter: 0.3, parapet: 0.5 },
  sawtooth:    { pitch: 0.18, clutter: 0.05, parapet: 0 },
  dome:        { pitch: 0,  clutter: 0.05, parapet: 0 },
  spire:       { pitch: 0,  clutter: 0.05, parapet: 0 },
  setback:     { pitch: 0,  clutter: 0.6, parapet: 0.8 },
  mansard:     { pitch: 0.42, clutter: 0.15, parapet: 0 },
};

/* ------------------------------------------------------------------ *
 * Building families.
 *
 * A family is a VISUAL GRAMMAR, not a mesh: a floor-height band, the look of
 * its openings, its roof, its plinth, and which palettes it may draw from.
 * Geometry is generated per building from these numbers, so 260k buildings
 * cost no more than one family definition.
 *
 * `floors` is [min, max] — a band the existing height estimate is expected to
 * land in, used to sanity-check an assignment rather than to override a height.
 * ------------------------------------------------------------------ */

/** @typedef {object} Family */
export const FAMILIES = {
  colonial_townhouse: {
    floors: [2, 4], ftf: 3.4, window: "shuttered", balcony: "none",
    roof: "pitched_tile", plinth: 0.6, palettes: ["colonial_stone", "plaster_warm", "plaster_faded"],
    groundShop: 0.25, awning: 0.2,
  },
  colonial_commercial: {
    floors: [3, 6], ftf: 3.6, window: "arched", balcony: "recessed",
    roof: "flat_parapet", plinth: 0.9, palettes: ["colonial_stone", "art_deco_cream", "plaster_warm"],
    groundShop: 0.7, awning: 0.45, signage: 0.55,
  },
  art_deco_apartment: {
    floors: [5, 9], ftf: 3.1, window: "bay", balcony: "curved_corner",
    roof: "flat_parapet", plinth: 0.8,
    palettes: ["art_deco_cream", "plaster_warm", "accent_mint", "accent_saffron"],
    groundShop: 0.3, awning: 0.1, signage: 0.2, banding: 0.9,
  },
  victorian_institutional: {
    floors: [2, 4], ftf: 4.4, window: "arched", balcony: "none",
    roof: "mansard", plinth: 1.1, palettes: ["institutional_stone", "colonial_stone"],
    groundShop: 0, awning: 0, colonnade: 0.7,
  },
  chawl: {
    floors: [3, 4], ftf: 3.2, window: "shuttered", balcony: "verandah",
    roof: "pitched_tile", plinth: 0.3,
    palettes: ["plaster_warm", "plaster_faded", "painted_teal", "accent_indigo", "accent_maroon"],
    groundShop: 0.35, awning: 0.6, timber: 0.8,
  },
  mumbai_apartment: {
    floors: [4, 8], ftf: 3.0, window: "grid", balcony: "slab",
    roof: "flat_parapet", plinth: 0.5,
    palettes: ["plaster_warm", "plaster_pink", "painted_ochre", "concrete_grey", "accent_saffron", "accent_mint", "accent_terracotta"],
    groundShop: 0.2, awning: 0.25, signage: 0.2,
  },
  midrise_concrete: {
    floors: [7, 12], ftf: 3.0, window: "grid", balcony: "slab",
    roof: "setback", plinth: 0.7,
    palettes: ["concrete_grey", "plaster_warm", "painted_blue", "accent_saffron", "accent_mint"],
    groundShop: 0.15, awning: 0.1, signage: 0.25,
  },
  modern_tower: {
    floors: [12, 25], ftf: 3.1, window: "glass_band", balcony: "recessed",
    roof: "setback", plinth: 1.4, palettes: ["modern_glass", "concrete_grey"],
    groundShop: 0.1, awning: 0, signage: 0.45, crown: 0.7,
  },
  mixed_use: {
    floors: [3, 6], ftf: 3.2, window: "shuttered", balcony: "slab",
    roof: "flat_parapet", plinth: 0.4,
    palettes: ["plaster_warm", "painted_teal", "plaster_faded", "painted_blue", "accent_maroon", "accent_saffron", "accent_mint"],
    groundShop: 0.75, awning: 0.65, signage: 0.6,
  },
  industrial_shed: {
    floors: [1, 2], ftf: 4.8, window: "narrow_slit", balcony: "none",
    roof: "sawtooth", plinth: 0.3, palettes: ["industrial_rust", "concrete_grey"],
    groundShop: 0.1, awning: 0,
  },
  informal_basti: {
    floors: [1, 3], ftf: 2.9, window: "narrow_slit", balcony: "none",
    roof: "pitched_tile", plinth: 0,
    palettes: ["plaster_faded", "brick_laterite", "painted_ochre", "accent_terracotta", "accent_indigo"],
    groundShop: 0.15, awning: 0.4, patched: 0.8,
  },
  bungalow: {
    floors: [1, 2], ftf: 3.4, window: "shuttered", balcony: "none",
    roof: "pitched_tile", plinth: 0.5, palettes: ["plaster_warm", "plaster_pink", "art_deco_cream"],
    groundShop: 0, awning: 0, garden: 0.8,
  },
  hotel: {
    floors: [5, 16], ftf: 3.2, window: "horizontal", balcony: "recessed",
    roof: "flat_parapet", plinth: 1.0, palettes: ["art_deco_cream", "colonial_stone", "plaster_warm"],
    groundShop: 0.5, awning: 0.4, signage: 0.9, canopy: 0.8,
  },
  religious: {
    floors: [1, 3], ftf: 5.0, window: "arched", balcony: "none",
    roof: "dome", plinth: 1.0, palettes: ["institutional_stone", "plaster_warm"],
    groundShop: 0, awning: 0, dome: 0.9,
  },
  institutional_campus: {
    floors: [2, 5], ftf: 3.8, window: "horizontal", balcony: "recessed",
    roof: "pitched_tile", plinth: 1.0, palettes: ["institutional_stone", "plaster_warm"],
    groundShop: 0.1, awning: 0.1, colonnade: 0.6,
  },
  market_shed: {
    floors: [1, 2], ftf: 4.2, window: "none", balcony: "none",
    roof: "sawtooth", plinth: 0.2, palettes: ["industrial_rust", "concrete_grey", "plaster_faded"],
    groundShop: 0.9, awning: 0.8,
  },
};

/** Every family id, in a stable order — the renderer indexes off this. */
/**
 * The V2 hues, by the families allowed to use them.
 *
 * Kept separate from FAMILIES so the version switch is one lookup rather than
 * two versions of every family definition — which is how two copies drift.
 */
const V2_PALETTES = [
  "v2_bright_cream", "v2_ochre", "v2_dusty_rose", "v2_muted_red",
  "v2_sage", "v2_pale_blue", "v2_turquoise", "v2_stone_brown",
  "plaster_warm", "plaster_faded", "colonial_stone",
];

/** The palette pool a family draws from, honouring the version switch. */
export function palettePool(family) {
  const base = (FAMILIES[family] || FAMILIES.mumbai_apartment).palettes;
  if (!isV2) return base;
  return [...new Set([...base, ...V2_PALETTES])];
}

export const FAMILY_IDS = Object.keys(FAMILIES);
export const PALETTE_IDS = Object.keys(PALETTES);
export const WINDOW_IDS = Object.keys(WINDOWS);
export const BALCONY_IDS = Object.keys(BALCONIES);
export const ROOF_IDS = Object.keys(ROOFS);

/* ------------------------------------------------------------------ *
 * Region priors.
 *
 * Not a hard restriction — a weighted preference. A Fort warehouse stays a
 * warehouse; a Fort chawl is unusual but possible. What the prior changes is
 * the DEFAULT family a bare, unnamed building takes on.
 * ------------------------------------------------------------------ */

/** @type {Record<string, Record<string, number>>} zone -> family -> weight */
export const REGION_PRIORS = {
  south_mumbai: {
    colonial_townhouse: 0.22, colonial_commercial: 0.16, art_deco_apartment: 0.14,
    victorian_institutional: 0.08, chawl: 0.1, mumbai_apartment: 0.1,
    mixed_use: 0.1, religious: 0.04, institutional_campus: 0.03, hotel: 0.02,
    bungalow: 0.01,
  },
  island_city: {
    art_deco_apartment: 0.3, hotel: 0.2, modern_tower: 0.2, colonial_commercial: 0.15,
    institutional_campus: 0.1, mixed_use: 0.05,
  },
  central: {
    chawl: 0.2, mumbai_apartment: 0.2, mixed_use: 0.18, industrial_shed: 0.1,
    midrise_concrete: 0.12, institutional_campus: 0.08, colonial_commercial: 0.06,
    religious: 0.03, art_deco_apartment: 0.03,
  },
  western_suburb: {
    mumbai_apartment: 0.24, midrise_concrete: 0.26, modern_tower: 0.16,
    mixed_use: 0.16, bungalow: 0.08, chawl: 0.05, hotel: 0.03, industrial_shed: 0.02,
  },
  eastern_suburb: {
    mumbai_apartment: 0.28, midrise_concrete: 0.24, chawl: 0.14, mixed_use: 0.14,
    industrial_shed: 0.1, modern_tower: 0.06, institutional_campus: 0.04,
  },
  new_mumbai: {
    modern_tower: 0.26, midrise_concrete: 0.26, mumbai_apartment: 0.2,
    hotel: 0.08, mixed_use: 0.12, industrial_shed: 0.05, bungalow: 0.03,
  },
};

/** Landmark tiers. See src/geo/landmarks.ts. */
export const TIER = {
  GENERIC: 0,
  SILHOUETTE: 1,
  NAMED: 2,
  HERO: 3,
};

/**
 * Pick a family for a bare building from its evidence.
 *
 * Deliberately conservative. Where the OSM type says something specific we
 * believe it; where it says nothing we fall back to the region prior and the
 * footprint's own size, because a 4,000 m2 plate in Fort is a different kind
 * of building from a 90 m2 one and area is the only per-building evidence a
 * nameless footprint has.
 *
 * @param {string} cls facade class from enrich-chunks.mjs classify()
 * @param {string} zone macro-zone from enrich-chunks.mjs zoneOf()
 * @param {number} areaM2
 * @param {number} floors from the height estimate
 * @param {string} id building id — the draw is seeded from it, so a street
 *   spreads across families instead of every bare building picking the same one
 */
export function pickFamily(cls, zone, areaM2, floors, id = "seed") {
  // 1. an explicit OSM type wins, when it names something we can draw
  const byClass = {
    industrial: "industrial_shed",
    commercial: floors >= 8 ? "modern_tower" : "mixed_use",
    institutional: floors >= 5 ? "institutional_campus" : "victorian_institutional",
    religious: "religious",
    infrastructure: "industrial_shed",
    apartments: floors >= 12 ? "modern_tower" : floors >= 7 ? "midrise_concrete" : "mumbai_apartment",
  };
  if (byClass[cls]) return byClass[cls];

  // 2. residential is where the priors do the work
  if (areaM2 > 2600) return "modern_tower";
  if (areaM2 < 55 && floors <= 2) return zone === "western_suburb" ? "bungalow" : "informal_basti";
  if (floors >= 14) return "modern_tower";
  if (floors >= 8) return "midrise_concrete";
  if (floors <= 2 && areaM2 > 700) return "market_shed";

  return weightedFamily(zone, undefined, id);
}

/**
 * Draw from a region's prior.
 *
 * The draw is seeded from the building id, not from the zone — a zone-derived
 * seed makes every building in the zone return the SAME family, which is the
 * opposite of what a prior is for.
 *
 * @param {string} zone
 * @param {number[]|undefined} weights flat [id, w, id, w, ...] — overrides the prior
 * @param {string} id the draw seed
 */
function weightedFamily(zone, weights, id) {
  const table = weights
    ? Object.fromEntries(
        Array.from({ length: weights.length / 2 }, (_, i) => [weights[i * 2], weights[i * 2 + 1]]),
      )
    : REGION_PRIORS[zone] ?? REGION_PRIORS.central;
  const entries = Object.entries(table);
  let total = 0;
  for (const [, w] of entries) total += w;
  const rnd = pseudo(Math.floor(hash01(id + "|" + zone) * 0x7fffffff) + 1);
  let r = rnd() * total;
  for (const [fid, w] of entries) {
    r -= w;
    if (r <= 0) return fid;
  }
  return entries[0][0];
}

/**
 * A tiny deterministic hash -> [0,1). Used wherever a "random-looking but
 * repeatable" choice is needed, on both sides of the pipeline, so the script
 * and the renderer never disagree about which building got which colour.
 *
 * FNV-1a over a string, which is in the integer range every JS engine agrees
 * on (unlike anything using Math.imul on a float, or >>> on a negative).
 */
export function hash01(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h >>> 8) / 0x1000000;
}

/** A stable pseudo-source seeded by a string, for a sequence of choices. */
export function pseudo(seed) {
  let s = Math.max(1, Math.floor(seed) || 1);
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/**
 * The per-building variation that stops a street looking cloned: which tone of
 * the palette, and how far off it is. Deterministic in the building id, so the
 * same building is the same colour every reload and every machine.
 */
export function facadeTone(paletteId, buildingId, salt = "") {
  const pal = PALETTES[paletteId] ?? PALETTES.plaster_warm;
  const r = hash01(buildingId + "|" + salt);
  const i = Math.min(pal.base.length - 1, Math.floor(r * pal.base.length));
  const j = Math.min(pal.trim.length - 1, Math.floor(hash01(buildingId + salt + "|trim") * pal.trim.length));
  const base = pal.base[i];
  const trim = pal.trim[j];
  // +/- 4% is enough to break the clone without looking noisy.
  const k = 0.96 + hash01(buildingId + salt + "|k") * 0.08;
  return { base: tint(base, k), trim: tint(trim, k), accent: pal.accent };
}

/** Multiply a 0xRRGGBB by a scalar, staying in 8-bit channels. */
export function tint(hex, k) {
  const r = Math.min(255, Math.round(((hex >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((hex >> 8) & 255) * k));
  const b = Math.min(255, Math.round((hex & 255) * k));
  return (r << 16) | (g << 8) | b;
}