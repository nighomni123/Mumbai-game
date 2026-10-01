/**
 * Types for src/geo/vocab.js.
 *
 * The vocabulary itself is plain JS, because the enrichment script (Node) and
 * the renderer (TypeScript) both have to read it and there must only ever be
 * one definition — same reason as citymap-math.js. TypeScript cannot add an
 * index signature to a type it inferred from JS, so the vocabularies are
 * re-stated here as `Record<string, T>`. This file declares SHAPES ONLY and
 * contains no values: if it ever grows a number in it, the two have drifted.
 */

export interface Palette {
  base: number[];
  trim: number[];
  accent: number;
}

export interface Family {
  /** expected storey band — a sanity check on the assignment, never an override */
  floors: [number, number];
  /** floor-to-floor height, metres */
  ftf: number;
  window: string;
  balcony: string;
  roof: string;
  /** plinth height, metres */
  plinth: number;
  /** allowed palette ids */
  palettes: string[];
  /** probability the ground floor is a shopfront */
  groundShop: number;
  awning: number;
  signage?: number;
  /** horizontal banding / string courses (Art Deco) */
  banding?: number;
  /** a crown or setback mass above the main volume */
  crown?: number;
  /** a dome */
  dome?: number;
  /** a colonnade at the ground floor */
  colonnade?: number;
  /** a timber verandah gallery */
  timber?: number;
  /** patchwork material */
  patched?: number;
  /** a garden / compound wall */
  garden?: number;
  /** an entrance canopy */
  canopy?: number;
}

export interface WindowSpec {
  /** chance a given bay is filled */
  rhythm: number;
  /** reveal depth, metres */
  inset: number;
  w: number;
  h: number;
  shade: number;
}

export interface BalconySpec {
  prob: number;
  depth: number;
  style: string;
}

export interface RoofSpec {
  pitch: number;
  /** 0..1, how much roof clutter this roof type carries */
  clutter: number;
  parapet: number;
}

export const PALETTES: Record<string, Palette>;
export const TRIM: {
  parapet: number;
  waterTank: number;
  waterTankBlue: number;
  tarpaulin: number;
  dish: number;
  laundry: number;
  balconyRail: number;
};
export const WINDOWS: Record<string, WindowSpec>;
export const BALCONIES: Record<string, BalconySpec>;
export const ROOFS: Record<string, RoofSpec>;
export const FAMILIES: Record<string, Family>;
export const FAMILY_IDS: string[];
export const PALETTE_IDS: string[];
export const WINDOW_IDS: string[];
export const BALCONY_IDS: string[];
export const ROOF_IDS: string[];
export const REGION_PRIORS: Record<string, Record<string, number>>;
export const TIER: { GENERIC: 0; SILHOUETTE: 1; NAMED: 2; HERO: 3 };
export const PALETTE_VERSION: string;
export const isV2: boolean;
export function palettePool(family: string): string[];

export function pickFamily(
  cls: string,
  zone: string,
  areaM2: number,
  floors: number,
  id?: string,
): string;
export function hash01(str: string): number;
export function pseudo(seed: number): () => number;
export function facadeTone(
  paletteId: string,
  buildingId: string,
  salt?: string,
): { base: number; trim: number; accent: number };
export function tint(hex: number, k: number): number;