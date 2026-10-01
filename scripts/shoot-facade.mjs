/**
 * Dev-only: A/B the four facade treatments on one identical pose grid.
 *
 * The readability experiment. Everything is held constant — geometry, families,
 * palette, lighting, camera, post — and only `?facade=` changes, so any
 * difference in the numbers is attributable to facade structure alone.
 *
 * Captured at 1920x1080, the real target, because the whole question is
 * whether facade features survive at the resolution people actually play at.
 *
 *   bun scripts/shoot-facade.mjs [treatment]
 */
import { mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const exe = join(
  process.env.HOME,
  "Library/Caches/ms-playwright/chromium-1124/chrome-mac/Chromium.app/Contents/MacOS/Chromium",
);
const { chromium } = await import(
  "/Users/Mitesh Gada/.npm-global/lib/node_modules/playwright/index.mjs"
);

const XS = [-7000, -6000, -5000, -4000, -3000];
const ZS = [-19500, -18000, -16500, -15000, -13500];
const url = process.argv[2] ?? "http://localhost:5173/dashboard";
const TREAT = (process.argv[3] ?? "a").toLowerCase();
const out = `shots/facade/${TREAT}`;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on("pageerror", (e) => console.log(`  [pageerror] ${e.message.slice(0, 120)}`));

await page.goto(`${url}?facade=${TREAT}`, { waitUntil: "load", timeout: 90000 });
await page.waitForTimeout(14000);
await page.evaluate(() => {
  const c = [...document.querySelectorAll("div,section,button")].find(
    (e) => /click to walk/i.test(e.textContent ?? "") && e.getBoundingClientRect().width < 900,
  );
  c?.click();
});
await page.waitForTimeout(1500);

let i = 0;
for (const x of XS) {
  for (const z of ZS) {
    await page.evaluate(([x, z]) => window.__geo?.teleport?.(x, z, 0.8), [x, z]);
    await page.waitForTimeout(2600);
    const hud = await page.evaluate(() => document.body.innerText.replace(/\n+/g, " | "));
    if (i === 0) {
      const n = (k) => hud.match(new RegExp(k + " \\| ([^|]+)"))?.[1]?.trim() ?? "?";
      console.log(`  facade=${TREAT}  tris=${n("tris")} draws=${n("draws")} fps=${n("fps")}`);
    }
    await page.screenshot({ path: `${out}/p${String(++i).padStart(2, "0")}_${x}_${z}.png` });
  }
}
console.log(`shot ${i} poses -> ${out}`);
await browser.close();
