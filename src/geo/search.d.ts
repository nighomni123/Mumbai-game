export type DestinationKind = "place" | "landmark" | "railway" | "metro";
export interface Destination {
  name: string;
  kind: DestinationKind;
  lon: number;
  lat: number;
  aliases?: string[];
  note?: string;
}
export const RAILWAY: Destination[];
export const METRO: Destination[];
export const KIND_LABEL: Record<DestinationKind, string>;
export function buildIndex(
  places: { name: string; lon: number; lat: number; region: string }[],
  landmarks: { name: string; nameDeva: string | null; lon: number; lat: number; note: string }[],
  westernLine: { latin: string; code: string; deva: string }[],
): Destination[];
export function searchDestinations(
  list: Destination[],
  q: string,
  opts?: { limit?: number; inArea?: (d: Destination) => boolean },
): Destination[];
