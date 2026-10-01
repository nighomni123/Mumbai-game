/**
 * Dev-only: shoot the street-density tiers on one street-level pose set.
 *
 * Held constant: facade D (now default), palette V2, ground, lighting, camera,
 * post-processing. Only `?street=` changes, so any difference is attributable to
 * street objects alone.
 *
 *   bun scripts/shoot-street.mjs [tier]
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const exe = join(
  process.env.HOME,
  "Library/Caches/ms-playwright/chromium-1124/chrome-mac/Chromium.app/Contents/MacOS/Chromium",
);
const { chromium } = await import(
  "/Users/Mitesh Gada/.npm-global/lib/node_modules/playwright/index.mjs"
);

const SPOTS = [
  ["fort-esplanade", -4577, -15919, 0.0],
  ["kala-ghoda", -4900, -16100, 1.6],
  ["gateway", -4555, -17143, 0.0],
  ["churchgate", -5544, -15451, 2.0],
  ["charni-road", -6291, -13826, 1.6],
  ["colaba-causeway", -5629, -18090, 0.4],
];
const TIER = (process.argv[2] ?? "a").toLowerCase();
const PLACE = process.argv[3] ?? "2";
const out = process.env.SHOOT_OUT ?? `shots/street/${TIER}p${PLACE}`;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on("pageerror", (e) => console.log(`  [pageerror] ${e.message.slice(0, 140)}`));

await page.goto(`http://localhost:5173/dashboard?street=${TIER}&place=${PLACE}`, {
  waitUntil: "load",
  timeout: 90000,
});
await page.waitForTimeout(14000);
await page.evaluate(() => {
  const c = [...document.querySelectorAll("div,section,button")].find(
    (e) => /click to walk/i.test(e.textContent ?? "") && e.getBoundingClientRect().width < 900,
  );
  c?.click();
});
await page.waitForTimeout(1500);

for (const [name, x, z, h] of SPOTS) {
  await page.evaluate(([x, z, h]) => window.__geo?.teleport?.(x, z, h), [x, z, h]);
  // Wait for the build queue to DRAIN, not for a fixed time. A fixed wait
  // screenshots whatever happens to be resident 4.2 s after the teleport, so
  // a faster build path and a slower one get compared at different points in
  // the same load — and the missing chunks read as a rendering regression
  // when they are only a load race. This is the fix: both sides are captured
  // at the same state, "everything that was asked for has arrived".
  await page
    .waitForFunction(() => (window.__geo?.inspect?.()?.queued ?? 1) === 0, {
      timeout: 30000,
      polling: 250,
    })
    .catch(() => console.log(`  [warn] ${name}: build queue never drained`));
  // One more settle so the final chunk's shadow flags and bounding volumes are
  // resolved before the frame is captured.
  await page.waitForTimeout(2500);
  const hud = await page.evaluate(() => document.body.innerText.replace(/\n+/g, " | "));
  const n = (k) => hud.match(new RegExp(k + " \\| ([^|]+)"))?.[1]?.trim() ?? "?";
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(`  ${name.padEnd(17)} chunks=${n("chunks").padEnd(6)} tris=${n("tris").padEnd(6)} draws=${n("draws").padEnd(4)} fps=${n("fps")}`);
}
console.log(`shot -> ${out}`);
await browser.close();
