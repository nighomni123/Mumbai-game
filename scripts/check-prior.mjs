/**
 * The gate on visual priors.
 *
 * A prior is the only thing standing between "we do not know" and a facade that
 * looks like we did. The failure it must never have is not a crash — it is a
 * building whose inferred appearance is presented with the same authority as a
 * measured one, silently, at 260,000-building scale, where nobody is reading.
 *
 * So this asserts behaviour, not just that the module imports:
 *   1. a researched landmark comes back fully documented, at confidence 1,
 *      with nothing still needed, and is NOT counted as inferred
 *   2. a bare anonymous footprint in Fort comes back majority model_prior, with
 *      a materially lower confidence than that landmark
 *   3. a measured 24-storey building never gets a chawl, bungalow or basti
 *   4. a 2-storey 60 m2 building never gets a modern tower
 *   5. provenance is PER FIELD, and covers every field but provenance itself
 *   6. every family / palette / window / balcony / roof that can be emitted is
 *      a real key in vocab.js — asserted against the module, not a copy
 *   7. needs is non-empty whenever confidence is low and empty when it is 1
 *   8. priorForChunk is deterministic, and its stats agree with its priors
 *
 * Run: node scripts/check-prior.mjs
 */

import {
  PRIOR_FIELDS,
  PROVENANCES,
  inferPrior,
  priorForChunk,
} from "../src/geo/prior.ts";
import {
  FAMILIES,
  PALETTES,
  WINDOWS,
  BALCONIES,
  ROOFS,
  FAMILY_IDS,
} from "../src/geo/vocab.js";

