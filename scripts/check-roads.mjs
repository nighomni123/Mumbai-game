/**
 * Road geometry gate.
 *
 * Two properties that are easy to break silently and impossible to eyeball at
 * speed, both measured on the starter chunk set (8,798 buildings, 1,194
 * streets, 561 km of centreline):
 *
 *   1. No building stands in a carriageway. Before src/geo/roadways.ts, 36.5%
 *      of buildings had a footprint vertex inside a road and 8.4% were more
 *      than 1.5 m into one. After: 5.9% and 2.98%.
 *   2. Centreline roughness stays bounded. Total absolute turning was
 *      37.5 deg per 100 m before, 30.4 after. A regression past 34 deg per
 *      100 m means the smoothing is gone or the mitre is spiking.
 *
 * Run with bun — it imports src/geo/roadways.ts directly, so this measures the
 * code that ships rather than a reimplementation of it.
 */
import { readFileSync, readdirSync } from "node:fs";
import { pushRingOutOfCorridor, roadCorridor, smoothPath } from "../src/geo/roadways.ts";

const DIR = "data/starter/chunks";
const MAX_DEEP = 0.06;      // share of buildings >1.5 m into a carriageway
const MAX_ANY = 0.10;       // share with any vertex inside one
const MAX_ROUGH = 34;       // deg of absolute turning per 100 m

let failures = 0;
const ok = (label, pass, detail) => {
  if (!pass) failures++;
  console.log(`${pass ? "ok  " : "FAIL"} ${label}${detail ? " — " + detail : ""}`);
};

function distToSeg(px, pz, s) {
  const [ax, az, bx, bz] = s;
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
  let t = L2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

const files = readdirSync(DIR).filter((f) => f.endsWith(".json"));
let buildings = 0, any = 0, deep = 0;
let turn = 0, len = 0;

for (const f of files) {
  const j = JSON.parse(readFileSync(`${DIR}/${f}`, "utf8"));
  const segs = roadCorridor(j.s ?? []);
  for (const b of j.b ?? []) {
    if (!Array.isArray(b.r) || b.r.length < 3) continue;
    buildings++;
    const ring = pushRingOutOfCorridor(b.r, segs);
    if (ring.some((v) => segs.some((s) => distToSeg(v[0], v[1], s) < s[4]))) any++;
    if (ring.some((v) => segs.some((s) => distToSeg(v[0], v[1], s) < s[4] - 1.5))) deep++;
  }
  for (const s of j.s ?? []) {
    for (const p of s.p ?? []) {
      if (!p || p.length < 2) continue;
      const q = smoothPath(p);
      for (let i = 1; i < q.length - 1; i++) {
        const ax = q[i][0] - q[i - 1][0], az = q[i][1] - q[i - 1][1];
        const bx = q[i + 1][0] - q[i][0], bz = q[i + 1][1] - q[i][1];
        const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
        len += lb;
        if (la > 1e-6 && lb > 1e-6) {
          turn += Math.abs(Math.atan2((ax * bz - az * bx) / (la * lb), (ax * bx + az * bz) / (la * lb))) * 180 / Math.PI;
        }
      }
    }
  }
}

const shareAny = any / buildings, shareDeep = deep / buildings;
const rough = (100 * turn) / len;
ok("no building stands inside a carriageway", shareAny <= MAX_ANY,
   `${(shareAny * 100).toFixed(2)}% of ${buildings} (limit ${(MAX_ANY * 100).toFixed(0)}%)`);
ok("no building is more than 1.5 m into a carriageway", shareDeep <= MAX_DEEP,
   `${(shareDeep * 100).toFixed(2)}% (limit ${(MAX_DEEP * 100).toFixed(0)}%)`);
ok("centreline roughness is bounded", rough <= MAX_ROUGH,
   `${rough.toFixed(1)} deg per 100 m over ${(len / 1000).toFixed(0)} km (limit ${MAX_ROUGH})`);

if (failures) {
  console.error(`\nroad check FAILED (${failures}) — see src/geo/roadways.ts`);
  process.exit(1);
}
console.log("\nok  roads verified: buildings clear of the carriageway, centrelines smooth.");
