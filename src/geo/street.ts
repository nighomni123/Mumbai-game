/**
 * The 0-4 m band: everything between the kerb and a person's head.
 *
 * Why this file exists, in one measured number. On 2026-09-30 the enrichment
 * pipeline gave buildings window grids, plinths, cornices, balconies and roof
 * clutter, and a Fort street frame went from 1,865 distinct colours to about
 * 3,000. The reference build it is modelled on carries 8,000-13,000. Attributing
 * the shortfall by band:
 *
 *   sky        reference 4,251   ours 1,645
 *   buildings  reference 4,835   ours 1,352
 *   ground     reference 3,409   ours   645
 *
 * No amount of facade work closes that. What the reference has and we do not is
 * the layer a person actually walks through: black-and-yellow kerb paint,
 * streetlamps, electric poles with wires strung between them, planters,
 * foliage, signage. Those are what put a magenta or a green in the frame, and
 * `magenta` was measured at literally 0% before this.
 *
 * Placement is driven by the REAL street centrelines already in every chunk, and
 * seeded from position, so the same street always gets the same lamp in the same
 * place — which is what makes a screenshot reproducible.
 *
 * Everything here writes into the same Facet buffers the buildings use, so a
 * chunk still costs a handful of draw calls.
 */

import { Facet } from "./buildings.js";
import { PAL } from "../engine/palette.js";
import {
  parkedCar,
  bike,
  autoRickshaw,
  pedestrian,
  bench,
  bollard,
  shrub,
  awning,
  shutter,
} from "./props.js";
import { hash01, pseudo, tint } from "./vocab.js";

/* ------------------------------------------------------------------ *
 * The palette. Taken from the engine's own PAL so the street layer sits
 * in the same world as the buildings rather than beside it.
 * ------------------------------------------------------------------ */
const C = {
  // hedge/hedgeLight now live in PAL (src/engine/palette.js) — promoted 2026-09-30
  hedge: PAL.hedge,
  hedgeLight: PAL.hedgeLight,
  kerbYellow: 0xf2c33c,
  kerbDark: 0x1e1c22,
  lampPost: 0x4d5a63,
  lampHead: 0xfff0cf,
  lampPool: 0xf0c9a0,
  poleWood: 0x6b5a4e,
  wire: 0x2b2733,
  concrete: 0xb9ad96,
  planter: 0xd0c4a8,
  trunk: 0x5a4433,
  leafA: 0x3f6b3a,
  leafB: 0x53834a,
  leafC: 0x2f5230,
  gulmohar: 0xd8452c,
  gulmoharDeep: 0xa82d1c,
  signRed: 0xc23a2c,
  signGreen: 0x2e7d4f,
  signBlue: 0x2b5f9e,
  signAmber: 0xe8a020,
  signWhite: 0xf7f2e6,
  bin: 0x2f6b52,
  binBlue: 0x2a5a7a,
};

const SIDE = { LEFT: -1, RIGHT: 1 } as const;

/**
 * STREET DENSITY TIER.
 *
 * `?street=A|B|C|D|E|F`:
 *   A  what ships today — kerb paint, lamps, poles, wires, trees, bins, planters,
 *      signs, string lights. No vehicles, no people, no furniture.
 *   B  A + vegetation density (more trees, shrubs, planting beds)
 *   C  A + urban furniture (benches, bollards)
 *   D  A + commercial frontage (awnings, shutters, fascia)
 *   E  A + mobility (parked cars, bikes, auto-rickshaws)   <- isolated early on
 *      purpose: the reference's accent rate and effective tone count plausibly
 *      come from exactly this class, and a parked car buys more visual complexity
 *      per triangle than dozens of window meshes.
 *   F  B + C + D + E + people
 *
 * Default is A, so the shipped world is unchanged until the experiment says
 * otherwise. Each tier is A plus ONE class, so the marginal contribution of each
 * class is measurable rather than confounded.
 */
const STREET_TIER =
  (typeof location !== "undefined" &&
    new URLSearchParams(location.search).get("street")) || "a";
