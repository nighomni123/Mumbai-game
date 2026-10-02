/**
 * Road geometry: centrelines in, a clean carriageway out.
 *
 * Two measured problems, both measured on the chunk JSON (19 starter chunks):
 *
 * 1. JAGGED. The ribbon was offset per vertex from a central-difference
 *    tangent, which has no mitre: at a corner the two sides pinch and spike
 *    instead of meeting cleanly. Underneath that the centrelines themselves are
 *    noisy — of 29,850 interior turns, 41% are >= 5 degrees and 8.9% are
 *    >= 20 degrees, with a 144 degree worst case. Almost none of that is a real
 *    corner; it is survey noise, and it draws as a saw edge.
 *
 * 2. BUILDINGS IN THE ROAD. 36.5% of buildings have a footprint vertex inside
 *    a carriageway and 8.4% are more than 1.5 m into one. Demoting the widest
 *    class from 14 m to 7 m only moved that 8.4% to 7.3%, so this is not a
 *    width-table mistake — the overlap is in the source data and has to be
 *    resolved when the ring is placed.
 *
 * Both fixes happen at chunk load, before the ring is emitted, so the render
 * geometry and the walker's collider read the SAME corrected ring. Correcting
 * one and not the other is how you get a building you can see but walk through.
 */

/** Carriageway half-width in metres, by ROAD_CLASS. */
export const ROAD_HALF_WIDTH: Record<number, number> = { 1: 3.5, 3: 4.5, 4: 5.5, 5: 7, 6: 7 };

/** Kerb height, and the footpath band outside it. */
export const KERB_H = 0.15;
export const FOOTPATH_W = 1.8;

/**
 * One centreline segment: endpoints, the corridor half-width it carries, and
 * the index of the street it belongs to.
 *
 * The street index matters because the footpath march has to ignore its OWN
 * centreline. Without it, stepping out from a kerb immediately finds the road
 * you are standing beside and gives up after 0.75 m, which classified 80% of
 * all street edges as junctions.
 */
export type RoadSeg = [ax: number, az: number, bx: number, bz: number, hw: number, sid: number];

/**
 * Douglas-Peucker, iterative so a 600 m path cannot blow the stack.
 *
 * This is what separates survey noise from real corners: a vertex that sits
 * within `tol` of the chord through its neighbours is not a corner and goes.
 */
function simplify(path: [number, number][], tol: number): [number, number][] {
  const n = path.length;
  if (n < 3) return path.slice();
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  const t2 = tol * tol;
  while (stack.length) {
    const [lo, hi] = stack.pop()!;
    if (hi <= lo + 1) continue;
    const [ax, az] = path[lo], [bx, bz] = path[hi];
    const dx = bx - ax, dz = bz - az;
    const L2 = dx * dx + dz * dz;
    let best = -1, bestD = t2;
    for (let i = lo + 1; i < hi; i++) {
      const [px, pz] = path[i];
      let d: number;
      if (L2 > 0) {
        let t = ((px - ax) * dx + (pz - az) * dz) / L2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        d = (px - ax - t * dx) ** 2 + (pz - az - t * dz) ** 2;
      } else {
        d = (px - ax) ** 2 + (pz - az) ** 2;
      }
      if (d > bestD) { bestD = d; best = i; }
    }
    if (best >= 0) { keep[best] = 1; stack.push([lo, best], [best, hi]); }
  }
  return path.filter((_, i) => keep[i]);
}

/**
 * Smooth a centreline: drop sub-15 cm noise, Douglas-Peucker the rest, then
 * two light Laplacian passes with the ends pinned.
 *
 * Endpoints stay put because a street must still meet the next chunk at the
 * same point, or the ribbon tears at every tile edge.
 */
export function smoothPath(
  path: [number, number][],
): [number, number][] {
  if (path.length < 3) return path.slice();
  let p = path.filter((v, i) => i === 0 || Math.hypot(v[0] - path[i - 1][0], v[1] - path[i - 1][1]) > 0.15);
  if (p.length < 3) return path.slice();
  p = simplify(p, 0.4);
  for (let pass = 0; pass < 2; pass++) {
    const q = p.map((v) => [v[0], v[1]] as [number, number]);
    for (let i = 1; i < p.length - 1; i++) {
      q[i][0] = p[i][0] + 0.4 * ((p[i - 1][0] + p[i + 1][0]) / 2 - p[i][0]);
      q[i][1] = p[i][1] + 0.4 * ((p[i - 1][1] + p[i + 1][1]) / 2 - p[i][1]);
    }
    p = q;
  }
  return p;
}

