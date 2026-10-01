/**
 * Geometry and projection utilities for the Greater Mumbai world.
 *
 * Two hard rules govern this file:
 *
 *  1. SOURCE DATA STAYS IN WGS84 (lon/lat degrees). Every feature is stored
 *     with its original coordinates and a `src` provenance tag. We never
 *     overwrite geography with a projection.
 *  2. RENDERING HAPPENS IN A LOCAL METRIC FRAME. A single equirectangular
 *     tangent plane centred on Greater Mumbai, with metres as units, gives
 *     sub-metre accuracy across the whole ~60 km metro, so 1 world unit = 1
 *     metre and walk speeds stay honest.
 *
 * Why not Web Mercator: at 19 deg N it inflates BOTH axes by 1/cos(19) =
 * 1.0585, i.e. a 5.85% isotropic error — about 3.5 km over 60 km. It is
 * conformal, so using it for a city model is simply wrong even though it
 * looks right on a map. Why not UTM 43N: Mumbai sits 223 km off its 75 deg E
 * central meridian and UTM carries a deliberate 400 ppm k0 bias. A local
 * tangent plane over 60 km is ~44 ppm (~2.7 m), which is invisible.
 *
 * Plain JS (`.mjs`) on purpose — these run under bare `node`, no build step
 * and no runtime dependency. Types are in JSDoc.
 */

/** @typedef {{ lon: number, lat: number }} LonLat */
/** @typedef {{ x: number, y: number }} XY */
/** @typedef {[number, number][]} Ring  (WGS84 lon/lat ring) */
/** @typedef {Ring[]} Poly  (polygon: [outer, ...holes]) */

/** Metro origin: roughly central Greater Mumbai (near the harbour). */
export const ORIGIN = { lon: 72.878, lat: 19.076 };

const DEG = Math.PI / 180;
const M_PER_DEG_LAT = 111320;
/** metres per degree of longitude at the origin latitude */
export const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos(ORIGIN.lat * DEG);

/**
 * WGS84 (lon, lat) -> local metric (x, y) metres.
 * @returns {XY}
 */
export function toLocal(lon, lat) {
  return {
    x: (lon - ORIGIN.lon) * M_PER_DEG_LON,
    y: (lat - ORIGIN.lat) * M_PER_DEG_LAT,
  };
}

/**
 * Local metric (x, y) metres -> WGS84 (lon, lat).
 * @returns {LonLat}
 */
export function toWgs84(x, y) {
  return {
    lon: ORIGIN.lon + x / M_PER_DEG_LON,
    lat: ORIGIN.lat + y / M_PER_DEG_LAT,
  };
}

/* ------------------------------------------------------------------ *
 * Tiling — a fixed grid over the metro. Each tile is streamed to the
 * browser independently so the whole city never lives in the GPU (or even
 * in memory) at once.
 * ------------------------------------------------------------------ */

/** Tile size in metres. ~2 km keeps a dense tile to a manageable payload. */
export const TILE_M = 2000;

/**
 * Metro bounds in local metres.
 *
 * Derived from the ACTUAL source extent (Mumbai_WFL1 buildings layer,
 * EPSG:3857 x 8,099,306-8,166,064 / y 2,130,638-2,212,787), which converts
 * to lon 72.757-73.357 / lat 18.793-19.491 — i.e. ALL of Greater Mumbai
 * including the eastern suburbs (Chembur, Ghatkopar, Mulund, Powai, Thane)
 * and Navi Mumbai. Padded 2 km. The task explicitly requires western AND
 * eastern suburbs, so do not narrow this back down.
 */
export const METRO_BOUNDS = { x0: -14730, x1: 52394, y0: -33504, y1: 48198 };

/**
 * The area we are actually building the mainland in, in local metres.
 *
 * A strict subset of METRO_BOUNDS: the ingested data keeps the whole metro (the
 * map shows all of it), but the city is only built inside this box. Decided
 * 2026-09-30 — out of scope for now, to be built when the mainland is done:
 *
 *   east of  19d12'27.8"N 72d59'36.5"E   lon 72.9934722 -> x 12,148
 *   north of              19.315608       lat 19.315608  -> y 26,673
 *   south of 18d53'26.7"N 72d48'42.6"E   lat 18.8907500 -> y -20,622
 *
 * So: the eastern mainland and Navi Mumbai (40 km off x1), the far north past
 * Panvel (21.5 km off y1), and the Konkan/Alibag hills south of the city.
 * The west edge stays at METRO_BOUNDS.x0 — nothing is cut there.
 *
 * MUST equal src/geo/geo-constants.ts ACTIVE_BOUNDS, like METRO_BOUNDS does.
 */
export const ACTIVE_BOUNDS = { x0: -14730, x1: 12148, y0: -20622, y1: 26673 };

/** @returns {boolean} whether a local-metre point is inside the build scope. */
export function inActive(x, y) {
  const b = ACTIVE_BOUNDS;
  return x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;
}

