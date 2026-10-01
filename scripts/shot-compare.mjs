/**
 * Dev-only: shoot OUR /dashboard on the same beats as the reference tour, so
 * the design spec compares two images rather than two memories.
 *
 * Scratch QA harness, not part of the build. Needs `bun run dev` first.
 *
 *   bun scripts/shot-compare.mjs
 * Output: shots/compare/*.png
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
page.on("console", (m) => {
  if (m.type() === "error") console.log(`  [err] ${m.text().slice(0, 160)}`);
});

console.log(`== goto ${url}`);
await page.goto(url, { waitUntil: "load", timeout: 90000 });
await page.waitForTimeout(12000);
await page.screenshot({ path: `${out}/00-entry.png` });
console.log("shot: 00-entry.png");

// The entry card is a div, not a button — click the card itself and confirm the
// overlay is gone, otherwise every later "walk" shot is the same frame.
const dismissed = await page.evaluate(() => {
  const card = [...document.querySelectorAll("div,section,button")].find(
    (e) => /click to walk/i.test(e.textContent ?? "") && e.getBoundingClientRect().width < 900,
  );
  if (!card) return false;
  card.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  card.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  card.click?.();
  return true;
});
console.log("  clicked card:", dismissed);
await page.waitForTimeout(2500);
const stillUp = await page.evaluate(() =>
  /click to walk/i.test(document.body.innerText),
);
console.log("  overlay still up:", stillUp);
if (stillUp) await page.mouse.click(720, 450);
await page.waitForTimeout(2000);
await page.screenshot({ path: `${out}/01-standing.png` });
console.log("shot: 01-standing.png");

// the harness's own telemetry hook, same numbers the HUD reads
const tel = await page.evaluate(() => {
  const g = window.__game ?? window.__geo;
  return g
    ? {
        keys: Object.keys(g).slice(0, 24),
        mode: g.mode,
        playing: g.playing,
        x: +g.x?.toFixed?.(1),
        z: +g.z?.toFixed?.(1),
      }
    : { missing: true, globals: Object.keys(window).filter((k) => /^__/.test(k)) };
});
console.log("  game object:", JSON.stringify(tel));

// walk forward, then look around — the same beats as the reference run
const hold = async (code, ms) => {
  await page.evaluate((c) => window.dispatchEvent(new KeyboardEvent("keydown", { code: c })), code);
  await page.waitForTimeout(ms);
  await page.evaluate((c) => window.dispatchEvent(new KeyboardEvent("keyup", { code: c })), code);
  await page.waitForTimeout(500);
};

await hold("KeyW", 3000);
await page.screenshot({ path: `${out}/02-walk-fwd.png` });
console.log("shot: 02-walk-fwd.png");

const afterWalk = await page.evaluate(() => {
  const g = window.__game ?? window.__geo;
  return { x: g?.x, z: g?.z, fps: g?.fps, keys: g ? Object.keys(g).slice(0, 30) : null };
});
console.log("  after walk:", JSON.stringify(afterWalk));

await hold("KeyW", 3000);
await page.screenshot({ path: `${out}/03-walk-far.png` });
console.log("shot: 03-walk-far.png");

await hold("KeyW", 3000);
await page.screenshot({ path: `${out}/04-walk-farther.png` });
console.log("shot: 04-walk-farther.png");

const fin = await page.evaluate(() => {
  const g = window.__game ?? window.__geo;
  const c = document.querySelector("canvas");
  return {
    pos: g ? { x: +g.x?.toFixed?.(1), z: +g.z?.toFixed?.(1), y: +g.y?.toFixed?.(1) } : {},
    fps: g ? Math.round(g.fps ?? 0) : 0,
    canvas: c ? `${c.width}x${c.height}` : "none",
    hud: document.body.innerText.replace(/\n+/g, " | ").slice(0, 300),
  };
});
console.log("  final:", JSON.stringify(fin));

await browser.close();
console.log("\ndone");