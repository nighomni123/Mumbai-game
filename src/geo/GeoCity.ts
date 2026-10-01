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
import { TILE_M, tileOf, tileInActive } from "./geo-constants.js";
import { Facet, buildBuilding } from "./buildings.js";
import type { Profile } from "./buildings.js";
import { dressStreet, blockPlanting } from "./street.js";
import { hash01, tint } from "./vocab.js";
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

/** Facade-class geometry, generated from a real footprint ring. */
function buildingGeometry(
  ring: [number, number][],
  height: number,
): THREE.BufferGeometry {
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
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: false,
  });
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
 * Every building in a chunk merges into ONE bucket.
 *
 * This used to be one bucket per facade class with one material per class, and
 * those materials were byte-identical — the per-building colour rides in the
 * vertex colour attribute, so the material carries no class information at all.
 * Seven identical materials and seven draw calls per chunk became one of each.
 */
const BUCKET = "all";

/** The flat tone an unenriched building gets, by facade class. */
const LEGACY_TONE: Record<string, number> = {
  industrial: 0x8a8175,
  commercial: 0x8f9bb0,
  institutional: 0xc9c0ae,
  religious: 0xd8c7a0,
  apartments: 0xbfa88f,
  residential: 0xd0be9c,
};

/** Turn a Facet's parallel arrays into the geometry the chunk merge expects. */
function facetGeometry(f: Facet): THREE.BufferGeometry {
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
    const clamped = Math.max(1200, Math.min(MAX_RENDER_DISTANCE, metres));
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

    while (st.i < list.length) {
      const b = list[st.i++];
      let geo: THREE.BufferGeometry;
      if (b.e) {
        // Enriched: the family's grammar, so banding, windows, balconies and
        // roof clutter all come from the profile rather than a flat prism.
        const facet = new Facet();
        buildBuilding(b, b.e, facet);
        geo = facetGeometry(facet);
      } else {
        // Not enriched yet: the plain prism, exactly as before. A chunk with no
        // `e` fields must keep working, because enrichment is progressive.
        geo = buildingGeometry(b.r, b.H);
        this.paintGeometry(geo, this.facadeColor(b.t || "residential", b));
      }
      const bucket = st.byClass.get(BUCKET);
      if (bucket) bucket.push(geo);
      else st.byClass.set(BUCKET, [geo]);
      if (st.i % batch === 0 && performance.now() - this._sliceStart > 6)
        return true;
    }

    // finalise: merge, attach streets, freeze transforms
    const meshes: (THREE.Mesh | THREE.LineSegments)[] = [];
    for (const geos of st.byClass.values()) {
      const merged = mergeGeometries(geos);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, materialFor());
      mesh.name = "buildings";
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      st.group.add(mesh);
      meshes.push(mesh);
      geos.forEach((g) => g.dispose());
    }

    const kit = buildStreetKit(job.data.s ?? []);
    const kitTriangles = kit ? Math.floor(kit.pos.length / 9) : 0;
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

  facadeColor(cls: string, b: RenderBuilding): THREE.Color {
    // The unenriched fallback. Deterministic in the building id — it used to
    // take a Math.random() callback, which meant the same building was a
    // different colour on every reload and nothing visual was reproducible.
    const k = 0.96 + hash01(b.id + "|tone") * 0.08;
    return new THREE.Color(tint(LEGACY_TONE[cls] ?? 0xd0be9c, k));
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
    i: number;
    byClass: Map<string, THREE.BufferGeometry[]>;
    group: THREE.Group;
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
const ROAD_HALF_WIDTH: Record<number, number> = { 1: 3.5, 3: 4.5, 5: 7, 6: 7 };
const KERB_H = 0.15;
const FOOTPATH_W = 1.8;

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

/** Perpendicular offsets either side of a centreline, at the given half-width. */
function ribbon(
  path: [number, number][],
  half: number,
): { l: [number, number][]; r: [number, number][] } | null {
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
      for (let i = 0; i < path.length - 1; i++) {
        roads.push({ ax: path[i][0], az: path[i][1], bx: path[i + 1][0], bz: path[i + 1][1], hw });
      }
      dressStreet(out, path as [number, number][], { halfWidth: hw, arterial: cls >= 5, cls });
    }
  }
  return out.empty ? null : out;
}

function buildSurfaces(
  key: string,
  streets: StreetFeature[],
): THREE.Group | null {
  const group = new THREE.Group();
  group.name = `surface_${key}`;

  // --- roads, kerbs, footpaths, markings --------------------------------
  //
  // There is deliberately NO ground quad here any more. Ground is the land
  // mask in src/geo/water.ts, which knows where the harbour is; a full-tile
  // quad cannot, and drew the Arabian Sea as land. The road stack sits above
  // it: sea 0.00, land 0.05, road 0.08, markings 0.09, kerb 0.15.
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
        roadQuad(road, w.l[i], w.l[i + 1], w.r[i + 1], w.r[i], 0.08);
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
  add(marks, 0xe8dfc0, 0, "markings");

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
function mergeGeometries(
  geos: THREE.BufferGeometry[],
): THREE.BufferGeometry | null {
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
  const idx = indexed
    ? vertexTotal > 65535
      ? new Uint32Array(indexTotal)
      : new Uint16Array(indexTotal)
    : null;

  let vOff = 0;
  let iOff = 0;
  for (const g of geos) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array as ArrayLike<number>, vOff * 3);
    if (g.attributes.normal)
      nor.set(g.attributes.normal.array as ArrayLike<number>, vOff * 3);
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
  if (geos[0].attributes.normal)
    out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  if (geos[0].attributes.color)
    out.setAttribute("color", new THREE.BufferAttribute(col, 3, true));
  if (idx) out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}
