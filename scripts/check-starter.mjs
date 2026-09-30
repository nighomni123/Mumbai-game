/**
 * Does a FRESH CLONE have a city?
 *
 * The starter slice exists so `git clone && bun run dev` is not an empty world,
 * but nothing in the normal test path exercises that: on a working machine
 * data/build/ is present, so the fallback is never taken and a break in it is
 * invisible until someone clones the repo.
 *
 * So this hides data/build/ for the duration of the run and asserts the world
 * still builds geometry from data/starter/ alone. That is the exact situation a
 * cloner is in, and it fails loudly if the committed slice goes stale, is not
 * committed, or drifts from the URL the loader asks for.
 *
 * Run: node scripts/check-starter.mjs   (needs the dev server up)
 */

import { existsSync, readdirSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const PW_ROOT =
  "/Users/Mitesh Gada/.npm-global/lib/node_modules/playwright";

/**
 * Point Playwright at a Chromium it can actually launch.
 *
 * This machine exports PLAYWRIGHT_BROWSERS_PATH at a folder that DOES exist —
 * so the usual "is the path there?" check passes and nothing is repaired — but
 * it holds chromium-1223 while the installed Playwright wants 1124, so every
 * launch dies with "Executable doesn't exist". (scripts/live.mjs has the same
 * hole; it only repairs when the whole folder is missing.)
 *
 * So: ask playwright-core which revision it wants, and look for THAT.
 */
function resolveChromium() {
  const wanted = (() => {
    try {
      const b = JSON.parse(
        readFileSync(
          join(PW_ROOT, "node_modules/playwright-core/browsers.json"),
          "utf8",
        ),
      );
      return b.browsers.find((x) => x.name === "chromium")?.revision;
    } catch {
      return undefined;
    }
  })();

  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    join(homedir(), "Library/Caches/ms-playwright"),
  ].filter(Boolean);

  for (const root of roots) {
    if (wanted && existsSync(join(root, `chromium-${wanted}`))) {
      process.env.PLAYWRIGHT_BROWSERS_PATH = root;
      return null; // let Playwright resolve it
    }
  }
  // No exact revision anywhere: fall back to any Chromium we can find.
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const d of readdirSync(root)) {
      if (!d.startsWith("chromium-")) continue;
      const exe = join(
        root,
        d,
        "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
      );
      if (existsSync(exe)) {
        console.warn(
          `[check-starter] no chromium-${wanted} found; using ${d} via executablePath`,
        );
        return exe;
      }
    }
  }
  return null;
}

const executablePath = resolveChromium();

const { chromium } = await import(join(PW_ROOT, "index.mjs"));

const URL = process.env.STARTER_URL || "http://localhost:5173/geo.html";

const probe = async () => {
  const browser = await chromium.launch(
    executablePath ? { executablePath } : {},
  );
  const page = await browser.newPage();
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(URL, { waitUntil: "domcontentloaded" });

  // The world streams chunks and extrudes them over a few seconds; wait for the
  // counters to settle rather than sampling once and racing the loader.
  let best = { chunks: 0, calls: 0, triangles: 0, landKm2: 0 };
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(500);
    const s = await page.evaluate(() => {
      const g = window.__geo?.game;
      if (!g) return null;
      return {
        chunks: g.chunks,
        calls: g.calls,
        triangles: g.triangles,
        landKm2: g.landKm2,
      };
    });
    if (s && s.chunks > best.chunks) best = s;
    if (s && s.chunks > 0 && s.calls > 0) {
      await page.waitForTimeout(1500);
      const t = await page.evaluate(() => {
        const g = window.__geo?.game;
        return g ? { chunks: g.chunks, calls: g.calls, triangles: g.triangles, landKm2: g.landKm2 } : null;
      });
      if (t && t.calls > 0) best = t;
      break;
    }
  }
  await browser.close();
  return { best, errors };
};

// Hide the full world for the duration, so this really tests the cloner. A
// rename on the same filesystem is instant and touches none of the 155 MB, and
// it is undone in `finally` — the one thing this script must never do is leave
// someone's build output renamed.
const LIVE = "data/build";
const HIDDEN = "data/build.hidden-by-check";
let hid = false;
if (existsSync(LIVE)) {
  renameSync(LIVE, HIDDEN);
  hid = true;
} else {
  console.warn(
    "data/build/ already absent — this machine already looks like a fresh clone",
  );
}

let result;
try {
  result = await probe();
} finally {
  if (hid && existsSync(HIDDEN)) {
    renameSync(HIDDEN, LIVE);
    console.log("(data/build restored)\n");
  }
}

const { best, errors } = result;

console.log(
  hid
    ? "starter slice check — data/build/ hidden, committed slice only\n"
    : "starter slice check — no data/build/, committed slice only\n",
);
console.log(`  resident chunks   ${best.chunks}`);
console.log(`  draw calls        ${best.calls}`);
console.log(`  triangles         ${best.triangles.toLocaleString()}`);
console.log(`  land km2          ${best.landKm2}`);

let fail = 0;
const ok = (label, cond) => {
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}`);
  if (!cond) fail++;
};

// A cloner must see a real city: geometry resident, drawn, and a sea (the
// landmask is what puts the harbour west of Fort).
ok("geometry is resident from the committed slice", best.chunks > 0);
ok("the GPU is drawing it", best.calls > 0);
ok("the land mask loaded (sea + walker collision)", best.landKm2 > 0);

const realErrors = errors.filter(
  (e) => !/favicon|Download the React DevTools/i.test(e),
);
if (realErrors.length) {
  console.log("\n  console errors:");
  for (const e of realErrors.slice(0, 5)) console.log(`    ${e}`);
}
ok("no console errors", realErrors.length === 0);

console.log(
  fail
    ? `\nFAIL — ${fail} check(s) failed. The committed slice does not stand alone.`
    : "\nOK — a fresh clone gets a real Mumbai.",
);
process.exit(fail ? 1 : 0);