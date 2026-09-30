/**
 * Where the water is — which is to say, where the land is not.
 *
 * There was no water anywhere in the world before this: chunks carried only
 * buildings and streets and the only ground was a flat quad per tile, so the
 * Arabian Sea and the harbour rendered as land-coloured ground. Standing at
 * CSMT showed no water to the west.
 *
 * THE MASK IS BUILT FROM BUILDINGS, NOT FROM THE COASTLINE
 *
 * Three attempts, all measured, all in scripts/ingest-water.mjs and
 * scripts/land-mask.mjs:
 *
 *  1. Wide strips on the seaward side of each coastline way. Wrong: a strip
 *     that reaches the horizon also reaches across the metro, so Thane — 23 km
 *     inland — read as sea.
 *  2. A scanline fill of the coastline. Better, and still wrong: of 1,635
 *     scanline rows, 1,470 run out of coastline before reaching the east edge of
 *     the bounds, because the OSM extract simply has no coastline over the
 *     northern and eastern metro. The fallback painted land to the edge and
 *     claimed 4,161 km2 — 76% of the bounds, against a real figure near 1,500.
 *     It rendered as hard horizontal bands across the map.
 *  3. Bounding the fallback. Measured at 60/40/30 km: 2,001 / 637 / 279 km2,
 *     and 26 / 24 / 23 of the 36 ground-truth sites on land. Every one worse.
 *
 * What works is the thing this project already has and trusts most: 260,890
 * real building footprints at real coordinates. A place with buildings in it is
 * land. Dilated 250 m to bridge the gaps between buildings in a block, eroded
 * once so the halo does not push the shore out into the bay. That gives
 * 1,020 km2, all 36 ground-truth sites on land, and the Arabian Sea, Back Bay,
 * the harbour, Thane creek and Panvel Creek all still water — because there are
 * no buildings in them, which is the entire argument.
 *
 * So the renderer draws the complement: a sea quad over the whole bounds, and
 * the land runs on top 5 cm higher. Heights line up with GeoCity.ts:
 * sea 0.00, land 0.05, road 0.08, marking 0.09, kerb 0.15.
 */

import * as THREE from "three";
import { flat } from "../engine/toon.js";
import { PAL } from "../engine/palette.js";
import { METRO_BOUNDS } from "./geo-constants.js";
import { landRuns } from "./citymap-math.js";
import { fetchData } from "./data-path.js";

export const SEA_Y = 0;
export const LAND_Y = 0.05;

/**
 * The land mask, relative to the data root. Built by scripts/land-mask.mjs and
 * shipped in the committed starter slice too — see src/geo/data-path.ts.
 */
export const LAND_MASK_PATH = "landmask.json";

export interface WaterData {
  v: number;
  builtAt: string;
  note: string;
  bounds: { x0: number; x1: number; y0: number; y1: number };
  cellM: number;
  cols: number;
  rows: number;
  reachM: number;
  buildings: number;
  areaKm2: number;
  /** Flat [row, x0, x1, row, x0, x1, ...] land runs, in local metres. */
  land: number[];
}

/** `path` is relative to the data root — see src/geo/data-path.ts. */
export async function loadWater(path: string): Promise<WaterData | null> {
  return fetchData<WaterData>(path);
}

/**
 * The land runs, as triangle positions at height `y`.
 *
 * Built from the SAME `landRuns` decomposition the map renderer uses, rather
 * than from its own index arithmetic over the flat mask. That arithmetic was
 * already written wrong once and produced a plausible-looking surface that was
 * not the land.
 */
export function landQuadPositions(data: WaterData, y: number): Float32Array {
  const runs = landRuns(data);
  const out = new Float32Array(runs.length * 6 * 3);
  let o = 0;
  const push = (x: number, z: number) => {
    out[o++] = x;
    out[o++] = y;
    out[o++] = z;
  };
  for (const r of runs) {
    push(r.x0, r.y0);
    push(r.x1, r.y0);
    push(r.x1, r.y1);
    push(r.x0, r.y0);
    push(r.x1, r.y1);
    push(r.x0, r.y1);
  }
  return out;
}

export function buildWater(data: WaterData): THREE.Group {
  const group = new THREE.Group();
  group.name = "water";

  const b = METRO_BOUNDS;
  const sea = new THREE.BufferGeometry();
  sea.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [
        b.x0,
        SEA_Y,
        b.y0,
        b.x1,
        SEA_Y,
        b.y0,
        b.x1,
        SEA_Y,
        b.y1,
        b.x0,
        SEA_Y,
        b.y0,
        b.x1,
        SEA_Y,
        b.y1,
        b.x0,
        SEA_Y,
        b.y1,
      ],
      3,
    ),
  );
  const seaMesh = new THREE.Mesh(
    sea,
    flat({ color: PAL.sea, toneMapped: false }),
  );
  seaMesh.name = "sea";
  seaMesh.renderOrder = -3;
  group.add(seaMesh);

  if (data.land.length) {
    const land = new THREE.BufferGeometry();
    land.setAttribute(
      "position",
      new THREE.BufferAttribute(landQuadPositions(data, LAND_Y), 3),
    );
    const landMesh = new THREE.Mesh(
      land,
      flat({ color: PAL.groundLand, toneMapped: false }),
    );
    landMesh.name = "land";
    landMesh.renderOrder = -2;
    group.add(landMesh);
  }

  group.updateMatrixWorld(true);
  return group;
}

/** Triangles and draw calls, for the HUD readout. */
export function waterStats(group: THREE.Object3D) {
  let tris = 0;
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh)
      tris +=
        (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3;
  });
  return { tris: Math.round(tris), calls: group.children.length };
}

/**
 * "Is this point in the water?"
 *
 * One binary search over the runs of its row. The HUD asks once a frame, and
 * the walker's readout is the only consumer — this replaced a segment scan
 * that had to guess whether a distant coastline's ribbon reached this point,
 * which is exactly the guess the mask removes.
 */
export class LandMask {
  private rows = new Map<number, number[]>();
  private cell: number;
  private y0: number;
  private x0: number;
  private x1: number;
  private rowsN: number;

  constructor(data: WaterData) {
    this.cell = data.cellM;
    this.y0 = data.bounds.y0;
    this.x0 = data.bounds.x0;
    this.x1 = data.bounds.x1;
    this.rowsN = data.rows;
    for (let i = 0; i < data.land.length; i += 3) {
      const r = data.land[i];
      const list = this.rows.get(r);
      if (list) list.push(data.land[i + 1], data.land[i + 2]);
      else this.rows.set(r, [data.land[i + 1], data.land[i + 2]]);
    }
  }

  get runs(): number {
    return this.rows.size;
  }

  isSea(x: number, z: number): boolean {
    if (x < this.x0 || x > this.x1) return true; // beyond the metro: open ocean
    const r = Math.floor((z - this.y0) / this.cell);
    if (r < 0 || r >= this.rowsN) return true;
    const list = this.rows.get(r);
    if (!list) return true; // no land on this row
    for (let i = 0; i < list.length; i += 2) {
      if (x >= list[i] && x <= list[i + 1]) return false;
    }
    return true;
  }
}
