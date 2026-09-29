/**
 * Shared geo constants for the RENDER side.
 *
 * These MUST match scripts/geo.mjs exactly — the ingest projects to this same
 * local metric frame, so the renderer reads chunk coordinates directly with no
 * further conversion. If ORIGIN or TILE_M drift apart from the script, every
 * building lands in the wrong place. Keep them in sync (the ingest writes its
 * manifest with the same values; scripts/check-geo.mjs asserts they match).
 */

/** Metro origin (central Greater Mumbai) — must equal scripts/geo.mjs ORIGIN. */
export const ORIGIN = { lon: 72.878, lat: 19.076 };

const DEG = Math.PI / 180;
const M_PER_DEG_LAT = 111320;
/** metres per degree of longitude at the origin latitude */
export const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos(ORIGIN.lat * DEG);

/** Chunk/tile size in metres — must equal scripts/geo.mjs TILE_M. */
export const TILE_M = 2000;

/** Metro bounds in local metres — must equal scripts/geo.mjs METRO_BOUNDS. */
export const METRO_BOUNDS = { x0: -14730, x1: 52394, y0: -33504, y1: 48198 };

/** @returns {{gx:number, gy:number}} the tile containing a local-metre point */
export function tileOf(x: number, y: number) {
  return { gx: Math.floor(x / TILE_M), gy: Math.floor(y / TILE_M) };
}

/** WGS84 (lon, lat) -> local metric (x, y) metres. */
export function toLocal(lon: number, lat: number) {
  return {
    x: (lon - ORIGIN.lon) * M_PER_DEG_LON,
    y: (lat - ORIGIN.lat) * M_PER_DEG_LAT,
  };
}

/** Local metric (x, y) metres -> WGS84 (lon, lat). */
export function toWgs84(x: number, y: number) {
  return {
    lon: ORIGIN.lon + x / M_PER_DEG_LON,
    lat: ORIGIN.lat + y / M_PER_DEG_LAT,
  };
}
