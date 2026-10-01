/**
 * Dev-only: A/B the four facade treatments on a STREET-LEVEL pose set.
 *
 * The first pass used the 25-pose flyover grid and every treatment came out
 * identical — because on that grid the buildings are a thin strip on the horizon
 * and facade detail is sub-pixel. Measured: A-vs-D differs by 0.0 in the sky
 * and 0.0 in the lower frame of a horizon pose, and by 25.6 in the mid band of
 * a close pose. The treatments work; the poses could not see them.
 *
 * These are the six curated street positions, shot at 1920x1080.
 *
 *   bun scripts/shoot-facade-street.mjs [treatment]
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
const TREAT = (process.argv[2] ?? "a").toLowerCase();
const out = `shots/facade-street/${TREAT}`;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on("pageerror", (e) => console.log(`  [pageerror] ${e.message.slice(0, 120)}`));

await page.goto(`http://localhost:5173/dashboard?facade=${TREAT}`, {
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
  await page.waitForTimeout(4200);
  const hud = await page.evaluate(() => document.body.innerText.replace(/\n+/g, " | "));
  const n = (k) => hud.match(new RegExp(k + " \\| ([^|]+)"))?.[1]?.trim() ?? "?";
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(`  ${name.padEnd(17)} tris=${n("tris").padEnd(6)} draws=${n("draws").padEnd(4)} fps=${n("fps")}`);
}
console.log(`shot -> ${out}`);
await browser.close();
