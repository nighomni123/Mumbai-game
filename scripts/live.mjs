#!/usr/bin/env node
/**
 * Live harness — watch the real game while you play it, or let the harness
 * drive and then scrub the entire run in Playwright's Trace Viewer.
 *
 *   bun scripts/live.mjs                 scripted play-through -> trace + video
 *   bun scripts/live.mjs --watch [sec]   hands-off: you play, it samples telemetry
 *   bun scripts/live.mjs --url <u>       default http://localhost:5173/dashboard
 *
 * Everything lands in shots/live/ (git-ignored):
 *   trace.zip       open with: npx playwright show-trace shots/live/trace.zip
 *   video/*.webm    video of the run — only if Playwright's ffmpeg is installed
 *   latest.png      newest frame
 *   <n>-<beat>.png  the play-through beats
 *   telemetry.jsonl one line per sample
 *
 * Telemetry reads `window.__game` — the same mutable bridge the HUD polls — so
 * the numbers here are the numbers on screen. `__game` only exists in DEV
 * (MumbaiWorld.tsx gates it on import.meta.env.DEV), so this cannot work
 * against a production build. That is fine: the point is to test the dev build.
 *
 * Same global-Playwright import as shot-fly.mjs, for the same reason: no
 * Playwright dependency is declared for dev-only QA, and the machine has it
 * installed globally.
 */
import {
  mkdirSync,
  writeFileSync,
  appendFileSync,
  readdirSync,
  rmSync,
  existsSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// This machine exports PLAYWRIGHT_BROWSERS_PATH pointing at a folder that does
// not exist, while Chromium really lives in the default cache. Repair it only
// when the configured path is unusable, so a working env is left alone. Has to
// happen before playwright loads, hence the dynamic import.
if (
  !process.env.PLAYWRIGHT_BROWSERS_PATH ||
  !existsSync(process.env.PLAYWRIGHT_BROWSERS_PATH)
) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = join(
    homedir(),
    "Library/Caches/ms-playwright",
  );
}

// Video needs ffmpeg, which Playwright ships as a separate download that is
// not present here. The trace — the thing you actually scrub — does not.
const hasFfmpeg =
  existsSync(process.env.PLAYWRIGHT_BROWSERS_PATH) &&
  readdirSync(process.env.PLAYWRIGHT_BROWSERS_PATH).some((d) =>
    d.startsWith("ffmpeg-"),
  );

const { chromium } =
  await import("/Users/Mitesh Gada/.npm-global/lib/node_modules/playwright/index.mjs");

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(k);
  return i === -1 ? d : argv[i + 1];
};

const url = arg("--url", "http://localhost:5173/dashboard");
const watch = argv.includes("--watch");
const every = Number(arg("--watch", 5)) || 5;
const OUT = "shots/live";
const W = 1280;
const H = 800;

// fresh run every time, so a trace is never a mix of two sessions
rmSync(OUT, { recursive: true, force: true });
mkdirSync(`${OUT}/video`, { recursive: true });
writeFileSync(`${OUT}/telemetry.jsonl`, "");

let beat = 0;
const problems = [];

/** Read the game's own state bridge, plus the canvas and HUD as a fallback. */
const readState = () =>
  // eslint-disable-next-line no-undef
  ({
    t: new Date().toISOString().slice(11, 19),
    playing: window.__game?.playing ?? null,
    ready: window.__game?.ready ?? null,
    fly: window.__game?.fly ?? null,
    fps: window.__game?.fps ?? null,
    pos: window.__game
      ? [
          +window.__game.x.toFixed(2),
          +window.__game.y.toFixed(2),
          +window.__game.z.toFixed(2),
        ]
      : null,
    speed: window.__game ? +window.__game.speed.toFixed(2) : null,
    onPlatform: window.__game?.onPlatform ?? null,
    nearest: window.__game?.nearest ?? null,
    canvas: (() => {
      const c = document.querySelector("canvas");
      return c ? `${c.width}x${c.height}` : null;
    })(),
    hudFps: document.body.innerText.match(/(\d+)\s*fps/)?.[1] ?? null,
  });

