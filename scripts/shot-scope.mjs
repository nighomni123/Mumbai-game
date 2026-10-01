/**
 * Dev-only: verify the ACTIVE_BOUNDS map wash renders — the deferred east,
 * north and south should read grey while the city stays normal, and place pins
 * must survive on top of it.
 *
 * Needs `bun run dev` first. Output: shots/compare/map-*.png
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const exe = join(
  process.env.HOME,
  "Library/Caches/ms-playwright/chromium-1124/chrome-mac/Chromium.app/Contents/MacOS/Chromium",
);
const { chromium } =
  await import("/Users/Mitesh Gada/.npm-global/lib/node_modules/playwright/index.mjs");

const url = process.argv[2] ?? "http://localhost:5173/dashboard";
const out = "shots/compare";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (e) => console.log(`  [pageerror] ${e.message}`));

await page.goto(url, { waitUntil: "load", timeout: 90000 });
await page.waitForTimeout(14000);

// the minimap is on the HUD by default
const mini = page.locator("canvas").last();
await mini.screenshot({ path: `${out}/map-minimap.png` }).catch(() => {});
console.log("shot: map-minimap.png");

// full map overlay
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button,a")].find((e) =>
    /open map/i.test(e.textContent ?? ""),
  );
  b?.click();
});
await page.waitForTimeout(3000);
await page.screenshot({ path: `${out}/map-overlay.png` });
console.log("shot: map-overlay.png");

// back to the city, then teleport into the now-deferred east to prove that
// nothing loads there
await page
  .getByRole("link", { name: /back to the city/i })
  .click({ timeout: 8000 })
  .catch(() => page.evaluate(() => (window.__game?.teardown?.(), 0)));
await page.waitForTimeout(2000);
const before = await page.evaluate(() => document.body.innerText.replace(/\n+/g, " | ").slice(0, 260));
console.log("  hud before:", before);

// Real places either side of each cut, from src/geo/places.ts. __geo.teleport
// takes LOCAL METRES, so convert here rather than exposing more to window.
const SPOTS = [
  ["IN  fort", 72.8345, 18.933],
  ["IN  bhandup (east limit)", 72.937, 19.1445],
  ["IN  thane", 72.97, 19.188],
  ["OUT vashi (east of cut)", 72.997, 19.077],
  ["OUT belapur (east of cut)", 72.9935, 19.23],
];
const OLON = 72.878, OLAT = 19.076, MPL = 111320;
const MPX = MPL * Math.cos((OLAT * Math.PI) / 180);
const inScope = (lon, lat) => {
  const x = (lon - OLON) * MPX, y = (lat - OLAT) * MPL;
  return x >= -14730 && x <= 12148 && y >= -20622 && y <= 26673;
};

for (const [label, lon, lat] of SPOTS) {
  await page.evaluate(
    ([x, z]) => window.__geo?.teleport?.(x, z, Math.PI),
    [(lon - OLON) * MPX, (lat - OLAT) * MPL],
  );
  await page.waitForTimeout(4000);
  const hud = await page.evaluate(() => document.body.innerText.replace(/\n+/g, " | "));
  const num = (k) => hud.match(new RegExp(k + " \\| ([^|]+)"))?.[1]?.trim() ?? "?";
  console.log(
    `  ${label.padEnd(26)} inScope=${String(inScope(lon, lat)).padEnd(5)} ` +
      `chunks=${num("chunks").padEnd(3)} tris=${num("tris").padEnd(6)} at ${num("where")}`,
  );
  await page.screenshot({ path: `${out}/scope-${label.split(" ")[0]}-${label.split(" ").pop().replace(/[^a-z0-9]/gi, "")}.png` });
}

await browser.close();
console.log("\ndone");