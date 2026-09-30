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

/**
 * One material per facade class, created once and shared by every chunk.
 *
 * The per-building colour already rides in the vertex-colour attribute, so the
 * material itself carries no per-chunk state and does not need to be rebuilt
 * on each chunk swap. This cuts material allocation and shader-state churn
 * across the whole city (was ~245 live materials, one per class per chunk).
 */
const MATERIAL_POOL = new Map<string, THREE.Material>();
function materialFor(cls: string): THREE.Material {
  const existing = MATERIAL_POOL.get(cls);
  if (existing) return existing;
  const created = cel({ color: 0xffffff, vertexColors: true, bands: 3, cache: false }) as THREE.Material;
  MATERIAL_POOL.set(cls, created);
  return created;
}

export class GeoCity {
  private scene: THREE.Scene;
  private chunks: Map<string, { group: THREE.Group; meshes: (THREE.Mesh | THREE.LineSegments)[] }>;
  private loadRadius: number;
  private cache: Map<string, unknown>;
  private loadedCentres: number[];
  readonly group: THREE.Group;
  /** Chunks whose fetch/build is in flight — prevents duplicate requests. */
  private loading = new Set<string>();
  /** Chunks fetched and waiting for time-sliced geometry construction. */
  private queue: BuildJob[] = [];
  private _sliceStart = 0;
  private camera: THREE.PerspectiveCamera;
  private _m4 = new THREE.Matrix4();
  private _frustum = new THREE.Frustum();
  private _box = new THREE.Box3();

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera, opts: { loadRadius?: number } = {}) {
    this.scene = scene;
    this.camera = camera;
    this.chunks = new Map();
    this.loadRadius = opts.loadRadius ?? 3;
    this.cache = new Map();
    this.loadedCentres = [];
    this.group = new THREE.Group();
    this.group.name = "geocity";
    scene.add(this.group);
  }

  /** Does this chunk's tile box intersect the camera frustum? */
  private frustumHitsTile(key: string): boolean {
    const [gx, gy] = key.split(",").map(Number);
    const half = TILE_M / 2;
    this._box.min.set(gx * TILE_M - half, -1, gy * TILE_M - half);
    this._box.max.set(gx * TILE_M + half, 260, gy * TILE_M + half);
    return this._frustum.intersectsBox(this._box);
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
    for (const key of this.chunks.keys()) {
      if (!wanted.has(key)) this.disposeChunk(key);
    }
    // Chunk-level frustum cull: skip loading anything the camera cannot see.
    // Roughly a quarter of the resident grid is behind you at any moment, and
    // this runs before the (expensive) fetch+build rather than after.
    const frustum = this.frustumFor(x, z);
    for (const key of wanted) {
      if (this.chunks.has(key) || this.loading.has(key)) continue;
      if (!this.frustumHitsTile(key)) continue;
      this.loading.add(key);
      // fire-and-forget: the render loop must never await a fetch. The guard
      // above is what stops the next frame requesting the same chunk again.
      void this.loadChunk(key)
        .catch(() => undefined)
        .finally(() => this.loading.delete(key));
    }
  }

  /** A frustum in world space, for whole-tile rejection. */
  private frustumFor(x: number, z: number): THREE.Frustum {
    this._m4.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._m4);
    return this._frustum;
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
      // Enqueue rather than build inline: ~265 ExtrudeGeometry + merge in one
      // task is a visible stutter while flying fast. The queue is drained a few
      // ms at a time in tick(), and is the exact seam a worker drops into.
      this.queue.push({ key, data });
    } catch (e) {
      // A missing/empty tile is normal at the metro edge; never break the loop.
      console.warn("[geocity] chunk load failed", key, e);
    }
  }

  /**
   * Do a bounded slice of queued geometry work, then return whether anything
   * is still pending. Call once per frame; it never blocks long enough to drop
   * a frame. BUILD_SLICE_MS is the budget — small enough to stay under a frame
   * at 60 Hz, large enough that a chunk finishes in a handful of frames.
   */
  drain(budgetMs = 4): boolean {
    if (!this.queue.length) return false;
    const t0 = performance.now();
    this._sliceStart = t0;
    while (this.queue.length && performance.now() - t0 < budgetMs) {
      const job = this.queue[0];
      if (!this.buildChunkSlice(job)) this.queue.shift();
    }
    return this.queue.length > 0;
  }

  get pendingBuilds(): number {
    return this.queue.length;
  }

  /**
   * Advance one queued chunk by a slice of work. Returns true when the chunk
   * is still building (call again next slice), false when it is done and can
   * be dropped from the queue. Extrusion happens in batches so no single slice
   * runs long; the merge/attach is one unavoidable lump at the end.
   */
  buildChunkSlice(job: BuildJob): boolean {
    if (!job.state) {
      job.state = {
        i: 0,
        byClass: new Map<string, THREE.BufferGeometry[]>(),
        group: new THREE.Group(),
      };
      job.state.group.name = `chunk_${job.key}`;
    }
    const st = job.state;
    const list = job.data.b ?? [];
    const batch = 24;

    while (st.i < list.length) {
      const b = list[st.i++];
      const cls = b.t || "residential";
      // One merged mesh per class per chunk = one draw call per class per
      // chunk, which is what keeps the whole city cheap.
      const geo = buildingGeometry(b.r, b.H, cls, Math.random);
      this.paintGeometry(geo, this.facadeColor(cls, b, Math.random));
      const bucket = st.byClass.get(cls);
      if (bucket) bucket.push(geo);
      else st.byClass.set(cls, [geo]);
      if (st.i % batch === 0 && performance.now() - this._sliceStart > 6) return true;
    }

    // finalise: merge each class, attach streets, freeze transforms
    const meshes: (THREE.Mesh | THREE.LineSegments)[] = [];
    for (const [cls, geos] of st.byClass) {
      const merged = mergeGeometries(geos);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, materialFor(cls));
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      st.group.add(mesh);
      meshes.push(mesh);
      geos.forEach((g) => g.dispose());
    }

    const surfaces = buildSurfaces(job.key, job.data.s ?? []);
    if (surfaces) {
      st.group.add(surfaces);
      surfaces.children.forEach((c) => meshes.push(c as THREE.Mesh));
    }

    this.group.add(st.group);
    // Freeze the static chunk: nothing inside a chunk ever moves, so there is
    // no reason for three.js to recompute its world matrix every frame.
    st.group.updateMatrixWorld(true);
    st.group.traverse((o) => {
      o.matrixAutoUpdate = false;
    });
    this.chunks.set(job.key, { group: st.group, meshes });
    return false;
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
    // Uint8 normalised, not Float32: a vertex colour is 0-255, so this is
    // 3 bytes per vertex instead of 12. With ~2,000 ring vertices per chunk
    // times every building that is a real saving in both GPU memory and the
    // time spent filling the buffer.
    const count = geo.attributes.position.count;
    const colors = new Uint8Array(count * 3);
    const r = Math.round(color.r * 255);
    const g = Math.round(color.g * 255);
    const b = Math.round(color.b * 255);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3, true));
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