const T_B = STREET_TIER.toLowerCase() === "b";
const T_C = STREET_TIER.toLowerCase() === "c";
const T_D = STREET_TIER.toLowerCase() === "d";
const T_E = STREET_TIER.toLowerCase() === "e";
const T_F = STREET_TIER.toLowerCase() === "f";
export const VEG = T_B || T_F;
export const FURN = T_C || T_F;
export const COMM = T_D || T_F;
export const MOBIL = T_E || T_F;
export const PEOPLE = T_F;

/** `?place=1` reverts mobility to the pre-2026-09-30 uniform spacing. */
const PLACE_UNIFORM =
  typeof location !== "undefined" &&
  new URLSearchParams(location.search).get("place") === "1";

/* ------------------------------------------------------------------ *
 * Deterministic placement.
 * ------------------------------------------------------------------ */

/** A stable 0..1 from a world position, so a spot always gets the same thing. */
function at(x: number, z: number, salt: string): number {
  return hash01(`${Math.round(x * 4)}:${Math.round(z * 4)}:${salt}`);
}

/**
 * Points along a street at a spacing, offset to one side.
 *
 * Walking the polyline by arc length rather than by index matters: an OSM way
 * is dense in some places and sparse in others, and index-based spacing puts
 * three lamps on one segment and none for a block on the next.
 */
function alongStreet(
  path: [number, number][],
  spacing: number,
  side: number,
  offset: number,
  salt: string,
): { x: number; z: number; dx: number; dz: number; r: number }[] {
  const out: { x: number; z: number; dx: number; dz: number; r: number }[] = [];
  let carry = spacing * 0.5;
  for (let i = 0; i < path.length - 1; i++) {
    const [ax, az] = path[i];
    const [bx, bz] = path[i + 1];
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 0.2) continue;
    const ux = dx / len, uz = dz / len;
    // left normal, offset to the requested side
    const nx = -uz * side, nz = ux * side;
    let t = carry;
    while (t < len) {
      const px = ax + ux * t + nx * offset;
      const pz = az + uz * t + nz * offset;
      out.push({ x: px, z: pz, dx: ux, dz: uz, r: at(px, pz, salt) });
      t += spacing;
    }
    carry = t - len;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Kerb paint — black and yellow, in 0.9 m blocks.
 *
 * The single most specifically-Mumbai thing in the whole reference, and it is
 * the cheapest: the kerb strip is already being drawn, this only alternates its
 * colour every 0.9 m. It is also the thing that puts a saturated yellow into a
 * frame that was 100% desaturated before.
 * ------------------------------------------------------------------ */
export function kerbPaint(
  out: Facet,
  path: [number, number][],
  halfWidth: number,
  blockLen = 0.9,
): void {
  const BLOCK = blockLen;
  for (let i = 0; i < path.length - 1; i++) {
    const [ax, az] = path[i];
    const [bx, bz] = path[i + 1];
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 0.3) continue;
    const ux = dx / len, uz = dz / len;
    const blocks = Math.max(1, Math.floor(len / BLOCK));
    for (let b = 0; b < blocks; b++) {
      const t0 = (b * len) / blocks;
      const t1 = ((b + 1) * len) / blocks;
      const y = 0.155; // just above the kerb top (KERB_H is 0.15)
      for (const side of [SIDE.LEFT, SIDE.RIGHT]) {
        const nx = -uz * side, nz = ux * side;
        const o0 = halfWidth, o1 = halfWidth + 0.16;
        out.quadY(
          ax + ux * t0 + nx * o0, az + uz * t0 + nz * o0,
          ax + ux * t1 + nx * o0, az + uz * t1 + nz * o0,
          y, y,
          b % 2 ? C.kerbYellow : C.kerbDark,
          1,
        );
        // the top face of the block
        out.quadY(
          ax + ux * t0 + nx * o0, az + uz * t0 + nz * o0,
          ax + ux * t1 + nx * o1, az + uz * t1 + nz * o1,
          y, y,
          b % 2 ? C.kerbYellow : C.kerbDark,
          1.12,
        );
        void o1;
      }
    }
  }
}

/* ------------------------------------------------------------------ *
 * Props.
 * ------------------------------------------------------------------ */

