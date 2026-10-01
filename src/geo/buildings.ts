/**
 * Procedural building geometry: a family plus a profile becomes boxes.
 *
 * This is the "95% of buildings" tier. No building gets a bespoke mesh; every
 * one is assembled from a handful of boxes derived from its family grammar and
 * its own footprint, and every building in a chunk appends into one shared
 * buffer (src/geo/chunk-build.ts).
 *
 * Why boxes and not textures: at eye level the eye resolves window rhythm,
 * balconies, roof shape and colour — not plaster detail. Measured against the
 * reference build, that is exactly where the difference lives. So the effort
 * goes into vertical banding and openings, which are geometry, and not into
 * surface texture, which would cost a texture atlas and resolve to nothing.
 *
 * Everything here is written into ONE position/colour buffer pair in the same
 * way the existing streets are, so a chunk still costs a handful of draw calls.
 */

import * as THREE from "three";
/**
 * FACADE TREATMENT — the readability experiment switch.
 *
 * The attribution pass showed buildings own 55% of the frame and 50.9 points of
 * it are low-chroma, so the question is not "what colour is this facade" but
 * "does this facade carry any structure at the distance the camera is looking
 * from". These four treatments isolate WHICH structure pays, holding the
 * geometry, families and palette constant:
 *
 *   A  current       — the original grammar
 *   B  segmentation  — bigger window groups, stronger contrast, stronger bands
 *   C  massing       — deeper balconies, projecting slabs, setbacks, parapets
 *   D  dense         — B + C + shutters, sills, doors, signage
 *
 * `?facade=A|B|C|D`. **Default is now D**, as of 2026-09-30: on street-level
 * poses edge density rises 4.58 -> 4.96% and effective tones 14.1 -> 15.5 from A
 * to D, with draw calls flat (47 -> 36) and triangle count unchanged at ~6.9M.
 * It costs nothing and is consistently better, so it is the new baseline. The
 * switch stays so A can still be A/B'd. See docs/facade-experiment.md.
 */
const FACADE_TREATMENT =
  (typeof location !== "undefined" &&
    new URLSearchParams(location.search).get("facade")) || "d";
const F_A = FACADE_TREATMENT.toLowerCase() === "a";
const F_B = FACADE_TREATMENT.toLowerCase() === "b";
const F_C = FACADE_TREATMENT.toLowerCase() === "c";
const F_D = FACADE_TREATMENT.toLowerCase() === "d";
/** segmentation (b) and dense (d) */
const SEG = F_B || F_D;
/** massing (c) and dense (d) */
const MASS = F_C || F_D;
/** dense (d) */
const DENSE = F_D;

import {
  FAMILIES,
  WINDOWS,
  BALCONIES,
  ROOFS,
  TRIM,
  facadeTone,
  hash01,
  pseudo,
  isV2,
  palettePool,
} from "./vocab.js";

/** A building's visual profile, as carried on the chunk record. */
export interface Profile {
  /** family id, key into FAMILIES */
  f: string;
  /** palette id, key into PALETTES */
  p: string;
  /** balcony id, key into BALCONIES */
  b?: string;
  /** roof override, key into ROOFS */
  r?: string;
  /** landmark tier, 0..3 */
  t?: number;
  /** landmark id when this building IS a landmark */
  l?: string;
}

export interface BuildingIn {
  r: [number, number][];
  H: number;
  F: number;
  a: number;
  id: string;
  /** street index this building fronts, if the enrichment found one */
  sp?: number;
  /** street centreline width, metres — decides whether the edge is a frontage */
  sw?: number;
  /** ring edge indices that front a street; absent until a chunk is enriched */
  frontEdges?: number[];
  /** the visual profile; present once a chunk has been enriched */
  e?: Profile;
}

/* ------------------------------------------------------------------ *
 * A buffer builder. Positions + Uint8 colours, written straight into
 * growable typed storage.
 *
 * Every writer appends exactly 9 floats and 9 bytes per triangle, in the same
 * order, so positions and colours stay index-aligned and one counter (`used`)
 * tracks both. `pos.length` is CAPACITY; `used` is what was written, and it
 * is what a consumer must read.
 * ------------------------------------------------------------------ */
export class Facet {
  pos = new Float32Array(8192);
  col = new Uint8Array(8192);
  /** floats written (= bytes written; the two are index-aligned) */
  used = 0;

  /** Double the buffers until they can take `need` elements. */
  private grow(need: number) {
    let cap = this.pos.length;
    if (need <= cap) return;
    while (cap < need) cap *= 2;
    const p = new Float32Array(cap);
    p.set(this.pos);
    this.pos = p;
    const c = new Uint8Array(cap);
    c.set(this.col);
    this.col = c;
  }

  /** @param hex 0xRRGGBB @param k brightness multiplier */
  tri(
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    hex: number, k: number,
  ) {
    this.grow(this.used + 9);
    const p = this.pos;
    const n = this.used;
    p[n] = ax; p[n + 1] = ay; p[n + 2] = az;
    p[n + 3] = bx; p[n + 4] = by; p[n + 5] = bz;
    p[n + 6] = cx; p[n + 7] = cy; p[n + 8] = cz;
    const r = Math.min(255, (((hex >> 16) & 255) * k) | 0);
    const g = Math.min(255, (((hex >> 8) & 255) * k) | 0);
    const b = Math.min(255, ((hex & 255) * k) | 0);
    const c = this.col;
    c[n] = r; c[n + 1] = g; c[n + 2] = b;
    c[n + 3] = r; c[n + 4] = g; c[n + 5] = b;
    c[n + 6] = r; c[n + 7] = g; c[n + 8] = b;
    this.used = n + 9;
  }

