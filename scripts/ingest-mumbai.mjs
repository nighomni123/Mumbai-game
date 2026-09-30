/**
 * Ingest Greater Mumbai from the public Mumbai_WFL1 ArcGIS FeatureServer
 * (OSM-derived, no token required) into a local, tile-partitioned store.
 *
 * The MCGM feature service (MCGMGIS_Departments_Master_All_Layers) that was
 * the intended primary source returns 499 "Token Required" on every query and
 * is therefore NOT ingestible without credentials. Mumbai_WFL1 is the public
 * substitute: 263,494 building polygons, OSM ids and building types, plus a
 * 226k-feature street network. It is OSM-derived, which matters for
 * provenance and for the ODbL obligations already documented in AGENTS.md.
 *
 * Everything is stored per tile in WGS84 with a source tag. Heights are NOT
 * invented here — Mumbai_WFL1 carries no height/floors. Height resolution is
 * the enrich stage's job (Overture -> Google/Microsoft footprints -> a
 * documented procedural rule), and every resolved height records its source.
 *
 * Run:  node scripts/ingest-mumbai.mjs [--tiles 0,0,1,1] [--layers buildings,streets,points]
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  toLocal,
  allTiles,
  tileBounds,
  TILE_M,
  METRO_BOUNDS,
  ringAreaM2,
  centroid,
} from "./geo.mjs";

const BASE =
  "https://services7.arcgis.com/8phUg7DrlXpKgLyA/ArcGIS/rest/services/Mumbai_WFL1/FeatureServer";
const LAYERS = { buildings: 2, streets: 1, points: 0 };
const OUT = "data/build";
const PAGE = 2000; // server maxRecordCount

const args = process.argv.slice(2);
const argVal = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};

async function getJSON(url) {
  return fetchWithRetry(url);
}

/** Query one layer for one envelope, paging by resultOffset. */
async function queryTile(layerId, x0, y0, x1, y1, outFields) {
  // convert local tile bounds back to a lon/lat envelope for the API
  const M_LON = 111320 * Math.cos((19.076 * Math.PI) / 180);
  const env = [
    72.878 + x0 / M_LON,
    19.076 + y0 / 111320,
    72.878 + x1 / M_LON,
    19.076 + y1 / 111320,
  ];
  const feats = [];
  let offset = 0;
  for (;;) {
    const params = new URLSearchParams({
      geometry: env.join(","),
      geometryType: "esriGeometryEnvelope",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      outFields: outFields.join(","),
      outSR: "4326",
      f: "json",
      resultOffset: String(offset),
      resultRecordCount: String(PAGE),
      returnGeometry: "true",
    });
    const data = await getJSON(`${BASE}/${layerId}/query?${params}`);
    if (data.error) throw new Error(JSON.stringify(data.error));
    const batch = data.features || [];
    feats.push(...batch);
    // ESRI signals "there may be more" with exceededTransferLimit. When the
    // page comes back short, we are done regardless of the flag.
    if (batch.length < PAGE) break;
    if (!data.exceededTransferLimit) break;
    offset += PAGE;
    if (offset > 2_000_000) break; // runaway guard
  }
  return feats;
}

/** ESRI rings -> GeoJSON polygon coordinate arrays. */
function esriToGeoJSON(geom) {
  if (!geom) return null;
  // geom.rings is ALREADY [outerRing, hole1, hole2, ...] where each ring is an
  // array of [x,y] pairs. Do NOT wrap it again — that turns poly[0] into the
  // array-of-rings and the area/centroid maths sees undefined coordinates.
  if (geom.rings) return geom.rings;
  if (geom.paths) return geom.paths; // polyline
  if (geom.x !== undefined) return [[geom.x, geom.y]]; // point
  return null;
}