/** A streetlamp: post, arm, sodium head, and a flat pool of light on the road. */
export function streetlamp(out: Facet, x: number, z: number, ux: number, uz: number): void {
  const H = 7.4;
  const nx = -uz, nz = ux;
  out.box(x, H / 2, z, 0.11, H / 2, 0.11, C.lampPost, 1.0);
  // arm reaching over the carriageway
  out.box(x + nx * 0.9, H, z + nz * 0.9, 0.06, 0.06, 0.9, C.lampPost, 1.05);
  out.box(x + nx * 1.8, H - 0.12, z + nz * 1.8, 0.3, 0.12, 0.22, C.lampHead, 1.16);
  // the pool: a flat disc of warm light, which is why a night street reads
  out.box(x + nx * 1.8, 0.1, z + nz * 1.8, 2.4, 0.006, 2.4, C.lampPool, 1.0);
  void ux;
}

/** An electric pole with a transformer box — Mumbai's overhead wiring. */
export function pole(out: Facet, x: number, z: number): void {
  const H = 8.2;
  out.box(x, H / 2, z, 0.14, H / 2, 0.14, C.poleWood, 1.0);
  out.box(x, H - 0.6, z, 0.5, 0.34, 0.34, C.kerbDark, 1.05);
  out.box(x, H - 1.5, z + 0.2, 0.24, 0.5, 0.2, C.poleWood, 1.02);
}

/**
 * String lights strung across a street.
 *
 * This replaces the overhead power wiring that was here first. Power cables
 * are a dense tangle of 2 cm threads, which a quad cannot represent — at any
 * span long enough to cross a street they render as 0.2 m pale ribbons and read
 * as structural beams, which is exactly what they did. (The black also lifted
 * to a sage green: post.js raises the black point, so a 0x2b2733 wire came out
 * at (155,172,144) on screen.)
 *
 * String lights are the better object anyway. They are SMALL and BRIGHT rather
 * than long and dark, so they survive this LOD, and they are what made one
 * particular lane the strongest frame in the reference build.
 */
export function stringLights(
  out: Facet,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  sag: number,
  hue: number,
): void {
  const N = 6;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const d = Math.sin(Math.PI * t) * sag;
    const x = ax + (bx - ax) * t;
    const z = az + (bz - az) * t;
    const y = ay + (by - ay) * t - d;
    // the cable
    if (i < N) {
      const t2 = (i + 1) / N;
      const d2 = Math.sin(Math.PI * t2) * sag;
      out.quadY(x, z, ax + (bx - ax) * t2, az + (bz - az) * t2, y, ay + (by - ay) * t2 - d2, C.wire, 1.0);
    }
    // a bulb every step — 0.12 m, which is what it actually is
    out.box(x, y - 0.09, z, 0.06, 0.06, 0.06, hue, 1.2);
  }
}

/** A catenary between two points — a sagging cable, not a straight line. */
export function wire(
  out: Facet,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  sag = 0.8,
  colour = C.wire,
): void {
  const N = 3;
  for (let i = 0; i < N; i++) {
    const t0 = i / N, t1 = (i + 1) / N;
    const d = (t: number) => Math.sin(Math.PI * t) * sag;
    out.quadY(
      ax + (bx - ax) * t0, az + (bz - az) * t0,
      ax + (bx - ax) * t1, az + (bz - az) * t1,
      ay + (by - ay) * t0 - d(t0), ay + (by - ay) * t1 - d(t1),
      colour, 1.0,
    );
  }
}

/** A planter with spherical topiary — Nariman Point and Marine Drive both have these. */
export function planter(out: Facet, x: number, z: number, r: number): void {
  out.box(x, 0.28, z, 0.62, 0.28, 0.62, C.planter, 1.0);
  out.box(x, 0.6, z, 0.5, 0.08, 0.5, C.hedge, 1.1);
  const s = 0.42 + r * 0.12;
  out.box(x, 0.6 + s, z, s, s, s, r > 0.5 ? C.hedgeLight : C.hedge, 1.12);
}

/** A litter bin, because a street with none of them reads as a model. */
export function bin(out: Facet, x: number, z: number, r: number): void {
  out.box(x, 0.34, z, 0.22, 0.34, 0.22, r > 0.5 ? C.bin : C.binBlue, 1.05);
  out.box(x, 0.7, z, 0.24, 0.05, 0.24, C.kerbDark, 1.1);
}

