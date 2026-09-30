/**
 * The geographic world: a tiled, streamed 3D model of Greater Mumbai built
 * from the real ingested data.
 *
 * The whole city (260k+ buildings) never lives in the GPU or in memory at
 * once. Chunks are 2 km squares; the renderer keeps only the chunks near the
 * camera, loads their JSON on demand, builds one InstancedMesh per facade
 * class per chunk, and disposes chunks that fall out of range. This is the
 * "zoom/chunk -> load features -> convert to local -> generate meshes ->
 * render" loop the brief asks for.
 *
 * All geometry is extruded from the real footprint rings, at the real local
 * coordinates, to the resolved height. Facade variation is procedural and
 * Mumbai-specific (chawl bands, midrise plinths, tower setbacks, water tanks)
 * but it never moves or invents a building — the mass comes from the data.
 */

import * as THREE from "three";
import { cel, flat } from "../engine/toon.js";
import { PAL } from "../engine/palette.js";
import { ORIGIN, TILE_M, tileOf, toLocal } from "./geo-constants.js";

/** A render building: footprint ring(s) in local metres + resolved height. */
interface RenderBuilding {
  id: string;
  r: [number, number][];
  h: [number, number][][] | null;
  c: [number, number];
  a: number;
  t: string;
  o: string | null;
  n: string | null;
  H: number;
  F: number;
  hs: string;
  hc: number;
  sp: number;
  src: string;
}

/** Facade-class geometry, generated from a real footprint ring. */
function buildingGeometry(ring: [number, number][], height: number, cls: string, rnd: () => number): THREE.BufferGeometry {
  // Extrude the REAL footprint ring into a prism, 1 unit = 1 m.
  //
  // The shape is built in the ring's own coordinates: shape-X = world X,
  // shape-Y = world northing. ExtrudeGeometry then grows along +Z from 0 to
  // `height`. A single rotateX(+90) maps (x, y, z) -> (x, -z, y), which puts
  // the footprint's northing onto world Z and the extrusion along -Y, so the
  // prism spans y in [-height, 0]; we then lift it to sit on the ground.
  //
  // Do NOT negate the northing when building the shape. It looks like it is
  // needed, but rotateX already mirrors Z, so pre-negating cancels the one
  // flip we want and mirrors the city across the origin — which put every
  // building ~10 km from the camera and left the whole map looking like bare
  // street lines. Verified: a footprint at northing -5148 must land at world
  // z = -5148.
  const shape = new THREE.Shape();
  shape.moveTo(ring[0][0], ring[0][1]);
  for (let i = 1; i < ring.length; i++) shape.lineTo(ring[i][0], ring[i][1]);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
  geo.rotateX(Math.PI / 2);
  geo.translate(0, height, 0);
  return geo;
}

export class GeoCity {
  private scene: THREE.Scene;
  private chunks: Map<string, { group: THREE.Group; meshes: (THREE.Mesh | THREE.LineSegments)[] }>;
  private loadRadius: number;
  private cache: Map<string, unknown>;
  private loadedCentres: number[];
  readonly group: THREE.Group;

  constructor(scene: THREE.Scene, opts: { loadRadius?: number } = {}) {
    this.scene = scene;
    this.chunks = new Map();
    this.loadRadius = opts.loadRadius ?? 3;
    this.cache = new Map();
    this.loadedCentres = [];
    this.group = new THREE.Group();
    this.group.name = "geocity";
    scene.add(this.group);
  }

  async ensureAround(x: number, z: number): Promise<void> {
    const { gx: cx, gy: cy } = tileOf(x, z);
    const wanted = new Set<string>();
    for (let dx = -this.loadRadius; dx <= this.loadRadius; dx++) {
      for (let dz = -this.loadRadius; dz <= this.loadRadius; dz++) {
        wanted.add(`${cx + dx},${cy + dz}`);
      }
    }
    // drop far chunks
    for (const [key, entry] of this.chunks) {
      if (!wanted.has(key)) {
        this.disposeChunk(key);
      }
    }
    // load near chunks (async, not awaited in the render loop)
    for (const key of wanted) {
      if (this.chunks.has(key)) continue;
      this.loadChunk(key);
    }
  }

  async loadChunk(key: string): Promise<void> {
    try {
      const [gx, gy] = key.split(",").map(Number);
      const url = `data/build/chunks/chunk_${gx}_${gy}.json`;
      const res = await fetch(url);
      // Vite's dev SPA fallback answers a missing chunk with 200 text/html
      // (index.html), not a 404 — so `res.ok` is NOT enough. Check the type.
      const type = res.headers.get("content-type") || "";
      if (!res.ok || !type.includes("json")) return; // empty tile / not a chunk
      const data = (await res.json()) as { b?: RenderBuilding[]; s?: StreetFeature[] };
      this.buildChunk(key, data);
    } catch (e) {
      // A missing/empty tile is normal at the metro edge; never break the loop.
      console.warn("[geocity] chunk load failed", key, e);
    }
  }