async function fetchWithRetry(url, tries = 4) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.status === 429 || res.status >= 500) {
        await sleep(500 * Math.pow(2, i)); // polite backoff
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      await sleep(300 * Math.pow(2, i));
    }
  }
  throw lastErr || new Error("fetch failed");
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Build one tile's records. Returns { rec, outObj }. */
async function buildTile(t, wantLayers, fields) {
  const b = tileBounds(t);
  const key = `${t.gx},${t.gy}`;
  const rec = { key, bounds: b, buildings: 0, streets: 0, points: 0 };
  const outObj = { buildings: [], streets: [], points: [] };

  if (wantLayers.includes("buildings")) {
    const feats = await queryTile(
      LAYERS.buildings,
      b.x0,
      b.y0,
      b.x1,
      b.y1,
      fields.buildings,
    );
    for (const f of feats) {
      const poly = esriToGeoJSON(f.geometry);
      if (!poly) continue;
      const ring = poly[0];
      const area = ringAreaM2(ring);
      const c = centroid(ring);
      outObj.buildings.push({
        id: f.attributes.osm_id || `a${f.attributes.OBJECTID}`,
        src: "mumbai_wfl1",
        name: f.attributes.name || null,
        type: f.attributes.type || f.attributes.fclass || null,
        district: f.attributes.districtname || null,
        subdistrict: f.attributes.subdistrictname || null,
        poly, // WGS84 rings, preserved verbatim
        centroid: [c.lon, c.lat],
        area_m2: Math.round(area),
        height_m: null, // resolved in enrich stage
        floors: null,
        usage: f.attributes.type || null,
        confidence: 1.0,
        source_priority: 2, // below BMC(1), above bare OSM(4)
      });
    }
    rec.buildings = outObj.buildings.length;
  }

  if (wantLayers.includes("streets")) {
    const feats = await queryTile(
      LAYERS.streets,
      b.x0,
      b.y0,
      b.x1,
      b.y1,
      fields.streets,
    );
    for (const f of feats) {
      const paths = esriToGeoJSON(f.geometry);
      if (!paths) continue;
      outObj.streets.push({
        id: `s${f.attributes.OBJECTID}`,
        src: "mumbai_wfl1_streets",
        name: f.attributes.FULL_STREET_NAME || null,
        street_type: f.attributes.STREET_TYPE || null,
        hierarchy: f.attributes.HIERARCHY ?? null,
        road_class: f.attributes.ROAD_CLASS ?? null,
        length_m: Math.round(f.attributes.Shape__Length || 0),
        paths, // WGS84 polylines
      });
    }
    rec.streets = outObj.streets.length;
  }

  if (wantLayers.includes("points")) {
    const feats = await queryTile(
      LAYERS.points,
      b.x0,
      b.y0,
      b.x1,
      b.y1,
      fields.points,
    );
    for (const f of feats) {
      const p = esriToGeoJSON(f.geometry);
      if (!p) continue;
      outObj.points.push({
        id: `p${f.attributes.OBJECTID}`,
        src: "mumbai_wfl1_points",
        osm_id: f.attributes.osm_id || null,
        point: p[0],
      });
    }
    rec.points = outObj.points.length;
  }
  return { rec, outObj };
}

