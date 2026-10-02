/**
 * The geographic world: a tiled, streamed 3D model of Greater Mumbai built
 * from the real ingested data.
 *
 * The whole city (260k+ buildings) never lives in the GPU or in memory at
 * once. Chunks are 2 km squares; the renderer keeps only the chunks near the
 * camera, loads their JSON on demand, builds ONE mesh per chunk, and disposes
 * chunks that fall out of range.
 *
 * That one mesh per chunk is built by appending every building into a single
 * shared buffer (src/geo/chunk-build.ts). It used to be one BufferGeometry
 * per building, merged afterwards — a per-building allocation and a full
 * extra copy of every vertex, for a result that was always merged anyway.
 * Measured 3.5x faster to build and pixel-identical; see
 * docs/chunk-build-arena.md.
 *
 * All geometry is extruded from the real footprint rings, at the real local
 * coordinates, to the resolved height. Facade variation is procedural and
 * Mumbai-specific (chawl bands, midrise plinths, tower setbacks, water tanks)
 * but it never moves or invents a building — the mass comes from the data.
 */

import * as THREE from "three";
import { cel, flat } from "../engine/toon.js";
import { TILE_M, tileOf, tileInActive } from "./geo-constants.js";
import { Facet } from "./buildings.js";
import {
  FOOTPATH_W,
  KERB_H,
  NearGrid,
  ROAD_HALF_WIDTH,
  indexRings,
  reachToBoundary,
  ribbon,
  roadCorridor,
  pushRingOutOfCorridor,
  smoothPath,
} from "./roadways.js";
import type { Profile } from "./buildings.js";
import { emitBuilding, facetGeometry } from "./chunk-build.js";
import { dressStreet, blockPlanting } from "./street.js";
import { hash01 } from "./vocab.js";
import { PAL } from "../engine/palette.js";
import { fetchData } from "./data-path.js";

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
  /** visual profile, present once scripts/enrich-families.mjs has run */
  e?: Profile;
  /** ring edge indices fronting a street */
  fx?: number[];
}

/** What a chunk file parses to. */
interface ChunkData {
  b?: RenderBuilding[];
  s?: StreetFeature[];
}

/** Where chunks come from, in order. See src/geo/data-path.ts. */
async function fetchChunk(name: string): Promise<ChunkData | null> {
  return fetchData<ChunkData>(`chunks/chunk_${name}.json`);
}

/**
 * One material shared by every chunk.
 *
 * The per-building colour already rides in the vertex-colour attribute, so the
 * material itself carries no per-chunk state and does not need to be rebuilt
 * on each chunk swap. This cuts material allocation and shader-state churn
 * across the whole city (was ~245 live materials, one per class per chunk).
 */
let SHARED_MATERIAL: THREE.Material | null = null;
function materialFor(): THREE.Material {
  if (SHARED_MATERIAL) return SHARED_MATERIAL;
  SHARED_MATERIAL = cel({
    color: 0xffffff,
    vertexColors: true,
    bands: 3,
    cache: false,
  }) as THREE.Material;
  return SHARED_MATERIAL;
}

/**
 * Asphalt tone families for the carriageway.
 *
 * Same reason as the ground: measured 2026-09-30, the road was one flat colour
 * covering ~21% of a street frame and returned the identical tone in five of six
 * sampled columns. These give the patch-and-damp variation real asphalt has
 * without ever going bright — the road should never compete with the buildings.
 */
const ROAD_TONES = [PAL.road, PAL.roadLight, PAL.roadPatch, PAL.roadDamp];

const ROAD_TMP = new THREE.Color();

/** Tinted road quad, hashed off the quad's own position so it is stable. */
function roadQuad(
  road: Strip,
  a: [number, number], b: [number, number],
  c: [number, number], d: [number, number],
  y: number,
) {
  const mx = Math.round((a[0] + c[0]) / 2);
  const my = Math.round((a[1] + c[1]) / 2);
  const h = hash01(`${mx},${my}`);
  // one dominant patch family, plus a damp band that reads as recent rain
  const t = Math.min(ROAD_TONES.length - 1, Math.floor(h * ROAD_TONES.length));
  ROAD_TMP.setHex(ROAD_TONES[t]);
  ROAD_TMP.multiplyScalar(0.96 + hash01(`${mx},${my},k`) * 0.08);
  road.quad(a, b, c, d, y, ROAD_TMP);
}

