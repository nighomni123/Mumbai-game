/**
 * Dev-only: surface-area attribution across the Fort grid.
 *
 * Answers the question the palette experiment could not: which layer actually
 * owns the frame? The measurement comes from the RENDERER's own geometry — each
 * layer is rendered alone and the framebuffer read back — never from a colour
 * rule, because a colour rule cannot tell sea from land from sky (that is how
 * the first check-visual passed on a frame with no ground).
 *
 * Needs `bun run dev` running.
 *
 *   bun scripts/attribute-surface.mjs
 * Output: docs/surface-attribution.md (and a table on stdout)
 */

import { readdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const exe = join(
  process.env.HOME,
  "Library/Caches/ms-playwright/chromium-1124/chrome-mac/Chromium.app/Contents/MacOS/Chromium",
);
const { chromium } = await import(
  "/Users/Mitesh Gada/.npm-global/lib/node_modules/playwright/index.mjs"
);

const COLS = 320, ROWS = 200;
// the Fort slice grid, same as the palette experiment's wide-*
const XS = [-7000, -6000, -5000, -4000, -3000];
const ZS = [-19500, -18000, -16500, -15000, -13500];

const url = process.argv[2] ?? "http://localhost:5173/dashboard";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
page.on("pageerror", (e) => console.log(`  [pageerror] ${e.message.slice(0, 120)}`));

console.log(`== goto ${url}`);
await page.goto(url, { waitUntil: "load", timeout: 90000 });
await page.waitForTimeout(13000);
await page.evaluate(() => {
  const c = [...document.querySelectorAll("div,section,button")].find(
    (e) => /click to walk/i.test(e.textContent ?? "") && e.getBoundingClientRect().width < 900,
  );
  c?.click();
});
await page.waitForTimeout(1500);

const rows = [];
for (const x of XS) {
  for (const z of ZS) {
    await page.evaluate(([x, z]) => window.__geo?.teleport?.(x, z, 0.8), [x, z]);
    await page.waitForTimeout(2600);
    const a = await page.evaluate(
      ([cols, rows]) => window.__geo?.attributeSurface?.(cols, rows),
      [COLS, ROWS],
    );
    if (!a) {
      console.log(`  !! no attributeSurface at ${x},${z}`);
      continue;
    }
    const n = a.cols * a.rows;
    const byLayer = {};
    for (const [k, v] of Object.entries(a.masks)) {
      if (v.length) byLayer[k] = v.length / n;
    }
    const unclaimed = a.claimed.reduce((s, v) => s + (v ? 0 : 1), 0) / n;
    // dominant colour region, decomposed by which layer owns each of its pixels
    const hist = new Map();
    for (let i = 0; i < n; i++) {
      const q =
        (Math.round(a.colour[i * 3] / 8) << 10) |
        (Math.round(a.colour[i * 3 + 1] / 8) << 5) |
        Math.round(a.colour[i * 3 + 2] / 8);
      if (!hist.has(q)) hist.set(q, { n: 0, layers: {} });
      const e = hist.get(q);
      e.n++;
    }
    // which layer owns pixel i
    const owner = new Array(n).fill(null);
    for (const [k, v] of Object.entries(a.masks)) for (const i of v) owner[i] = k;
    const ranked = [...hist.values()].sort((p, q) => q.n - p.n);
    const top = ranked[0];
    const topShare = top.n / n;
    // re-walk the top colour to tally its layers
    const topLayers = {};
    {
      const wanted = [...hist.entries()].sort((p, q) => q[1].n - p[1].n)[0][0];
      for (let i = 0; i < n; i++) {
        const q =
          (Math.round(a.colour[i * 3] / 8) << 10) |
          (Math.round(a.colour[i * 3 + 1] / 8) << 5) |
          Math.round(a.colour[i * 3 + 2] / 8);
        if (q !== wanted) continue;
        const l = owner[i] ?? "background";
        topLayers[l] = (topLayers[l] || 0) + 1;
      }
    }
    // low-chroma area per layer (chroma < 26/255)
    const lowChroma = {};
    let lowTotal = 0;
    for (let i = 0; i < n; i++) {
      const r = a.colour[i * 3], g = a.colour[i * 3 + 1], b = a.colour[i * 3 + 2];
      if (Math.max(r, g, b) - Math.min(r, g, b) >= 26) continue;
      lowTotal++;
      const l = owner[i] ?? "background";
      lowChroma[l] = (lowChroma[l] || 0) + 1;
    }
    rows.push({ x, z, byLayer, unclaimed, topShare, topLayers, lowChroma, lowTotal: lowTotal / n });
  }
}
await browser.close();

const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const allLayers = [...new Set(rows.flatMap((r) => Object.keys(r.byLayer)))];

console.log(`\n== ${rows.length} poses, ${COLS}x${ROWS} each ==`);
console.log("\nAREA SHARE BY LAYER (mean %):");
const share = {};
for (const L of allLayers) share[L] = mean(rows.map((r) => r.byLayer[L] ?? 0)) * 100;
share.background = mean(rows.map((r) => r.unclaimed)) * 100;
for (const [L, v] of Object.entries(share).sort((a, b) => b[1] - a[1]))
  console.log(`  ${L.padEnd(12)} ${v.toFixed(1).padStart(5)}%`);

console.log(`\nDOMINANT COLOUR REGION: ${(mean(rows.map((r) => r.topShare)) * 100).toFixed(1)}% of frame, decomposed by layer (mean % of frame):`);
const topLayerAgg = {};
for (const r of rows) for (const [L, v] of Object.entries(r.topLayers)) topLayerAgg[L] = (topLayerAgg[L] || 0) + v;
for (const [L, v] of Object.entries(topLayerAgg).sort((a, b) => b[1] - a[1]))
  console.log(`  ${L.padEnd(12)} ${(v / rows.length / (COLS * ROWS) * 100).toFixed(1).padStart(5)}%`);

console.log(`\nLOW-CHROMA AREA per layer (chroma<26, mean % of frame):`);
const lcAgg = {};
for (const r of rows) for (const [L, v] of Object.entries(r.lowChroma)) lcAgg[L] = (lcAgg[L] || 0) + v;
for (const [L, v] of Object.entries(lcAgg).sort((a, b) => b[1] - a[1]))
  console.log(`  ${L.padEnd(12)} ${(v / rows.length / (COLS * ROWS) * 100).toFixed(1).padStart(5)}%`);
console.log(`  (total low-chroma ${(mean(rows.map((r) => r.lowTotal)) * 100).toFixed(1)}% of frame)`);

// write the report
let md = `# Surface-area attribution — 2026-09-30\n\n`;
md += `Which layer owns the frame? Measured from the RENDERER's own geometry: each\n`;
md += `layer rendered alone, framebuffer read back. Not a colour rule.\n\n`;
md += `${rows.length} poses on a ${COLS}x${ROWS} grid over the Fort slice.\n\n`;
md += `## Area share by layer (mean % of frame)\n\n| layer | share |\n|---|---:|\n`;
for (const [L, v] of Object.entries(share).sort((a, b) => b[1] - a[1])) md += `| ${L} | ${v.toFixed(1)} |\n`;
md += `\n## The dominant colour region, decomposed\n\n`;
md += `The largest single colour region covers ${(mean(rows.map((r) => r.topShare)) * 100).toFixed(1)}% of the frame on average. Which layers make it up:\n\n| layer | share of frame |\n|---|---:|\n`;
for (const [L, v] of Object.entries(topLayerAgg).sort((a, b) => b[1] - a[1]))
  md += `| ${L} | ${(v / rows.length / (COLS * ROWS) * 100).toFixed(1)} |\n`;
md += `\n## Low-chroma area per layer (chroma < 26/255, mean % of frame)\n\n| layer | low-chroma share |\n|---|---:|\n`;
for (const [L, v] of Object.entries(lcAgg).sort((a, b) => b[1] - a[1]))
  md += `| ${L} | ${(v / rows.length / (COLS * ROWS) * 100).toFixed(1)} |\n`;
md += `\nTotal low-chroma: ${(mean(rows.map((r) => r.lowTotal)) * 100).toFixed(1)}% of frame.\n`;
writeFileSync("docs/surface-attribution.md", md);
console.log("\nwrote docs/surface-attribution.md");
