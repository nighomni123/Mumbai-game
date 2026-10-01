/**
 * Where chunk-build time actually goes, and a guard on the roof-cap fix.
 *
 * This is a PROFILER, not an A/B. An earlier version compared two variants
 * with medians, which turned out to be unreadable on this box: several agents
 * share it, and load averages of 40-50 turn a median into noise (the same code
 * measured 18 ms and 122 ms in consecutive runs). Everything here therefore
 * reports the MINIMUM over many rounds — the least-interrupted run — and
 * prints the load average so a reader can judge how contended it was.
 *
 * The phases below sum to one complete chunk build. If they ever stop
 * summing, the instrument is lying and the numbers should not be trusted.
 *
 *   bun scripts/bench-chunk.ts                        # the shipped slice
 *   bun scripts/bench-chunk.ts data/build/chunks 3    # the full metro
 */

import { readdirSync, readFileSync } from "node:fs";
import { loadavg } from "node:os";
import * as THREE from "three";
import {
  emitBuilding,
  type ChunkBuilding,
} from "../src/geo/chunk-build.ts";
import { Facet } from "../src/geo/buildings.ts";

const dir = process.argv[2] ?? "data/starter/chunks";
const ROUNDS = Number(process.argv[3] ?? 9);

const chunks = readdirSync(dir)
  .filter((f) => f.startsWith("chunk_") && f.endsWith(".json") && !f.endsWith(".meta.json"))
  .sort()
  .map((f) => JSON.parse(readFileSync(`${dir}/${f}`, "utf8")))
  .filter((c) => (c.b ?? []).length > 0);

const buildings = chunks.reduce((n, c) => n + (c.b ?? []).length, 0);

/** Floats actually written, whichever storage the Facet uses. */
const written = (f: Facet) => ("used" in f ? f.used : f.pos.length);

/** Buildings with no enrichment, i.e. the ones that are exactly a prism. */
function plainOf(list: ChunkBuilding[]) {
  return list.filter((b) => !b.e);
}

/**
 * The theoretical triangle count for a prism: each footprint vertex is 2 wall
 * triangles plus 1 cap triangle.
 *
 * This is the regression guard for the roof-cap bug, where the cap fan sat
 * inside the per-edge loop and drew every roof `ring.length` times over.
 * The mean ring here is ~7.66 vertices, so that bug was a 4.4x multiplier.
 *
 * Enriched buildings emit far more than a prism, so BOTH sides of the
 * comparison count only the unenriched ones — otherwise a chunk set with any
 * enrichment in it compares enriched output against a prism expectation and
 * always "fails".
 */
function expectedTriangles() {
  let tris = 0;
  for (const c of chunks) {
    for (const b of plainOf((c.b ?? []) as ChunkBuilding[])) {
      const ring = b.r?.length ?? 0;
      if (ring >= 3) tris += 3 * ring;
    }
  }
  return tris;
}

function actualTriangles() {
  let tris = 0;
  for (const c of chunks) {
    const f = new Facet();
    for (const b of plainOf((c.b ?? []) as ChunkBuilding[])) emitBuilding(b, f);
    // `used` is the written count; `pos.length` is capacity, which is why
    // reading the wrong one here silently inflates the triangle total.
    tris += written(f) / 9;
  }
  return tris;
}

/** One complete build of every chunk, timed per phase. */
function pass() {
  let emit = 0,
    convert = 0,
    normals = 0,
    bounds = 0;
  for (const c of chunks) {
    const f = new Facet();

    let t = performance.now();
    for (const b of (c.b ?? []) as ChunkBuilding[]) emitBuilding(b, f);
    emit += performance.now() - t;

    t = performance.now();
    // Must match production facetGeometry exactly: the position attribute has
    // to be `used` long, not `pos.length`. Handing three.js the capacity
    // inflates the vertex count and makes normals/bounds measure the tail of
    // unwritten memory — which is not what ships.
    const pos = "used" in f ? f.pos.slice(0, f.used) : f.pos;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute(
      "color",
      new THREE.BufferAttribute(Uint8Array.from(f.col.slice(0, written(f))), 3, true),
    );
    convert += performance.now() - t;

    t = performance.now();
    geo.computeVertexNormals();
    normals += performance.now() - t;

    t = performance.now();
    geo.computeBoundingSphere();
    bounds += performance.now() - t;

    geo.dispose();
  }
  return { emit, convert, normals, bounds, total: emit + convert + normals + bounds };
}

// Warm once so no round pays first-call JIT.
pass();

const runs = Array.from({ length: ROUNDS }, pass);
const min = (k: "emit" | "convert" | "normals" | "bounds") =>
  Math.min(...runs.map((r) => r[k]));
const d = {
  emit: min("emit"),
  convert: min("convert"),
  normals: min("normals"),
  bounds: min("bounds"),
};
const total = d.emit + d.convert + d.normals + d.bounds;
const tris = actualTriangles();

console.log(`source        ${dir}`);
console.log(`chunks        ${chunks.length}`);
console.log(`buildings     ${buildings.toLocaleString()}`);
console.log(`triangles     ${Math.round(tris).toLocaleString()}`);
console.log(`rounds        ${ROUNDS}, MIN reported`);
console.log(
  `load average  ${loadavg()[0].toFixed(1)}  (this box is shared; low is better)\n`,
);

console.log("one full build of every chunk:");
for (const [k, v] of Object.entries(d)) {
  console.log(
    `   ${k.padEnd(9)} ${v.toFixed(1).padStart(7)} ms  ${((100 * v) / total)
      .toFixed(0)
      .padStart(3)}%`,
  );
}
console.log(`   ${"sum".padEnd(9)} ${total.toFixed(1).padStart(7)} ms`);

/* --- the roof-cap regression guard ------------------------------------- */
const expected = expectedTriangles();
const got = Math.round(tris);
const ratio = expected ? got / expected : 1;
console.log(
  `\nroof cap: ${got.toLocaleString()} triangles vs ${expected.toLocaleString()} of unenriched prism`,
);
if (ratio > 1.15) {
  console.error(
    `FAIL: ${ratio.toFixed(2)}x the unenriched prism count — the cap is being overdrawn again`,
  );
  process.exit(1);
}
console.log(`OK: ${ratio.toFixed(2)}x — cap drawn once, not once per ring edge`);