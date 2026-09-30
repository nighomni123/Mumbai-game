/**
 * Named real places in Greater Mumbai, as [lon, lat].
 *
 * One list, three consumers: the planet's destination pins, the dev harness's
 * `__geo.teleport('<place>')`, and the HUD's "nearest place" readout. When it
 * lived only inside preview.ts the dev harness had destinations the product
 * could not reach; that is the kind of drift that ends with two half-lists.
 *
 * The coordinates come from scripts/validation-sites.mjs, which is this
 * project's ground truth — 36 sites checked against the source the ingest
 * pipeline reads from. They are NOT hand-typed guesses. That matters: an
 * earlier version of this list carried `fort` at 72.8335, 19.0245, which is
 * the Bandra-Worli causeway in the Mahim creek about 10 km north of Fort. The
 * walker spawned on water there, and it was the coordinates that were wrong,
 * not the coastline. Anything invented here should be replaced with a
 * validated site before it is trusted.
 */

export interface Place {
  name: string;
  lon: number;
  lat: number;
  /** Region label shown next to the pin in planet view. */
  region: string;
}

export const PLACES: Place[] = [
  { name: "gateway", lon: 72.8347, lat: 18.922, region: "Colaba" },
  { name: "fort", lon: 72.8345, lat: 18.933, region: "Fort" },
  { name: "colaba", lon: 72.8245, lat: 18.9135, region: "Colaba Causeway" },
  { name: "churchgate", lon: 72.8253, lat: 18.9372, region: "Churchgate" },
  { name: "charni", lon: 72.8182, lat: 18.9518, region: "Grant Road" },
  { name: "marine", lon: 72.824, lat: 18.93, region: "Marine Drive" },
  { name: "parel", lon: 72.841, lat: 18.99, region: "Parel" },
  { name: "worli", lon: 72.834, lat: 19.026, region: "Worli" },
  { name: "dadar", lon: 72.8422, lat: 19.018, region: "Dadar" },
  { name: "wadala", lon: 72.856, lat: 19.018, region: "Wadala" },
  { name: "bandra", lon: 72.837, lat: 19.0546, region: "Bandra" },
  { name: "vile", lon: 72.8302, lat: 19.0596, region: "Bandra West" },
  { name: "santacruz", lon: 72.8416, lat: 19.081, region: "Santacruz" },
  { name: "khar", lon: 72.838, lat: 19.098, region: "Khar" },
  { name: "vileparle", lon: 72.8404, lat: 19.0979, region: "Vile Parle" },
  { name: "andheri", lon: 72.8464, lat: 19.1197, region: "Andheri" },
  { name: "juhu", lon: 72.8225, lat: 19.122, region: "Juhu" },
  { name: "jogeshwari", lon: 72.8505, lat: 19.1545, region: "Jogeshwari" },
  { name: "goregaon", lon: 72.845, lat: 19.166, region: "Goregaon" },
  { name: "malad", lon: 72.842, lat: 19.1865, region: "Malad" },
  { name: "kandivali", lon: 72.856, lat: 19.213, region: "Kandivali" },
  { name: "borivali", lon: 72.857, lat: 19.229, region: "Borivali" },
  { name: "dahisar", lon: 72.855, lat: 19.247, region: "Dahisar" },
  { name: "bkc", lon: 72.852, lat: 19.06, region: "Bandra Kurla Complex" },
  { name: "chembur", lon: 72.8995, lat: 19.0605, region: "Chembur" },
  { name: "ghatkopar", lon: 72.908, lat: 19.086, region: "Ghatkopar" },
  { name: "mulund", lon: 72.939, lat: 19.059, region: "Mulund" },
  { name: "powai", lon: 72.916, lat: 19.118, region: "Powai" },
  { name: "vikhroli", lon: 72.93, lat: 19.11, region: "Vikhroli" },
  { name: "kanjurmarg", lon: 72.9285, lat: 19.1295, region: "Kanjurmarg" },
  { name: "bhandup", lon: 72.937, lat: 19.1445, region: "Bhandup" },
  { name: "thane", lon: 72.97, lat: 19.188, region: "Thane" },
  { name: "vashi", lon: 72.997, lat: 19.077, region: "Vashi, Navi Mumbai" },
  {
    name: "belapur",
    lon: 73.0395,
    lat: 19.0205,
    region: "CBD Belapur, Navi Mumbai",
  },
];

export const PLACE_BY_NAME = new Map(PLACES.map((p) => [p.name, p]));

/**
 * The thirteen places worth naming on a 900-pixel globe.
 *
 * One list, two consumers: the planet's pins and the map's markers. It lived in
 * planet-rig.ts first and got copied into citymap.ts, which is exactly the drift
 * that produced two half-lists of coordinates earlier in this file's history.
 */
export const MAJOR_PLACES = new Set([
  "gateway",
  "fort",
  "marine",
  "worli",
  "dadar",
  "bandra",
  "juhu",
  "andheri",
  "borivali",
  "ghatkopar",
  "powai",
  "thane",
  "vashi",
]);
