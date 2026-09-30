#!/usr/bin/env node
/**
 * Self-check for `src/mumbai/stations.ts` — the ordered list that every sign,
 * board and departure LED in the world derives from by adjacency. If the order
 * or a code drifts, the place stops reading as a real railway, so:
 *
 *   node scripts/check-stations.mjs      (or: bun run check:stations)
 *
 * The source is TypeScript, so this PARSES the file text rather than importing
 * it. WESTERN_LINE is plain object literals, one per line: a regex to lift the
 * array body plus a key/value scan per line is enough. No parser, no AST, no
 * dependencies, no fixtures.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(
  fileURLToPath(new URL("../src/mumbai/stations.ts", import.meta.url)),
  "utf8",
);

/** The real Western line, south to north: [code, name] as the railway has it. */
const REAL_ORDER = [
  ["CCG", "Churchgate"],
  ["MEL", "Marine Lines"],
  ["CYR", "Charni Road"],
  ["GTR", "Grant Road"],
  ["MMCT", "Mumbai Central"],
  ["MX", "Mahalaxmi"],
  ["PL", "Lower Parel"],
  ["DR", "Dadar"],
];

const DEVA = /[ऀ-ॿ]/; // Devanagari block, U+0900–U+097F

/** Scan one `{ key: value, ... }` literal into a plain object. */
function parseStation(literal) {
  const station = {};
  const pair = /(\w+)\s*:\s*('[^']*'|\[[^\]]*\]|true|false|-?[\d.]+)/g;
  for (const [, key, raw] of literal.matchAll(pair)) {
    if (raw.startsWith("'")) station[key] = raw.slice(1, -1);
    else if (raw.startsWith("[")) {
      station[key] = (raw.slice(1, -1).match(/'[^']*'/g) ?? []).map((s) =>
        s.slice(1, -1),
      );
    } else if (raw === "true" || raw === "false") station[key] = raw === "true";
    else station[key] = Number(raw);
  }
  return station;
}

let passed = 0;

/** Run one named assertion, print it, and count it. Exits non-zero on failure. */
function check(label, fn) {
  try {
    fn();
  } catch (err) {
    console.error(`FAIL  ${label}\n        ${err.message}`);
    process.exit(1);
  }
  passed++;
  console.log(`ok    ${label}`);
}

// --- parse ------------------------------------------------------------------

const body = src.match(/export const WESTERN_LINE[^=]*=\s*\[([\s\S]*?)\n\];/);
check("WESTERN_LINE is a parseable array literal", () =>
  assert.ok(body, "no array literal found in stations.ts"),
);

const line = [...body[1].matchAll(/\{[^{}]*\}/g)].map(([literal]) =>
  parseStation(literal),
);
const gap = (i) => line[i + 1].chainage - line[i].chainage;

// --- 1-5: shape, identity, order, head, scripts -----------------------------

for (const [i, s] of line.entries()) {
  const at = `${i}:${s.code ?? "?"}`;
  check(`${at} has non-empty code, deva and latin`, () => {
    for (const k of ["code", "deva", "latin"])
      assert.ok(typeof s[k] === "string" && s[k].trim() > "", `empty ${k}`);
  });
  check(`${at} has a numeric chainage`, () =>
    assert.equal(typeof s.chainage, "number"),
  );
  check(`${at} deva is Devanagari`, () =>
    assert.ok(DEVA.test(s.deva), `no U+0900-U+097F in "${s.deva}"`),
  );
  check(`${at} latin is not Devanagari`, () =>
    assert.ok(!DEVA.test(s.latin), `Devanagari in "${s.latin}"`),
  );
  if (i > 0)
    check(`${at} chainage increases north of ${line[i - 1].code}`, () =>
      assert.ok(gap(i - 1) > 0, `${s.chainage} after ${line[i - 1].chainage}`),
    );
}

check("all codes are unique", () => {
  const codes = line.map((s) => s.code);
  assert.equal(
    new Set(codes).size,
    codes.length,
    "duplicate code in WESTERN_LINE",
  );
});

check("Churchgate is first, at chainage 0", () => {
  assert.equal(line[0].chainage, 0);
  assert.equal(
    line[0].terminus,
    true,
    "the southern terminus must be flagged terminus: true",
  );
});

// --- 6: the real railway, not just this file's opinion of it -----------------

check(
  `the real Western line runs ${REAL_ORDER.map(([c]) => c).join(" ")} in order`,
  () => {
    assert.ok(
      line.length >= REAL_ORDER.length,
      `only ${line.length} stations listed`,
    );
    assert.deepEqual(
      line.slice(0, REAL_ORDER.length).map((s) => [s.code, s.latin]),
      REAL_ORDER,
    );
  },
);

// --- 7: chainages are plausible ---------------------------------------------

check("every chainage is a real distance from Churchgate", () => {
  for (const s of line)
    assert.ok(s.chainage >= 0, `negative chainage at ${s.code}`);
});

check("first gap is under 2 km", () =>
  assert.ok(gap(0) < 2000, `Churchgate to Marine Lines is ${gap(0)} m`),
);

for (let i = 0; i < line.length - 1; i++) {
  check(`gap ${line[i].code}->${line[i + 1].code} is under 5 km`, () =>
    assert.ok(gap(i) <= 5000, `${gap(i)} m`),
  );
}

console.log(
  `\nPASS  ${passed} assertions over ${line.length} stations, ${line[0].latin} -> ${line.at(-1).latin}`,
);