/** @returns {boolean} whether a tile (gx,gy) touches the build scope at all. */
export function tileInActive(gx, gy) {
  return inActive(gx * TILE_M, gy * TILE_M) || inActive(gx * TILE_M, (gy + 1) * TILE_M);
}

/**
 * @typedef {{ gx: number, gy: number }} TileId
 */

/** @param {number} x @param {number} y @returns {TileId} */
export function tileOf(x, y) {
  return { gx: Math.floor(x / TILE_M), gy: Math.floor(y / TILE_M) };
}

/** @param {TileId} t */
export function tileBounds(t) {
  return {
    x0: t.gx * TILE_M,
    x1: (t.gx + 1) * TILE_M,
    y0: t.gy * TILE_M,
    y1: (t.gy + 1) * TILE_M,
  };
}

/** @returns {TileId[]} all tiles covering the metro bounds */
export function allTiles() {
  const out = [];
  const gx0 = Math.floor(METRO_BOUNDS.x0 / TILE_M);
  const gx1 = Math.floor(METRO_BOUNDS.x1 / TILE_M);
  const gy0 = Math.floor(METRO_BOUNDS.y0 / TILE_M);
  const gy1 = Math.floor(METRO_BOUNDS.y1 / TILE_M);
  for (let gy = gy0; gy <= gy1; gy++)
    for (let gx = gx0; gx <= gx1; gx++) out.push({ gx, gy });
  return out;
}

/* ------------------------------------------------------------------ *
 * Polygon helpers (GeoJSON-ish, [lon,lat] rings)
 * ------------------------------------------------------------------ */

/**
 * Area of a ring in square metres (shoelace, computed on the local frame).
 * @param {Ring} ring
 * @returns {number}
 */
export function ringAreaM2(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const p1 = toLocal(ring[j][0], ring[j][1]);
    const p2 = toLocal(ring[i][0], ring[i][1]);
    a += p1.x * p2.y - p2.x * p1.y;
  }
  return Math.abs(a / 2);
}

/**
 * Area-weighted centroid of a polygon in WGS84, via the outer ring.
 * @param {Ring} ring
 * @returns {LonLat}
 */
export function centroid(ring) {
  let cx = 0,
    cy = 0,
    a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x0, y0] = ring[j];
    const [x1, y1] = ring[i];
    const f = x0 * y1 - x1 * y0;
    a += f;
    cx += (x0 + x1) * f;
    cy += (y0 + y1) * f;
  }
  if (Math.abs(a) < 1e-12) {
    let mx = 0,
      my = 0;
    for (const p of ring) {
      mx += p[0];
      my += p[1];
    }
    return { lon: mx / ring.length, lat: my / ring.length };
  }
  a *= 3;
  return { lon: cx / a, lat: cy / a };
}

/* ------------------------------------------------------------------ *
 * Douglas-Peucker polyline simplification.
 *
 * Shared because it now has three callers (the water ingest, the city map
 * build, and anything that wants map-scale geometry) and the cost of a
 * subtly different copy is silent: a coastline that collapses, or a road
 * skeleton so detailed the map file is 40 MB instead of 2.
 *
 * Iterative, because a Konkan coastline way runs to thousands of points
 * and the recursive form blows the stack.
 *
 * A CLOSED ring has its duplicate last point lifted off first. Left alone,
 * the outer a->b baseline is zero-length, every interior point reads as
 * collinear, and the ring collapses to 2 points.
 *
 * @param {[number,number][]} pts
 * @param {number} tol tolerance in the units of `pts`
 * @returns {[number,number][]}
 */
export function simplify(pts, tol) {
  const closed =
    pts.length > 2 &&
    Math.abs(pts[0][0] - pts[pts.length - 1][0]) < 1e-9 &&
    Math.abs(pts[0][1] - pts[pts.length - 1][1]) < 1e-9;
  const arc = closed ? pts.slice(0, -1) : pts;
  if (arc.length < 3) return pts;

  const keep = new Uint8Array(arc.length);
  keep[0] = keep[arc.length - 1] = 1;
  const stack = [[0, arc.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    if (b - a < 2) continue;
    const [ax, ay] = arc[a];
    const [bx, by] = arc[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1e-12;
    let far = -1;
    let fd = tol;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * (arc[i][0] - ax) - dx * (arc[i][1] - ay)) / len;
      if (d > fd) {
        fd = d;
        far = i;
      }
    }
    if (far < 0) continue;
    keep[far] = 1;
    stack.push([a, far], [far, b]);
  }
  const out = arc.filter((_, i) => keep[i]);
  return closed ? [...out, out[0]] : out;
}

/** Segment length of a polyline. Cheap; the map builder sums these. */
export function pathLength(pts) {
  let n = 0;
  for (let i = 0; i < pts.length - 1; i++)
    n += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  return n;
}
