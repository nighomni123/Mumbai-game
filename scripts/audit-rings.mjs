/**
 * RING AUDIT — is `mass()`'s centroid fan safe for the real data?
 *
 * `mass()` caps a roof with a triangle fan from the ring centroid, with the
 * comment "rings here are convex enough in practice". This measures whether
 * that assumption actually holds across every enriched chunk on disk.
 *
 * For each ring it reports topology (duplicate/short/zero edges, winding,
 * reflex vertices, centroid containment) and the decisive number: fan area vs
 * shoelace polygon area. For a convex ring the fan tiles the polygon and the
 * ratio is exactly 1. Above 1 the fan double-covers, and the excess is either
 * overlap or area outside the footprint — both draw roof pixels where there is
 * no building.
 *
 * Run: bun scripts/audit-rings.mjs [--worst N]
 */

import fs from "fs";
import path from "path";

const DIR = "data/build/chunks";
const worstN = Number(process.argv[process.argv.indexOf("--worst") + 1]) || 15;

/** Strip the duplicate closing vertex OSM rings carry, and validate the rest. */
function normalise(r) {
  const p = r.slice();
  if (p.length > 1 && p[0][0] === p[p.length - 1][0] && p[0][1] === p[p.length - 1][1]) p.pop();
  return p;
}

