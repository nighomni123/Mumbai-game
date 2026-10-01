/**
 * Dev-only: shoot the two map views — the HUD minimap and the full-map overlay.
 *
 *   bun scripts/shoot-maps.mjs [port]
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const PORT = process.argv[2] ?? "5199";
const exe = join(
  process.env.HOME,
  "Library/Caches/ms-playwright/chromium-1124/chrome-mac/Chromium.app/Contents/MacOS/Chromium",
);
const { chromium } = await import(
  "/Users/Mitesh Gada/.npm-global/lib/node_modules/playwright/index.mjs"
);

const out = "shots/maps";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (e) => console.log(`  [pageerror] ${e.message.slice(0, 160)}`));
await page.goto(`http://localhost:${PORT}/dashboard`, { waitUntil: "load", timeout: 90000 });
await page.waitForTimeout(16000);
await page.evaluate(() => {
  const c = [...document.querySelectorAll("div,section,button")].find(
    (e) => /click to walk/i.test(e.textContent ?? "") && e.getBoundingClientRect().width < 900,
  );
  c?.click();
});
await page.waitForTimeout(1500);

// 1. the minimap at two positions, so the marker is seen to move
for (const [name, x, z] of [
  ["minimap-fort", -4577, -15919],
  ["minimap-juhu", 1200, -19600],
]) {
  await page.evaluate(([x, z]) => window.__geo?.teleport?.(x, z, 220), [x, z]);
  await page.waitForTimeout(4500);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(`  ${name}`);
}

// 2. the full-map overlay
await page.evaluate(() => window.__geo?.teleport?.(-4577, -15919, 220));
await page.waitForTimeout(3500);
await page.evaluate(() => window.__geo?.openMap?.());
await page.waitForTimeout(3500);
await page.screenshot({ path: `${out}/fullmap.png` });
console.log("  fullmap");

await browser.close();
