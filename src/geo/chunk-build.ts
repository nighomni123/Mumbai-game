/**
 * The chunk geometry hot path.
 *
 * Everything in here runs once per building per chunk load, on the main
 * thread, inside the frame. It is deliberately a separate module with no DOM,
 * no three.js scene and no renderer state so it can be measured in isolation
 * (`bun scripts/bench-chunk.ts`) and, later, dropped verbatim into a worker
 * without the renderer having to change shape.
 */

import * as THREE from "three";
import { Facet, buildBuilding, mass } from "./buildings.js";
import type { BuildingIn, Profile } from "./buildings.js";
import { hash01, tint } from "./vocab.js";

/** The flat tone an unenriched building gets, by facade class. */
const LEGACY_TONE: Record<string, number> = {
  industrial: 0x8a8175,
  commercial: 0x8f9bb0,
  institutional: 0xc9c0ae,
  religious: 0xd8c7a0,
  apartments: 0xbfa88f,
  residential: 0xd0be9c,
};

/** What the hot path needs from a chunk's building record. */
export type ChunkBuilding = BuildingIn & { t?: string; e?: Profile };

/** Turn a Facet's parallel arrays into one geometry. */
export function facetGeometry(f: Facet): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(f.pos, 3));
  geo.setAttribute(
    "color",
    new THREE.BufferAttribute(Uint8Array.from(f.col), 3, true),
  );
  geo.computeVertexNormals();
  return geo;
}

/**
 * The unenriched fallback colour.
 *
 * Deterministic in the building id — it used to take a Math.random() callback,
 * which meant the same building was a different colour on every reload and
 * nothing visual was reproducible.
 */
function facadeColor(cls: string, b: ChunkBuilding): number {
  const k = 0.96 + hash01(b.id + "|tone") * 0.08;
  return tint(LEGACY_TONE[cls] ?? 0xd0be9c, k);
}

/**
 * Emit ONE building into the shared arena.
 *
 * Both paths — the enriched procedural grammar and the unenriched fallback —
 * write into the same `Facet`, because `buildBuilding` works in absolute
 * chunk-local coordinates: there is no per-building transform to undo, so
 * every building in a chunk can simply append. That is the whole trick.
 */
export function emitBuilding(b: ChunkBuilding, out: Facet): void {
  if (b.e) {
    buildBuilding(b, b.e, out);
  } else {
    // Not enriched yet: the plain prism, from the real footprint ring. A chunk
    // with no `e` fields must keep working, because enrichment is progressive.
    mass(b.r, b.H, facadeColor(b.t || "residential", b), out);
  }
}

/**
 * Build every building in a chunk into ONE geometry.
 *
 * One `Facet`, one `BufferGeometry`, one pass. Nothing is allocated per
 * building, nothing is merged afterwards and nothing is disposed afterwards.
 *
 * The renderer does NOT use this: it time-slices, so it drives `emitBuilding`
 * into an arena it keeps across frames. This is the whole-chunk equivalent,
 * which is what a benchmark and any worker want.
 */
export function chunkBuildingGeometry(
  list: ChunkBuilding[],
): THREE.BufferGeometry | null {
  const out = new Facet();
  for (let i = 0; i < list.length; i++) emitBuilding(list[i], out);
  if (out.empty) return null;
  return facetGeometry(out);
}