/** Hard ceiling on how far geometry is ever drawn, whatever the altitude. */
export const MAX_RENDER_DISTANCE = 9000;

/**
 * The floor, and the reason the HUD render-distance slider is honest.
 *
 * This used to be 1200 m, which is a reasonable floor but a broken slider
 * minimum: 1200 / WALK_DISTANCE is 0.46, so every setting below 0.46x was a
 * dead zone that read as "the slider does nothing" while changing nothing at
 * all. Kept low enough that the bottom of the control is live — one block, the
 * street, the skyline — which is the point on a machine that cannot hold frame
 * rate at full distance.
 */
export const MIN_RENDER_DISTANCE = 350;

export class GeoCity {
  private scene: THREE.Scene;
  private chunks: Map<string, ChunkEntry>;
  private loadRadius: number;
  private cache: Map<string, unknown>;
  private loadedCentres: number[];
  readonly group: THREE.Group;
  /** Chunks whose fetch is in flight — prevents duplicate requests. */
  private loading = new Set<string>();
  /**
   * Chunks fetched and WAITING to be built.
   *
   * This set is the difference between 11 fps and 60. `ensureAround` runs every
   * frame and a chunk is not in `this.chunks` until its geometry is built, which
   * takes ~13 ms. Without this set, every queued-but-unbuilt chunk was
   * re-fetched and re-queued on every single frame: measured 440 queue entries
   * and 386 MB of heap at Andheri, with 8 chunks actually resident.
   */
  private queued = new Set<string>();
  /** Chunks fetched and waiting for time-sliced geometry construction. */
  private queue: BuildJob[] = [];
  private _sliceStart = 0;
  private camera: THREE.PerspectiveCamera;
  private _m4 = new THREE.Matrix4();
  private _frustum = new THREE.Frustum();
  private _box = new THREE.Box3();
  private _near = new THREE.Vector3();
  private maxDistance: number;

  constructor(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    opts: { loadRadius?: number; maxDistance?: number } = {},
  ) {
    this.scene = scene;
    this.camera = camera;
    this.chunks = new Map();
    this.loadRadius = opts.loadRadius ?? 3;
    this.maxDistance = opts.maxDistance ?? 6000;
    this.cache = new Map();
    this.loadedCentres = [];
    this.group = new THREE.Group();
    this.group.name = "geocity";
    scene.add(this.group);
  }

  /**
   * Is this chunk worth having at all: inside the frustum AND inside the
   * distance budget?
   *
   * The frustum alone is not a render distance. Standing still on a footpath,
   * the frustum reaches 9 km — past the far plane of useful detail — and every
   * chunk inside it gets fetched, built and merged. The distance cap is what
   * makes the number of resident chunks a function of how much you can actually
   * see, and it is applied here, before the fetch, not after the geometry
   * already exists.
   */
  private frustumHitsTile(key: string): boolean {
    const [gx, gy] = key.split(",").map(Number);
    const half = TILE_M / 2;
    this._box.min.set(gx * TILE_M - half, -1, gy * TILE_M - half);
    this._box.max.set(gx * TILE_M + half, 260, gy * TILE_M + half);
    // Distance to the NEAREST point of the tile, not its centre, so a tile you
    // are standing on the edge of is not culled by its far corner.
    this._near.copy(this._box.min);
    this._box.clampPoint(this.camera.position, this._near);
    if (this.camera.position.distanceTo(this._near) > this.maxDistance)
      return false;
    this._m4.multiplyMatrices(
      this.camera.projectionMatrix,
      this.camera.matrixWorldInverse,
    );
    this._frustum.setFromProjectionMatrix(this._m4);
    return this._frustum.intersectsBox(this._box);
  }

