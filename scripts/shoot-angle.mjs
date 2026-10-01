/**
 * Dev-only: reproduce the "specific angles" artefact at a fixed heading.
 *
 *   bun scripts/shoot-angle.mjs [port] [tag] [heading]
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const PORT = process.argv[2] ?? "5199";
const TAG = process.argv[3] ?? "angle";
const HEAD = Number(process.argv[4] ?? "220");
const exe = join(
  process.env.HOME,
  "Library/Caches/ms-playwright/chromium-1124/chrome-mac/Chromium.app/Contents/MacOS/Chromium",
);
const { chromium } = await import(
  "/Users/Mitesh Gada/.npm-global/lib/node_modules/playwright/index.mjs"
);

const out = `shots/${TAG}`;
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
await page.evaluate(([h]) => window.__geo?.teleport?.(-4577, -15919, h), [HEAD]);
await page.waitForTimeout(6000);
await page.screenshot({ path: `${out}/h${HEAD}.png` });
console.log(`-> ${out}/h${HEAD}.png`);
await browser.close();
