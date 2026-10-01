/**
 * The destination index, bound to this project's real place lists.
 *
 * The data and the search live in `search.js` because a Node check script
 * has to import them and Node cannot resolve a `.ts` specifier. This module is
 * the only one that knows about `places.ts` and `landmarks.ts`, and its whole
 * job is to fold them in and re-bind the search to the real index.
 */

import { buildIndex, searchDestinations as search, KIND_LABEL } from "./search.js";
import { PLACES } from "./places.js";
import { LANDMARKS } from "./landmarks.js";
import { WESTERN_LINE } from "../mumbai/stations.js";
import { toLocal, DEV_BOUNDS } from "./geo-constants.js";

export type DestinationKind = "place" | "landmark" | "railway" | "metro";

export interface Destination {
  name: string;
  kind: DestinationKind;
  lon: number;
  lat: number;
  aliases?: string[];
  note?: string;
}

export const DESTINATIONS: Destination[] = buildIndex(
  PLACES,
  LANDMARKS,
  WESTERN_LINE,
) as Destination[];

/** Local-metre position, or null when the entry has no usable coordinates. */
export function destinationLocal(
  d: Destination,
): { x: number; y: number } | null {
  if (!d.lon && !d.lat) return null;
  return toLocal(d.lon, d.lat);
}

/**
 * True when the destination is inside the area you can currently walk to.
 *
 * Entries outside it are still searchable and still shown — the map and the
 * data are whole — but they rank below anything you can actually go to, and the
 * UI marks them. Hiding them would make the search look broken while the
 * development cut-off is in place.
 */
export function inDevArea(d: Destination): boolean {
  const p = destinationLocal(d);
  if (!p) return false;
  const b = DEV_BOUNDS;
  return p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1;
}

/** Search the real index, ranking what is reachable right now first. */
export function searchDestinations(q: string, limit = 8): Destination[] {
  return search(DESTINATIONS, q, { limit, inArea: inDevArea }) as Destination[];
}

export { KIND_LABEL };
