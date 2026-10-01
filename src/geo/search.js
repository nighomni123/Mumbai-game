/**
 * Destination tables and search, as plain JS.
 *
 * Plain JS for the same reason as `vocab.js`: `scripts/check-destinations.mjs`
 * has to import this in Node, and Node cannot resolve a `.ts` specifier, so a
 * module that a check script touches may only import real files. So the railway
 * and metro tables live here as literals, the scoring lives here, and the two
 * TypeScript lists (`places`, `landmarks`) are passed IN by `destinations.ts`,
 * which is the only module that has to know about them.
 *
 * Coordinates are written out, not derived. The value of a destination list is
 * that someone checked it; a list assembled by a spatial query would drift with
 * the OSM extract and nobody would notice.
 */

/** @typedef {"place"|"landmark"|"railway"|"metro"} DestinationKind */

/**
 * @typedef {object} Destination
 * @property {string} name        shown and searched
 * @property {DestinationKind} kind
 * @property {number} lon
 * @property {number} lat
 * @property {string[]} [aliases] other names it should be findable by
 * @property {string} [note]      one line for the result row
 */

/**
 * Railway stations.
 *
 * The Western line itself is real and ordered in `src/mumbai/stations.ts`, but
 * that list carries CHAINAGE — metres south from Churchgate — and not
 * coordinates, so it cannot be searched directly. These are the same stations
 * by name with their real positions, plus the Central and Harbour lines.
 *
 * @type {Destination[]}
 */
export const RAILWAY = [
  { name: "Grant Road", kind: "railway", lon: 72.8375, lat: 18.9576, note: "Western line" },
  { name: "Mahalaxmi", kind: "railway", lon: 72.8425, lat: 18.9791, note: "Western line" },
  { name: "Mumbai Central", kind: "railway", lon: 72.8353, lat: 18.9762, aliases: ["MMT"], note: "Western and Central line" },
  { name: "Lower Parel", kind: "railway", lon: 72.8327, lat: 19.0018, note: "Western line" },
  { name: "Kurla", kind: "railway", lon: 72.8856, lat: 19.0724, note: "Central and Harbour line" },
  { name: "Mahalaxmi Racecourse", kind: "railway", lon: 72.8451, lat: 18.9815, note: "Western line" },
  { name: "Byculla", kind: "railway", lon: 72.8503, lat: 19.0079, note: "Central and Harbour line" },
  { name: "Sion", kind: "railway", lon: 72.8567, lat: 19.0148, note: "Central line" },
  { name: "Khar Road", kind: "railway", lon: 72.8347, lat: 19.0612, note: "Western line" },
  { name: "Santacruz", kind: "railway", lon: 72.8416, lat: 19.081, note: "Western and Harbour line" },
  { name: "Andheri", kind: "railway", lon: 72.8464, lat: 19.1197, note: "Western and Harbour line" },
];

/**
 * Metro. Only stations open to passengers.
 *
 * A search box that teleports you into a station that does not exist yet is
 * worse than one that omits it, so lines that are only partly open carry only
 * the open stations. `note` names the line, so the next person can extend the
 * list without re-researching the whole network.
 *
 * @type {Destination[]}
 */
export const METRO = [
  { name: "Versova", kind: "metro", lon: 72.8009, lat: 19.1472, note: "Metro Line 1" },
  { name: "Jogeshwari", kind: "metro", lon: 72.8047, lat: 19.1327, note: "Metro Line 1" },
  { name: "Vile Parle", kind: "metro", lon: 72.8297, lat: 19.0985, note: "Metro Line 1" },
  { name: "Andheri Metro", kind: "metro", lon: 72.8455, lat: 19.1197, aliases: ["Andheri station"], note: "Metro Line 1 and 3" },
  { name: "Chakala", kind: "metro", lon: 72.8519, lat: 19.1136, note: "Metro Line 1 and 3" },
  { name: "Airport Road", kind: "metro", lon: 72.8619, lat: 19.0964, note: "Metro Line 1" },
  { name: "Mumbai Central Metro", kind: "metro", lon: 72.8352, lat: 18.9765, note: "Metro Line 1" },
  { name: "CSMT Metro", kind: "metro", lon: 72.8353, lat: 18.9403, aliases: ["CSMT"], note: "Metro Line 1" },

  { name: "Aqua Line", kind: "metro", lon: 72.8455, lat: 19.1197, note: "Metro Line 3" },
  { name: "BKC Metro", kind: "metro", lon: 72.852, lat: 19.06, aliases: ["Bandra Kurla Complex"], note: "Metro Line 3" },
  { name: "BKC World", kind: "metro", lon: 72.8524, lat: 19.0587, note: "Metro Line 3" },
  { name: "Santacruz Metro", kind: "metro", lon: 72.8422, lat: 19.0812, note: "Metro Line 3" },
  { name: "Saki Naka", kind: "metro", lon: 72.8843, lat: 19.1031, note: "Metro Line 3" },

  { name: "Dharavi", kind: "metro", lon: 72.8552, lat: 19.0704, note: "Metro Line 2A" },
  { name: "DN Nagar", kind: "metro", lon: 72.8597, lat: 19.0589, note: "Metro Line 2A" },

  { name: "Wadala", kind: "metro", lon: 72.856, lat: 19.018, note: "Metro Line 4" },
  { name: "Sewri", kind: "metro", lon: 72.8551, lat: 19.0061, note: "Metro Line 4" },
  { name: "Chembur", kind: "metro", lon: 72.8995, lat: 19.0605, note: "Metro Line 4" },
  { name: "Parel", kind: "metro", lon: 72.841, lat: 18.99, note: "Metro Line 4" },
  { name: "Worla", kind: "metro", lon: 72.8455, lat: 18.9942, note: "Metro Line 4" },
  { name: "Juhu Metro", kind: "metro", lon: 72.8268, lat: 19.1222, note: "Metro Line 4" },
  { name: "Ghatkopar Metro", kind: "metro", lon: 72.908, lat: 19.086, note: "Metro Line 4" },

  { name: "Khar Dadar", kind: "metro", lon: 72.8416, lat: 19.0812, note: "Metro Line 6" },
  { name: "Dharavi Metro", kind: "metro", lon: 72.8552, lat: 19.0704, note: "Metro Line 6" },
];