  /**
   * Move the render distance. The caller sets this from the camera's altitude,
   * so standing on a footpath keeps the city tight and climbing opens it out —
   * without the player ever seeing a number or a setting.
   */
  setMaxDistance(metres: number): void {
    const clamped = Math.max(
      MIN_RENDER_DISTANCE,
      Math.min(MAX_RENDER_DISTANCE, metres),
    );
    if (clamped === this.maxDistance) return;
    this.maxDistance = clamped;
    // Keep the ring just wide enough to cover the budget, and never wider: a
    // radius of 4 costs 81 tiles for the sake of a few at the edge.
    this.loadRadius = Math.max(1, Math.min(3, Math.ceil(clamped / TILE_M) + 1));
  }

  get renderDistance(): number {
    return this.maxDistance;
  }

  /**
   * Only chunks within this distance cast shadows.
   *
   * Beyond it a 2048 shadow map cannot resolve a 20 m building anyway, so
   * casting them is a second full geometry pass for nothing. Recomputed when
   * the distance changes rather than per frame per chunk — the resident set is
   * small and the change is rare.
   */
  setShadowDistance(metres: number): void {
    if (metres === this.shadowDistance) return;
    this.shadowDistance = metres;
    for (const chunk of this.chunks.values()) {
      chunk.group.getWorldPosition(this._near);
      const casts = this._near.distanceTo(this.camera.position) <= metres;
      for (const m of chunk.meshes) m.castShadow = casts;
    }
  }

  private shadowDistance = -1;

  async ensureAround(x: number, z: number): Promise<void> {
    // The frustum is recomputed inside frustumHitsTile for each candidate; the
    // camera matrices are already current because render() ran last frame.
    const { gx: cx, gy: cy } = tileOf(x, z);
    const wanted = new Set<string>();
    for (let dx = -this.loadRadius; dx <= this.loadRadius; dx++) {
      for (let dz = -this.loadRadius; dz <= this.loadRadius; dz++) {
        // The eastern mainland, the far north and the Konkan hills are not
        // being built yet (ACTIVE_BOUNDS). Skipping them here means they are
        // never fetched, never built and never resident — the cheapest possible
        // way to not have them, and it shrinks the ring that does exist.
        if (!tileInActive(cx + dx, cy + dz)) continue;
        wanted.add(`${cx + dx},${cy + dz}`);
      }
    }
    // Drop what is out of range, and drop what is still QUEUED but no longer
    // wanted — otherwise flying forward leaves a tail of chunks that will be
    // built, thrown away, and never seen.
    for (const key of this.chunks.keys()) {
      if (!wanted.has(key)) this.disposeChunk(key);
    }
    if (this.queue.length) {
      this.queue = this.queue.filter((j) => {
        if (wanted.has(j.key)) return true;
        this.queued.delete(j.key);
        return false;
      });
    }
    // Chunk-level frustum cull: skip loading anything the camera cannot see.
    // Roughly a quarter of the resident grid is behind you at any moment, and
    // this runs before the (expensive) fetch+build rather than after.
    for (const key of wanted) {
      if (this.chunks.has(key) || this.loading.has(key) || this.queued.has(key))
        continue;
      if (!this.frustumHitsTile(key)) continue;
      this.loading.add(key);
      // fire-and-forget: the render loop must never await a fetch. The guard
      // above is what stops the next frame requesting the same chunk again.
      void this.loadChunk(key)
        .catch(() => undefined)
        .finally(() => this.loading.delete(key));
    }
  }

