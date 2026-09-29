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
 * @typedef {{ gx: number, gy: number }} TileId
 */

/** @param {number} x @param {number} y @returns {TileId} */
export function tileOf(x, y) {
  return { gx: Math.floor(x / TILE_M), gy: Math.floor(y / TILE_M) };
}

/** @param {TileId} t */
export function tileBounds(t) {
  return { x0: t.gx * TILE_M, x1: (t.gx + 1) * TILE_M, y0: t.gy * TILE_M, y1: (t.gy + 1) * TILE_M };
}

/** @returns {TileId[]} all tiles covering the metro bounds */
export function allTiles() {
  const out = [];
  const gx0 = Math.floor(METRO_BOUNDS.x0 / TILE_M);
  const gx1 = Math.floor(METRO_BOUNDS.x1 / TILE_M);
  const gy0 = Math.floor(METRO_BOUNDS.y0 / TILE_M);
  const gy1 = Math.floor(METRO_BOUNDS.y1 / TILE_M);
  for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) out.push({ gx, gy });
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
  let cx = 0, cy = 0, a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x0, y0] = ring[j];
    const [x1, y1] = ring[i];
    const f = x0 * y1 - x1 * y0;
    a += f;
    cx += (x0 + x1) * f;
    cy += (y0 + y1) * f;
  }
  if (Math.abs(a) < 1e-12) {
    let mx = 0, my = 0;
    for (const p of ring) { mx += p[0]; my += p[1]; }
    return { lon: mx / ring.length, lat: my / ring.length };
  }
  a *= 3;
  return { lon: cx / a, lat: cy / a };
}
