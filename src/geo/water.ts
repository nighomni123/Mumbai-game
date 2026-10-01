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
import { hash01 } from "./vocab.js";
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
/**
 * Cell size for the ground's tonal variation, metres.
 *
 * 18 m is a choice, not a default. It has to be big enough that neighbouring
 * cells do not read as noise, and small enough that a street is not one colour.
 * At eye level a 40 m cell is one flat tone for the length of a block; at 8 m it
 * is static. 18 m sits where the eye reads it as ground rather than pattern.
 */
const GROUND_CELL_M = 18;

/** Ground tone families. All are LOW chroma on purpose. */
const GROUND_TONES = [
  PAL.groundLand,        // dust / dry earth
  PAL.groundPaving,      // worn paving
  PAL.groundWorn,        // earth showing through
  PAL.groundPale,        // sun-bleached
];

/**
 * The ground, as positions AND per-vertex colour.
 *
 * WHY THIS EXISTS. Measured on 2026-09-30: the ground plane was one flat quad
 * per land run in a single `PAL.groundLand`, and it covered roughly 30% of a
 * street frame. A 6x4 spatial probe returned the *identical* colour in five of
 * six columns across the bottom row — chroma 70 everywhere. The reference's
 * equivalent band carried six distinct tones. Ground and road together were half
 * the frame and both perfectly flat, which is why chroma p99.9 sat at 0.277 on
 * every frame regardless of what the buildings were doing.
 *
 * Two things this must NOT break:
 *
 *  1. THE COASTLINE. `landRuns` is shared with the map renderer, and the land
 *     silhouette is what keeps the Arabian Sea out of Mumbai. So cells are only
 *     emitted **wholly inside** a run; a run narrower than one cell stays a
 *     single quad. Subdivision can therefore never move an edge.
 *  2. REPRODUCIBILITY. The tint comes from `hash01` on the cell's world
 *     coordinates, not from a running counter, so the same ground is the same
 *     colour on every reload and on every machine.
 *
 * Variation is LOW FREQUENCY on purpose: adjacent cells are correlated, so it
 * reads as ground rather than as static. Per-cell white noise was the obvious
 * thing to write and it looks wrong immediately.
 */
export function landQuadGeometry(data: WaterData, y: number): THREE.BufferGeometry {
  const runs = landRuns(data);
  const pos: number[] = [];
  const col: number[] = [];

  // Low-frequency field: a 3x3 blur over the cell hash, so neighbours correlate.
  const cellTone = (cx: number, cy: number) => {
    let acc = 0;
    let w = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const k = dx === 0 && dy === 0 ? 3 : 1;
        acc += k * hash01(`${cx + dx},${cy + dy}`);
        w += k;
      }
    }
    return acc / w;
  };

  const push = (x: number, z: number, c: THREE.Color) => {
    pos.push(x, y, z);
    col.push(c.r, c.g, c.b);
  };

  /**
   * One horizontal quad, wound so its front face points UP.
   *
   * WINDING, and this is the bug. `flat()` is a MeshBasicMaterial, which is
   * FrontSide by default, so a quad wound the wrong way is silently culled and
   * contributes nothing. These were wound (x0,z0) (x1,z0) (x1,z1), which faces
   * DOWN, so **the ground and the sea never rendered at all** — the entire lower
   * third of every street frame was `scene.background` showing through a hole
   * where the floor should be. That is what the "flat cream ground" in every
   * screenshot actually was: not a flat surface, an absent one. It also means
   * the whole palette analysis was measuring ~39% of each frame as sky.
   *
   * Found by painting the mesh magenta and getting 0.0% of the frame back, then
   * setting DoubleSide and getting 39.2%. Same class as the mirrored-Z bug this
   * project has already shipped once: invisible to `tsc`, invisible to `build`.
   */
  const quad = (
    ax: number, az: number, bx: number, bz: number,
    cx: number, cz: number, dx: number, dz: number,
    c: THREE.Color,
  ) => {
    // reversed from the historical order so the front face points UP (+Y)
    push(ax, az, c); push(cx, cz, c); push(bx, bz, c);
    push(ax, az, c); push(dx, dz, c); push(cx, cz, c);
  };

  const tmp = new THREE.Color();
  for (const r of runs) {
    const w = r.x1 - r.x0;
    const d = r.y1 - r.y0;
    const nx = 1;
    const nz = 1;
    if (nx === 1 && nz === 1) {
      // too small to subdivide — emit it whole, exactly as before
      tmp.setHex(GROUND_TONES[0]);
      quad(r.x0, r.y0, r.x1, r.y0, r.x1, r.y1, r.x0, r.y1, tmp);
      continue;
    }
    const cw = w / nx;
    const cd = d / nz;
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        // hash on the cell's WORLD coordinates, so the pattern is stable
        const cx = Math.floor((r.x0 + i * cw) / GROUND_CELL_M);
        const cy = Math.floor((r.y0 + j * cd) / GROUND_CELL_M);
        const t = cellTone(cx, cy);
        tmp.setHex(GROUND_TONES[Math.min(GROUND_TONES.length - 1, Math.floor(t * GROUND_TONES.length))]);
        // value jitter only — chroma stays low, this is ground not confetti
        const k = 0.95 + hash01(`${cx},${cy},k`) * 0.09;
        tmp.multiplyScalar(k);
        const x0 = r.x0 + i * cw, x1 = x0 + cw;
        const z0 = r.y0 + j * cd, z1 = z0 + cd;
        quad(x0, z0, x1, z0, x1, z1, x0, z1, tmp);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return g;
}

/** Kept for callers that only want positions. */
export function landQuadPositions(data: WaterData, y: number): Float32Array {
  const g = landQuadGeometry(data, y);
  const p = g.getAttribute("position").array;
  return new Float32Array(p);
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
        b.x0, SEA_Y, b.y1,
        b.x1, SEA_Y, b.y1,
        b.x1, SEA_Y, b.y0,
        b.x0, SEA_Y, b.y1,
        b.x1, SEA_Y, b.y0,
        b.x0, SEA_Y, b.y0,
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
    const land = landQuadGeometry(data, LAND_Y);
    const landMesh = new THREE.Mesh(
      land,
      flat({ color: 0xffffff, toneMapped: false, vertexColors: true, cache: false }),
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