  async loadChunk(key: string): Promise<void> {
    try {
      const [gx, gy] = key.split(",").map(Number);
      const data = await fetchChunk(`${gx}_${gy}`);
      if (!data) return; // empty tile / outside the slice
      // Enqueue rather than build inline: ~265 ExtrudeGeometry + merge in one
      // task is a visible stutter while flying fast. The queue is drained a few
      // ms at a time in tick(), and is the exact seam a worker drops into.
      this.queued.add(key);
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
   *
   * The work is append-only into a chunk's shared arena, so a slice boundary
   * costs nothing: the next slice keeps appending where it left off. There is
   * no per-building state to save and nothing to undo.
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
   * The enrichment summary of every resident chunk, merged.
   *
   * This is what makes the pipeline inspectable. The failure mode of a
   * classification system is a silent fallback to the default — every id is a
   * string, so a typo does not fail a build, it fails quietly — so the QA
   * overlay needs the counts of what actually landed.
   */
  get enrichment(): ChunkEnrichSummary {
    const families = new Set<string>();
    const palettes = new Set<string>();
    const landmarks = new Set<string>();
    let buildings = 0, enriched = 0, fronted = 0;
    for (const entry of this.chunks.values()) {
      const e = entry.enrich;
      if (!e) continue;
      buildings += e.buildings;
      enriched += e.enriched;
      fronted += e.fronted;
      for (const f of e.families) families.add(f);
      for (const p of e.palettes) palettes.add(p);
      for (const l of e.landmarks) landmarks.add(l);
    }
    return {
      buildings,
      enriched,
      fronted,
      families: [...families].sort(),
      palettes: [...palettes].sort(),
      landmarks: [...landmarks].sort(),
    };
  }

  /**
   * Advance one queued chunk by a slice of work. Returns true when the chunk
   * is still building (call again next slice), false when it is done and can
   * be dropped from the queue. Buildings are emitted in batches so no single
   * slice runs long.
   */
  buildChunkSlice(job: BuildJob): boolean {
    if (!job.state) {
      job.state = {
        i: 0,
        arena: new Facet(),
        group: new THREE.Group(),
      };
      job.state.group.name = `chunk_${job.key}`;
    }
    const st = job.state;
    const list = job.data.b ?? [];
    const batch = 24;

    // Clear the footprints off the carriageway BEFORE anything reads a ring.
    //
    // Measured on the starter slice: 36.5% of buildings have a footprint vertex
    // inside a road and 8.4% are more than 1.5 m into one, so buildings
    // routinely stand in the street. It is in the source geometry, not in the
    // width table, and the raw tiles that would let it be fixed at ingest time
    // are deleted after enrichment — so it is corrected here.
    //
    // In place, before both `emitBuilding` below and `buildBroad(list)` at the
    // end. Those two are the render geometry and the walker's collider; if only
    // one of them saw the corrected ring you could see a building and still
    // walk through it.
    if (!st.roadsPushed) {
      st.roadsPushed = true;
      const segs = roadCorridor(job.data.s ?? []);
      if (segs.length) {
        for (const b of list) {
          if (Array.isArray(b.r) && b.r.length > 2) b.r = pushRingOutOfCorridor(b.r, segs);
        }
      }
    }

    // QA: what this chunk's enrichment actually contains. Counted here because
    // this is the one place every building in the chunk passes through.
    if (!st.enrich) {
      const families = new Set<string>();
      const palettes = new Set<string>();
      const landmarks = new Set<string>();
      let enriched = 0, fronted = 0;
      for (const b of list) {
        if (b.e) {
          enriched++;
          families.add(b.e.f);
          if (b.e.p) palettes.add(b.e.p);
          if (b.e.l) landmarks.add(b.e.l);
        }
        if (b.fx?.length) fronted++;
      }
      st.enrich = {
        buildings: list.length,
        enriched,
        fronted,
        families: [...families].sort(),
        palettes: [...palettes].sort(),
        landmarks: [...landmarks].sort(),
      };
    }

    // Every building in the chunk appends into ONE arena. Nothing is allocated
    // per building and nothing is merged afterwards — the slice boundary is
    // just "come back and keep appending".
    while (st.i < list.length) {
      emitBuilding(list[st.i++], st.arena);
      if (st.i % batch === 0 && performance.now() - this._sliceStart > 6)
        return true;
    }

    // finalise: one geometry, attach streets, freeze transforms
    const meshes: (THREE.Mesh | THREE.LineSegments)[] = [];
    const geo = st.arena.empty ? null : facetGeometry(st.arena);
    if (geo) {
      const mesh = new THREE.Mesh(geo, materialFor());
      mesh.name = "buildings";
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      st.group.add(mesh);
      meshes.push(mesh);
    }

    const kit = buildStreetKit(job.data.s ?? []);
    const kitTriangles = kit ? Math.floor(kit.used / 9) : 0;
    if (kit) {
      const mesh = new THREE.Mesh(
        facetGeometry(kit),
        materialFor(),
      );
      mesh.name = "streetkit";
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      st.group.add(mesh);
      meshes.push(mesh);
      st.kit = { props: kitTriangles };
    }

    const surfaces = buildSurfaces(job.key, job.data.s ?? [], list);
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
    this.chunks.set(job.key, {
      group: st.group,
      meshes,
      list,
      boxes: buildBroad(list),
      enrich: st.enrich,
    });
    return false;
  }

  /**
   * Every building footprint whose ring could reach within `radius` of a point.
   *
   * This is the walker's broad phase. It is deliberately two-stage: a tight
   * numeric scan over precomputed boxes (cheap across all ~13k resident
   * buildings), then the caller's exact ring test on the handful that survive.
   * The exact test is what matters — an AABB per building would put an invisible
   * wall in the middle of the road for any concave footprint, because Mumbai's
   * local streets are only 7 m kerb to kerb.
   */
  forEachBuildingNear(
    x: number,
    z: number,
    radius: number,
    fn: (b: RenderBuilding) => void,
  ): number {
    let hits = 0;
    for (const entry of this.chunks.values()) {
      const box = entry.boxes;
      for (let i = 0; i < box.length; i += 3) {
        const dx = box[i] - x;
        const dz = box[i + 1] - z;
        const reach = radius + box[i + 2];
        if (dx * dx + dz * dz > reach * reach) continue;
        fn(entry.list[i / 3]);
        hits++;
      }
    }
    return hits;
  }

  disposeChunk(key: string): void {
    this.queued.delete(key);
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

  /** Drop every resident chunk. Called on unmount, not during play. */
  dispose(): void {
    for (const key of [...this.chunks.keys()]) this.disposeChunk(key);
    this.cache.clear();
    this.loading.clear();
    this.queued.clear();
    this.queue.length = 0;
  }
}

interface BuildJob {
  key: string;
  data: { b?: RenderBuilding[]; s?: StreetFeature[] };
  state?: {
    /** the next building to emit; survives across slices */
    i: number;
    /** every building in this chunk appends here, across every slice */
    arena: Facet;
    group: THREE.Group;
    /** Footprints already cleared off the carriageway for this chunk. */
    roadsPushed?: boolean;
    enrich?: ChunkEnrichSummary;
    kit?: { props: number };
  };
}

/** What one chunk's enrichment contained. Read by the QA overlay. */
export interface ChunkEnrichSummary {
  buildings: number;
  enriched: number;
  fronted: number;
  families: string[];
  palettes: string[];
  landmarks: string[];
}

/** A resident chunk: its meshes, and the footprint data the walker collides with. */
interface ChunkEntry {
  group: THREE.Group;
  enrich?: ChunkEnrichSummary;
  meshes: (THREE.Mesh | THREE.LineSegments)[];
  /** Raw footprints, retained for collision. ~13k buildings resident, trivial. */
  list: RenderBuilding[];
  /**
   * Flat [cx, cz, span] per building, precomputed so the broad phase is a tight
   * numeric loop instead of re-walking every ring each frame. `span` is the
   * ring's radius about its centroid.
   */
  boxes: Float32Array;
}

/** StreetFeature shape carried in the chunk payload. */
interface StreetFeature {
  id: string;
  p: [number, number][][];
  n: string | null;
  c: number | null;
  w: number | null;
}

/**
 * Precompute [cx, cz, span] per building for the walker's broad phase. The
 * centroid `c` is already in the chunk data; `span` is the ring's radius about
 * it, which is what makes the test conservative for an off-centre footprint.
 */
function buildBroad(list: RenderBuilding[]): Float32Array {
  const out = new Float32Array(list.length * 3);
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    let span = 0;
    for (const p of b.r) {
      const d = Math.hypot(p[0] - b.c[0], p[1] - b.c[1]);
      if (d > span) span = d;
    }
    out[i * 3] = b.c[0];
    out[i * 3 + 1] = b.c[1];
    out[i * 3 + 2] = span;
  }
  return out;
}

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

/** Strip builder: accumulate quads as flat [x,y,z,...] arrays. */
class Strip {
  pos: number[] = [];
  /** Optional per-quad tint. When set, `quad` writes a colour attribute. */
  col: number[] = [];
  /** Push a horizontal quad from two edges, optionally tinted. */
  quad(
    a: [number, number],
    b: [number, number],
    c: [number, number],
    d: [number, number],
    y: number,
    tint?: THREE.Color,
  ) {
    const p = this.pos;
    p.push(a[0], y, a[1], b[0], y, b[1], c[0], y, c[1]);
    p.push(a[0], y, a[1], c[0], y, c[1], d[0], y, d[1]);
    if (tint) for (let i = 0; i < 6; i++) this.col.push(tint.r, tint.g, tint.b);
  }
  geometry(): THREE.BufferGeometry | null {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    if (this.col.length === this.pos.length) {
      g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    }
    return g;
  }
}

/**
 * Dress a chunk's streets: kerb paint, lamps, poles and wires, trees, bins,
 * planters, shopfront signage, and block planting.
 *
 * Split from the road surfaces because it is a different thing: `buildSurfaces`
 * draws the flat ground the street sits ON, this puts OBJECTS on it. Both are
 * driven by the same real centrelines, so a lamp is always beside the road it
 * belongs to.
 *
 * Returns null for a chunk with no streets, which is most of the ocean.
 */
function buildStreetKit(streets: StreetFeature[]): Facet | null {
  const out = new Facet();
  const roads: { ax: number; az: number; bx: number; bz: number; hw: number }[] = [];
  for (const st of streets) {
    const cls = (st.c ?? 1) as number;
    const hw = ROAD_HALF_WIDTH[cls] ?? ROAD_HALF_WIDTH[1];
    for (const path of st.p) {
      if (!path || path.length < 2) continue;
      // Same smoothed centreline the carriageway is built from, so lamps and
      // poles do not stand on a road that was then drawn somewhere else.
      const sp = smoothPath(path as [number, number][]);
      for (let i = 0; i < sp.length - 1; i++) {
        roads.push({ ax: sp[i][0], az: sp[i][1], bx: sp[i + 1][0], bz: sp[i + 1][1], hw });
      }
      dressStreet(out, sp, { halfWidth: hw, arterial: cls >= 5, cls });
    }
  }
  return out.empty ? null : out;
}

function buildSurfaces(
  key: string,
  streets: StreetFeature[],
  buildings: { r: [number, number][] }[] = [],
): THREE.Group | null {
  const group = new THREE.Group();
  group.name = `surface_${key}`;

  // --- roads, kerbs, footpaths, markings --------------------------------
  //
  // There is deliberately NO ground quad here any more. Ground is the land
  // mask in src/geo/water.ts, which knows where the harbour is; a full-tile
  // quad cannot, and drew the Arabian Sea as land. The road stack sits above
  // it: sea 0.00, land 0.05, road 0.08, markings 0.09, kerb 0.15.
  // Longest footpath we will draw before giving up and leaving bare land.
  // ponytail: the march is O(steps) per corridor edge and runs inside the chunk
  // build slice. At 26 m / 0.75 m steps it measured 653 ms PER CHUNK, which is a
  // two-thirds-second freeze every time a chunk loads. 16 m / 1.0 m steps plus
  // computing every second vertex (the width varies slowly along a street) is
  // ~6x cheaper. Ceiling: the cost is linear in MAX_FOOTPATH, so if the void
  // ever has to close further the fix is a per-chunk chamfer distance field to
  // the nearest footprint, rasterised once in O(cells) and then an O(1) lookup
  // per step — not a bigger loop.
  const MAX_FOOTPATH = 16;
  // Below this the footpath cannot get out at all — that is a junction.
  const JUNCTION_MIN = 1.2;
  // How far a junction pad reaches either side of a carriageway that is boxed in.
  const JUNCTION_PAD = 9;

  const road = new Strip();
  const kerb = new Strip();
  const foot = new Strip();
  const marks = new Strip();
  const apron = new Strip();

  // --- the corridor ------------------------------------------------------
  //
  // A street is a PATH WITH BOUNDARIES, not a stripe on the ground: carriageway,
  // kerb, then a footpath that runs until it meets something. The footpath used
  // to be a fixed 1.8 m band, so everything past it was bare land — which is
  // the wide pale void between the road and the buildings in every aerial.
  //
  // Two grids, built once per chunk, so the march below stays cheap:
  //   - every footprint ring, by bounding box
  //   - every street centreline segment
  const rings = buildings.map((b) => b.r).filter((r) => r && r.length > 2);
  const ringGrid = new NearGrid(24);
  indexRings(rings, ringGrid);
  const allSegs = roadCorridor(streets);
  const segGrid = new NearGrid(24);
  for (let i = 0; i < allSegs.length; i++) {
    const [ax, az, bx, bz] = allSegs[i];
    segGrid.add(ax, az, i);
    segGrid.add(bx, bz, i);
  }

  /** How far the footpath runs out from `p` along `(dx, dz)`. */
  const reach = (p: [number, number], dx: number, dz: number, own: number) =>
    reachToBoundary(p[0], p[1], dx, dz, rings, ringGrid, allSegs, segGrid, MAX_FOOTPATH, own);

  for (let si = 0; si < streets.length; si++) {
    const st = streets[si];
    // `c` is road_class and may be null on some features; default to local.
    const cls = (st.c ?? 1) as number;
    const hw = ROAD_HALF_WIDTH[cls] ?? ROAD_HALF_WIDTH[1];
    const isArterial = cls >= 5;
    for (const raw of st.p) {
      // ribbon() smooths, so every offset below must be measured from the SAME
      // smoothed centreline. It used to be measured from the raw `path[i]`,
      // which pushed kerbs and footpaths along a different vector to the
      // carriageway they belong to.
      const path = smoothPath(raw as [number, number][]);
      const w = ribbon(path, hw);
      if (!w) continue;
      for (let i = 0; i < w.l.length - 1; i++) {
        // carriageway
        roadQuad(road, w.l[i], w.l[i + 1], w.r[i + 1], w.r[i], 0.08);

        // OUTWARD normal at each end of this edge, from the SMOOTHED line.
        //
        // Perpendicular to the tangent, not along it. Marching along the
        // tangent walks down the kerb line and never leaves the road, which is
        // what made 59% of sides run the full 26 m without finding a wall.
        const normalAt = (j2: number): [number, number] => {
          const a = path[Math.max(0, j2 - 1)];
          const b = path[Math.min(path.length - 1, j2 + 1)];
          const dx = b[0] - a[0];
          const dz = b[1] - a[1];
          const L = Math.hypot(dx, dz) || 1;
          return [-dz / L, dx / L];
        };
        const dL0 = normalAt(i), dL1 = normalAt(i + 1);
        const dR0: [number, number] = [-dL0[0], -dL0[1]];
        const dR1: [number, number] = [-dL1[0], -dL1[1]];

        // How far each side's footpath runs before it meets a wall or a road.
        // Every second vertex only — see MAX_FOOTPATH — then interpolated, so
        // the band still tapers but the march cost is halved.
        const ev = (l: number) => {
          const n = normalAt(l);
          return reach(w.l[l], n[0], n[1], si);
        };
        const rv = (l: number) => {
          const n = normalAt(l);
          return reach(w.r[l], -n[0], -n[1], si);
        };
        const lerp = (f: (l: number) => number) =>
          i % 2 === 0
            ? [f(i), f(i + 1)]
            : [(f(i - 1) + f(i)) / 2, (f(i) + f(i + 1)) / 2];
        const [rl0, rl1] = lerp(ev);
        const [rr0, rr1] = lerp(rv);

        // A junction is where the footpath could not get out at all. Dropping
        // the kerb there is what stops kerbs and footpath bands being drawn
        // straight across the crossing carriageway, which was most of the
        // "convoluted mess" where more than one road met.
        const openL = Math.max(rl0, rl1) > JUNCTION_MIN;
        const openR = Math.max(rr0, rr1) > JUNCTION_MIN;

        const off = (
          v: [number, number],
          base: [number, number],
          d: [number, number],
          out: number,
        ): [number, number] => [v[0] + d[0] * out, v[1] + d[1] * out];

        if (openL || openR) {
          const l0 = off(w.l[i], path[i], dL0, 0.001);
          const l1 = off(w.l[i + 1], path[i + 1], dL1, 0.001);
          const r0 = off(w.r[i], path[i], dR0, 0.001);
          const r1 = off(w.r[i + 1], path[i + 1], dR1, 0.001);
          if (openL) kerb.quad(w.l[i], l0, l1, w.l[i + 1], KERB_H);
          if (openR) kerb.quad(r1, r0, w.r[i + 1], w.r[i], KERB_H);

          const L0 = off(w.l[i], path[i], dL0, FOOTPATH_W + rl0);
          const L1 = off(w.l[i + 1], path[i + 1], dL1, FOOTPATH_W + rl1);
          const R0 = off(w.r[i], path[i], dR0, FOOTPATH_W + rr0);
          const R1 = off(w.r[i + 1], path[i + 1], dR1, FOOTPATH_W + rr1);
          if (openL) foot.quad(l0, L0, L1, l1, KERB_H);
          if (openR) foot.quad(r1, R0, r0, r1, KERB_H);
        } else {
          // Fully enclosed: this is the junction mouth. Fill it at road level so
          // the carriageways read as one open intersection instead of several
          // ribbons laid over each other with bare land showing between them.
          const J = JUNCTION_PAD;
          const L0 = off(w.l[i], path[i], dL0, J);
          const L1 = off(w.l[i + 1], path[i + 1], dL1, J);
          const R0 = off(w.r[i], path[i], dR0, J);
          const R1 = off(w.r[i + 1], path[i + 1], dR1, J);
          apron.quad(L0, w.l[i], w.l[i + 1], L1, 0.085);
          apron.quad(w.r[i], R0, R1, w.r[i + 1], 0.085);
        }

        // centre line on arterials only
        if (isArterial) {
          marks.quad(path[i], path[i + 1], path[i + 1], path[i], 0.09);
        }
      }
    }
  }

  const add = (s: Strip, color: number, order: number, name: string) => {
    const g = s.geometry();
    if (!g) return;
    // when the strip carries a colour attribute, the vertex colours ARE the
    // tone and `color` becomes white
    const perVertex = !!g.getAttribute("color");
    const m = new THREE.Mesh(
      g,
      flat({
        color: perVertex ? 0xffffff : color,
        toneMapped: false,
        side: THREE.DoubleSide,
        vertexColors: perVertex,
        cache: false,
      }),
    );
    m.name = name;
    m.receiveShadow = true;
    m.renderOrder = order;
    group.add(m);
  };
  // Heights match src/geo/water.ts: ground 0, sea 0.05, road 0.08, marks 0.09.
  // The road stack used to start at 0.01 and sat UNDER the sea ribbons, which
  // drew causeways and the Sea Link beneath the water they cross.
  add(road, 0x54535a, -1, "road");
  add(kerb, 0xcfcabb, 0, "kerb");
  add(foot, 0xb9b3a4, 0, "footpath");
  add(apron, 0x54535a, -1, "junction");
  add(marks, 0xe8dfc0, 0, "markings");

  return group.children.length ? group : null;
}