/**
 * Offset a centreline by `half` either side, with a real mitre at each corner.
 *
 * The old version averaged the two adjacent segment normals and used that as
 * the offset direction. At a 90 degree corner that under-shoots by cos(45),
 * and at a reversal it overshoots without limit, which is the saw edge. The
 * mitre scales by 1/cos(half-angle) to compensate; the clamp stops a 144 degree
 * vertex from firing a spike across the block.
 */
export function ribbon(
  path: [number, number][],
  half: number,
): { l: [number, number][]; r: [number, number][] } | null {
  const p = smoothPath(path);
  const n = p.length;
  if (n < 2) return null;
  const l: [number, number][] = [];
  const r: [number, number][] = [];
  const MAX_MITRE = 2.5;
  for (let i = 0; i < n; i++) {
    // unit direction of the incoming and outgoing segments
    const inD = i > 0 ? unit(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]) : null;
    const outD = i < n - 1 ? unit(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]) : null;
    const d = outD ?? inD!;
    let mx = -d[1], mz = d[0]; // left normal
    let scale = 1;
    if (inD && outD) {
      const n0x = -inD[1], n0z = inD[0];
      const n1x = -outD[1], n1z = outD[0];
      const bx = n0x + n1x, bz = n0z + n1z;
      const bl = Math.hypot(bx, bz);
      if (bl > 1e-6) {
        mx = bx / bl; mz = bz / bl;
        // 1/cos(half the turn angle) = |n0 + n1| / (1 + n0.n1)
        const cosHalf = (1 + n0x * n1x + n0z * n1z) / 2;
        scale = cosHalf > 0.05 ? Math.min(MAX_MITRE, 1 / Math.sqrt(cosHalf)) : MAX_MITRE;
      }
    }
    const o = half * scale;
    l.push([p[i][0] + mx * o, p[i][1] + mz * o]);
    r.push([p[i][0] - mx * o, p[i][1] - mz * o]);
  }
  return { l, r };
}

function unit(x: number, z: number): [number, number] {
  const L = Math.hypot(x, z) || 1;
  return [x / L, z / L];
}

/** Every street centreline in a chunk, flattened to segments with their width. */
export function roadCorridor(
  streets: { p?: [number, number][][]; c?: number | null }[],
): RoadSeg[] {
  const out: RoadSeg[] = [];
  for (let si = 0; si < streets.length; si++) {
    const s = streets[si];
    const hw = ROAD_HALF_WIDTH[s.c ?? 1] ?? ROAD_HALF_WIDTH[1];
    for (const path of s.p ?? []) {
      if (!path || path.length < 2) continue;
      for (let i = 0; i < path.length - 1; i++) {
        out.push([path[i][0], path[i][1], path[i + 1][0], path[i + 1][1], hw, si]);
      }
    }
  }
  return out;
}

/** Squared distance from a point to a segment, and the closest point on it. */
function closest(
  px: number, pz: number, s: RoadSeg,
): { d: number; cx: number; cz: number } {
  const [ax, az, bx, bz] = s;
  const dx = bx - ax, dz = bz - az;
  const L2 = dx * dx + dz * dz;
  let t = L2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + t * dx, cz = az + t * dz;
  return { d: Math.hypot(px - cx, pz - cz), cx, cz };
}

/**
 * Push a footprint ring out of the road corridor.
 *
 * A vertex inside the corridor moves out along the ray from the nearest point
 * on the centreline, to exactly `margin` beyond the carriageway edge. Three
 * passes, because pushing off one street can put a corner into the next.
 *
 * Only the carriageway is cleared. Buildings are SUPPOSED to front a footpath —
 * that is what a city street looks like — so widening this to kerb + footpath
 * would demolish the whole street wall to fix the 8% that really do overlap.
 */
