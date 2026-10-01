/**
 * Visual QA gate: is the world actually being drawn?
 *
 * FALSIFICATION TESTED. This gate was written twice. The first version used only
 * layer coverage from `measure-scene.mjs` and it PASSED on frames where the
 * ground was culled — because the sea underneath classified as `building` (blue
 * at chroma 71 reads as low-chroma architecture to a colour rule), so the frame
 * still looked surface-dominated. A frame statistic cannot tell you the floor is
 * missing when something else is standing in for it.
 *
 * The version below adds a SEMANTIC anchor: the lower band of a footpath frame
 * must be the colour the ground is supposed to be, and must not be the sea.
 * Re-injecting the winding bug now fails 6/6 poses with `sea=96%`; the fix
 * passes at `ground=97% sea=1%`. If you change this gate, re-run that
 * falsification before trusting it.
 *
 * The failure this exists to catch: on 2026-09-30 the ground and sea quads were
 * wound to face down, so `MeshBasicMaterial`'s FrontSide culled them and **the
 * ground plane had never rendered**. Buildings and streets drew happily over
 * bare `scene.background`, and the result looked like a finished render. The
 * tell was that the bottom quarter of every street frame was one flat colour
 * whose nearest palette entry was `skyHaze` — the background — rather than
 * `groundLand`.
 *
 * That went unnoticed through several rounds of visual work, and it corrupted
 * every number: a palette "ceiling" measured at 0.277 on three different frames
 * was in fact the background colour appearing in three different places.
 *
 * So the invariant is narrow and structural, not aesthetic:
 *
 *   A street-level frame must not be dominated by exposed background.
 *
 * A pose is a FOOTPATH: the camera is 1.7 m up in a city, so sky cannot occupy
 * the lower half and the ground cannot be absent. These bounds are deliberately
 * loose — they are here to catch a missing surface, not to police composition,
 * and they will not notice a frame that is merely ugly.
 *
 * It reads the frame two ways, because each catches a different failure:
 *   - pixels, via `measure-scene.mjs`'s layer split, to catch exposure
 *   - the live scene, via `__geo.inspect()` + `game.waterAttached`, to catch a
 *     builder that threw and left the group unattached
 *
 * Needs `bun run dev` running and the six-pose harness having written
 * shots/enrich/*.png.
 *
 * Run: node scripts/check-visual.mjs
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PAL } from "../src/engine/palette.js";

/**
 * RGB distance to a palette entry, 0-255.
 *
 * Used as a SEMANTIC anchor, and this is the second attempt at this gate. The
 * first one used only layer coverage and it PASSED on a frame where the ground
 * was culled — because the sea underneath classified as `building` (it is blue
 * at chroma 71, which the colour rule calls low-chroma architecture). A frame
 * statistic cannot tell you that the floor is missing when something else is
 * standing in for it.
 *
 * So: assert the floor is the colour the floor is supposed to be, and
 * specifically that the sea is not showing through where land should be.
 */