/** The macro-zones enrich-chunks.mjs zoneOf() can return, kept in step with it. */
const REGION_ZONES = [
  "south_mumbai", "island_city", "central",
  "western_suburb", "eastern_suburb", "new_mumbai",
];

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${detail ? " — " + detail : ""}`);
};

/** A bare footprint: no name, no type, no storey count, no landmark. */
const bare = (over = {}) => ({
  id: "w-1",
  lon: 72.8362,
  lat: 18.9355, // Fort
  zone: "south_mumbai",
  cls: "residential",
  areaM2: 400,
  heightM: 14,
  levels: null,
  streetFacing: true,
  name: null,
  ...over,
});

/* ---------------------------------------------------------------- 1 */
const landmark = inferPrior(
  bare({
    id: "csmt",
    name: "Chhatrapati Shivaji Maharaj Terminus",
    landmark: {
      id: "csmt",
      tier: 3,
      family: "colonial_commercial",
      palette: "colonial_stone",
      roof: "mansard",
    },
  }),
);
ok("landmark: family is the researched one", landmark.family === "colonial_commercial", landmark.family);
ok("landmark: palette is the researched one", landmark.palette === "colonial_stone", landmark.palette);
ok("landmark: roof is the researched one", landmark.roof === "mansard", landmark.roof);
ok(
  "landmark: every field is documented, none model_prior",
  PRIOR_FIELDS.every((f) => landmark.provenance[f] === "osm:name"),
  JSON.stringify(landmark.provenance),
);
ok("landmark: confidence is 1", landmark.confidence === 1, String(landmark.confidence));
ok("landmark: nothing left to ask for", landmark.needs.length === 0, landmark.needs.join("; "));

/* ---------------------------------------------------------------- 2 */
const anonymous = inferPrior(bare());
const modelPriorFields = PRIOR_FIELDS.filter((f) => anonymous.provenance[f] === "model_prior");
ok(
  "anonymous Fort footprint: majority model_prior",
  modelPriorFields.length * 2 > PRIOR_FIELDS.length,
  `${modelPriorFields.length}/${PRIOR_FIELDS.length} model_prior: ${modelPriorFields.join(",")}`,
);
ok(
  "anonymous Fort footprint: materially lower confidence than the landmark",
  anonymous.confidence <= landmark.confidence - 0.3,
  `${anonymous.confidence} vs ${landmark.confidence}`,
);
ok(
  "anonymous Fort footprint: confidence is not 1",
  anonymous.confidence < 1,
  String(anonymous.confidence),
);
ok(
  "anonymous Fort footprint: rationale names the inference",
  /prior, not a fact/.test(anonymous.rationale),
  anonymous.rationale,
);

/* ---------------------------------------------------------------- 3 */
const TOO_LOW = ["chawl", "bungalow", "informal_basti", "colonial_townhouse", "market_shed", "industrial_shed"];
for (const zone of ["south_mumbai", "central", "western_suburb", "eastern_suburb", "island_city", "new_mumbai"]) {
  for (const areaM2 of [120, 900, 4200]) {
    const p = inferPrior(bare({ id: `t-${zone}-${areaM2}`, zone, areaM2, heightM: 78, levels: 24, cls: "apartments" }));
    ok(
      `24 measured storeys in ${zone}/${areaM2}m2: not ${TOO_LOW.join("/")}`,
      !TOO_LOW.includes(p.family),
      p.family,
    );
    ok(
      `24 measured storeys in ${zone}: storey count is stated in the rationale`,
      /24 measured storeys/.test(p.rationale),
      p.rationale,
    );
  }
}

/* ---------------------------------------------------------------- 4 */
for (const zone of ["south_mumbai", "island_city", "central", "western_suburb", "eastern_suburb", "new_mumbai"]) {
  const p = inferPrior(bare({ id: `s-${zone}`, zone, areaM2: 60, heightM: 6, levels: 2 }));
  ok(`2 storeys / 60 m2 in ${zone}: not a modern tower or midrise`, !["modern_tower", "midrise_concrete"].includes(p.family), p.family);
}

/* ---------------------------------------------------------------- 5 */
ok("provenance: covers exactly the five visual fields", Object.keys(anonymous.provenance).length === PRIOR_FIELDS.length, Object.keys(anonymous.provenance).join(","));
ok(
  "provenance: has no key of its own or of confidence/rationale/needs",
  !["provenance", "confidence", "rationale", "needs"].some((k) => k in anonymous.provenance),
);
ok("provenance: every value is a declared Provenance", PRIOR_FIELDS.every((f) => PROVENANCES.includes(anonymous.provenance[f])));
ok(
  "provenance: a documented class does not launder the palette",
  inferPrior(bare({ cls: "commercial" })).provenance.family === "osm:building" &&
    inferPrior(bare({ cls: "commercial" })).provenance.palette === "model_prior",
  JSON.stringify(inferPrior(bare({ cls: "commercial" })).provenance),
);
ok(
  "provenance: a name outranks a type",
  inferPrior(bare({ name: "Seth Boman Homi Wadia Building" })).provenance.family === "osm:name",
);

/* ---------------------------------------------------------------- 6 */
/**
 * A wide sweep, so "every id it can emit" is a claim about the whole space and
 * not about the four hand-picked cases above. The id is varied so the seeded
 * draw visits more than one branch.
 */
const emitted = { family: new Set(), palette: new Set(), windows: new Set(), balconies: new Set(), roof: new Set() };
const zones = REGION_ZONES;
for (let i = 0; i < 4000; i++) {
  const e = bare({
    id: `sweep-${i}`,
    lon: 72.8 + (i % 200) / 1000,
    lat: 18.9 + (i % 97) / 1000,
    zone: zones[i % zones.length],
    cls: ["residential", "apartments", "commercial", "industrial", "institutional", "religious", "infrastructure"][i % 7],
    areaM2: 20 + ((i * 37) % 6000),
    heightM: 3 + ((i * 13) % 120),
    levels: i % 3 === 0 ? null : 1 + (i % 28),
    streetFacing: i % 2 === 0,
    name: i % 11 === 0 ? `Building ${i}` : null,
  });
  const p = inferPrior(e);
  emitted.family.add(p.family);
  emitted.palette.add(p.palette);
  emitted.windows.add(p.windows);
  emitted.balconies.add(p.balconies);
  emitted.roof.add(p.roof);
}
ok("sweep: every family emitted exists in vocab.FAMILIES", [...emitted.family].every((k) => k in FAMILIES), [...emitted.family].filter((k) => !(k in FAMILIES)).join(","));
ok("sweep: every palette emitted exists in vocab.PALETTES", [...emitted.palette].every((k) => k in PALETTES), [...emitted.palette].filter((k) => !(k in PALETTES)).join(","));
ok("sweep: every window emitted exists in vocab.WINDOWS", [...emitted.windows].every((k) => k in WINDOWS), [...emitted.windows].filter((k) => !(k in WINDOWS)).join(","));
ok("sweep: every balcony emitted exists in vocab.BALCONIES", [...emitted.balconies].every((k) => k in BALCONIES), [...emitted.balconies].filter((k) => !(k in BALCONIES)).join(","));
ok("sweep: every roof emitted exists in vocab.ROOFS", [...emitted.roof].every((k) => k in ROOFS), [...emitted.roof].filter((k) => !(k in ROOFS)).join(","));
ok("sweep: the draw actually reached more than one family", emitted.family.size > 5, `${emitted.family.size} of ${FAMILY_IDS.length} families`);

/* ---------------------------------------------------------------- 7 */
ok("needs: non-empty below 0.7 confidence", anonymous.needs.length > 0 && anonymous.confidence < 0.7, `${anonymous.confidence}: ${anonymous.needs.length} needs`);
ok(
  "needs: mentions building:levels for this building when no storey count was measured",
  anonymous.needs.some((n) => /building:levels/.test(n) && /w-1/.test(n)),
  anonymous.needs[0],
);
// Colour is the weakest field, so `needs` must say so — and must NOT offer a
// facade photograph. This was originally asserted the other way round. The
// research settled it: a photograph of a building cannot be input to shipped
// geometry in a proprietary renderer (CC BY-SA captures the derived model, and
// only ~4.6% of Wikimedia's Mumbai building images are CC0), so promising a
// photograph as future evidence describes something we cannot actually use. The
// data that does exist is names, building types and storey counts.
ok(
  "needs: explains that the palette is the weakest field",
  anonymous.needs.some((n) => /palette/.test(n) && /weakest/.test(n)),
  anonymous.needs.join(" | ").slice(0, 120),
);
ok(
  "needs: does NOT promise a facade photograph — that cannot legally feed shipped geometry",
  !anonymous.needs.some((n) => /facade photograph/i.test(n)),
);
ok(
  "needs: empty at confidence 1",
  inferPrior(
    bare({
      id: "gw",
      name: "Gateway of India",
      landmark: { id: "gateway-of-india", tier: 3, family: "victorian_institutional", palette: "institutional_stone", roof: "mansard" },
    }),
  ).needs.length === 0,
);
let lowWithoutNeeds = 0;
let highWithNeeds = 0;
for (let i = 0; i < 2000; i++) {
  const p = inferPrior(bare({ id: `nd-${i}`, levels: i % 2 ? null : 1 + (i % 20), areaM2: 30 + (i % 900), heightM: 4 + (i % 60) }));
  if (p.confidence < 0.7 && p.needs.length === 0) lowWithoutNeeds++;
  if (p.confidence === 1 && p.needs.length > 0) highWithNeeds++;
}
ok("needs: every low-confidence prior says what would raise it", lowWithoutNeeds === 0, `${lowWithoutNeeds} empty`);
ok("needs: no confidence-1 prior is still asking for evidence", highWithNeeds === 0, `${highWithNeeds} with needs`);

/* ---------------------------------------------------------------- 8 */
const chunk = [];
for (let i = 0; i < 300; i++) {
  chunk.push(bare({ id: `c-${i}`, zone: zones[i % zones.length], levels: i % 4 === 0 ? null : 2 + (i % 15), areaM2: 40 + ((i * 53) % 3000) }));
  if (i % 50 === 0) {
    chunk.push(
      bare({
        id: `c-lm-${i}`,
        name: "Taj Mahal Palace",
        landmark: { id: "taj", tier: 3, family: "hotel", palette: "art_deco_cream", roof: "dome" },
      }),
    );
  }
}
const a = priorForChunk(chunk);
const b = priorForChunk(chunk);
ok("priorForChunk: deterministic across two runs", JSON.stringify([...a.priors] ) === JSON.stringify([...b.priors]));
ok("priorForChunk: every building keyed by id", a.priors.size === chunk.length, `${a.priors.size} of ${chunk.length}`);
ok("priorForChunk: no landmark is counted as inferred", a.stats.inferred === chunk.length - 6, `${a.stats.inferred} inferred of ${a.stats.n}`);
ok("priorForChunk: mean confidence is below the landmark's 1", a.stats.meanConfidence < 1, String(a.stats.meanConfidence));
ok(
  "priorForChunk: provenance totals equal 5 fields per building",
  PROVENANCES.reduce((s, p) => s + a.stats.byProvenance[p], 0) === a.stats.n * 5,
  JSON.stringify(a.stats.byProvenance),
);
ok(
  "priorForChunk: family counts sum to n",
  Object.values(a.stats.byFamily).reduce((s, n) => s + n, 0) === a.stats.n,
);
ok(
  "priorForChunk: an empty chunk is not a crash and is not n=1",
  priorForChunk([]).stats.n === 0 && priorForChunk([]).stats.meanConfidence === 0,
);

console.log(
  failures ? `\n${failures} failing` : `\nall prior checks passed (${emitted.family.size} families, ${emitted.palette.size} palettes reachable)`,
);
process.exit(failures ? 1 : 0);
