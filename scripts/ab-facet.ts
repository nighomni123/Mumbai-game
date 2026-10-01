/**
 * A/B the array-backed Facet against the typed growable one.
 *
 * Each side imports its OWN Facet class from its OWN tree. This is the whole
 * point and it is easy to get wrong: an earlier version of this file imported
 * one Facet and handed it to both emitters, which made the "old" side write
 * into the new class — so it compared the new implementation against itself
 * and reported a meaningless 0.9x-1.07x spread that was pure machine noise.
 *
 * The oracle is the real previous implementation in a git worktree, not a
 * copy of it written here: a re-typed reference drifts from the thing it is
 * meant to prove equal.
 *
 *   git worktree add -f /tmp/mumbai-before 51b5aa0
 *   ln -sfn "$PWD/node_modules" /tmp/mumbai-before/node_modules
 *   bun scripts/ab-facet.ts
 */

import { readdirSync, readFileSync } from "node:fs";
import { loadavg } from "node:os";

// side A: the committed array-backed implementation
import { emitBuilding as emitA } from "/tmp/mumbai-before/src/geo/chunk-build.ts";
import { Facet as FacetA } from "/tmp/mumbai-before/src/geo/buildings.ts";
// side B: the typed growable implementation under test
import { emitBuilding as emitB } from "../src/geo/chunk-build.ts";
import { Facet as FacetB } from "../src/geo/buildings.ts";

const dir = process.argv[2] ?? "data/starter/chunks";
const ROUNDS = Number(process.argv[3] ?? 15);

const chunks = readdirSync(dir)
  .filter((f) => f.startsWith("chunk_") && f.endsWith(".json") && !f.endsWith(".meta.json"))
  .sort()
  .map((f) => JSON.parse(readFileSync(`${dir}/${f}`, "utf8")))
  .filter((c) => (c.b ?? []).length > 0);

const buildings = chunks.reduce((n, c) => n + (c.b ?? []).length, 0);

/** The length of a facet's written content, whichever storage it uses. */
const written = (f: FacetA | FacetB) => ("used" in f ? f.used : f.pos.length);

/** Emit every chunk's buildings. Each side builds ITS OWN Facet. */
function pass(emit: typeof emitA, Facet: typeof FacetA) {
  const t0 = performance.now();
  let floats = 0;
  for (const c of chunks) {
    const f = new Facet();
    for (const b of c.b ?? []) emit(b as never, f as never);
    floats += written(f as FacetB);
  }
  return { ms: performance.now() - t0, floats };
}

function pct(xs: number[], p: number) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
}

// Prove the two sides are the same thing before timing them. If this fails,
// any speed difference is a difference in output, not in speed.
let mismatches = 0;
let comparedFloats = 0;
for (const c of chunks) {
  const fa = new FacetA();
  const fb = new FacetB();
  for (const b of c.b ?? []) {
    emitA(b as never, fa);
    emitB(b as never, fb as never);
  }
  const pa = Float32Array.from(fa.pos as number[]);
  const pb = fb.pos.slice(0, fb.used);
  const ca = Uint8Array.from(fa.col as number[]);
  const cb = fb.col.slice(0, fb.used);
  comparedFloats += pa.length;
  if (pa.length !== pb.length || ca.length !== cb.length) {
    mismatches++;
    console.error(`  size mismatch ${pa.length}/${pb.length}`);
    continue;
  }
  for (let i = 0; i < pa.length; i++) {
    if (pa[i] !== pb[i] || ca[i] !== cb[i]) {
      mismatches++;
      console.error(`  first diff at ${i}: pos ${pa[i]}/${pb[i]} col ${ca[i]}/${cb[i]}`);
      break;
    }
  }
}
console.log(
  `equivalence: ${mismatches ? `FAIL (${mismatches} chunks differ)` : "OK"} — ${comparedFloats.toLocaleString()} floats compared byte-for-byte`,
);
if (mismatches) process.exit(1);

pass(emitA, FacetA);
pass(emitB, FacetB);

const aMs: number[] = [];
const bMs: number[] = [];
for (let i = 0; i < ROUNDS; i++) {
  aMs.push(pass(emitA, FacetA).ms);
  bMs.push(pass(emitB, FacetB).ms);
}

const a = pct(aMs, 0);
const b = pct(bMs, 0);
console.log(`\nsource        ${dir}`);
console.log(`chunks        ${chunks.length}   buildings ${buildings.toLocaleString()}`);
console.log(`rounds        ${ROUNDS} interleaved`);
console.log(`load average  ${loadavg()[0].toFixed(1)}  (this box is shared; low is better)\n`);
console.log(`   A  array-backed Facet   min ${a.toFixed(1).padStart(7)}  p25 ${pct(aMs, 0.25).toFixed(1).padStart(7)}  med ${pct(aMs, 0.5).toFixed(1).padStart(7)}  max ${Math.max(...aMs).toFixed(1).padStart(7)}`);
console.log(`   B  typed growable       min ${b.toFixed(1).padStart(7)}  p25 ${pct(bMs, 0.25).toFixed(1).padStart(7)}  med ${pct(bMs, 0.5).toFixed(1).padStart(7)}  max ${Math.max(...bMs).toFixed(1).padStart(7)}`);
console.log(`\n   gain on min ${(a / b).toFixed(2)}x   on p25 ${(pct(aMs, 0.25) / pct(bMs, 0.25)).toFixed(2)}x   on median ${(pct(aMs, 0.5) / pct(bMs, 0.5)).toFixed(2)}x`);
console.log(
  `\n   NOTE: if the load average is high, treat anything inside +/-20% as noise.`,
);