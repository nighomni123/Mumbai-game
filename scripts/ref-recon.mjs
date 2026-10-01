/**
 * Dev-only: recon the reference build (gulmohar-local.pages.dev/?city=mumbai).
 * Scratch QA harness, not part of the build. No Playwright dependency is
 * declared for it — the import below is this machine's global install.
 *
 * Dumps: entry screenshot, full DOM text, every button/label, console output,
 * network requests, and the size of each JS chunk. Nothing is judged here —
 * this only establishes WHAT the reference is.
 *
 *   bun scripts/ref-recon.mjs [url]
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";

// This machine's PLAYWRIGHT_BROWSERS_PATH is both wrong AND version-skewed:
// the global playwright (1.45.1) wants chromium-1124, which is in the default
// cache, while the exported folder only has chromium-1223. Name the binary
// directly — that skips the revision bookkeeping entirely.
const exe = join(
  process.env.HOME,
  "Library/Caches/ms-playwright/chromium-1124/chrome-mac/Chromium.app/Contents/MacOS/Chromium",
);
const { chromium } =
  await import("/Users/Mitesh Gada/.npm-global/lib/node_modules/playwright/index.mjs");

const url = process.argv[2] ?? "https://gulmohar-local.pages.dev/?city=mumbai";
const out = "shots/ref";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const net = [];
page.on("request", (r) => net.push(`${r.resourceType()} ${r.url()}`));
page.on("console", (m) => console.log(`  [page:${m.type()}] ${m.text().slice(0, 300)}`));
page.on("pageerror", (e) => console.log(`  [pageerror] ${e.message}`));

console.log(`== goto ${url}`);
await page.goto(url, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(6000);
await page.screenshot({ path: `${out}/00-entry.png` });
console.log("shot: 00-entry.png");

// what does the page actually say?
const dom = await page.evaluate(() => ({
  title: document.title,
  bodyText: document.body.innerText.replace(/\n{2,}/g, "\n").slice(0, 4000),
  buttons: [...document.querySelectorAll("button,[role=button],a")].map((e) => ({
    tag: e.tagName,
    text: (e.innerText || e.textContent || "").trim().slice(0, 60),
    aria: e.getAttribute("aria-label"),
    cls: e.className?.toString().slice(0, 80),
  })),
  canvases: [...document.querySelectorAll("canvas")].map((c) => ({
    w: c.width,
    h: c.height,
    cw: c.clientWidth,
    ch: c.clientHeight,
  })),
  scripts: [...document.querySelectorAll("script[src]")].map((s) => s.src),
  links: [...document.querySelectorAll("link[href]")].map((s) => s.href),
}));
console.log("\n== DOM");
console.log("title:", dom.title);
console.log("canvases:", JSON.stringify(dom.canvases));
console.log("\n-- body text --\n" + dom.bodyText);
console.log("\n-- buttons --");
for (const b of dom.buttons) console.log(`  [${b.tag}] "${b.text}" aria=${b.aria} cls=${b.cls}`);
console.log("\n-- scripts --");
for (const s of dom.scripts) console.log("  " + s);
console.log("\n-- links --");
for (const l of dom.links) console.log("  " + l);

console.log("\n== network (" + net.length + ")");
for (const n of net) console.log("  " + n.slice(0, 160));

// global hooks the build may publish
const globals = await page.evaluate(() =>
  Object.keys(window).filter((k) => /game|world|three|city|scene|debug|state/i.test(k)),
);
console.log("\n== interesting globals:", JSON.stringify(globals));

await browser.close();