/**
 * A tree.
 *
 * The reference build's foliage is its weakest element — overlapping flat
 * lozenges and faceted icospheres, which is the first thing the eye finds wrong.
 * So: a real trunk, and four overlapping crowns at different sizes and greens,
 * which is roughly the same triangle count and reads as foliage rather than as
 * a shape.
 */
export function tree(out: Facet, x: number, z: number, r: number): void {
  const th = 2.6 + r * 1.2;
  const tr = 0.16 + r * 0.07;
  out.box(x, th / 2, z, tr, th / 2, tr, C.trunk, 1.0);
  // one limb, so the trunk is not a pole
  out.box(x + 0.25, th * 0.62, z, 0.06, 0.5, 0.06, C.trunk, 0.95);

  const crown = r > 0.86 ? C.gulmohar : r > 0.7 ? C.leafB : C.leafA;
  const deep = r > 0.86 ? C.gulmoharDeep : C.leafC;
  const spread = 1.15 + r * 0.85;
  // four lobes, deliberately uneven
  const lobes: [number, number, number, number][] = [
    [0, 0, 0, 1.0],
    [spread * 0.42, 0, spread * 0.22, 0.66],
    [-spread * 0.26, spread * 0.2, -spread * 0.3, 0.56],
  ];
  for (const [ox, oz, oy, s] of lobes) {
    out.box(
      x + ox, th + 0.5 + oy, z + oz,
      spread * s, spread * s * 0.78, spread * s * 0.92,
      s > 0.8 ? crown : deep, 1.0 + s * 0.08,
    );
  }
}

/** A shop fascia board — hung across the frontage, facing along the street. */
export function shopSign(
  out: Facet,
  x: number, z: number, dx: number, dz: number,
  r: number,
): void {
  const colours = [C.signRed, C.signGreen, C.signBlue, C.signAmber];
  const c = colours[Math.floor(r * colours.length) % colours.length];
  // board: halfW 1.3 m, halfH 0.34 m — a fascia, not a billboard. The first
  // version used an axis-aligned box 2.4 x 0.53 half-extents and read as a
  // hoarding floating over the footpath.
  out.panel(x, 3.05, z, dx, dz, 1.3, 0.34, c, 1.12);
  // a pale band so the board has content at distance
  out.panel(x + dz * 0.03, 3.05, z - dx * 0.03, dx, dz, 1.02, 0.11, C.signWhite, 1.2);
  // and a bracket back to the wall
  out.box(x, 3.35, z, 0.05, 0.05, 0.05, C.lampPost, 1.0);
}

/* ------------------------------------------------------------------ *
 * The placement pass.
 * ------------------------------------------------------------------ */

export interface StreetKitOptions {
  /** half the carriageway width, from the road class */
  halfWidth: number;
  /** true for roads wide enough to warrant the full kit */
  arterial: boolean;
  /** the road class itself — this is what gates the kit */
  cls?: number;
}

/**
 * Dress one street polyline. Called per street per chunk.
 *
 * Densities are tuned so a footpath in Fort ends up with a lamp every 24 m, a
 * tree most of the time and the occasional bin — which is roughly what the
 * reference does and, more importantly, is enough to put a colour into every
 * frame without costing anything per frame.
 */
/**
 * MOBILITY PLACEMENT — the depth-composition rule.
 *
 * Density is not the problem; composition is. Uniform 6.5 m spacing fills the
 * near frame with the nearest vehicle and blocks the view down the street. The
 * reference composes instead: a hero object in the foreground, an open middle
 * distance, and continuity further off.
 *
 * WHY THIS IS CAMERA-INDEPENDENT, which is a real constraint and not a
 * simplification. Chunk groups are built once and then frozen
 * (`matrixAutoUpdate = false` in GeoCity), and a chunk is only rebuilt when it
 * crosses the residency ring. A rule that read the camera would therefore be
 * stale for as long as you stood still, and would pop every time a chunk
 * rebuilt — a worse artefact than the one it fixes. So the rhythm is a property
 * of the STREET, not of the viewer, and it is derived from arc length so it is
 * stable across reloads.
 *
 * The acceptance pipeline, in order. The first four are exact; the last two are
 * approximated by clustering, and it is worth being honest about that:
 *
 *   1. inside the parking band   exact   — offset from the centreline
 *   2. orientation plausible      exact   — strictly along the street tangent
 *   3. no overlap with a sibling  exact   — minimum gap by vehicle length
 *   4. clear of the kerb ends     exact   — set-back from both polyline ends
 *   5. not excessive near area    approx  — larger vehicles need a longer slot,
 *                                         so small ones dominate by count
 *   6. does not block the view    approx  — enforced by on/off CLUSTERS rather
 *                                         than by looking down the sightline
 */