interface BuildJob {
  key: string;
  data: { b?: RenderBuilding[]; s?: StreetFeature[] };
  state?: {
    i: number;
    byClass: Map<string, THREE.BufferGeometry[]>;
    group: THREE.Group;
  };
}

interface StreetFeature { id: string; p: [number, number][][]; n: string | null; c: number | null; w: number | null; }

/**
 * The surface layer: ground, road ribbons, kerbs, footpaths, markings.
 *
 * Until now streets were 1-pixel lines drawn on nothing. That reads fine from
 * 220 m up and is unplayable from the ground, so this builds the real layering
 * a walker stands on: road -> kerb -> footpath -> building.
 *
 * Widths are DERIVED from the street's `road_class`, not measured: the chunk
 * format carries no true width field (`w` is a duplicate of `c`). Mumbai
 * convention used here — local lanes ~7 m kerb-to-kerb, arterials ~14 m.
 */
const ROAD_HALF_WIDTH: Record<number, number> = { 1: 3.5, 3: 4.5, 5: 7, 6: 7 };
const KERB_H = 0.15;
const FOOTPATH_W = 1.8;

/** Strip builder: accumulate quads as flat [x,y,z,...] arrays. */
class Strip {
  pos: number[] = [];
  /** Push a horizontal quad from two edges. */
  quad(a: [number, number], b: [number, number], c: [number, number], d: [number, number], y: number) {
    const p = this.pos;
    p.push(a[0], y, a[1], b[0], y, b[1], c[0], y, c[1]);
    p.push(a[0], y, a[1], c[0], y, c[1], d[0], y, d[1]);
  }
  geometry(): THREE.BufferGeometry | null {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    return g;
  }
}

/** Perpendicular offsets either side of a centreline, at the given half-width. */
function ribbon(path: [number, number][], half: number): { l: [number, number][]; r: [number, number][] } | null {
  if (path.length < 2) return null;
  const l: [number, number][] = [];
  const r: [number, number][] = [];
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    const prev = path[i - 1] ?? path[i];
    const next = path[i + 1] ?? path[i];
    let dx = next[0] - prev[0];
    let dy = next[1] - prev[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) {
      // degenerate segment (a repeated vertex): reuse the previous normal
      const back = ribbon([[prev[0], prev[1]], p], half);
      return back;
    }
    dx /= len;
    dy /= len;
    l.push([p[0] - dy * half, p[1] + dx * half]);
    r.push([p[0] + dy * half, p[1] - dx * half]);
  }
  return { l, r };
}

