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

/**
 * The area the city is built in — must equal scripts/geo.mjs ACTIVE_BOUNDS.
 *
 * A strict subset of METRO_BOUNDS. All of the metro is still ingested and the
 * map still draws it, but only this box is built and streamed. Decided
 * 2026-09-30; out of scope for now, for when the mainland is complete:
 *
 *   east of  19d12'27.8"N 72d59'36.5"E  (lon 72.9934722 -> x 12,148)
 *   north of              19.315608      (lat 19.315608  -> y 26,673)
 *   south of 18d53'26.7"N 72d48'42.6"E  (lat 18.8907500 -> y -20,622)
 *
 * That drops the eastern mainland and Navi Mumbai, the far north past Panvel,
 * and the Konkan hills south of the city. The west edge is METRO_BOUNDS.x0 —
 * nothing is cut there.
 */
export const ACTIVE_BOUNDS = { x0: -14730, x1: 12148, y0: -20622, y1: 26673 };


/**
 * THE DEVELOPMENT EXPLORE AREA — a second, smaller cut inside ACTIVE_BOUNDS.
 *
 * ACTIVE_BOUNDS says what the pipeline is ALLOWED to build. DEV_BOUNDS says
 * what you can currently WALK to, and it is deliberately much smaller so the
 * city does not have to be finished before any of it is playable.
 *
 * Decided 2026-09-30: bounded by Juhu to the north and Ghatkopar to the east.
 * That is Colaba, Fort, Kala Ghoda, Worli, Dadar, Parel, Bandra, Khar, Mahim and
 * Juhu itself. Chembur, Ghatkopar, Powai, Vikhroli, Bhandup, the airport and
 * everything north of Juhu is out of play for now.
 *
 * This is a SEPARATE constant on purpose. Shrinking ACTIVE_BOUNDS would also
 * stop the ingest skipping the excluded area, so a rebuild would pull down
 * chunks you cannot visit; and it would shrink the /map page, which should keep
 * showing the whole metro. The map stays whole, the data stays whole, and only
 * the explorable world is cut.
 *
 * MUST equal scripts/geo.mjs DEV_BOUNDS, like ACTIVE_BOUNDS does.
 */
export const DEV_BOUNDS = { x0: -14730, x1: 3156, y0: -20622, y1: 5500 };

/**
 * Whether a tile is inside the explore area.
 *
 * Separate from `tileInActive` on purpose: ACTIVE_BOUNDS decides what the
 * ingest is allowed to fetch, DEV_BOUNDS decides what you can walk to. They
 * will drift apart as more of the city opens, and collapsing them now would
 * mean re-plumbing the ingest and the map every time.
 */
export function tileInDev(gx: number, gy: number): boolean {
  const inBox = (x: number, y: number) =>
    x >= DEV_BOUNDS.x0 && x <= DEV_BOUNDS.x1 && y >= DEV_BOUNDS.y0 && y <= DEV_BOUNDS.y1;
  return inBox(gx * TILE_M, gy * TILE_M) || inBox(gx * TILE_M, (gy + 1) * TILE_M);
}

/** Whether a local-metre point is inside the build scope. */
export function inActive(x: number, y: number): boolean {
  return (
    x >= ACTIVE_BOUNDS.x0 &&
    x <= ACTIVE_BOUNDS.x1 &&
    y >= ACTIVE_BOUNDS.y0 &&
    y <= ACTIVE_BOUNDS.y1
  );
}

/** Whether a tile (gx,gy) touches the build scope at all. */
export function tileInActive(gx: number, gy: number): boolean {
  return (
    inActive(gx * TILE_M, gy * TILE_M) ||
    inActive(gx * TILE_M, (gy + 1) * TILE_M)
  );
}

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
