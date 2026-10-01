/**
 * Dev-only: shoot the poses that exposed the winding and sky-dome bugs.
 *
 *   bun scripts/shoot-fix.mjs [port] [tag]
 *
 * Street-level, close range, and one far-out-in-the-suburbs pose. Transparent
 * walls only read at close range (you see the road through a facade), and the
 * sky dome only breaks past 3,200 m from the origin (Andheri).
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const PORT = process.argv[2] ?? "5199";
const TAG = process.argv[3] ?? "fix";
const exe = join(
  process.env.HOME,
  "Library/Caches/ms-playwright/chromium-1124/chrome-mac/Chromium.app/Contents/MacOS/Chromium",
);
const { chromium } = await import(
  "/Users/Mitesh Gada/.npm-global/lib/node_modules/playwright/index.mjs"
);

const SPOTS = [
  // close street level — the transparent-wall read
  ["fort-close", -4577, -15919, 1.6],
  ["charni-close", -6291, -13826, 1.6],
  // a second angle, since the bug was reported as "specific angles"
  ["churchgate-close", -5544, -15451, 2.0],
  // high altitude over the core — roof caps and massing
  ["fort-air", -4577, -15919, 220],
  // far west of the origin — where a fixed sky dome breaks
  ["andheri-air", -14400, -6400, 180],
  ["andheri-close", -14400, -6400, 1.6],
];

const out = `shots/${TAG}`;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (e) => console.log(`  [pageerror] ${e.message.slice(0, 140)}`));

await page.goto(`http://localhost:${PORT}/dashboard`, {
  waitUntil: "load",
  timeout: 90000,
});
await page.waitForTimeout(16000);
// dismiss the entry card so the HUD is up
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
  const hud = await page.evaluate(() => document.body.innerText.replace(/\n+/g, " | "));
  const n = (k) => hud.match(new RegExp(k + " \\| ([^|]+)"))?.[1]?.trim() ?? "?";
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(
    `  ${name.padEnd(16)} tris=${n("tris").padEnd(7)} draws=${n("draws").padEnd(5)} fps=${n("fps").padEnd(4)} lat=${n("lat")}`,
  );
}
console.log(`shot -> ${out}`);
await browser.close();