function shoelace(p) {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

function centroidInside(p, x, z) {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const xi = p[i][0], zi = p[i][1], xj = p[j][0], zj = p[j][1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

function segIntersect(a, b, c, d) {
  const o = (px, py, qx, qy, rx, ry) => Math.sign((qx - px) * (ry - py) - (qy - py) * (rx - px));
  const d1 = o(a[0], a[1], c[0], c[1], d[0], d[1]);
  const d2 = o(b[0], b[1], c[0], c[1], d[0], d[1]);
  const d3 = o(a[0], a[1], b[0], b[1], c[0], c[1]);
  const d4 = o(a[0], a[1], b[0], b[1], d[0], d[1]);
  return d1 !== d2 && d3 !== d4;
}

function selfIntersects(p) {
  const n = p.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // shared endpoint of the closure
      if (segIntersect(p[i], p[(i + 1) % n], p[j], p[(j + 1) % n])) return true;
    }
  }
  return false;
}

const stat = {
  rings: 0, degenerate: 0, nan: 0, zeroArea: 0,
  dupConsecutive: 0, dupNonConsecutive: 0,
  zeroEdge: 0, shortEdge: 0, selfIntersecting: 0,
  ccw: 0, cw: 0, concave: 0, centroidOutside: 0,
  fanOvershoot: 0, fanExcessArea: 0, polygonArea: 0,
  maxVertices: 0, maxOvershoot: 0,
};
const worst = [];
let files = 0;

for (const f of fs.readdirSync(DIR)) {
  if (!f.endsWith(".json") || f.endsWith(".meta.json")) continue;
  let j;
  try { j = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")); } catch { continue; }
  files++;
  for (const b of j.b || []) {
    const raw = b.r;
    if (!Array.isArray(raw) || raw.length < 4) continue;
    stat.rings++;
    const p = normalise(raw);

    if (raw.some(([x, z]) => !Number.isFinite(x) || !Number.isFinite(z))) { stat.nan++; continue; }
    if (raw.length > stat.maxVertices) stat.maxVertices = raw.length;

    let dupConsec = 0, dupOther = 0, zero = 0, short = 0;
    const seen = new Map();
    for (let i = 0; i < raw.length; i++) {
      const k = `${raw[i][0]},${raw[i][1]}`;
      if (seen.has(k)) dupOther++;
      else seen.set(k, i);
    }
    // edges of the DEDUPED ring: counting the OSM closure edge would report
    // 100% zero-length on every ring and tell you nothing
    for (let i = 0; i < p.length; i++) {
      const a = p[i], c = p[(i + 1) % p.length];
      const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (L === 0) { zero++; dupConsec++; } else if (L < 0.3) short++;
    }
    if (dupConsec) stat.dupConsecutive++;
    if (dupOther > 1) stat.dupNonConsecutive++;
    if (zero) stat.zeroEdge++;
    if (short) stat.shortEdge++;

    if (p.length < 3) { stat.degenerate++; continue; }
    if (selfIntersects(p)) stat.selfIntersecting++;

    const A2 = shoelace(p);
    const A = Math.abs(A2);
    if (A < 1e-6) { stat.zeroArea++; continue; }
    A2 < 0 ? stat.cw++ : stat.ccw++;
    stat.polygonArea += A;

    const n = p.length;
    let cx = 0, cz = 0;
    for (const q of p) { cx += q[0]; cz += q[1]; }
    cx /= n; cz /= n;

    let reflex = 0;
    const w = Math.sign(A2);
    for (let i = 0; i < n; i++) {
      const a = p[(i - 1 + n) % n], q = p[i], c = p[(i + 1) % n];
      const cr = (q[0] - a[0]) * (c[1] - q[1]) - (q[1] - a[1]) * (c[0] - q[0]);
      if (cr * w < 0) reflex++;
    }
    if (reflex) stat.concave++;
    if (!centroidInside(p, cx, cz)) stat.centroidOutside++;

    let F = 0;
    for (let i = 0; i < n; i++) {
      const a = p[i], c = p[(i + 1) % n];
      F += Math.abs((a[0] - cx) * (c[1] - cz) - (c[0] - cx) * (a[1] - cz)) / 2;
    }
    const ratio = F / A;
    if (ratio > 1.0001) {
      stat.fanOvershoot++;
      stat.fanExcessArea += F - A;
      if (ratio > stat.maxOvershoot) stat.maxOvershoot = ratio;
      worst.push({ id: b.id, chunk: f, n, ratio, area: A, excess: F - A, reflex, H: b.H });
    }
  }
}

const pct = (x) => `${((100 * x) / stat.rings).toFixed(2)}%`;
console.log(`\nring audit — ${files} chunks, ${stat.rings} rings\n`);
const rows = [
  ["concave (>=1 reflex vertex)", stat.concave],
  ["fan overshoots polygon", stat.fanOvershoot],
  ["centroid outside polygon", stat.centroidOutside],
  ["self-intersecting", stat.selfIntersecting],
  ["duplicate non-consecutive vertices", stat.dupNonConsecutive],
  ["zero-length edges", stat.zeroEdge],
  ["short edges (<0.3 m, culled by mass)", stat.shortEdge],
  ["zero-area", stat.zeroArea],
  ["NaN / Infinity", stat.nan],
];
for (const [k, v] of rows) console.log(`  ${k.padEnd(40)} ${String(v).padStart(7)}  ${pct(v)}`);
console.log(`\n  winding                            CW ${stat.cw} / CCW ${stat.ccw}`);
console.log(`  longest ring                        ${stat.maxVertices} vertices`);
console.log(`  worst single ring overshoot         ${stat.maxOvershoot.toFixed(2)}x`);
console.log(`  roof area drawn outside footprint   ${(stat.fanExcessArea / 1e6).toFixed(2)} km2 of ${(stat.polygonArea / 1e6).toFixed(2)} km2 = ${((100 * stat.fanExcessArea) / stat.polygonArea).toFixed(2)}%`);

worst.sort((a, b) => b.excess - a.excess);
console.log(`\nworst ${worstN} by excess roof area (m2):`);
for (const w of worst.slice(0, worstN)) {
  console.log(`  ${w.id}  ${w.chunk.padEnd(22)} v=${String(w.n).padStart(2)} reflex=${w.reflex} H=${w.H} fan=${w.ratio.toFixed(2)}x excess=${w.excess.toFixed(0)}`);
}
console.log("");
