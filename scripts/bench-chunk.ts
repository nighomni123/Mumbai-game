/**
 * Chunk-build benchmark: the per-building-geometry path vs one typed arena.
 *
 * Both paths run interleaved on the SAME real chunk data in one process, so
 * the comparison cannot drift with machine load or JIT warm-up. It is the
 * measurement behind docs/chunk-build-arena.md.
 *
 *   bun scripts/bench-chunk.ts            # the shipped starter slice
 *   bun scripts/bench-chunk.ts data/build # the full 260k-building metro
 */

import { readdirSync, readFileSync } from "node:fs";
import * as THREE from "three";
import { facetGeometry, chunkBuildingGeometry } from "../src/geo/chunk-build.ts";
import { Facet, buildBuilding } from "../src/geo/buildings.ts";
import type { ChunkBuilding } from "../src/geo/chunk-build.ts";

const dir = `${process.argv[2] ?? "data/starter"}/chunks`;
const ROUNDS = Number(process.argv[3] ?? 5);

const files = readdirSync(dir)
  .filter((f) => f.startsWith("chunk_") && f.endsWith(".json"))
  .sort();

const chunks = files
  .map((f) => JSON.parse(readFileSync(`${dir}/${f}`, "utf8")))
  .filter((c) => (c.b ?? []).length > 0);

const buildings = chunks.reduce((n, c) => n + (c.b ?? []).length, 0);

/* --- the path the renderer used before: one geometry per building -------- *
 *
 * Kept verbatim here, not in src/, because it is now dead code there. It is
 * the "before" half of the comparison and must stay byte-for-byte the thing
 * that actually ran, or the number below stops meaning anything.
 * ---------------------------------------------------------------------- */

/** The prism builder the renderer used for unenriched buildings. */
function buildingGeometry(ring: [number, number][], height: number) {
  const shape = new THREE.Shape();
  shape.moveTo(ring[0][0], ring[0][1]);
  for (let i = 1; i < ring.length; i++) shape.lineTo(ring[i][0], ring[i][1]);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: false,
  });
  geo.rotateX(Math.PI / 2);
  geo.translate(0, height, 0);
  return geo;
}

/** The post-hoc merge the renderer did once per chunk. */
function mergeGeometries(geos: THREE.BufferGeometry[]) {
  if (!geos.length) return null;
  let vertexTotal = 0;
  for (const g of geos) vertexTotal += g.attributes.position.count;

  const pos = new Float32Array(vertexTotal * 3);
  const nor = new Float32Array(vertexTotal * 3);
  const col = new Uint8Array(vertexTotal * 3);
  let vOff = 0;
  for (const g of geos) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array as ArrayLike<number>, vOff * 3);
    if (g.attributes.normal)
      nor.set(g.attributes.normal.array as ArrayLike<number>, vOff * 3);
    if (g.attributes.color) {
      const src = g.attributes.color.array as ArrayLike<number>;
      for (let i = 0; i < n * 3; i++) col[vOff * 3 + i] = src[i];
    }
    vOff += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  if (geos[0].attributes.normal)
    out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  if (geos[0].attributes.color)
    out.setAttribute("color", new THREE.BufferAttribute(col, 3, true));
  out.computeBoundingSphere();
  return out;
}

function buildOld(list: ChunkBuilding[]) {
  const geos: THREE.BufferGeometry[] = [];
  for (const b of list) {
    let geo;
    if (b.e) {
      const facet = new Facet();
      buildBuilding(b, b.e, facet);
      geo = facetGeometry(facet);
    } else {
      geo = buildingGeometry(b.r, b.H);
      const count = geo.attributes.position.count;
      const colors = new Uint8Array(count * 3);
      for (let i = 0; i < count; i++) colors[i * 3] = 200;
      geo.setAttribute("color", new THREE.BufferAttribute(colors, 3, true));
    }
    geos.push(geo);
  }
  const merged = mergeGeometries(geos);
  geos.forEach((g) => g.dispose());
  return merged;
}

/** Run one full pass over every chunk, returning ms elapsed. */
function pass(fn: (list: ChunkBuilding[]) => THREE.BufferGeometry | null) {
  const t0 = performance.now();
  let tris = 0;
  for (const c of chunks) {
    const g = fn(c.b ?? []);
    if (g) tris += g.attributes.position.count / 3;
    g?.dispose();
  }
  return { ms: performance.now() - t0, tris };
}

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

// Warm both paths before timing either.
pass(buildOld);
pass(chunkBuildingGeometry);

const oldMs: number[] = [];
const newMs: number[] = [];
let tris = 0;
for (let i = 0; i < ROUNDS; i++) {
  const a = pass(buildOld);
  const b = pass(chunkBuildingGeometry);
  oldMs.push(a.ms);
  newMs.push(b.ms);
  tris = a.tris;
}

const o = median(oldMs);
const n = median(newMs);

console.log(`source       ${dir}`);
console.log(`chunks       ${chunks.length}`);
console.log(`buildings    ${buildings}`);
console.log(`triangles    ${tris.toLocaleString()}`);
console.log("");
console.log(`per-building geometry : ${o.toFixed(1)} ms   [${oldMs.map((x) => x.toFixed(0)).join(", ")}]`);
console.log(`one typed arena      : ${n.toFixed(1)} ms   [${newMs.map((x) => x.toFixed(0)).join(", ")}]`);
console.log(`speedup               : ${(o / n).toFixed(1)}x   (${((1 - n / o) * 100).toFixed(0)}% less time)`);