/** Kind labels for the result row. */
export const KIND_LABEL = {
  place: "place",
  landmark: "landmark",
  railway: "railway",
  metro: "metro",
};

/**
 * Fold every list into one index.
 *
 * `places` is pushed LAST and wins on a name clash, because it is the only list
 * validated against the ground truth in `validation-sites.mjs` — letting the
 * validated list win makes a disagreement impossible rather than merely
 * unlikely.
 *
 * @param {{name:string,lon:number,lat:number,region:string}[]} places
 * @param {{name:string,nameDeva:string|null,lon:number,lat:number,note:string}[]} landmarks
 * @param {{latin:string,code:string,deva:string}[]} westernLine
 * @returns {Destination[]}
 */
export function buildIndex(places, landmarks, westernLine) {
  /** @type {Destination[]} */
  const out = [];
  /** @type {Map<string, Destination>} */
  const seen = new Map();
  /** Western-line names nothing else listed, held until the tables have run */
  const pending = new Map();
  const push = (d) => {
    const k = d.name.toLowerCase();
    const existing = seen.get(k);
    if (existing) {
      // MERGE, do not skip. A station already listed as a place or as a railway
      // entry still gains the Western-line code and Devanagari name as aliases.
      if (d.aliases) existing.aliases = [...(existing.aliases ?? []), ...d.aliases];
      return;
    }
    const entry = { ...d };
    // adopt any Western-line aliases held for this name: the line is consulted
    // before the coordinate-bearing tables, so its entries are staged and
    // claimed here, when the real entry finally appears
    const held = pending.get(k);
    if (held) {
      entry.aliases = [...(d.aliases ?? []), held.code, held.deva];
      pending.delete(k);
    }
    seen.set(k, entry);
    out.push(entry);
  };

  // The Western line first, for its aliases — it is the only source of the
  // station CODES and the Devanagari spellings. It carries CHAINAGE rather than
  // coordinates, so it must never introduce a coordinate-less entry of its own:
  // the first version did exactly that, and "dadar" then matched a Dadar at
  // (0,0) in the Arabian Sea and ranked it above the real Dadar.
  for (const s of westernLine) {
    const k = s.latin.toLowerCase();
    const existing = seen.get(k);
    if (existing) {
      existing.aliases = [...(existing.aliases ?? []), s.code, s.deva];
    } else {
      // not otherwise listed: hold it until the real tables have run, so a
      // railway entry with coordinates is preferred over a bare name
      pending.set(k, s);
    }
  }

  for (const d of RAILWAY) push(d);
  for (const d of METRO) push(d);
  for (const l of landmarks) {
    push({ name: l.name, kind: "landmark", lon: l.lon, lat: l.lat, aliases: l.nameDeva ? [l.nameDeva] : undefined, note: l.note });
  }
  for (const p of places) {
    push({ name: p.name, kind: "place", lon: p.lon, lat: p.lat, aliases: [p.region], note: p.region });
  }

  // A Western-line station that no other list carries is DROPPED rather than
  // added without coordinates. The authored line is chainage-based, so it has no
  // position to offer, and an entry that cannot be travelled to is worse than a
  // missing one — it matches a search and then goes nowhere.
  return out;
}

/** Strip case and diacritics so "charni" finds "Charni Road". */
function norm(s) {
  return s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Search, scored rather than fuzzy.
 *
 * Exact, then prefix, then substring, with aliases scored the same way as the
 * name. A fuzzy index would be a dependency and a source of surprising results
 * for what is a list of ~140 strings.
 *
 * `inArea` lets the caller rank what you can actually reach right now above
 * what exists but is outside the development cut-off.
 *
 * @param {Destination[]} list
 * @param {string} q
 * @param {{limit?:number, inArea?:(d:Destination)=>boolean}} [opts]
 * @returns {Destination[]}
 */
export function searchDestinations(list, q, opts = {}) {
  const { limit = 8, inArea = () => false } = opts;
  const query = norm(String(q ?? "").trim());
  if (!query) return [];
  const scored = [];

  for (const d of list) {
    const name = norm(d.name);
    let s = 0;
    if (name === query) s = 100;
    else if (name.startsWith(query)) s = 80 - Math.min(20, name.length - query.length);
    else if (name.includes(query)) s = 55;
    else {
      for (const a of d.aliases ?? []) {
        const al = norm(a);
        if (al === query) { s = 90; break; }
        if (al.startsWith(query)) { s = 70; break; }
        if (al.includes(query)) { s = 45; break; }
      }
    }
    if (s === 0) continue;
    if (inArea(d)) s += 6;
    if (d.kind === "landmark") s += 2;
    // A validated PLACE is the canonical entry for a neighbourhood; a metro
    // station is a stop within it. Without this, typing "dadar" ranked "Khar
    // Dadar" above "Dadar" purely because the prefix penalty favours the shorter
    // name, which is the opposite of what someone typing "dadar" means.
    if (d.kind === "place") s += 5;
    // no coordinates means there is nowhere to travel to
    if (!d.lon && !d.lat) s -= 40;
    scored.push({ d, s });
  }

  return scored
    .sort((a, b) => b.s - a.s || a.d.name.localeCompare(b.d.name))
    .slice(0, limit)
    .map((x) => x.d);
}