  /** An axis-aligned box with per-face shading, which is what sells flat form. */
  box(
    cx: number, cy: number, cz: number,
    hx: number, hy: number, hz: number,
    hex: number, k = 1,
  ) {
    const x0 = cx - hx, x1 = cx + hx;
    const y0 = cy - hy, y1 = cy + hy;
    const z0 = cz - hz, z1 = cz + hz;
    // A fixed per-face brightness ramp. This is the whole lighting model for a
    // merged city mesh: one constant per face direction, so every building in
    // the chunk is lit consistently and no normal is ever needed.
    const top = k * 1.1, bot = k * 0.55;
    const sx = k * 0.94, sz = k * 0.8, sy = k * 1.0;
    this.tri(x0, y1, z0, x1, y1, z0, x1, y1, z1, hex, top);
    this.tri(x0, y1, z0, x1, y1, z1, x0, y1, z1, hex, top);
    this.tri(x0, y0, z1, x1, y0, z1, x1, y0, z0, hex, bot);
    this.tri(x0, y0, z1, x0, y0, z0, x0, y0, z0, hex, bot);
    this.tri(x0, y0, z1, x1, y0, z1, x1, y1, z1, hex, sz);
    this.tri(x0, y0, z1, x1, y1, z1, x0, y1, z1, hex, sz);
    this.tri(x1, y0, z0, x0, y0, z0, x0, y1, z0, hex, sx);
    this.tri(x1, y0, z0, x0, y1, z0, x1, y1, z0, hex, sx);
    this.tri(x0, y0, z0, x0, y0, z1, x0, y1, z1, hex, sx);
    this.tri(x0, y0, z0, x0, y1, z1, x0, y1, z0, hex, sx);
    this.tri(x1, y0, z1, x1, y0, z0, x1, y1, z0, hex, sx);
    this.tri(x1, y0, z1, x1, y1, z0, x1, y1, z1, hex, sx);
  }

  /**
   * A vertical quad on the XZ plane, given by two ring points and a y range.
   * Used for facades and window reveals, where a box would be overkill.
   */
  quadY(
    ax: number, az: number, bx: number, bz: number,
    y0: number, y1: number,
    hex: number, k = 1, flip = false,
  ) {
    // A hairline band running unbroken for tens of metres is a BEAM, not a
    // course. This was reported as "a rendering error that shows on specific
    // angles", and measured rather than guessed at: the culprit is one quad,
    // 0.14 m tall and 50.9 m long, on the building 3.8 m from the player
    // (b_158253041, a 51 m art-deco frontage). Seen from 7.5 m its near end is
    // ~11 px thick and it recedes to the vanishing point, sweeping across the
    // sky in front of every other building.
    //
    // Splitting it per bay instead was tried first and was worse: 16x the
    // triangles and a new set of dark artifacts. So it is dropped instead. The
    // horizontal line is not lost — the 0.26 m MASSING ring band still runs the
    // full frontage and survives this test, and it is thick enough to read as
    // masonry at the same distance.
    //
    // ponytail: a distance fade would be better still, but chunks are static
    // and camera-independent, so there is no distance to fade against. Upgrade
    // path if this ever bites: draw thin bands only for edges under ~20 m.
    if (Math.abs(y1 - y0) < 0.25 && Math.hypot(bx - ax, bz - az) > 20) return;
    if (flip) {
      this.tri(ax, y0, az, bx, y0, bz, bx, y1, bz, hex, k);
      this.tri(ax, y0, az, bx, y1, bz, ax, y1, az, hex, k);
    } else {
      this.tri(ax, y0, az, bx, y1, bz, bx, y0, bz, hex, k);
      this.tri(ax, y0, az, ax, y1, az, bx, y1, bz, hex, k);
    }
  }

  /**
   * A vertical panel standing along a direction — a shop fascia, a sign board.
   *
   * `Facet.box` is axis-aligned, which is right for a building and wrong for
   * anything hung on a street: an axis-aligned box on an angled road points at
   * the viewer like a billboard. This takes the actual direction instead.
   */
  panel(
    cx: number, cy: number, cz: number,
    ux: number, uz: number,
    halfW: number, halfH: number,
    hex: number, k = 1,
  ) {
    const hx = ux * halfW, hz = uz * halfW;
    this.quadY(cx - hx, cz - hz, cx + hx, cz + hz, cy - halfH, cy + halfH, hex, k);
  }

