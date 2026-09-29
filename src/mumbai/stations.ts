/**
 * The Western line, as literals.
 *
 * This is the single most valuable file in the world: locality comes from
 * ADJACENCY, not coordinates. Every sign, board and departure LED in the
 * station derives its text from these records and their order, which is why
 * the place reads as researched rather than invented. Nothing here is
 * scraped — it is a hand-maintained commit list, and the assert script
 * (`bun run check:stations`) fails if the order or the codes drift.
 *
 * Chainage is real distance south from Churchgate, in metres. The walkable
 * district is a slice of it centred on Charni Road, at true 1:1 scale.
 */

export interface Station {
  /** Western Railway station code, e.g. CCG. Unique across the line. */
  code: string;
  /** Devanagari name, as it appears on the fascia. */
  deva: string;
  /** Latin name, as it appears on the fascia and the platform boards. */
  latin: string;
  /** Real distance south from Churchgate, in metres. */
  chainage: number;
  /** True where local trains terminate (Churchgate is the southbound end). */
  terminus?: boolean;
  /**
   * Languages this station's boards carry. The Western line runs through
   * Gujarati-speaking Maharashtrian commuter territory, so Gujarati is
   * genuinely present on the line boards — a detail no map data yields.
   */
  scripts?: ('deva' | 'latin' | 'guj')[];
}

/**
 * South to north, the way the line actually runs. The district is centred on
 * Charni Road, but the neighbours either side are real and are what every
 * board in the scene points at.
 */
export const WESTERN_LINE: Station[] = [
  { code: 'CCG', deva: 'चर्चगेट', latin: 'Churchgate', chainage: 0, terminus: true, scripts: ['deva', 'latin', 'guj'] },
  { code: 'MEL', deva: 'मरीन लाइन्स', latin: 'Marine Lines', chainage: 1200, scripts: ['deva', 'latin', 'guj'] },
  { code: 'CYR', deva: 'चर्नी रोड', latin: 'Charni Road', chainage: 2500, scripts: ['deva', 'latin', 'guj'] },
  { code: 'GTR', deva: 'ग्रँट रोड', latin: 'Grant Road', chainage: 3700, scripts: ['deva', 'latin', 'guj'] },
  { code: 'MMCT', deva: 'मुंबई सेंट्रल', latin: 'Mumbai Central', chainage: 5000, scripts: ['deva', 'latin'] },
  { code: 'MX', deva: 'महालक्ष्मी', latin: 'Mahalaxmi', chainage: 6000, scripts: ['deva', 'latin', 'guj'] },
  { code: 'PL', deva: 'लोअर परेल', latin: 'Lower Parel', chainage: 9000, scripts: ['deva', 'latin'] },
  { code: 'DR', deva: 'दादर', latin: 'Dadar', chainage: 11000, scripts: ['deva', 'latin', 'guj'] },
];

/** The station the player spawns on and the district is built around. */
export const HOME = 'CYR';

const index = new Map<string, number>(
  WESTERN_LINE.map((s, i) => [s.code, i]),
);

export function stationAt(chainage: number): Station {
  let best = WESTERN_LINE[0];
  for (const s of WESTERN_LINE) {
    if (Math.abs(s.chainage - chainage) < Math.abs(best.chainage - chainage)) best = s;
  }
  return best;
}

export function next(code: string): Station | null {
  const i = index.get(code);
  return i === undefined || i + 1 >= WESTERN_LINE.length ? null : WESTERN_LINE[i + 1];
}

export function prev(code: string): Station | null {
  const i = index.get(code);
  return i === undefined || i - 1 < 0 ? null : WESTERN_LINE[i - 1];
}

/**
 * The terminus a train departing `code` is heading for. Platforms on the line
 * read this straight onto the departure LED, so the destination is always
 * derived — never hard-coded onto a sign.
 */
export function terminusFrom(code: string): Station | null {
  const i = index.get(code);
  if (i === undefined) return null;
  return i >= WESTERN_LINE.length / 2 ? WESTERN_LINE[0] : WESTERN_LINE[WESTERN_LINE.length - 1];
}

/** The three services shown on the departure board, derived from adjacency. */
export function departuresFrom(code: string, nowMinutes: number) {
  const n = next(code);
  const p = prev(code);
  const home = WESTERN_LINE[index.get(code)!];
  const south = terminusFrom(code)!;
  const clock = (m: number) => {
    const hh = Math.floor(m / 60) % 24;
    const mm = Math.floor(m % 60);
    return `${hh}.${String(mm).padStart(2, '0')}`;
  };
  return [
    { train: 1, dest: south.code === home.code ? home.latin : south.latin, time: clock(nowMinutes) },
    { train: 7, dest: (p ?? home).latin, time: clock(nowMinutes + 24) },
    { train: 9, dest: (n ?? home).latin, time: clock(nowMinutes + 38) },
  ];
}

/** Board text for a station in a given script. */
export function nameIn(station: Station, script: 'deva' | 'latin' | 'guj'): string {
  if (script === 'latin') return station.latin;
  // Gujarati shares most of its letterforms with Devanagari for these names;
  // the Western line boards commonly print the Latin alongside, so the
  // Gujarati pass falls back to the Devanagari form rather than inventing a
  // transliteration that might be wrong.
  return station.deva;
}

export const HOME_STATION = WESTERN_LINE[index.get(HOME)!];