function placeMobility(
  out: Facet,
  path: [number, number][],
  halfWidth: number,
): void {
  // Per-vehicle-length minimum gaps. This is where "more small objects than
  // large ones" comes from: two cars need 8 m between them, two scooters need
  // 3.5 m, so a crowded stretch naturally fills with scooters.
  const SPEC = [
    { make: parkedCar, slot: 6.5, len: 4.4, gap: 2.2, roll: 0.34 },
    { make: bike, slot: 4.2, len: 1.9, gap: 1.4, roll: 0.5 },
    { make: autoRickshaw, slot: 5.4, len: 2.8, gap: 1.8, roll: 0.16 },
  ];
  // Cluster period and the chance a period is occupied. A ~38 m period with
  // roughly half the stretches empty gives the read: a busy patch, a gap, a busy
  // patch — which is what a real kerb looks like and what stops the view.
  const CLUSTER_M = 38;
  const OCCUPIED = 0.52;
  const END_SETBACK = 7;

  // `?place=1` restores the old uniform 6.5 m rule, so placement V1 and V2 can
  // be compared on the same poses. Kept because "the new one is better" is a
  // claim that should remain checkable rather than becoming folklore.
  if (PLACE_UNIFORM) {
    for (const side of [SIDE.LEFT, SIDE.RIGHT]) {
      for (const p of alongStreet(path, 6.5, side, halfWidth - 0.45, "caruni")) {
        const yaw = Math.atan2(p.dz, p.dx) + (side === SIDE.LEFT ? 0 : Math.PI);
        if (p.r > 0.82) autoRickshaw(out, p.x, p.z, yaw, p.r);
        else if (p.r > 0.6) bike(out, p.x, p.z, yaw, p.r);
        else if (p.r > 0.12) parkedCar(out, p.x, p.z, yaw, p.r);
      }
    }
    return;
  }

  const total = pathLength(path);

  for (const side of [SIDE.LEFT, SIDE.RIGHT]) {
    // accepted positions on this side, so overlap can be rejected (check 3)
    const taken: { s: number; len: number; gap: number }[] = [];
    const band = halfWidth - 0.45;

    // Walk the polyline by GLOBAL arc length. The first attempt walked it per
    // OSM segment and reset the cursor, which restarted the cluster period at
    // every vertex — so the rhythm was a function of how the road happened to be
    // digitised rather than of the street. Arc length is the only stable
    // measure here, and it is what makes the placement reproducible.
    let travelled = 0;
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const seg = Math.hypot(dx, dz);
      if (seg < 0.2) continue;
      const ux = dx / seg, uz = dz / seg;
      const nx = -uz * side, nz = ux * side;

      for (let t = 0; t <= seg; t += 2.0) {
        const at = travelled + t;
        // 4. clear of the kerb ends
        if (at < END_SETBACK || at > total - END_SETBACK) continue;

        // 5. the cluster gate — what keeps sightlines open. Without it every
        // slot fills and the nearest vehicle fills the near frame.
        const period = Math.floor(at / CLUSTER_M);
        if (hash01(`${period}|${side}|occ`) >= OCCUPIED) continue;

        const r = hash01(`${Math.round(at)}|${side}|veh`);
        let acc = 0, spec = SPEC[0];
        for (const sp of SPEC) {
          acc += sp.roll;
          if (r < acc) { spec = sp; break; }
        }

        // 3. overlap rejection against everything already accepted on this side
        let blocked = false;
        for (const tk of taken) {
          if (Math.abs(tk.s - at) < (tk.len + spec.len) / 2 + tk.gap) { blocked = true; break; }
        }
        if (blocked) continue;

        // 1. inside the parking band, 2. aligned to the street tangent
        const px = a[0] + ux * t + nx * band;
        const pz = a[1] + uz * t + nz * band;
        const yaw = Math.atan2(uz, ux) + (side === SIDE.LEFT ? 0 : Math.PI);
        spec.make(out, px, pz, yaw, r);
        taken.push({ s: at, len: spec.len, gap: spec.gap });
      }
      travelled += seg;
    }
  }
}

