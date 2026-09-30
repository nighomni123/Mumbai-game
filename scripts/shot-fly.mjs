/**
 * Dev-only: drive /dashboard in a real browser and screenshot the admin-power
 * toggle in both states. Scratch QA harness, not part of the build, and no
 * Playwright dependency is declared for it — the import below is this
 * machine's global install. Change it, or `bunx playwright`, if it moves.
 *
 * Output lands in shots/, which is git-ignored.
 *
 *   bun scripts/shot-fly.mjs [url]
 */
import { chromium } from "/Users/Mitesh Gada/.npm-global/lib/node_modules/playwright/index.mjs";

const url = process.argv[2] ?? "http://localhost:5173/dashboard";
const out = "shots";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("console", (m) =>
  console.log(`  [page:${m.type()}] ${m.text().slice(0, 200)}`),
);
page.on("pageerror", (e) => console.log(`  [pageerror] ${e.message}`));

await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/fly-1-start.png` });
console.log("shot: start overlay");

// start walking (pointer lock will not engage headless; drag-to-look still works)
await page.getByRole("button", { name: /click to walk/i }).click();
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/fly-2-walking.png` });
console.log("shot: walking, toggle should read grounded");

const toggle = page.getByRole("button", { name: /admin power/i });
console.log("  toggle visible while playing:", await toggle.isVisible());
console.log(
  "  toggle text (off):",
  (await toggle.innerText()).replace(/\n/g, " | "),
);

await toggle.click();
await page.waitForTimeout(400);
console.log(
  "  aria-pressed after click:",
  await toggle.getAttribute("aria-pressed"),
);
console.log(
  "  toggle text (on):",
  (await toggle.innerText()).replace(/\n/g, " | "),
);
await page.screenshot({ path: `${out}/fly-3-power-on.png` });
console.log("shot: power on");

// climb: hold space, read the bridge the engine publishes
await page.evaluate(() =>
  window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" })),
);
await page.waitForTimeout(1500);
await page.evaluate(() =>
  window.dispatchEvent(new KeyboardEvent("keyup", { code: "Space" })),
);
await page.screenshot({ path: `${out}/fly-4-climbing.png` });
console.log("shot: climbing");

// the HUD polls `game`, so read the same numbers off the DOM the player sees
const readout = await page.evaluate(() => {
  const g = document.querySelector("canvas");
  return {
    canvas: !!g,
    hud: document.body.innerText.replace(/\n+/g, " | ").slice(0, 200),
  };
});
console.log("  page text:", readout.hud);

// turn the power off again, should fall back to the ground
await toggle.click();
await page.waitForTimeout(200);
console.log(
  "  aria-pressed after second click:",
  await toggle.getAttribute("aria-pressed"),
);
await page.screenshot({ path: `${out}/fly-5-power-off.png` });
console.log("shot: power off");

await browser.close();
