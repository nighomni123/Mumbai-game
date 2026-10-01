/**
 * Dev-only: shoot the Fort vertical slice before/after enrichment, and measure.
 *
 * This is the honest test of the enrichment pipeline: same place, same camera,
 * colour-family spread counted with PIL. The baseline recorded on 2026-09-30
 * was 1,865 distinct colours across 3 hue families per street frame.
 *
 * Needs `bun run dev` first.
 *
 *   bun scripts/shot-enrich.mjs
 * Output: shots/enrich/*.png
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
const out = "shots/enrich";
mkdirSync(out, { recursive: true });

/** Fort, Kala Ghoda, Colaba — the real places, converted to local metres. */
const SPOTS = [
  ["fort-esplanade", -4577, -15919, 0.0],
  ["kala-ghoda", -4900, -16100, 1.6],
  ["gateway", -4555, -17143, 0.0],
  ["churchgate", -5544, -15451, 2.0],
  ["charni-road", -6291, -13826, 1.6],
  ["colaba-causeway", -5629, -18090, 0.4],
];

const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (e) => console.log(`  [pageerror] ${e.message}`));

await page.goto(url, { waitUntil: "load", timeout: 90000 });
await page.waitForTimeout(14000);
await page.evaluate(() => {
  const card = [...document.querySelectorAll("div,section,button")].find(
    (e) => /click to walk/i.test(e.textContent ?? "") && e.getBoundingClientRect().width < 900,
  );
  card?.click();
});
await page.waitForTimeout(2000);

for (const [name, x, z, heading] of SPOTS) {
  await page.evaluate(([x, z, h]) => window.__geo?.teleport?.(x, z, h), [x, z, heading]);
  await page.waitForTimeout(4500);
  const hud = await page.evaluate(() => document.body.innerText.replace(/\n+/g, " | "));
  const num = (k) => hud.match(new RegExp(k + " \\| ([^|]+)"))?.[1]?.trim() ?? "?";
  await page.screenshot({ path: `${out}/${name}.png` });
  if (name === "kala-ghoda") {
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyG" })));
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${out}/qa-panel.png` });
    console.log("  shot: qa-panel.png");
  }
  console.log(
    `  ${name.padEnd(18)} fps=${num("fps").padEnd(4)} chunks=${num("chunks").padEnd(4)} ` +
      `draws=${num("draws").padEnd(5)} tris=${num("tris").padEnd(7)} nearby=${num("nearby")}`,
  );
}

await browser.close();
console.log("\ndone");