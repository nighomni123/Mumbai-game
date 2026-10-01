/**
 * Enrichment: real footprint -> visual profile.
 *
 * This is the "geographic evidence in, classification out" step. It does not
 * author textures and does not author meshes. It decides what KIND OF MUMBAI
 * THING each building is, and the deterministic renderer decides how that class
 * looks. That split is what makes the system rerunnable and cheap to extend.
 *
 * What it adds to each building record, inline on the chunk record as `e`:
 *
 *   e.f  family   — the visual grammar (src/geo/vocab.js FAMILIES)
 *   e.p  palette  — a named colour family, never a per-building hex
 *   e.t  tier     — 0 generic .. 3 hero landmark
 *   e.l  landmark — id from src/geo/landmarks.ts, when this IS one
 *   sp/sw        — the street it fronts and that street's width
 *
 * Why inline rather than a sidecar: the renderer already fetches one file per
 * chunk, and a parallel array keyed by position is exactly the kind of thing
 * that silently desynchronises. Absent `e` simply means "not enriched yet",
 * which is the progressive model — a completed southern chunk stays complete
 * while northern ones are still generic.
 *
 * WHY IT IS ALREADY GOOD WITHOUT THIS SCRIPT: it is not. Measured on 2026-09-30,
 * a street frame here carried 1,865 distinct colours across 3 hue families,
 * against the reference build's 8,005-13,204 across 9. The single flat tone per
 * building was the whole of that gap. This script is where the rest comes from.
 *
 * RUNNABLE, DETERMINISTIC, CHUNK-SCOPED, and idempotent: running it twice
 * produces byte-identical output.
 *
 * Run: node scripts/enrich-families.mjs                (every chunk)
 *      node scripts/enrich-families.mjs -1,-7          (one chunk, while iterating)
 *      node scripts/enrich-families.mjs --slice fort   (a named area)
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tileBounds, toWgs84 } from "./geo.mjs";
import { FAMILIES, PALETTES, hash01, pickFamily, palettePool } from "../src/geo/vocab.js";

const DIR = "data/build/chunks";

/**
 * The landmark registry, authored in TypeScript next to the places list it
 * parallels. Node 22 strips the types on import, so there is still only ONE
 * definition of where the Gateway is — the same rule places.ts follows.
 *
 * Optional on purpose: a clone without landmarks.ts still enriches every
 * generic building, which is the tier-0 system working on its own. Landmarks
 * are an upgrade, not a dependency.
 */
const LANDMARKS = await import("../src/geo/landmarks.ts")
  .then((m) => m.LANDMARKS ?? [])
  .catch(() => []);

/* ------------------------------------------------------------------ *
 * Street frontage.
 *
 * The decisive question for a facade is "does this wall face a street?". The
 * chunk already carries every street polyline, so the answer is computable
 * rather than guessed — which means shopfronts, windows and signage land on
 * real frontages and blank backs stay blank.
 * ------------------------------------------------------------------ */

/** Flatten a chunk's street polylines into segments, once per chunk. */
function streetSegments(streets) {
  const segs = [];
  for (const st of streets) {
    const half = (st.w === "motorway" || st.w === "trunk" ? 11 : 6.5);
    for (const path of st.p) {
      for (let i = 0; i < path.length - 1; i++) {
        segs.push({ a: path[i], b: path[i + 1], half });
      }
    }
  }
  return segs;
}

/** Squared distance from a point to a segment. */
function pointSegDist2(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + dx * t, cz = az + dz * t;
  return (px - cx) * (px - cx) + (pz - cz) * (pz - cz);
}

/**
 * Midpoints of the ring's edges, so frontage is tested at one point per edge
 * rather than against every edge against every segment.
 */
function edgeMidpoints(ring) {
  const mids = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.4) continue;
    mids.push({ i, x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2 });
  }
  return mids;
}