  /**
   * A box rotated about Y.
   *
   * `box` is axis-aligned, which is right for a building and wrong for anything
   * that belongs to a street: a car parked on an angled road drawn with `box`
   * points at the camera like a billboard. Everything in the street kit that has
   * an along-street orientation — parked cars, bikes, autos, benches — goes
   * through here.
   */
  rbox(
    cx: number, cy: number, cz: number,
    hx: number, hy: number, hz: number,
    hex: number, k = 1, yaw = 0,
  ) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const put = (dx: number, dz: number): [number, number] => [cx + dx * c - dz * s, cz + dx * s + dz * c];
    const [x0, z0] = put(-hx, -hz), [x1, z1] = put(hx, -hz);
    const [x2, z2] = put(hx, hz), [x3, z3] = put(-hx, hz);
    const y0 = cy - hy, y1 = cy + hy;
    const top = k * 1.1, bot = k * 0.55;
    this.tri(x0, y1, z0, x1, y1, z1, x2, y1, z2, hex, top);
    this.tri(x0, y1, z0, x2, y1, z2, x3, y1, z3, hex, top);
    this.tri(x3, y0, z3, x2, y0, z2, x1, y0, z1, hex, bot);
    this.tri(x3, y0, z3, x1, y0, z1, x0, y0, z0, hex, bot);
    this.quadY(x0, z0, x1, z1, y0, y1, hex, k * 0.8);
    this.quadY(x2, z2, x3, z3, y0, y1, hex, k * 0.8);
    this.quadY(x1, z1, x2, z2, y0, y1, hex, k * 0.95);
    this.quadY(x3, z3, x0, z0, y0, y1, hex, k * 0.95);
  }

  /** Merge another facet, offset in Y. */
  add(o: Facet, dy = 0) {
    const m = o.used;
    if (!m) return;
    this.grow(this.used + m);
    const src = o.pos;
    const dst = this.pos;
    const at = this.used;
    for (let i = 0; i < m; i++) {
      // dy rides the Y component, which is every third float
      dst[at + i] = src[i] + (i % 3 === 1 ? dy : 0);
    }
    this.col.set(o.col.subarray(0, m), at);
    this.used = at + m;
  }

  get empty() {
    return this.used === 0;
  }
}

/* ------------------------------------------------------------------ *
 * Ring helpers.
 * ------------------------------------------------------------------ */

/** Signed area of a ring in the XZ plane; sign tells us the winding. */
export function ringArea(r: [number, number][]): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]);
  }
  return -a / 2;
}

/** Axis-aligned bounds of a ring. */
export function ringBounds(r: [number, number][]) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of r) {
    if (p[0] < x0) x0 = p[0];
    if (p[0] > x1) x1 = p[0];
    if (p[1] < z0) z0 = p[1];
    if (p[1] > z1) z1 = p[1];
  }
  return { x0, x1, z0, z1, w: x1 - x0, d: z1 - z0, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2 };
}

/** Every ring edge as [ax,az,bx,bz,len], skipping the closing edge. */
function edges(r: [number, number][]) {
  const out: [number, number, number, number, number][] = [];
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 0.4) continue;
    out.push([a[0], a[1], b[0], b[1], len]);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * The builder.
 * ------------------------------------------------------------------ */

/**
 * Assemble one building into `out`.
 *
 * Order matters: the mass, then its vertical banding, then the plinth, then
 * the roof and its clutter, then openings on the street-facing edges only.
 * Anything is skippable by the family and every skip is a real decision about
 * what that kind of building looks like — which is the point.
 */