async function sample(page) {
  const s = await page.evaluate(readState);
  const line = JSON.stringify(s);
  appendFileSync(`${OUT}/telemetry.jsonl`, `${line}\n`);
  console.log(
    `  ${s.t}  fps ${String(s.fps ?? s.hudFps ?? "?").padStart(3)}` +
      `  pos ${JSON.stringify(s.pos ?? null).padEnd(22)}` +
      `  v ${String(s.speed ?? "?").padStart(5)}  ${s.onPlatform ? "platform" : "road"}` +
      `  ${s.fly ? "fly " : ""}${s.playing ? "walking" : "overlay "}` +
      `  ${s.nearest ? `[${s.nearest}]` : ""}`,
  );
  return s;
}

/** One recorded beat: act, settle, screenshot, measure. */
async function beatStep(page, label, act, settle = 900) {
  const n = String(++beat).padStart(2, "0");
  console.log(`\n▸ ${n} ${label}`);
  try {
    await act();
  } catch (e) {
    console.log(`  ! ${label} failed: ${e.message.split("\n")[0]}`);
  }
  await page.waitForTimeout(settle);
  await page.screenshot({ path: `${OUT}/${n}-${label}.png` });
  await page.screenshot({ path: `${OUT}/latest.png` });
  await sample(page);
}

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({
  viewport: { width: W, height: H },
  // Video is a nice-to-have; the trace is the artefact. Skip it rather than
  // fail the whole run when ffmpeg is missing.
  ...(hasFfmpeg
    ? { recordVideo: { dir: `${OUT}/video`, size: { width: W, height: H } } }
    : {}),
});
// Only worth recording when this harness is the one driving. In watch mode the
// player types the actions, which Playwright does not record as actions at
// all — so a trace would be near-empty, while still costing ~17 MB of staged
// screenshots and, on a long session, failing to assemble at all. Watch mode
// gets interval screenshots + telemetry instead, which is what you want anyway.
const tracing = !watch;
if (tracing)
  await context.tracing.start({
    screenshots: true,
    snapshots: true,
    sources: false,
  });

const page = await context.newPage();
page.on("pageerror", (e) =>
  problems.push(`[pageerror] ${e.message.split("\n")[0]}`),
);
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning")
    problems.push(`[${m.type()}] ${m.text().slice(0, 180)}`);
});

// A trace is only written by an explicit stop(), so a Ctrl-C or a killed
// process would otherwise throw the whole recording away — which is exactly
// how you stop a watch session. SIGINT and the page closing fire at the same
// moment, so every caller awaits the SAME promise: a second one that raced it
// would call process.exit mid-write and truncate the trace.
let closing = null;
const shutdown = () =>
  (closing ??= (async () => {
    if (tracing) {
      try {
        await context.tracing.stop({ path: `${OUT}/trace.zip` });
        console.log(`\n  trace saved: ${OUT}/trace.zip`);
      } catch (e) {
        console.log(`\n  ! trace not saved: ${e.message.split("\n")[0]}`);
      }
    }
    try {
      await context.close(); // flushes video
    } catch {}
    try {
      await browser.close();
    } catch {}
  })());

// Signals only flip a flag; the main flow below owns shutdown. A handler that
// closed the browser itself raced tracing.stop() mid-write and left a
// truncated zip, and two callers racing each other truncated it differently.
let stopping = false;
let signalStop;
const stopped = new Promise((r) => (signalStop = r));
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    if (stopping) return;
    stopping = true;
    console.log("\n  stopping…");
    signalStop();
  });
}
page.on("close", () => {
  stopping = true;
  signalStop();
});

console.log(
  `${watch ? "WATCH — you play, it samples" : "PLAY-THROUGH"}  ${url}`,
);
console.log(
  `out: ${OUT}/  ${tracing ? `trace.zip${hasFfmpeg ? " + video/" : ""}` : "latest.png + telemetry.jsonl"}`,
);