/** Total arc length of a polyline. */
function pathLength(path: [number, number][]): number {
  let n = 0;
  for (let i = 0; i < path.length - 1; i++) {
    n += Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]);
  }
  return n;
}

/**
 * Dress one street polyline, by road class.
 *
 * Why the class gating is not laziness. A Fort chunk carries 1,066 streets and
 * 88 km of carriageway — 851 of them class-1 local lanes. Dressing all of it
 * put ~8M triangles into a 2 km tile, which is not a style choice, it is the
 * build queue never draining (measured: `chunks 0 (+8)` — nothing resident).
 * Kerb paint alone is ~9 triangles per metre of kerb, so both sides of 88 km is
 * 1.5M before a single lamp exists.
 *
 * So the full kit goes on arterials, where it reads most anyway, local lanes get
 * kerb paint at half resolution, and everything else is skipped. The prop types
 * are all still here; they are just placed where they would really be.
 *
 * Densities, in metres between props:
 *   arterial  kerb 0.9  lamp 42  tree 34  pole 52  sign 44
 *   collector kerb 1.8  lamp 32  tree 24
 *   local     kerb 1.8
 */
export function dressStreet(
  out: Facet,
  path: [number, number][],
  opt: StreetKitOptions,
): { wires: number } {
  const { halfWidth, arterial, cls = 1 } = opt;
  const walk = halfWidth + 1.2;

  if (cls >= 5) {
    // --- arterial: the full kit ------------------------------------------
    kerbPaint(out, path, halfWidth, 1.8);
    for (const s of [SIDE.LEFT, SIDE.RIGHT]) {
      for (const p of alongStreet(path, arterial ? 42 : 34, s, walk + 0.4, "lamp"))
        streetlamp(out, p.x, p.z, p.dx, p.dz);
    }
    for (const s of [SIDE.LEFT, SIDE.RIGHT]) {
      for (const p of alongStreet(path, arterial ? 34 : 28, s, walk + 0.8, "tree")) {
        if (p.r > 0.34) tree(out, p.x, p.z, p.r);
        else if (p.r > 0.19) bin(out, p.x, p.z, p.r);
        else if (p.r > 0.15) planter(out, p.x, p.z, p.r);
      }
    }
    let wires = 0;
    const seq = alongStreet(path, arterial ? 52 : 44, SIDE.LEFT, walk + 0.5, "pole");
    for (let i = 0; i < seq.length; i++) pole(out, seq[i].x, seq[i].z);

    // string lights strung pole to pole, in the warm festival colours the
    // reference uses — seven tints, so a street gets variety not a metronome
    const HUES = [0xffd27a, 0xff8a6a, 0x7dff9a, 0x8ac6ff, 0xf07ac0, 0xfff0c8, 0xffa83c];
    for (let i = 1; i < seq.length; i++) {
      const q = seq[i - 1], p = seq[i];
      for (let h = 0; h < 2; h++) {
        const r = at(q.x + q.z, p.z, `sl${h}`);
        stringLights(out, q.x, 6.9, q.z, p.x, 6.9, p.z, 1.1, HUES[Math.floor(r * HUES.length) % HUES.length]);
        wires++;
      }
    }
    for (const s of [SIDE.LEFT, SIDE.RIGHT]) {
      for (const p of alongStreet(path, 44, s, walk + 0.3, "sign"))
        shopSign(out, p.x, p.z, p.dx, p.dz, p.r);
    }

    // --- tier-gated additions -------------------------------------------------
    // Placed INSIDE the arterial branch because these are kerbside things; a
    // back lane at Fort does not have a bench on it, and putting one there would
    // be a detail that is wrong rather than one that is missing.
    if (FURN) {
      for (const sd of [SIDE.LEFT, SIDE.RIGHT]) {
        for (const p of alongStreet(path, 26, sd, walk + 0.9, "bench")) {
          const yaw = Math.atan2(p.dz, p.dx);
          if (p.r > 0.5) bench(out, p.x, p.z, yaw, p.r);
          else bollard(out, p.x, p.z, p.r);
        }
      }
    }
    if (COMM) {
      for (const sd of [SIDE.LEFT, SIDE.RIGHT]) {
        for (const p of alongStreet(path, 13, sd, walk + 0.5, "awn")) {
          const yaw = Math.atan2(p.dz, p.dx) + Math.PI / 2;
          if (p.r > 0.45) awning(out, p.x, p.z, yaw, p.r);
          else shutter(out, p.x, p.z, yaw, p.r);
        }
      }
    }
    if (MOBIL) {
      placeMobility(out, path, halfWidth);
    }
    if (VEG) {
      for (const sd of [SIDE.LEFT, SIDE.RIGHT]) {
        for (const p of alongStreet(path, 7, sd, walk + 1.4, "veg")) {
          if (p.r > 0.55) shrub(out, p.x, p.z, p.r);
        }
      }
    }
    if (PEOPLE) {
      for (const sd of [SIDE.LEFT, SIDE.RIGHT]) {
        for (const p of alongStreet(path, 3.4, sd, walk + 0.7, "ppl")) {
          pedestrian(out, p.x, p.z, Math.atan2(p.dz, p.dx) + Math.PI / 2, p.r);
        }
      }
    }
    return { wires };
  }

  // --- local lane (80% of the network, 60 km of it): kerb paint only -------
  if (cls === 1) {
    kerbPaint(out, path, halfWidth, 3.6);
    return { wires: 0 };
  }

  // --- collector: kerb, a lamp, and the odd tree --------------------------
  kerbPaint(out, path, halfWidth, 3.6);
  for (const s of [SIDE.LEFT, SIDE.RIGHT]) {
    for (const p of alongStreet(path, 32, s, walk + 0.4, "lamp"))
      streetlamp(out, p.x, p.z, p.dx, p.dz);
    for (const p of alongStreet(path, 24, s, walk + 0.8, "tree"))
      if (p.r > 0.42) tree(out, p.x, p.z, p.r);
  }
  return { wires: 0 };
}
/* ------------------------------------------------------------------ *
 * Street-tree spread, seeded off the road.
 *
 * Trees that only line the road never reach the middle of a block, and a block
 * interior is a large part of a frame from the air and from a side street.
 * ------------------------------------------------------------------ */