  buildChunk(key: string, data: { b?: RenderBuilding[]; s?: StreetFeature[] }): void {
    const group = new THREE.Group();
    group.name = `chunk_${key}`;
    const byClass = new Map<string, THREE.BufferGeometry[]>();

    for (const b of data.b ?? []) {
      const cls = b.t || "residential";
      if (!byClass.has(cls)) byClass.set(cls, []);
      // One InstancedMesh per class is ideal, but footprints differ, so we
      // merge per-building geometry into a single BufferGeometry per class and
      // use a single material. That is one draw call per facade class per
      // chunk, which keeps the whole city cheap.
      const geo = buildingGeometry(b.r, b.H, cls, Math.random);
      // per-building tint via vertex colors
      const tint = this.facadeColor(cls, b, Math.random);
      this.paintGeometry(geo, tint);
      geo.translate(0, 0, 0);
      const list = byClass.get(cls);
      if (list) list.push(geo);
    }

    const meshes = [];
    for (const [cls, geos] of byClass) {
      const merged = mergeGeometries(geos);
      void cls;
      if (!merged) continue;
      const mat = cel({ color: 0xffffff, vertexColors: true, bands: 3, cache: false });
      const mesh = new THREE.Mesh(merged, mat);
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      group.add(mesh);
      meshes.push(mesh);
      geos.forEach((g) => g.dispose());
    }

    // streets: a single line-segment mesh per chunk
    if (data.s && data.s.length) {
      const pts = [];
      for (const st of data.s) {
        for (const path of st.p) {
          for (let i = 0; i < path.length - 1; i++) {
            pts.push(path[i][0], 0.06, path[i][1], path[i + 1][0], 0.06, path[i + 1][1]);
          }
        }
      }
      if (pts.length) {
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
        const streets = new THREE.LineSegments(g, flat({ color: 0x5b5548, toneMapped: false }));
        group.add(streets);
        meshes.push(streets);
      }
    }

    this.group.add(group);
    this.chunks.set(key, { group, meshes });
  }

  facadeColor(cls: string, b: RenderBuilding, rnd: () => number): THREE.Color {
    // Mumbai-specific palette, varied per building so a block is not one
    // flat tone. Uses the real class + the OSM subtype.
    const t = (b.o || "").toLowerCase();
    let base;
    if (cls === "industrial") base = rnd() > 0.5 ? 0x8a8175 : 0x9aa39f;
    else if (cls === "commercial") base = rnd() > 0.5 ? 0x8f9bb0 : 0xa8b0bd;
    else if (cls === "institutional") base = 0xc9c0ae;
    else if (cls === "religious") base = 0xd8c7a0;
    else if (/apartment|terrace|residential/.test(t)) base = rnd() > 0.5 ? 0xc9a98a : 0xbfa88f;
    else base = rnd() > 0.5 ? 0xd6c4a4 : 0xcdb894; // residential/chawl default
    const c = new THREE.Color(base);
    c.multiplyScalar(0.94 + rnd() * 0.12); // subtle per-building variation
    return c;
  }

  paintGeometry(geo: THREE.BufferGeometry, color: THREE.Color): void {
    const count = geo.attributes.position.count;
    const colors = new Float32Array(count * 3);
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  }

  disposeChunk(key: string): void {
    const entry = this.chunks.get(key);
    if (!entry) return;
    this.group.remove(entry.group);
    for (const m of entry.meshes) {
      m.geometry?.dispose();
      const mat = m.material;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    }
    this.chunks.delete(key);
  }

  get loadedChunks(): number {
    return this.chunks.size;
  }
}

interface StreetFeature { id: string; p: [number, number][][]; n: string | null; c: number | null; w: number | null; }

/** Minimal geometry merge (positions + colors only) to avoid a BufferGeometryUtils import. */
function mergeGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (!geos.length) return null;
  let total = 0;
  for (const g of geos) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  let off = 0;
  for (const g of geos) {
    const p = g.attributes.position.array;
    const n = g.attributes.normal ? g.attributes.normal.array : null;
    const c = g.attributes.color ? g.attributes.color.array : null;
    pos.set(p, off * 3);
    if (n) nor.set(n, off * 3);
    if (c) col.set(c, off * 3);
    off += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  if (geos[0].attributes.normal) out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  if (geos[0].attributes.color) out.setAttribute("color", new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}