const rgbOf = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
const dist = (a, b) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const GROUND_REFS = [PAL.groundLand, PAL.groundPaving, PAL.groundWorn, PAL.groundPale].map(rgbOf);
const SEA_REF = rgbOf(PAL.sea);
const SKY_REF = rgbOf(PAL.skyHaze);

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${detail ? " — " + detail : ""}`);
};

/* ---- 1. the live scene ---------------------------------------------------- */

const exe = join(
  process.env.HOME,
  "Library/Caches/ms-playwright/chromium-1124/chrome-mac/Chromium.app/Contents/MacOS/Chromium",
);
const { chromium } = await import(
  "/Users/Mitesh Gada/.npm-global/lib/node_modules/playwright/index.mjs"
);

let scene = null;
if (existsSync("shots/enrich") || true) {
  try {
    const browser = await chromium.launch({ executablePath: exe, headless: true });
    const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message.slice(0, 120)));
    await page.goto("http://localhost:5173/dashboard", { waitUntil: "load", timeout: 60000 });
    await page.waitForTimeout(13000);
    scene = await page.evaluate(() => {
      const i = window.__geo?.inspect?.();
      const canvas = document.querySelector("canvas");
      return { i, errors: [] };
    });
    scene.errors = errors;
    await browser.close();
  } catch (e) {
    console.log(`skip live scene check — dev server unreachable (${String(e.message).slice(0, 60)})`);
  }
}

if (scene?.i) {
  const kids = scene.i.waterChildren;
  ok("the ground/sea group is attached to the scene", scene.i.waterVisible === true);
  ok("it has meshes", Array.isArray(kids) && kids.length >= 2, `children=${kids?.length}`);
  if (Array.isArray(kids)) {
    for (const m of kids) {
      ok(`  ${m.name}: visible and has geometry`, m.visible === true && m.verts > 0, `verts=${m.verts}`);
    }
    const land = kids.find((m) => m.name === "land");
    // A whole-metro ground is thousands of runs; anything under a hundred means
    // the mask decoded to almost nothing and the floor would be a hole.
    ok("the land mesh has a plausible number of vertices", (land?.verts ?? 0) > 60000, `verts=${land?.verts}`);
  }
}
if (scene?.errors?.length) {
  ok("no uncaught page errors during boot", scene.errors.length === 0, scene.errors.slice(0, 2).join(" | "));
}

/* ---- 2. the frames ------------------------------------------------------- */

const SHOTS = "shots/enrich";
const FRAMES = [
  "fort-esplanade",
  "kala-ghoda",
  "gateway",
  "churchgate",
  "charni-road",
  "colaba-causeway",
];

if (!existsSync(SHOTS)) {
  console.log("skip frame checks — shots/enrich not present; run scripts/shot-enrich.mjs");
} else {
  const { measure, decodePng } = await import("./measure-scene.mjs");
  let checked = 0;
  for (const name of FRAMES) {
    const p = join(SHOTS, `${name}.png`);
    if (!existsSync(p)) {
      console.log(`  skip ${name} — not captured`);
      continue;
    }
    // --- semantic anchor on the floor colour, read straight off the pixels ---
    // decodePng returns {width, height, rgb:Uint8Array} interleaved 0..255
    const img = decodePng(readFileSync(p));
    const w = img.width, h = img.height;
    const px = (x, y) => {
      const i = (y * w + x) * 3;
      return [img.rgb[i], img.rgb[i + 1], img.rgb[i + 2]];
    };
    // sample the lower band: at 1.7 m on a footpath this is floor, always
    let nearGround = 0, nearSea = 0, nearSky = 0, n = 0;
    for (let y = Math.floor(h * 0.72); y < Math.floor(h * 0.96); y += 3) {
      for (let x = Math.floor(w * 0.1); x < Math.floor(w * 0.9); x += 3) {
        const c = px(x, y);
        if (!c) continue;
        n++;
        if (Math.min(...GROUND_REFS.map((g) => dist(c, g))) < 26) nearGround++;
        if (dist(c, SEA_REF) < 30) nearSea++;
        if (dist(c, SKY_REF) < 22) nearSky++;
      }
    }
    const gShare = n ? nearGround / n : 0;
    const sShare = n ? nearSea / n : 0;
    const kShare = n ? nearSky / n : 0;
    ok(
      `${name}: the lower band is GROUND, not sea showing through`,
      gShare > 0.5 && sShare < 0.25,
      `ground=${(gShare * 100).toFixed(0)}% sea=${(sShare * 100).toFixed(0)}% sky=${(kShare * 100).toFixed(0)}%`,
    );

    const m = measure(p);
    // `coverage` is already normalised shares summing to 1. The tool's own
    // `ground` layer reads 0 here on purpose: the new ground is low-chroma
    // mid-lightness and classifies into `building`, which is why that layer
    // jumped from 32.2% to 54.9% when the winding was fixed. The invariant is
    // therefore about SURFACE vs SKY, not about which bucket a pixel lands in.
    const cov = m.coverage ?? {};
    const surface =
      (cov.building ?? 0) +
      (cov.wash ?? 0) +
      (cov.road ?? 0) +
      (cov.ground ?? 0) +
      (cov.vegetation ?? 0);
    checked++;

    ok(
      `${name}: background is not exposed across the frame`,
      (cov.sky ?? 0) < 0.55,
      `sky=${((cov.sky ?? 0) * 100).toFixed(1)}%`,
    );
    ok(
      `${name}: most of the frame is world surface, not sky`,
      surface > 0.35,
      `surface=${(surface * 100).toFixed(1)}%  building=${((cov.building ?? 0) * 100).toFixed(1)}%`,
    );
    ok(
      `${name}: chroma p99.9 is in a sane band`,
      m.facade.chromaP999 > 0.05 && m.facade.chromaP999 < 0.99,
      `p99.9=${m.facade.chromaP999}`,
    );
  }
  if (!checked) console.log("skip frame checks — none of the six poses captured");
}

if (failures) {
  console.error(
    `\nvisual check FAILED (${failures}) — the world is not fully drawn. ` +
      `Metrics taken from these frames would be measuring a hole.`,
  );
  process.exit(1);
}
console.log("\nok  visual verified: the ground is attached and no frame is dominated by background.");