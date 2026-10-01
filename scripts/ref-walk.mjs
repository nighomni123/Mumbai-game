/**
 * Dev-only: drive the reference build (gulmohar-local.pages.dev/?city=mumbai)
 * through a scripted play-through and screenshot every beat. Scratch QA
 * harness, not part of the build; no Playwright dependency is declared for it.
 *
 * The build takes ~15s of canvas work before the entry card appears, so the
 * wait is on the card, not a fixed timeout.
 *
 *   bun scripts/ref-walk.mjs [url]
 * Output: shots/ref/*.png
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
const out = "shots/ref";
mkdirSync(out, { recursive: true });

// Headed, because against the REFERENCE build headless fell back to software
// rasterisation and its canvas build crawled. Our own scene is small enough
// that headless is fine and much faster.
//
// `fps` read out of a headless browser under automation is an automation
// number, not an engine verdict (scripts/live.mjs measured ~9 fps headed the
// same way). Trust `tris` and `draws` here; ignore `fps`.
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("console", (m) => {
  const t = m.text();
  if (m.type() === "error" || m.type() === "warning" || /build|enter|walk/i.test(t))
    console.log(`  [page:${m.type()}] ${t.slice(0, 200)}`);
});
page.on("pageerror", (e) => console.log(`  [pageerror] ${e.message}`));

let n = 0;
const shot = async (name) => {
  const p = `${out}/${String(++n).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path: p });
  console.log(`shot: ${p}`);
};
const hud = async (label) => {
  const t = await page.evaluate(() =>
    document.body.innerText.replace(/\n{2,}/g, "\n").trim().slice(0, 700),
  );
  console.log(`\n-- text @ ${label} --\n${t}\n`);
};
const key = async (code, ms = 0) => {
  await page.evaluate((c) => window.dispatchEvent(new KeyboardEvent("keydown", { code: c, key: c })), code);
  if (ms) await page.waitForTimeout(ms);
  await page.evaluate((c) => window.dispatchEvent(new KeyboardEvent("keyup", { code: c, key: c })), code);
  await page.waitForTimeout(700);
};
// pointer-lock look: move in steps so movementX/Y accumulate
const look = async (dx, dy = 0) => {
  for (let i = 0; i < 10; i++) {
    await page.mouse.move(720 + i, 450 + i, { steps: 1 });
    await page.evaluate(([x, y]) => {
      window.dispatchEvent(
        new MouseEvent("mousemove", { movementX: x, movementY: y, bubbles: true }),
      );
    }, [dx / 10, dy / 10]);
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(300);
};
const walk = async (code, ms) => {
  await page.evaluate((c) => window.dispatchEvent(new KeyboardEvent("keydown", { code: c, key: c })), code);
  await page.waitForTimeout(ms);
  await page.evaluate((c) => window.dispatchEvent(new KeyboardEvent("keyup", { code: c, key: c })), code);
  await page.waitForTimeout(400);
};

console.log(`== goto ${url}`);
await page.goto(url, { waitUntil: "load", timeout: 60000 });

console.log("waiting for the entry card (canvas build runs ~15s, #go is disabled until done)");
await page.waitForSelector("#go:not([disabled])", { timeout: 240000 });
await page.waitForFunction(() => !!window.__THREE__, null, { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(2000);
await shot("landing");
await hud("landing");

// ---- enter -------------------------------------------------------------
await page.getByRole("button", { name: /walk in/i }).click();
await page.waitForTimeout(3000);
await shot("standing");
await hud("standing");

// ---- walk --------------------------------------------------------------
await walk("KeyW", 2500);
await shot("walk-fwd-2.5s");
await walk("KeyW", 2500);
await shot("walk-fwd-5s");
await hud("after 5s forward");

await walk("KeyW", 1500);
await look(700, 0);
await shot("look-right-70");
await look(700, 0);
await shot("look-right-140");
await look(700, 0);
await shot("look-right-210");
await look(-2100, 0);
await shot("look-around-full");
await hud("after look");

// run
await walk("KeyW", 2000);
await page.evaluate(() => {
  window.dispatchEvent(new KeyboardEvent("keydown", { code: "ShiftLeft", key: "Shift" }));
});
await walk("KeyW", 3000);
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keyup", { code: "ShiftLeft", key: "Shift" })));
await shot("after-run");
await hud("after run");

// ---- world-state keys --------------------------------------------------
await key("KeyT");
await shot("time-toggled");
await hud("time");
await key("KeyT");

await key("KeyK");
await page.waitForTimeout(2500);
await shot("rain");
await hud("rain");
await key("KeyK");

await key("KeyP");
await page.waitForTimeout(4000);
await shot("planet");
await hud("planet");
await key("KeyP");
await page.waitForTimeout(3000);
await shot("back-from-planet");

// interact
await key("KeyE");
await shot("interact");
await hud("interact");

// hide UI
await key("KeyH");
await shot("ui-hidden");
await key("KeyH");

// menu
await key("Escape");
await page.waitForTimeout(800);
await shot("menu");
await hud("menu");

await browser.close();
console.log("\ndone");