export function pushRingOutOfCorridor(
  ring: [number, number][],
  segs: RoadSeg[],
  margin = 0.35,
): [number, number][] {
  if (!segs.length || ring.length < 3) return ring;
  const out = ring.map((v) => [v[0], v[1]] as [number, number]);
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (let i = 0; i < out.length; i++) {
      const v = out[i];
      for (const s of segs) {
        const R = s[4] + margin;
        const c = closest(v[0], v[1], s);
        if (c.d >= R || c.d < 1e-6) continue;
        let dx = v[0] - c.cx, dz = v[1] - c.cz;
        const L = Math.hypot(dx, dz);
        if (L < 1e-6) { dx = 1; dz = 0; } else { dx /= L; dz /= L; }
        out[i] = [c.cx + dx * R, c.cz + dz * R];
        moved = true;
        break;
      }
    }
    if (!moved) break;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Street corridor: how far the footpath runs before it hits something.
 * ------------------------------------------------------------------ */

/**
 * A uniform XZ grid over item indices.
 *
 * The corridor march below asks "what is near this point" once per step, for
 * every footpath vertex on both sides of every street. Without this that is
 * O(vertices x steps x everything); a 1,600 m tile has ~2,500 centreline
 * vertices and ~1,400 footprints, so the naive form is tens of millions of
 * point-in-polygon tests on a frame the player is waiting on.
 */
export class NearGrid {
  private m = new Map<string, number[]>();
  readonly cell: number;
  constructor(cell: number) { this.cell = cell; }

  private key(cx: number, cz: number) {
    return `${cx}|${cz}`;
  }

  addCell(cx: number, cz: number, i: number): void {
    const k = this.key(cx, cz);
    const a = this.m.get(k);
    if (a) a.push(i);
    else this.m.set(k, [i]);
  }

  add(x: number, z: number, i: number): void {
    this.addCell(Math.floor(x / this.cell), Math.floor(z / this.cell), i);
  }

  /** Item indices in the 3x3 block around a point. Reuses `out`. */
  near(x: number, z: number, out: number[] = []): number[] {
    out.length = 0;
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const a = this.m.get(this.key(cx + dx, cz + dz));
        if (a) for (let i = 0; i < a.length; i++) out.push(a[i]);
      }
    }
    return out;
  }
}

/** Put every footprint ring into a grid, once, by its bounding box. */
export function indexRings(rings: [number, number][][], g: NearGrid): void {
  for (let i = 0; i < rings.length; i++) {
    const r = rings[i];
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of r) {
      if (p[0] < x0) x0 = p[0];
      if (p[0] > x1) x1 = p[0];
      if (p[1] < z0) z0 = p[1];
      if (p[1] > z1) z1 = p[1];
    }
    for (let cx = Math.floor(x0 / g.cell); cx <= Math.floor(x1 / g.cell); cx++) {
      for (let cz = Math.floor(z0 / g.cell); cz <= Math.floor(z1 / g.cell); cz++) {
        g.addCell(cx, cz, i);
      }
    }
  }
}

/** Strict even-odd test. A vertex exactly on an edge does not count. */
function inRing(px: number, pz: number, r: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const xi = r[i][0], zi = r[i][1], xj = r[j][0], zj = r[j][1];
    if (zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * How far the footpath runs outward from a kerb before it hits something.
 *
 * It stops at the first building footprint or the first OTHER road's
 * centreline. That single number is what fixes both reported problems at once:
 *
 *   - The void between kerb and building closes, because the footpath now runs
 *     all the way to the facade instead of stopping at a fixed 1.8 m.
 *   - Junctions stop being a mess, because the footpath stops before it can
 *     draw a band across the crossing carriageway.
 *
 * Stepped rather than exact: a corridor edge does not need sub-metre accuracy,
 * and `step` bounds the cost.
 */
export function reachToBoundary(
  x: number,
  z: number,
  dx: number,
  dz: number,
  rings: [number, number][][],
  ringGrid: NearGrid,
  segs: RoadSeg[],
  segGrid: NearGrid,
  max: number,
  ownStreet: number,
  step = 1.0,
  junctionGap = 2.0,
): number {
  const scratch: number[] = [];
  for (let d = step; d <= max; d += step) {
    const px = x + dx * d;
    const pz = z + dz * d;
    // a building first: standing in a wall is worse than a short footpath
    for (const i of ringGrid.near(px, pz, scratch)) {
      if (inRing(px, pz, rings[i])) return d;
    }
    for (const i of segGrid.near(px, pz, scratch)) {
      const sg = segs[i];
      if (sg[5] === ownStreet) continue;      // our own road, not a junction
      const clear = sg[4] + junctionGap;
      if (clear < d) continue;                // too far away to matter yet
      if (closest(px, pz, sg).d < clear) return d;
    }
  }
  return max;
}