async function main() {
  const wantLayers = (argVal("--layers") || "buildings,streets,points").split(
    ",",
  );
  const tileFilter = argVal("--tiles")
    ? new Set(
        argVal("--tiles")
          .split(";")
          .map((s) => s.trim())
          .filter(Boolean),
      )
    : null;
  const workers = parseInt(argVal("--concurrency") || "6", 10);
  const force = args.includes("--force");

  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

  const fields = {
    buildings: [
      "OBJECTID",
      "osm_id",
      "type",
      "fclass",
      "name",
      "districtname",
      "subdistrictname",
      "Shape__Area",
    ],
    streets: [
      "OBJECTID",
      "FULL_STREET_NAME",
      "STREET_TYPE",
      "HIERARCHY",
      "ROAD_CLASS",
      "Shape__Length",
    ],
    points: ["OBJECTID", "osm_id", "XCoord", "YCoord"],
  };

  let tiles = allTiles().filter(
    (t) => !tileFilter || tileFilter.has(`${t.gx},${t.gy}`),
  );
  // resumable: skip tiles already written (unless --force)
  if (!force) {
    tiles = tiles.filter(
      (t) => !existsSync(join(OUT, `tile_${t.gx}_${t.gy}.json`)),
    );
  }

  const manifestPath = join(OUT, "manifest.json");
  let manifest = {
    builtAt: new Date().toISOString(),
    tileM: TILE_M,
    bounds: METRO_BOUNDS,
    // The ODbL Attribution Guidelines want the credit "as part of the database
    // ... within the data or metadata", not only in an app UI — these chunks
    // are a Derivative Database and this file is the provenance record that
    // travels with them.
    attribution: "© OpenStreetMap contributors",
    license: "ODbL 1.0",
    licenseUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
    sources: {},
    tiles: {},
  };
  if (existsSync(manifestPath) && !force) {
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch {}
  }
  // Re-stamped on every run, including a resumed one that loaded the old
  // manifest above, so the notice cannot be lost by an incremental rebuild.
  manifest.attribution = "© OpenStreetMap contributors";
  manifest.license = "ODbL 1.0";
  manifest.licenseUrl = "https://opendatacommons.org/licenses/odbl/1-0/";
  manifest.sources = {
    buildings: {
      service: `${BASE}/2`,
      name: "Mumbai - Buildings (Mumbai_WFL1, OSM-derived)",
      licence: "ODbL 1.0 (OSM)",
    },
    streets: {
      service: `${BASE}/1`,
      name: "Mumbai - Streets (TomTom/Esri via Mumbai_WFL1)",
    },
    points: { service: `${BASE}/0`, name: "Mumbai - Points (OSM-derived)" },
  };

  console.error(
    `ingesting ${tiles.length} tiles with ${workers} workers (layers: ${wantLayers.join(",")})...`,
  );

  let done = 0;
  let totalBuildings = 0,
    totalStreets = 0,
    totalPoints = 0;
  const queue = [...tiles];
  const failed = [];

  async function worker() {
    for (;;) {
      const t = queue.shift();
      if (!t) return;
      const key = `${t.gx},${t.gy}`;
      try {
        const { rec, outObj } = await buildTile(t, wantLayers, fields);
        if (
          outObj.buildings.length ||
          outObj.streets.length ||
          outObj.points.length
        ) {
          writeFileSync(
            join(OUT, `tile_${t.gx}_${t.gy}.json`),
            JSON.stringify(outObj),
          );
          manifest.tiles[key] = rec;
        }
        totalBuildings += rec.buildings;
        totalStreets += rec.streets;
        totalPoints += rec.points;
      } catch (e) {
        failed.push({ key, err: String(e).slice(0, 120) });
      }
      done++;
      if (done % 25 === 0) {
        process.stderr.write(
          `  ${done}/${tiles.length} tiles (b=${totalBuildings} s=${totalStreets} p=${totalPoints})\n`,
        );
        writeFileSync(manifestPath, JSON.stringify(manifest, null, 2)); // checkpoint
      }
    }
  }

  await Promise.all(Array.from({ length: workers }, worker));

  manifest.totals = {
    buildings: totalBuildings,
    streets: totalStreets,
    points: totalPoints,
  };
  manifest.failed = failed;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(
    `\nDONE. buildings=${totalBuildings} streets=${totalStreets} points=${totalPoints} failed=${failed.length}`,
  );
  if (failed.length)
    console.log(
      "failed tiles (rerun to retry):",
      failed
        .slice(0, 10)
        .map((f) => f.key)
        .join(" "),
    );
  console.log(`manifest -> ${manifestPath}`);
}

main().catch((e) => {
  console.error("INGEST FAILED:", e);
  process.exit(1);
});