export function blockPlanting(
  out: Facet,
  boxes: { x0: number; x1: number; z0: number; z1: number }[],
  roads: { ax: number; az: number; bx: number; bz: number; hw: number }[],
): number {
  let placed = 0;
  for (const b of boxes) {
    const w = b.x1 - b.x0, d = b.z1 - b.z0;
    if (w < 18 || d < 18) continue; // too small to hold anything
    const n = Math.min(10, Math.floor((w * d) / 9000));
    if (n <= 0) continue;
    for (let i = 0; i < n; i++) {
      const r = pseudo(Math.floor(hash01(`${b.x0},${b.z0},blk,${i}`) * 0x7fffffff) + 1)();
      const x = b.x0 + 3 + r * (w - 6);
      const r2 = pseudo(Math.floor(hash01(`${b.x0},${b.z0},blk2,${i}`) * 0x7fffffff) + 1)();
      const z = b.z0 + 3 + r2 * (d - 6);
      // keep clear of the carriageway
      let near = false;
      for (const s of roads) {
        const dx = s.bx - s.ax, dz = s.bz - s.az;
        const l2 = dx * dx + dz * dz;
        let t = l2 ? ((x - s.ax) * dx + (z - s.az) * dz) / l2 : 0;
        t = Math.max(0, Math.min(1, t));
        const cx = s.ax + dx * t, cz = s.az + dz * t;
        if ((x - cx) ** 2 + (z - cz) ** 2 < (s.hw + 5) ** 2) { near = true; break; }
      }
      if (near) continue;
      const r3 = pseudo(Math.floor(hash01(`${b.x0},${b.z0},blk3,${i}`) * 0x7fffffff) + 1)();
      if (r3 > 0.55) tree(out, x, z, r3);
      else if (r3 > 0.42) planter(out, x, z, r3);
      placed++;
    }
  }
  return placed;
}

export { tint };