export function buildBuilding(
  b: BuildingIn,
  profile: Profile,
  out: Facet,
): void {
  const fam = FAMILIES[profile.f] ?? FAMILIES.mumbai_apartment;
  const tone = facadeTone(profile.p, b.id);
  const rnd = pseudo(Math.floor(hash01(b.id + "|bld") * 0x7fffffff) + 1);
  const bb = ringBounds(b.r);
  const es = edges(b.r); // computed once: it was being rebuilt per edge before
  const H = b.H;
  const floors = Math.max(1, b.F || Math.round(H / (fam.ftf ?? 3.0)));
  const ftf = H / floors;

  // Only edges that front a street get openings. The rest stay blank, which is
  // what a real back lane looks like, and it is most of the cost saving.
  const front = b.frontEdges && b.frontEdges.length ? b.frontEdges : null;
  const targets = front ?? es.map((_, i) => i);

  // --- the mass, as a real extruded footprint ------------------------------
  // A plain box reads as a slab in a street of boxes. The ring is kept because
  // having OSM geometry is only worth something if the plan is real.
  mass(b.r, H, tone.base, out);

  // --- vertical banding ----------------------------------------------------
  // Plinth / body / cornice. This is what stops a facade being one flat tone,
  // and it is the single biggest contributor to the reference's read.
  const plinthH = Math.min(fam.plinth * 1.6, H * 0.22);
  if (plinthH > 0.4) band(b.r, 0, plinthH, tone.trim, 1.0, out);
  if (fam.banding || SEG) {
    // a horizontal string course every few floors, as Art Deco has. Under
    // segmentation it applies to every family and every 2 floors, because a
    // continuous horizontal rhythm is what gives a flat facade its scale.
    const every = SEG ? 2 : 4;
    for (let f = 2; f < floors; f += every) {
      band(b.r, plinthH + f * ftf - 0.12, plinthH + f * ftf + 0.12, tone.trim, SEG ? 1.06 : 0.94, out);
    }
  }
  band(b.r, H - 0.35, H, tone.trim, 1.0, out); // cornice
  secondaryRegions(b, fam, tone, plinthH, ftf, floors, out, rnd);

  // --- openings on the street frontage -------------------------------------
  // Segmentation scales the window group up: under B/D fewer, larger openings
  // with a higher-contrast reveal, which is what survives at medium distance.
  const win = { ...(WINDOWS[fam.window] ?? WINDOWS.none) };
  if (SEG) {
    win.w = win.w * 1.45;
    win.h = win.h * 1.12;
    win.rhythm = Math.min(1, win.rhythm * 1.25);
  }
  if (win.w > 0) {
    for (const ei of targets) {
      const e = es[ei];
      if (e) openings(e, H, floors, ftf, plinthH, fam, win, tone, out, rnd, SEG);
    }
  }

  // --- balconies -----------------------------------------------------------
  // Massing (C, D) forces a balcony onto every family and doubles the depth: a
  // projecting slab catches a shadow line, and a shadow line is structure.
  const balSpec = BALCONIES[profile.b ?? fam.balcony] ?? BALCONIES.none;
  const bal = MASS ? { ...balSpec, depth: Math.max(0.8, balSpec.depth * 2), prob: 1 } : balSpec;
  if (bal.depth > 0 && targets.length && rnd() < (bal.prob ?? 0)) {
    // one continuous line on the longest frontage; per-edge reads as noise
    let best = targets[0];
    for (const ei of targets) if (es[ei] && es[ei][4] > es[best][4]) best = ei;
    if (es[best]) balcony(es[best], H, floors, ftf, plinthH, bal, tone, out);
  }

  // --- massing: a projecting slab course and a setback crown ---------------
  if (MASS) {
    // a continuous projecting band at every second floor. It is the single
    // cheapest thing that makes a flat elevation read as a building: the band
    // casts its own shadow and creates a horizontal line the eye can follow.
    for (let f = 1; f < floors; f += 2) {
      const y = plinthH + f * ftf;
      if (y > H - 1.4) break;
      const d = 0.28;
      ring(b.r, y, y + 0.26, d, tone.trim, 1.0, out);
    }
    // a parapet that stands proud of the wall
    ring(b.r, H - 0.05, H + 0.55, 0.2, tone.trim, 1.0, out);
    // a setback upper mass, so the silhouette is not a single prism
    if (floors >= 5) {
      const inset = ringInset(b.r, 1.1);
      if (inset.length > 2) {
        mass(inset, Math.max(1.5, H * 0.14), tone.base, out, H - 0.05);
      }
    }
  }

  // --- semantic accents, driven by the family -------------------------------
  semanticAccents(b, fam, tone, plinthH, ftf, floors, front, es, out, rnd);

  // --- dense (D): shutters, sills, and a lintel course ---------------------
  if (DENSE) {
    for (const ei of targets) {
      const e = es[ei];
      if (!e) continue;
      const [ax, az, bx, bz, len] = e;
      if (len < 5) continue;
      const dx = (bx - ax) / len, dz = (bz - az) / len;
      const nx = -dz, nz = dx;
      for (let f = 0; f < floors; f++) {
        const y = plinthH + f * ftf;
        if (y > H - 1.0) break;
        // a projecting sill under every floor
        out.quadY(
          ax + nx * 0.18, az + nz * 0.18,
          bx + nx * 0.18, bz + nz * 0.18,
          y - 0.18, y - 0.04, tone.trim, 1.0,
        );
      }
    }
  }

  // --- roof ----------------------------------------------------------------
  roof(b, profile, fam, bb, tone, out, rnd);
}