try {
  await page.goto(url, { waitUntil: "domcontentloaded" });
} catch (e) {
  console.error(`\n  ! cannot open ${url}\n    ${e.message.split("\n")[0]}`);
  console.error("    is the dev server up?  cd Beach-game && bun run dev\n");
  await shutdown();
  process.exit(1);
}

if (watch) {
  // Hands-off. The window is yours; the harness just samples and records.
  let first = true;
  while (true) {
    try {
      if (first) {
        await beatStep(page, "start", async () => {}, 0);
        first = false;
      } else {
        await page.screenshot({ path: `${OUT}/latest.png` });
        await sample(page);
      }
      // Race the sample interval against the stop signal, so Ctrl-C lands in
      // seconds rather than up to `every` seconds — and never busy-spins once
      // stopped, because `stopped` stays resolved.
      await Promise.race([page.waitForTimeout(every * 1000), stopped]);
      if (stopping) break;
    } catch {
      // The browser going away mid-sample is the normal way this loop ends.
      // An unhandled rejection here would kill the process before the trace
      // is written, which is the one thing this script must not do.
      break;
    }
  }
}

// --------------------------------------------------------------- play-through
// Its own branch, not an early return: the watch loop above `break`s when the
// browser goes away, and falling through into these beats would throw uncaught
// and take the trace down with it.
else {
  await beatStep(
    page,
    "loaded",
    async () => {
      // The world builds progressively; wait for the engine to say ready.
      await page.waitForFunction(() => window.__game?.ready === true, null, {
        timeout: 30000,
      });
    },
    1200,
  );

  await beatStep(page, "overlay", async () => {});

  await beatStep(page, "walking", async () => {
    await page.getByRole("button", { name: /click to walk/i }).click();
  });

  await beatStep(page, "look-around", async () => {
    await page.mouse.move(W / 2, H / 2);
    await page.mouse.down();
    await page.mouse.move(W / 2 + 260, H / 2 + 20, { steps: 20 });
    await page.mouse.up();
  });

  await beatStep(
    page,
    "walk-fwd",
    async () => {
      await page.keyboard.down("KeyW");
    },
    1500,
  );
  await page.keyboard.up("KeyW");

  await beatStep(
    page,
    "run",
    async () => {
      await page.keyboard.down("ShiftLeft");
      await page.keyboard.down("KeyW");
    },
    1500,
  );
  await page.keyboard.up("KeyW");
  await page.keyboard.up("ShiftLeft");

  await beatStep(page, "power-on", async () => {
    await page.getByRole("button", { name: /admin power/i }).click();
  });

  await beatStep(
    page,
    "climb",
    async () => {
      await page.keyboard.down("Space");
    },
    1500,
  );
  await page.keyboard.up("Space");

  await beatStep(
    page,
    "power-off",
    async () => {
      await page.getByRole("button", { name: /admin power/i }).click();
    },
    1200,
  );
}

// ------------------------------------------------------------------- wrap up
// The browser may already be gone in watch mode, so this read is best-effort.
let s = null;
try {
  s = await sample(page);
} catch {}

console.log("\n— problems —");
console.log(
  problems.length
    ? problems.slice(-15).join("\n")
    : "  none (no page errors, console errors or warnings)",
);

await shutdown();

const video = readdirSync(`${OUT}/video`).filter((f) => f.endsWith(".webm"));
console.log("\n— replay —");
if (tracing)
  console.log(
    `  scrub the harness run:  npx playwright show-trace ${OUT}/trace.zip`,
  );
if (video.length)
  console.log(`  watch the run as video:  open ${OUT}/video/${video[0]}`);
console.log(`  telemetry:              ${OUT}/telemetry.jsonl`);
if (!tracing) console.log(`  last frame:             ${OUT}/latest.png`);
console.log(
  s && typeof s.fps === "number" && s.fps < 30
    ? "\n  ! fps under 30 — check telemetry.jsonl for when it dropped"
    : "",
);