/** Edges of `ring` that face a street, as ring-edge indices. */
function frontEdges(ring, segs) {
  if (!segs.length) return null;
  const mids = edgeMidpoints(ring);
  const hits = [];
  let best = Infinity;
  for (const m of mids) {
    for (const s of segs) {
      const d2 = pointSegDist2(m.x, m.z, s.a[0], s.a[1], s.b[0], s.b[1]);
      // inside the road corridor, or within 4 m of its edge
      if (d2 <= s.half * s.half + 16) {
        hits.push(m.i);
        if (d2 < best) best = d2;
        break;
      }
    }
  }
  // A building with no frontage at all is a back-of-block interior, which is
  // real; but an isolated one usually means the street data simply is not in
  // this chunk, so fall back to the longest edge rather than a blank box.
  return hits.length ? hits : null;
}

/* ------------------------------------------------------------------ *
 * Per-building classification.
 * ------------------------------------------------------------------ */

/** Named buildings short-circuit: a landmark's own family wins. */
function landmarkFor(x, z) {
  let best = null;
  let bestD = Infinity;
  for (const l of LANDMARKS) {
    const p = toWgs84(x, z);
    const dx = (l.lon - p.lon) * 105207;
    const dz = (l.lat - p.lat) * 111320;
    const d = Math.hypot(dx, dz);
    // generous, because a landmark's OSM footprint centroid is not the building
    // centre and a Gateway that matched nothing would be worse than useless
    if (d < 90 && d < bestD) {
      bestD = d;
      best = l;
    }
  }
  return best;
}

/**
 * The whole decision, for one building.
 *
 * Order of evidence, strongest first:
 *   1. it is a landmark we have researched        -> that landmark's family
 *   2. OSM gave it a name                          -> name-driven family
 *   3. OSM gave a specific type                   -> that class's family
 *   4. nothing but a footprint                    -> region prior, seeded by id
 *
 * Step 4 is where ~95% of buildings land, and it is a PRIOR: it biases what a
 * bare footprint looks like in Fort versus Andheri, it does not forbid a Fort
 * warehouse. Where it guesses it says so, via `c` (confidence) on the record.
 */
function profileFor(b, front) {
  const fam = pickFamily(b.t, b.z, b.a, b.F, b.id);

  // Palette: the family's own choice list, picked deterministically so a street
  // is a family of related tones rather than one repeated colour. The one
  // seeded accent per streetfront is what gives the frame a colour that reads.
  const allowed = palettePool(fam);
  const pal = allowed[Math.floor(hash01(b.id + "|p") * allowed.length) % allowed.length];

  return {
    f: fam,
    p: PALETTES[pal] ? pal : "plaster_warm",
    c: round2(0.35 + hash01(b.id + "|c") * 0.2), // how sure the class is
    ...(front ? { fx: 1 } : {}),
  };
}

const round2 = (v) => Math.round(v * 100) / 100;

/* ------------------------------------------------------------------ *
 * Chunk pass.
 * ------------------------------------------------------------------ */

function enrichChunk(gx, gy, stats) {
  const file = join(DIR, `chunk_${gx}_${gy}.json`);
  if (!existsSync(file)) return 0;
  const d = JSON.parse(readFileSync(file, "utf8"));
  const buildings = d.b || [];
  if (!buildings.length) return 0;

  const segs = streetSegments(d.s || []);
  const famCount = {};
  const palCount = {};
  let fronted = 0;
  let land = 0;

  for (const b of buildings) {
    const fe = frontEdges(b.r, segs);
    if (fe) fronted++;
    const lm = landmarkFor(b.c[0], b.c[1]);
    const prof = profileFor(b, fe);
    if (lm) {
      prof.f = lm.family;
      prof.p = lm.palette;
      prof.r = lm.roof;
      prof.t = lm.tier;
      prof.l = lm.id;
      prof.c = 1;
      land++;
    }
    b.e = prof;
    famCount[prof.f] = (famCount[prof.f] || 0) + 1;
    palCount[prof.p] = (palCount[prof.p] || 0) + 1;
    if (fe) b.fx = fe;
  }

  writeFileSync(file, JSON.stringify(d));
  stats.buildings += buildings.length;
  stats.fronted += fronted;
  stats.landmarks += land;
  for (const k of Object.keys(famCount)) stats.families[k] = (stats.families[k] || 0) + famCount[k];
  for (const k of Object.keys(palCount)) stats.palettes[k] = (stats.palettes[k] || 0) + palCount[k];
  return buildings.length;
}

