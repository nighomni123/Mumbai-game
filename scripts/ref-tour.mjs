/**
 * Dev-only: tour the reference build (gulmohar-local.pages.dev/?city=mumbai)
 * using its own debug API rather than blind walking, so every district is
 * actually reached instead of a wall.
 *
 * The build publishes `window.__api = { pose, tod, player, post, fpsPoses }`
 * and `player.physics.{groundAt,collide}` — so every pose below is validated
 * against real geometry before it is shot. Guessed poses land inside walls;
 * these ones cannot.
 *
 * Walkable strips, from the build's own road table (assets/ground-*.js):
 *   north road z 13..21, south road z -21..-13, platform z 22.4 / 11.4,
 *   back lane z 57..61, ridge road z -64..-58, side lanes at x -90 -43 0 46 98.
 * Block centres are looked AT from the adjacent lane, not stood in.
 *
 *   bun scripts/ref-tour.mjs [url]
 * Output: shots/ref/tour/*.png
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const exe = join(
  process.env.HOME,
  "Library/Caches/ms-playwright/chromium-1124/chrome-mac/Chromium.app/Contents/MacOS/Chromium",
);
const { chromium } =
  await import("/Users/Mitesh Gada/.npm-global/lib/node_modules/playwright/index.mjs");

const url = process.argv[2] ?? "https://gulmohar-local.pages.dev/?city=mumbai";
const out = "shots/ref/blocks";
mkdirSync(out, { recursive: true });

// name, stand x, stand z, look-at x, look-at z, tod(0 golden/.5 blue/1 night), rain
const TOUR = [
  // Blocks are looked AT from the road in front, not stood in — the fillers
  // put buildings at z 34..48 with the open middle behind them.
  ["b1-bazaar-front", -66, 17, -66, 48, 0, 0],
  ["b2-chawl-front", 24, 17, 24, 48, 0, 0],
  ["b3-talkies-front", 72, 17, 72, 48, 0, 0],
  ["b4-khotachi-front", 130, 17, 130, 48, 0, 0],
  ["b5-temple-front", -66, -17, -66, -48, 0, 0],
  ["b6-mandi-front", -22, -17, -22, -48, 0, 0],
  ["b7-hall-front", 72, -17, 72, -48, 0, 0],
  ["b8-bazaar-lane", -43, 40, -66, 40, 0, 0],
  ["b9-talkies-lane", 98, 40, 72, 40, 0, 0],
  ["b10-temple-lane", -43, -40, -66, -40, 0, 0],
  ["b11-station-crowd", -9, 18, -9, 24, 0, 0],
  ["b12-platform-wide", -60, 23, 40, 16, 0, 0],
  ["b13-seafront-wide", -100, 92, 120, 100, 0, 0],
  ["b14-tetrapod-close", 60, 92, 60, 130, 0, 0],
];

const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (e) => console.log(`  [pageerror] ${e.message}`));

console.log(`== goto ${url}`);
await page.goto(url, { waitUntil: "load", timeout: 60000 });
await page.waitForSelector("#go:not([disabled])", { timeout: 240000 });
await page.click("#go");
await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
await page.waitForTimeout(4000); // the entry card lifts over ~2s
// Escape would open the pause card and sit on top of every frame.
await page
  .getByRole("button", { name: /keep walking/i })
  .click({ timeout: 2000 })
  .catch(() => {});
await page.waitForTimeout(800);

console.log("  __api:", await page.evaluate(() => Object.keys(window.__api ?? {})));

// Nudge off a blocked spot: the game's own collide() pushes a point out of any
// solid it is inside, so an unchanged return means the spot is genuinely free.
const solve = (x, z) =>
  page.evaluate(
    ([x, z]) => {
      const ph = window.__api.player.physics;
      const RING = [0, 2, -2, 4, -4, 7, -7, 11, -11, 16, -16];
      for (const dx of RING)
        for (const dz of RING) {
          const X = x + dx,
            Z = z + dz;
          const y = ph.groundAt(X, Z);
          if (!isFinite(y) || y > 200) continue;
          const [cx, cz] = ph.collide(X, Z, 0.34, y);
          if (Math.hypot(cx - X, cz - Z) < 0.02) return { x: X, z: Z, y };
        }
      return null;
    },
    [x, z],
  );

let i = 0;
let bad = 0;
for (const [name, sx, sz, tx, tz, tod, rain] of TOUR) {
  const spot = await solve(sx, sz);
  if (!spot) {
    console.log(`  !! ${name}: no free spot near (${sx},${sz}) — skipped`);
    bad++;
    continue;
  }
  const moved = Math.hypot(spot.x - sx, spot.z - sz) > 0.5;
  await page.evaluate(
    ([x, z, tx, tz, yaw, pitch, tod, rain]) => {
      const a = window.__api;
      a.tod.t = a.tod.target = tod;
      a.tod.rain = a.tod.rainTarget = rain;
      a.pose({ x, z, yaw, pitch });
    },
    [
      spot.x,
      spot.z,
      tx,
      tz,
      Math.atan2(spot.x - tx, spot.z - tz),
      0.05,
      tod,
      rain,
    ],
  );
  await page.evaluate(() => window.__api.tod.update(10)); // snap the sky lerp
  await page.waitForTimeout(900);
  const d = await page.evaluate(() => {
    const m = document.body.innerText.match(/[\u0900-\u097F][\u0900-\u097F\s]*\n\s*[A-Z][A-Za-z .]+/);
    return { label: m ? m[0].replace(/\n/g, " / ") : "?", y: +window.__api.player.y.toFixed(1) };
  });
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(
    `  ${String(++i).padStart(2)} ${name.padEnd(24)} x${spot.x.toFixed(0)} z${spot.z.toFixed(0)} y${d.y}${moved ? " (nudged)" : ""}  ${d.label}`,
  );
}

await browser.close();
console.log(`\ndone — ${i} shots, ${bad} skipped`);