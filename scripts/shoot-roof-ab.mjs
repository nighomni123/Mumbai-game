/**
 * A/B the roof cap in the live app, at the poses that were actually reported.
 *
 *   git stash push src/geo/buildings.ts   # revert the fix
 *   PORT=5199 bun scripts/shoot-roof-ab.mjs before
 *   git stash pop                          # restore the fix
 *   PORT=5199 bun scripts/shoot-roof-ab.mjs after
 *
 * Street level at Fort (the reported repro: "surface ground", nearest fort,
 * 1-28 m) at four headings, plus a stand-back from b_315613914 — the 180-vertex
 * ring whose centroid fan drew a 620 x 610 m phantom plane at H=30.
 *
 * `teleport(x, z, heading)` takes a HEADING, not an altitude, so every pose here
 * is ground level on purpose: that is what the screenshots showed.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const TAG = process.argv[2] ?? "ab";
const PORT = process.env.PORT ?? "5199";
const exe = join(
  process.env.HOME,
  "Library/Caches/ms-playwright/chromium-1124/chrome-mac/Chromium.app/Contents/MacOS/Chromium",
);
const { chromium } = await import(
  "/Users/Mitesh Gada/.npm-global/lib/node_modules/playwright/index.mjs"
);

const SPOTS = [
  ["fort-n", -4577, -15919, 0],
  ["fort-e", -4577, -15919, Math.PI / 2],
  ["fort-s", -4577, -15919, Math.PI],
  ["fort-w", -4577, -15919, -Math.PI / 2],
  // b_315613914 lives in chunk_-1_1 -> origin (-2000, 2000); its ring centroid
  // is chunk-local (-417, 2239), so world (-2417, 4239).
  ["b-315613914", -2417, 4239, Math.PI],
];

const out = `shots/roof-ab-${TAG}`;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ executablePath: exe, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto(`http://localhost:${PORT}/dashboard`, { waitUntil: "load", timeout: 90000 });
  await page.waitForTimeout(16000);
  await page.evaluate(() => {
    const c = [...document.querySelectorAll("div,section,button")].find(
      (e) => /click to walk/i.test(e.textContent ?? "") && e.getBoundingClientRect().width < 900,
    );
    c?.click();
  });
  await page.waitForTimeout(2000);

  for (const [name, x, z, h] of SPOTS) {
    await page.evaluate(([x, z, h]) => window.__geo?.teleport?.(x, z, h), [x, z, h]);
    await page.waitForTimeout(5000);
    await page.screenshot({ path: `${out}/${name}.png` });
    const hud = await page.evaluate(() => document.body.innerText.replace(/\n+/g, " | "));
    const n = (k) => hud.match(new RegExp(k + " \\| ([^|]+)"))?.[1]?.trim() ?? "?";
    console.log(`  ${name.padEnd(14)} tris=${n("tris").padEnd(7)} draws=${n("draws").padEnd(5)} fps=${n("fps")}`);
  }
  console.log(`shot -> ${out}`);
} finally {
  await browser.close();
}