/** The extruded prism of the true footprint. */
export function mass(
  r: [number, number][],
  H: number,
  hex: number,
  out: Facet,
  y0 = 0,
) {
  // Walls as quads, one per edge. Flat-shaded per edge normal direction, which
  // is enough for cel shading and costs no extra vertices per face normal.
  const n = r.length;
  const sign = windingSign(r);
  for (let i = 0; i < n; i++) {
    const a = r[i], b = r[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.3) continue;
    const [nx, nz] = outwardNormal(r, i, sign);
    const dot = nx * 0.55 + nz * 0.83; // fixed sun azimuth
    const k = 0.72 + 0.38 * Math.max(0, dot) - 0.06;
    // side quads
    out.quadY(a[0] + nx * 0.01, a[1] + nz * 0.01, b[0] + nx * 0.01, b[1] + nz * 0.01, y0, y0 + H, hex, k);
  }

  // The roof cap.
  //
  // This used to be ONE triangle fan from the ring centroid, carrying the
  // comment "rings here are convex enough in practice". They are not. Measured
  // over all 260,890 enriched rings (`bun scripts/audit-rings.mjs`): 27.5% are
  // concave, 19.33% made the fan overshoot the footprint, and it drew 8.16 km2
  // of roof OUTSIDE the buildings it was capping — 8.24% of all roof area.
  //
  // The worst case is not subtle. b_315613914 (chunk_-1_1) is a 180-vertex ring
  // a kilometre across; its fan covered 3.62x the true footprint, hanging a
  // 620 x 610 m phantom plane at H=30. That is the reported "large triangular
  // polygons where they should not be" and "roofs stretched across empty
  // space". `bun scripts/repro-roof.mjs b_315613914 chunk_-1_1.json` renders the
  // fan and the fix side by side against the true outline.
  //
  // Ear clipping is exact on the same corpus: worst area error 2.15e-8, zero
  // throws, zero non-finite output. It is also the correct primitive — a fan
  // is only ever valid for a convex ring.
  const y = y0 + H;
  // OSM rings repeat the first vertex to close; triangulateShape must not see it.
  const cap =
    r[0][0] === r[n - 1][0] && r[0][1] === r[n - 1][1] ? r.slice(0, -1) : r;
  const pts = cap.map(([x, z]) => new THREE.Vector2(x, z));
  const faces = THREE.ShapeUtils.triangulateShape(pts, []);
  for (let i = 0; i < faces.length; i++) {
    const a2 = pts[faces[i][0]], b2 = pts[faces[i][1]], c2 = pts[faces[i][2]];
    // normal.y = -(2D cross of b-a, c-a), so the cap faces up when that cross is
    // NEGATIVE. Ear clipping does not emit a uniform winding over this corpus
    // (measured: 1.12M of ~1.48M faces came out down-facing), so it is corrected
    // per triangle — get this backwards and FrontSide culls the whole roof.
    if ((b2.x - a2.x) * (c2.y - a2.y) - (b2.y - a2.y) * (c2.x - a2.x) > 0) {
      out.tri(a2.x, y, a2.y, c2.x, y, c2.y, b2.x, y, b2.y, hex, 1.12);
    } else {
      out.tri(a2.x, y, a2.y, b2.x, y, b2.y, c2.x, y, c2.y, hex, 1.12);
    }
  }
  // ponytail: 19 of 260,890 rings are self-intersecting and ear clipping drops a
  // vertex, leaving an unfilled patch in the roof. All 19 are 48-1196 m2 sheds
  // 8-11 m tall, so the gap is a few pixels; a hole-aware triangulator is the
  // upgrade path if that ever stops being true.
}

/**
 * SECONDARY COLOUR REGIONS.
 *
 * This is the single biggest lever available, and the baseline says why: our
 * frames needed only 2-3 tones to cover half the picture, against the
 * reference's 16-33. A building painted in one colour is one mass; a building
 * with a plinth, a body, a cornice, a shopfront band and a parapet is five
 * regions, and five regions is five chances to differ.
 *
 * Each region is a real architectural element that already exists in the
 * building — not a decal — so this adds colour without adding geometry, and
 * without inventing detail. A 0.05-0.15 chroma step across a band reads as
 * architectural articulation; the same step sprayed over the facade reads as
 * noise.
 *
 * V2-only, so the V1 experiment stays reproducible.
 */
function secondaryRegions(
  b: BuildingIn,
  fam: (typeof FAMILIES)[string],
  tone: { base: number; trim: number; accent: number },
  plinthH: number,
  ftf: number,
  floors: number,
  out: Facet,
  rnd: () => number,
): void {
  if (!isV2) return;
  // a second colour for this building, related to the first but clearly distinct
  const pool = palettePool(profileFamily(b));
  const alt = pool[Math.floor(hash01(b.id + "|alt") * pool.length) % pool.length];
  const altTone = facadeTone(alt, b.id, "alt");
  const r = hash01(b.id + "|altmix");
  // some buildings keep one colour; the rest get a second. Uniformity is what
  // we are trying to stop, but total randomness is what makes a toy city.
  if (r < 0.35) return;
  const strong = r > 0.78;

  // 1. ground-floor frontage — the storey that meets the street
  if (fam.groundShop > 0.2 && plinthH > 0.3) {
    band(b.r, 0, plinthH, altTone.trim, 0.9, out);
  }
  // 2. a secondary body band, so the facade is not one field of colour
  if (strong && floors >= 3) {
    const f = 1 + Math.floor(rnd() * (floors - 2));
    const y0 = plinthH + f * ftf;
    const y1 = Math.min(y0 + ftf * 0.42, plinthH + (f + 1) * ftf - 0.3);
    if (y1 > y0) band(b.r, y0, y1, altTone.base, 0.96, out);
  }
  // 3. the parapet reads as a cap, not as more wall
  if (fam.plinth > 0.5) band(b.r, b.H - 0.9, b.H - 0.1, altTone.trim, 1.08, out);
  void tone;
}

const profileFamily = (b: BuildingIn) => b.e?.f ?? "mumbai_apartment";

/**
 * SEMANTIC ACCENTS.
 *
 * The brief for these is the important part, and it is a design rule, not a
 * number: an accent must exist because something is THERE, never because a
 * random roll came up. `if (rnd() < 0.15) facade = saturated` produces colour
 * that means nothing and reads as a toy. Each of these is a thing Mumbai
 * buildings actually have, which is also why they will help place recognition
 * later and not only the benchmark.
 *
 * V2-only.
 */
