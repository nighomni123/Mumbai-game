/**
 * Gate on the destination search index.
 *
 * The failure modes here are quiet. A duplicated name silently drops a station
 * from the list. A coordinate outside Greater Mumbai puts a search result in the
 * sea. A scoring change makes "charni" return nothing and the search box looks
 * broken with nothing in the console to say why. None of that fails `tsc`.
 *
 * This checks the parts that can break — the tables and the scoring, both in
 * `src/geo/search.js` — with the REAL railway and metro tables rather than
 * fixtures, because the tables are the part someone hand-wrote and got wrong.
 *
 * The binding in `destinations.ts` to `places.ts` / `landmarks.ts` is three
 * imports that `tsc` already checks, and the assembled index is verified in a
 * browser by the HUD itself.
 *
 * Run: node scripts/check-destinations.mjs
 */

import { RAILWAY, METRO, buildIndex, searchDestinations } from "../src/geo/search.js";
import { DEV_BOUNDS } from "./geo.mjs";

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${detail ? " — " + detail : ""}`);
};

/* the fixtures stand in for places.ts and landmarks.ts, which Node cannot
   import; the tables under test are the real ones */
// The fixture mirrors the real shape of places.ts: stations that are BOTH a
// neighbourhood and a stop appear as a place, which is how the Western-line
// code and Devanagari aliases get merged onto a coordinate-bearing entry.
const PLACES = [
  { name: "fort", lon: 72.8345, lat: 18.933, region: "Fort" },
  { name: "churchgate", lon: 72.8253, lat: 18.9372, region: "Churchgate" },
  { name: "dadar", lon: 72.8422, lat: 19.018, region: "Dadar" },
  { name: "charni", lon: 72.8182, lat: 18.9518, region: "Grant Road" },
  { name: "juhu", lon: 72.8225, lat: 19.1213, region: "Juhu" },
  { name: "ghatkopar", lon: 72.908, lat: 19.086, region: "Ghatkopar" },
];
const LANDMARKS = [
  { name: "Gateway of India", nameDeva: "गेटवे ऑफ इंडिया", lon: 72.8347, lat: 18.922, note: "Basalt monument" },
  { name: "Taj Mahal Palace Hotel", nameDeva: null, lon: 72.8322, lat: 18.9214, note: "Hotel" },
];
const WESTERN = [
  { latin: "Churchgate", code: "CCG", deva: "चर्चगेट" },
  { latin: "Dadar", code: "DR", deva: "दादर" },
];

const index = buildIndex(PLACES, LANDMARKS, WESTERN);

/* 1. shape ------------------------------------------------------------------ */
ok(`index assembles (${index.length} entries)`, index.length > 0);

/* 2. no duplicate names — a dup silently drops a destination ---------------- */
const names = index.map((d) => d.name.toLowerCase());
const dupes = names.filter((n, i) => names.indexOf(n) !== i);
ok("no duplicate names", dupes.length === 0, [...new Set(dupes)].join(", "));

/* 3. every entry that claims to be a station has a real position ------------- */
const needCoords = index.filter((d) => d.kind === "metro" || d.kind === "landmark" || d.kind === "place");
const noCoord = needCoords.filter((d) => !d.lon || !d.lat);
ok(
  "every metro, landmark and place has coordinates",
  noCoord.length === 0,
  noCoord.map((d) => d.name).join(", "),
);
const wc = RAILWAY.concat(METRO).filter((d) => !d.lon || !d.lat);
ok("every railway and metro table entry has coordinates", wc.length === 0, wc.map((d) => d.name).join(", "));

/* 4. coordinates are inside Greater Mumbai and in a plausible box ----------- */
const OFFSHORE = index.filter(
  (d) => d.lon && (d.lon < 72.70 || d.lon > 73.10 || d.lat < 18.85 || d.lat > 19.32),
);
ok("no entry lands outside Greater Mumbai", OFFSHORE.length === 0, OFFSHORE.map((d) => `${d.name} ${d.lon},${d.lat}`).join("; "));

/* 5. the tables are worth having ------------------------------------------ */
ok("the railway table is populated", RAILWAY.length >= 8, `${RAILWAY.length} stations`);
ok("the metro table is populated", METRO.length >= 15, `${METRO.length} stations`);
ok(
  "every metro entry names its line",
  METRO.every((d) => /Line \d/.test(d.note ?? "")),
  METRO.filter((d) => !/Line \d/.test(d.note ?? "")).map((d) => d.name).join(", "),
);

/* 6. search actually finds the things it must ------------------------------- */
const finds = (q) => searchDestinations(index, q, { limit: 5 }).map((d) => d.name);
const CASES = [
  ["gateway", /Gateway of India/],
  ["taj", /Taj Mahal Palace/],
  ["charni", /charni/i],
  ["CSMT", /CSMT/],
  ["ccg", /churchgate/i], // Western-line code, merged as an alias
  ["mumbai central", /Mumbai Central/],
  ["bkc", /BKC|Bandra Kurla/],
  ["चर", /churchgate/i], // Devanagari alias from the Western line (चर्चगेट)
];
// "dadar" must resolve to the PLACE, not to "Khar Dadar" — a shorter name used
// to win the prefix penalty and point at a station inside a different suburb.
ok(
  'search "dadar" ranks the Dadar place first',
  finds("dadar")[0] === "dadar",
  finds("dadar").join(", "),
);
ok(
  "every entry can actually be travelled to",
  index.every((d) => d.lon || d.lat),
  index.filter((d) => !d.lon && !d.lat).map((d) => d.name).join(", "),
);
for (const [q, re] of CASES) {
  const got = finds(q);
  ok(`search "${q}" finds ${re}`, got.some((n) => re.test(n)), got.join(", ") || "(nothing)");
}

/* 7. search is total — never throws on odd input --------------------------- */
for (const q of ["", "   ", "!!!", "zzzzzz", "0", "\u0000"]) {
  let threw = false;
  try {
    searchDestinations(index, q, { limit: 3 });
  } catch {
    threw = true;
  }
  ok(`search survives ${JSON.stringify(q)}`, !threw);
}
ok("an empty query returns nothing", searchDestinations(index, "  ", { limit: 3 }).length === 0);
ok("a non-matching query returns nothing", searchDestinations(index, "qqqqzzz", { limit: 3 }).length === 0);

/* 8. the reachability ranking is what it claims --------------------------- */
const local = (name) => index.find((d) => d.name === name);
const jp = local("Juhu Metro");
const gk = local("Ghatkopar Metro");
// Both are real coordinates. Juhu is the northern edge and must be IN, or the
// cut bisects the precinct; Ghatkopar is the eastern edge and must be OUT.
ok("Juhu Metro is inside DEV_BOUNDS (the northern edge is not bisected)", inDev(jp));
ok("Ghatkopar Metro is outside DEV_BOUNDS (the eastern cut works)", !inDev(gk));

function inDev(d) {
  if (!d?.lon) return false;
  const x = (d.lon - 72.878) * 105206.96;
  const y = (d.lat - 19.076) * 111320;
  return x >= DEV_BOUNDS.x0 && x <= DEV_BOUNDS.x1 && y >= DEV_BOUNDS.y0 && y <= DEV_BOUNDS.y1;
}

if (failures) {
  console.error(`\ndestination check FAILED (${failures}) — the search box would be wrong.`);
  process.exit(1);
}
console.log(`\nok  destinations verified: ${index.length} searchable, tables sane, search total.`);
