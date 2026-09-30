/**
 * Cut a small, committed starter slice out of the full built world.
 *
 * Why this exists: data/build/ is ~155 MB and git-ignored, so a fresh clone has
 * no city at all — the loaders fail soft, and you get an empty world that looks
 * like a bug in your own code rather than missing data. Regenerating the whole
 * metro is a long network ingest, which is the wrong price for "let me see it
 * run".
 *
 * So the repo carries the ground around Fort — the densest, most characterful
 * part of the city, and where the walker actually starts (walker.ts picks the
 * "fort" local). ~4 MB, and `git clone && bun install && bun run dev` shows a
 * real Mumbai immediately. The full metro is one command away: `bun run setup`.
 *
 * Everything else stays out of git, which is also the route OSM's guidance
 * prefers: commit the means of creating a Derivative Database rather than the
 * baked thing. This slice is the narrow exception, and it is small enough to be
 * obviously not a data dump.
 *
 * Plain uncompressed JSON, deliberately: the loader then has exactly ONE code
 * path whether or not data/build/ exists. Gzipping would save ~3 MB and cost a
 * DecompressionStream branch plus a second format to keep in sync.
 *
 * Run: node scripts/make-starter.mjs [--radius N] [--force]
 */

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
  copyFileSync,
} from "node:fs";
import { join } from "node:path";
import { toLocal, tileOf, TILE_M } from "./geo.mjs";

const IN = "data/build";
const OUT = "data/starter";

/** The walker's starting local (src/geo/places.ts) — keep these in step. */
const CENTRE = { name: "Fort", lon: 72.8345, lat: 18.933 };

/** Layers the world fetches at runtime that are NOT per-tile. */
const LAYERS = ["landmask.json", "citymap.json", "water.json"];

const ATTRIBUTION = "© OpenStreetMap contributors";
const LICENSE = "ODbL 1.0";
const LICENSE_URL = "https://opendatacommons.org/licenses/odbl/1-0/";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? fallback : process.argv[i + 1];
};

function main() {
  const radius = parseInt(arg("--radius", "2"), 10);
  const force = process.argv.includes("--force");

  if (!existsSync(join(IN, "chunks"))) {
    console.error(
      `no built world at ${IN}/chunks — run: node scripts/ingest-mumbai.mjs && node scripts/enrich-chunks.mjs`,
    );
    process.exit(1);
  }

  const { x, y } = toLocal(CENTRE.lon, CENTRE.lat);
  const { gx, gy } = tileOf(x, y);

  const wanted = [];
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      wanted.push([gx + dx, gy + dy]);
    }
  }

  const chunkDir = join(OUT, "chunks");
  if (force && existsSync(OUT)) rmSync(OUT, { recursive: true });
  mkdirSync(chunkDir, { recursive: true });

  const copied = [];
  let bytes = 0;
  for (const [cx, cy] of wanted) {
    const name = `chunk_${cx}_${cy}.json`;
    const src = join(IN, "chunks", name);
    if (!existsSync(src)) continue; // sparse tile — nothing to copy
    copyFileSync(src, join(chunkDir, name));
    bytes += readFileSync(src).length;
    copied.push([cx, cy]);
  }

  const layers = [];
  for (const name of LAYERS) {
    const src = join(IN, name);
    if (!existsSync(src)) {
      console.warn(`skip ${name} — not built yet`);
      continue;
    }
    copyFileSync(src, join(OUT, name));
    bytes += readFileSync(src).length;
    layers.push(name);
  }

  writeManifest(copied, layers, radius, { gx, gy });

  console.log(
    `starter slice written to ${OUT}/ — ${copied.length} chunks around ${CENTRE.name} (r=${radius}), ` +
      `${(bytes / 1048576).toFixed(1)} MB, ${layers.length} layers`,
  );
}

/**
 * The provenance record that travels with the data. ODbL wants the credit
 * "within the data or metadata" rather than only in an app UI, and this file is
 * the metadata for the slice.
 */
function writeManifest(copied, layers, radius, centreTile) {
  const built = existsSync(join(IN, "manifest.json"))
    ? JSON.parse(readFileSync(join(IN, "manifest.json"), "utf8")).builtAt
    : null;

  writeFileSync(
    join(OUT, "manifest.json"),
    JSON.stringify(
      {
        what: "Starter slice of the Greater Mumbai world — Fort and its surroundings.",
        why: "A fresh clone has no data/build/ (git-ignored, ~155 MB). This slice makes `bun run dev` show a real city immediately; `bun run setup` regenerates the full metro.",
        attribution: ATTRIBUTION,
        license: LICENSE,
        licenseUrl: LICENSE_URL,
        derivedFromBuiltAt: built,
        generatedBy: "scripts/make-starter.mjs",
        centre: CENTRE,
        centreTile,
        radiusTiles: radius,
        tileM: TILE_M,
        chunks: copied.map(([cx, cy]) => `chunk_${cx}_${cy}.json`),
        layers,
      },
      null,
      2,
    ),
  );

  writeFileSync(
    join(OUT, "LICENCE"),
    `${ATTRIBUTION}

The files in this directory are a Derivative Database of data from
OpenStreetMap, made by scripts/make-starter.mjs out of scripts/ingest-mumbai.mjs.

    This data is (c) OpenStreetMap contributors, available under the
    Open Database License (ODbL) v1.0: ${LICENSE_URL}

Where the chunk geometry came from, and how it was transformed:

  Source      Mumbai_WFL1 (Buildings / Streets FeatureServer), an OSM-derived
              dataset, plus natural=coastline and natural=water from the
              OpenStreetMap editing API.
  Transformed Tiles de-duplicated by centroid ownership, heights estimated by
              a documented per-class rule (NOT measured — height_source is
              "estimated" with confidence capped at 0.45), WGS84 rings
              projected to a local metric frame and quantised to centimetres.

The renderer and application code in src/ is NOT covered by the ODbL. It is a
Produced Work and is licensed separately; the share-alike attaches to this
data, never to the app.

Regenerate this directory with:  node scripts/make-starter.mjs --force
Regenerate the data behind it with: bun run setup
`,
  );
}

main();