function semanticAccents(
  b: BuildingIn,
  fam: (typeof FAMILIES)[string],
  tone: { base: number; trim: number; accent: number },
  plinthH: number,
  ftf: number,
  floors: number,
  front: number[] | null,
  es: [number, number, number, number, number][],
  out: Facet,
  rnd: () => number,
): void {
  if (!isV2) return;
  const A = tone.accent;
  const bb = ringBounds(b.r);
  const r = hash01(b.id + "|acc");

  // 1. a shopfront band where the ground floor is a shop — the single most
  //    common saturated thing on a Mumbai street
  if (fam.groundShop > 0.45 && r < 0.75) {
    const y = Math.min(plinthH + ftf * 0.62, b.H - 0.5);
    band(b.r, plinthH + ftf * 0.18, y, A, 1.1, out);
  }

  // 2. a fascia board over the shopfront, on street-facing edges only
  if (fam.signage && front && front.length && r > 0.35) {
    for (const ei of front) {
      const e = es[ei];
      if (!e) continue;
      const [ax, az, bx, bz] = e;
      const dx = bx - ax, dz = bz - az;
      const len = Math.hypot(dx, dz);
      if (len < 4) continue;
      const nx = -dz / len, nz = dx / len;
      const y = plinthH + ftf * 0.95;
      out.quadY(
        ax + nx * 0.14, az + nz * 0.14,
        bx + nx * 0.14, bz + nz * 0.14,
        y, y + 0.42, A, 1.0,
      );
    }
  }

  // 3. awnings, where the family wants them
  if (fam.awning > 0.4 && front && front.length && r > 0.5) {
    const hues = [0x2f6b52, 0xc23a2c, 0xe8a020, 0x2b5f9e];
    const c = hues[Math.floor(rnd() * hues.length) % hues.length];
    for (const ei of front) {
      const e = es[ei];
      if (!e || e[4] < 5) continue;
      const [ax, az, bx, bz] = e;
      const dx = bx - ax, dz = bz - az;
      const len = Math.hypot(dx, dz);
      const nx = -dz / len, nz = dx / len;
      const y = plinthH + ftf * 0.8;
      // a shallow sloping canvas over the shopfront
      out.quadY(ax + nx * 0.1, az + nz * 0.1, bx + nx * 0.1, bz + nz * 0.1, y, y + 0.06, c, 1.12);
      out.quadY(ax + nx * 1.1, az + nz * 1.1, bx + nx * 1.1, bz + nz * 1.1, y - 0.34, y, c, 1.0);
    }
  }

  // 4. painted shutters on the openings, which is what the reference does and
  //    what makes a facade read as inhabited rather than extruded
  if (fam.timber && r > 0.55) {
    band(b.r, plinthH, plinthH + 0.34, 0x2f6b52, 1.05, out);
  }

  // 5. a coloured door on the ground floor
  if (r > 0.6 && plinthH > 0.25) {
    const hues = [0xc23a2c, 0x2e7d4f, 0x2b5f9e, 0xe8a020, 0x8a1a2a];
    const c = hues[Math.floor(rnd() * hues.length) % hues.length];
    const es0 = front?.[0] != null ? es[front[0]] : es[0];
    if (es0) {
      const [ax, az, bx, bz, len] = es0;
      if (len > 6) {
        const t = 0.5;
        const dx = (bx - ax) * 0.045, dz = (bz - az) * 0.045;
        const cx = ax + (bx - ax) * t, cz = az + (bz - az) * t;
        out.quadY(cx - dx, cz - dz, cx + dx, cz + dz, 0.02, Math.min(2.2, b.H * 0.4), c, 1.12);
      }
    }
  }
  void bb; void floors;
}

/**
 * The OUTWARD normal of ring edge `i`.
 *
 * Measured 2026-10-01: `mass()` computed `(dz, -dx)` and its comment assumed a
 * ring wound the other way, so the normal pointed INWARD on every edge in the
 * data — 28934 of 28934 testable edges, not the 1312-edge sample first quoted.
 * With `cel()` being `FrontSide` that back-face culled every wall, and you
 * could see straight through every building to the road behind it.
 *
 * Direction is decided by the ring's own signed area, NOT by testing the
 * normal against the centroid. Every ring here is clockwise (shoelace < 0), so
 * the winding is uniform and already correct on the ~18% of edges that are
 * reflex — and reflex is exactly where "does this point away from the
 * centroid" is ambiguous. That test flipped 2992 correct normals the wrong
 * way. Re-injecting it fails 10.34% of edges; the signed area fails none.
 */
function outwardNormal(
  r: [number, number][],
  i: number,
  sign: number,
): [number, number] {
  const n = r.length;
  const a = r[i], b = r[(i + 1) % n];
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return [0, 0];
  // clockwise ring (sign +1) -> outward is (-dz, dx)
  return [(-dz / len) * sign, (dx / len) * sign];
}

/** +1 for a clockwise ring, -1 for counter-clockwise — the shoelace sign. */
function windingSign(r: [number, number][]): number {
  let s = 0;
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s < 0 ? 1 : -1;
}

/** Pull every ring vertex toward the centroid, so a roof clears its eaves. */
function ringInset(r: [number, number][], by: number): [number, number][] {
  let cx = 0, cz = 0;
  for (const p of r) { cx += p[0]; cz += p[1]; }
  cx /= r.length; cz /= r.length;
  return r.map(([x, z]) => {
    const dx = x - cx, dz = z - cz;
    const len = Math.hypot(dx, dz) || 1;
    const k = Math.max(0, (len - by) / len);
    return [cx + dx * k, cz + dz * k] as [number, number];
  });
}