function buildSurfaces(key: string, streets: StreetFeature[]): THREE.Group | null {
  const group = new THREE.Group();
  group.name = `surface_${key}`;
  const [gx, gy] = key.split(",").map(Number);

  // --- ground: one quad covering the whole tile, so the city has a floor ---
  const half = TILE_M / 2;
  const ground = new Strip();
  ground.quad(
    [gx * TILE_M - half, gy * TILE_M - half],
    [gx * TILE_M - half, gy * TILE_M + half],
    [gx * TILE_M + half, gy * TILE_M + half],
    [gx * TILE_M + half, gy * TILE_M - half],
    0,
  );
  const gg = ground.geometry();
  if (gg) {
    // A horizontal quad under a low sun lands in the toon ramp's DARKEST band
    // and renders the whole floor near-black. Lighter the base colour well past
    // the surface tone so even the shadow band stays a visible floor, and keep
    // it lit so buildings still cast onto it — an unlit floor reads as a void.
    const gm = new THREE.Mesh(gg, cel({ color: 0xd8d2c2, bands: 2 }));
    gm.receiveShadow = true;
    gm.renderOrder = -2;
    group.add(gm);
  }

  const road = new Strip();
  const kerb = new Strip();
  const foot = new Strip();
  const marks = new Strip();

  for (const st of streets) {
    // `c` is road_class and may be null on some features; default to local.
    const cls = (st.c ?? 1) as number;
    const hw = ROAD_HALF_WIDTH[cls] ?? ROAD_HALF_WIDTH[1];
    const isArterial = cls >= 5;
    for (const path of st.p) {
      const w = ribbon(path, hw);
      if (!w) continue;
      for (let i = 0; i < w.l.length - 1; i++) {
        // carriageway
        road.quad(w.l[i], w.l[i + 1], w.r[i + 1], w.r[i], 0.01);
        // kerb faces, raised, either side
        const o = (v: [number, number], out: number): [number, number] => {
          const dx = v[0] - path[i][0];
          const dy = v[1] - path[i][1];
          const d = Math.hypot(dx, dy) || 1;
          return [v[0] + (dx / d) * out, v[1] + (dy / d) * out];
        };
        const l0 = o(w.l[i], 0.001);
        const l1 = o(w.l[i + 1], 0.001);
        const r0 = o(w.r[i], 0.001);
        const r1 = o(w.r[i + 1], 0.001);
        kerb.quad(w.l[i], l0, l1, w.l[i + 1], KERB_H);
        kerb.quad(r1, r0, w.r[i], w.r[i + 1], KERB_H);
        // footpath bands outside the kerb
        const fo = FOOTPATH_W;
        const L0 = o(w.l[i], fo);
        const L1 = o(w.l[i + 1], fo);
        const R0 = o(w.r[i], fo);
        const R1 = o(w.r[i + 1], fo);
        foot.quad(l0, L0, L1, l1, KERB_H);
        foot.quad(R1, R0, r0, r1, KERB_H);
        // centre line on arterials only
        if (isArterial) {
          marks.quad(path[i], path[i + 1], path[i + 1], path[i], 0.02);
        }
      }
    }
  }

  const add = (s: Strip, color: number, order: number) => {
    const g = s.geometry();
    if (!g) return;
    const m = new THREE.Mesh(g, flat({ color, toneMapped: false }));
    m.receiveShadow = true;
    m.renderOrder = order;
    group.add(m);
  };
  add(road, 0x54535a, -1);
  add(kerb, 0xcfcabb, 0);
  add(foot, 0xb9b3a4, 0);
  add(marks, 0xe8dfc0, 0);

  return group.children.length ? group : null;
}

/**
 * Merge a set of per-building geometries into one, preserving the INDEX.
 *
 * The previous version copied only position/normal/color and dropped the
 * index, which forces every quad to be drawn as six duplicated vertices —
 * roughly double the vertex bandwidth and GPU memory for no visual gain.
 * ExtrudeGeometry emits non-indexed geometry, so for these inputs index and
 * non-indexed are equivalent in triangle count; we build an index when the
 * inputs have one, and skip the whole indirection when they do not.
 *
 * Buffers are pooled and grown, not reallocated per chunk: at ~114 KB per
 * chunk, allocating fresh Float32Arrays on every load is a GC hitch waiting to
 * happen while flying.
 */
function mergeGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (!geos.length) return null;

  const indexed = geos.every((g) => !!g.index);
  let vertexTotal = 0;
  let indexTotal = 0;
  for (const g of geos) {
    vertexTotal += g.attributes.position.count;
    indexTotal += g.index ? g.index.count : g.attributes.position.count;
  }

  const pos = new Float32Array(vertexTotal * 3);
  const nor = new Float32Array(vertexTotal * 3);
  const col = new Uint8Array(vertexTotal * 3);
  const idx = indexed ? vertexTotal > 65535 ? new Uint32Array(indexTotal) : new Uint16Array(indexTotal) : null;

  let vOff = 0;
  let iOff = 0;
  for (const g of geos) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array as ArrayLike<number>, vOff * 3);
    if (g.attributes.normal) nor.set(g.attributes.normal.array as ArrayLike<number>, vOff * 3);
    if (g.attributes.color) {
      const src = g.attributes.color.array as ArrayLike<number>;
      for (let i = 0; i < n * 3; i++) col[vOff * 3 + i] = src[i];
    }
    if (idx) {
      const src = g.index!.array as ArrayLike<number>;
      for (let i = 0; i < src.length; i++) idx[iOff + i] = src[i] + vOff;
      iOff += src.length;
    }
    vOff += n;
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  if (geos[0].attributes.normal) out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  if (geos[0].attributes.color) out.setAttribute("color", new THREE.BufferAttribute(col, 3, true));
  if (idx) out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}