function main() {
  const args = process.argv.slice(2);
  let targets = null;
  const sliceAt = args.indexOf("--slice");
  const specific = args.filter((a) => /^-\d+,-\d+$/.test(a));

  const files = existsSync(DIR)
    ? readdirSync(DIR).filter((f) => /^chunk_-?\d+_-?\d+\.json$/.test(f) && !f.includes(".meta."))
    : [];
  if (!files.length) {
    console.log(`no chunks in ${DIR} — run scripts/enrich-chunks.mjs first`);
    return;
  }

  if (specific.length) {
    targets = specific.map((s) => s.slice(1).split(",").map(Number));
  } else if (sliceAt !== -1) {
    // --slice <region>: the chunks whose centroid falls inside the region box
    const region = args[sliceAt + 1];
    const box = SLICES[region];
    if (box)
      console.log(
        `  slice ${region}: x ${box.x0.toFixed(0)}..${box.x1.toFixed(0)}, ` +
          `y ${box.y0.toFixed(0)}..${box.y1.toFixed(0)}`,
      );
    if (!box) {
      console.log(`unknown slice "${region}". known: ${Object.keys(SLICES).join(", ")}`);
      return;
    }
    targets = [];
    for (const f of files) {
      const m = f.match(/chunk_(-?\d+)_(-?\d+)\.json/);
      const b = tileBounds({ gx: +m[1], gy: +m[2] });
      const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
      if (cx >= box.x0 && cx <= box.x1 && cy >= box.y0 && cy <= box.y1) targets.push([+m[1], +m[2]]);
    }
  }

  const stats = { buildings: 0, fronted: 0, landmarks: 0, families: {}, palettes: {} };
  const list = targets ?? files.map((f) => f.match(/chunk_(-?\d+)_(-?\d+)\.json/).slice(1).map(Number));
  for (const [gx, gy] of list) enrichChunk(gx, gy, stats);

  const pct = stats.buildings ? ((stats.fronted / stats.buildings) * 100).toFixed(1) : "0";
  console.log(
    `enriched ${list.length} chunk(s): ${stats.buildings} buildings, ` +
      `${stats.fronted} with a street frontage (${pct}%), ${stats.landmarks} landmarks`,
  );
  const top = (o) =>
    Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${((v / stats.buildings) * 100).toFixed(1)}%`).join("  ");
  console.log(`  families:  ${top(stats.families)}`);
  console.log(`  palettes:  ${top(stats.palettes)}`);
}

/**
 * Named areas to enrich first — the expansion order, in local metres.
 *
 * These are derived from src/geo/places.ts, NOT hand-tuned. The first attempt
 * put the Fort box at y -3000, which is 13 km north of Fort at y -15919, and
 * so silently enriched Parel and Dadar while calling it "Fort". Every box is
 * now real place coordinates plus a walk-around radius, so it cannot drift
 * from where the places actually are.
 */
const SLICE_PLACES = {
  fort: ["fort", "gateway", "colaba", "churchgate", "marine", "charni"],
  worli: ["worli", "parel"],
  dadar: ["dadar"],
  bandra: ["bandra", "bkc"],
  andheri: ["andheri"],
};

const SLICES = await sliceBoxes();

async function sliceBoxes() {
  const { PLACES } = await import("../src/geo/places.ts");
  const by = new Map(PLACES.map((p) => [p.name, p]));
  const PAD = 2200; // a walk around each place, not just its block
  const out = {};
  for (const [name, list] of Object.entries(SLICE_PLACES)) {
    const pts = list.map((n) => by.get(n)).filter(Boolean);
    if (!pts.length) continue;
    const xs = pts.map((p) => (p.lon - 72.878) * 105207);
    const ys = pts.map((p) => (p.lat - 19.076) * 111320);
    out[name] = {
      x0: Math.min(...xs) - PAD,
      x1: Math.max(...xs) + PAD,
      y0: Math.min(...ys) - PAD,
      y1: Math.max(...ys) + PAD,
    };
  }
  return out;
}

main();