/** A ridge beam along one axis, capping a pitched roof at height `y`. */
function ridge(
  out: Facet, cx: number, cz: number, y: number,
  half: number, halfW: number,
  axis: "x" | "z",
  hex: number, k: number,
) {
  const hx = axis === "x" ? half : halfW;
  const hz = axis === "x" ? halfW : half;
  out.box(cx, y + 0.09, cz, hx, 0.09, hz, hex, k);
}

/**
 * A horizontal band that stands PROUD of the wall on every edge, like a string
 * course or a projecting slab. Unlike `band`, which is a flush strip, this
 * pushes outward by `out` metres so it catches a shadow of its own — a shadow
 * line is structure, and a flush colour change is not.
 */
function ring(
  r: [number, number][],
  y0: number,
  y1: number,
  out: number,
  hex: number,
  k: number,
  f: Facet,
) {
  const n = r.length;
  const sign = windingSign(r);
  for (let i = 0; i < n; i++) {
    const a = r[i], b = r[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.3) continue;
    const [un, uz] = outwardNormal(r, i, sign);
    const nx = un * out, nz = uz * out;
    f.quadY(a[0] + nx, a[1] + nz, b[0] + nx, b[1] + nz, y0, y1, hex, k);
  }
}

/** A thin horizontal band around the whole footprint, used for banding. */
function band(
  r: [number, number][],
  y0: number,
  y1: number,
  hex: number,
  k: number,
  out: Facet,
) {
  const n = r.length;
  for (let i = 0; i < n; i++) {
    const a = r[i], b = r[(i + 1) % n];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 0.3) continue;
    const nx = (dz / len) * 0.09, nz = (-dx / len) * 0.09;
    out.quadY(a[0] + nx, a[1] + nz, b[0] + nx, b[1] + nz, y0, y1, hex, k);
  }
}

/** Windows down one edge. */
function openings(
  e: [number, number, number, number, number],
  H: number,
  floors: number,
  ftf: number,
  plinthH: number,
  fam: (typeof FAMILIES)[string],
  win: (typeof WINDOWS)[string],
  tone: { base: number; trim: number; accent: number },
  out: Facet,
  rnd: () => number,
  strong = false,
) {
  const [ax, az, bx, bz, len] = e;
  const dx = bx - ax, dz = bz - az;
  const nx = dz / len, nz = -dx / len;
  const ox = nx * (win.inset + 0.05), oz = nz * (win.inset + 0.05);

  // how many bays fit this edge
  const per = Math.max(1, Math.floor(len / (win.w * 2.0)));
  const spacing = len / per;
  const wW = Math.min(win.w, spacing * 0.55);
  const wH = Math.min(win.h, ftf * 0.62);

  for (let f = 0; f < floors; f++) {
    const base = plinthH + f * ftf + (ftf - wH) / 2;
    if (base + wH > H - 0.6) break;
    // the ground floor of a shopfront row is openings, not windows
    if (f === 0 && fam.groundShop > 0) {
      // a lit recess across the whole bay instead of discrete windows
      out.quadY(ax + ox, az + oz, bx + ox, bz + oz, 0.5, Math.min(2.6, H * 0.5), 0x2f3540, 0.7);
      continue;
    }
    for (let i = 0; i < per; i++) {
      if (win.rhythm < 1 && rnd() > win.rhythm) continue;
      const t0 = (i + 0.5) / per;
      const cx0 = ax + dx * t0 - (dx / len) * wW * 0.5;
      const cz0 = az + dz * t0 - (dz / len) * wW * 0.5;
      const cx1 = cx0 + (dx / len) * wW;
      const cz1 = cz0 + (dz / len) * wW;
      // reveal (the dark recess), then the frame
      out.quadY(cx0 + ox, cz0 + oz, cx1 + ox, cz1 + oz, base, base + wH, win.shade, strong ? 0.72 : 1.0);
      // Under segmentation the frame is a BRIGHT ring, not a trim-coloured one:
      // the contrast between a light frame and a dark opening is what makes a
      // window read at distance, and trim is too close to the base to do it.
      out.quadY(cx0, cz0, cx1, cz1, base - 0.12, base + wH + 0.12, strong ? 0xe8dcc4 : tone.trim, strong ? 1.25 : 1.05);
      // The sill is PER BAY, not one run down the whole edge.
      //
      // A continuous one was the "beams on specific angles" artefact: an 0.12 m
      // band drawn unbroken along a 51 m frontage is 11 px thick seven metres
      // from the eye and sweeps from the top of the frame to the vanishing
      // point, so it reads as a searchlight rather than as masonry. Broken per
      // bay it is what it was meant to be — a sill under each window — and it
      // costs the same triangles.
      if (f === 0 || rnd() > 0.6) {
        out.quadY(
          cx0 - (dx / len) * wW * 0.18, cz0 - (dz / len) * wW * 0.18,
          cx1 + (dx / len) * wW * 0.18, cz1 + (dz / len) * wW * 0.18,
          base - 0.16, base - 0.04, tone.trim, 1.0,
        );
      }
    }
  }
}

/** A continuous balcony slab down one edge. */
function balcony(
  e: [number, number, number, number, number],
  H: number,
  floors: number,
  ftf: number,
  plinthH: number,
  bal: (typeof BALCONIES)[string],
  tone: { base: number; trim: number; accent: number },
  out: Facet,
) {
  const [ax, az, bx, bz, len] = e;
  if (len < 3) return;
  const dx = (bx - ax) / len, dz = (bz - az) / len;
  const nx = dz, nz = -dx;
  const depth = bal.depth;
  const railH = 0.85;
  for (let f = 1; f < floors; f++) {
    const y = plinthH + f * ftf;
    if (y > H - 1.2) break;
    // slab: a horizontal band standing out from the wall
    band(
      [
        [ax + nx * depth, az + nz * depth],
        [bx + nx * depth, bz + nz * depth],
        [bx, bz],
        [ax, az],
      ],
      y - 0.14,
      y,
      tone.trim,
      1.08,
      out,
    );
    // railing
    out.quadY(
      ax + nx * depth, az + nz * depth,
      bx + nx * depth, bz + nz * depth,
      y, y + railH,
      TRIM.balconyRail, 0.9,
    );
  }
}

/** The roof, its parapet, and the clutter that makes a Mumbai skyline. */
function roof(
  b: BuildingIn,
  profile: Profile,
  fam: (typeof FAMILIES)[string],
  bb: ReturnType<typeof ringBounds>,
  tone: { base: number; trim: number; accent: number },
  out: Facet,
  rnd: () => number,
) {
  const H = b.H;
  const spec = ROOFS[profile.r ?? fam.roof] ?? ROOFS.flat_parapet;

  if (spec.pitch > 0) {
    // A ridged roof over the INSET footprint, not the bounding box.
    //
    // The first version used the AABB, which on a concave or L-shaped plan
    // sticks out past the real walls and reads as a slab floating beside the
    // building — it was visible as a detached plane across half the sky.
    // Pitch is also capped: 0.34 x min(w,d) is a 7 m roof on a 20 m house.
    const rise = Math.min(spec.pitch * Math.min(bb.w, bb.d), 2.6);
    const inset = ringInset(b.r, 0.35);
    if (inset.length > 2) {
      // sits ON the building, from H up by the rise
      mass(inset, rise, tone.trim, out, H);
      // the ridge: a short capping tile. It used to be bb.w/2 long, i.e. the
      // full width of the building, which at eye level read as a slab hanging
      // in the sky beside it.
      const top = H + rise;
      const half = Math.min(6, Math.max(bb.w, bb.d) * 0.22);
      if (bb.w >= bb.d) ridge(out, bb.cx, bb.cz, top, half, 0.12, "x", tone.base, 1.16);
      else ridge(out, bb.cx, bb.cz, top, half, 0.12, "z", tone.base, 1.16);
    }
  } else if (profile.r === "dome" || fam.dome) {
    out.box(bb.cx, H + 0.6, bb.cz, Math.min(bb.w, bb.d) * 0.32, 0.6, Math.min(bb.w, bb.d) * 0.32, tone.trim, 1.05);
    out.box(bb.cx, H + 2.2, bb.cz, Math.min(bb.w, bb.d) * 0.2, 1.0, Math.min(bb.w, bb.d) * 0.2, tone.trim, 1.12);
    out.box(bb.cx, H + 3.6, bb.cz, 0.25, 0.6, 0.25, tone.accent, 1.15);
  }

  if (spec.parapet > 0) {
    band(b.r, H - 0.1, H + spec.parapet, tone.trim, 1.06, out);
  }

  // --- clutter: the densest, most recognisable part of a Mumbai roofline ---
  const n = Math.round(spec.clutter * 4);
  for (let i = 0; i < n; i++) {
    const x = bb.x0 + 1 + rnd() * Math.max(0.1, bb.w - 2);
    const z = bb.z0 + 1 + rnd() * Math.max(0.1, bb.d - 2);
    const k = rnd();
    if (k < 0.34) {
      // black poly water tank on a stand
      const s = 0.55 + rnd() * 0.35;
      out.box(x, H + 0.35, z, s * 0.5, 0.35, s * 0.5, 0x2b2b2e, 1.0);
      out.box(x, H + 0.95 + s * 0.4, z, s, s * 0.55, s, rnd() > 0.5 ? TRIM.waterTank : TRIM.waterTankBlue, 1.05);
    } else if (k < 0.56) {
      // dish antenna
      const s = 0.3 + rnd() * 0.25;
      out.box(x, H + 0.2, z, 0.08, 0.2, 0.08, TRIM.balconyRail, 1.0);
      out.box(x, H + 0.45 + s, z, s, s, s * 0.5, TRIM.dish, 1.1);
    } else if (k < 0.78) {
      // tarpaulin over something
      const w = 0.7 + rnd() * 1.1;
      out.box(x, H + 0.3, z, w, 0.3, w * 0.7, rnd() > 0.5 ? TRIM.tarpaulin : 0x4a7f8c, 1.06);
    } else {
      // stair head / lift machine room
      const w = 0.8 + rnd() * 0.6;
      out.box(x, H + 0.7, z, w, 0.7, w * 0.85, tone.trim, 0.98);
    }
  }
}