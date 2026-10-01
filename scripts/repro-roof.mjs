/**
 * MINIMAL REPRO — roof cap only. No GeoCity, no streaming, no streets, no
 * shadows, no post-processing, no HUD.
 *
 *   bun scripts/repro-roof.mjs [buildingId] [chunkFile]
 *   bun run dev --port 5199      (must already be running)
 *
 * Renders the SAME footprint twice through repro-roof.html: once with the
 * centroid fan `mass()` actually ships, once with ear clipping, true footprint
 * outlined in black on top of both.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ID = process.argv[2] ?? "b_315613914";
const CHUNK = process.argv[3] ?? "chunk_-1_1.json";
const PORT = process.env.PORT ?? "5199";

const exe = join(
  process.env.HOME,
  "Library/Caches/ms-playwright/chromium-1124/chrome-mac/Chromium.app/Contents/MacOS/Chromium",
);
const { chromium } = await import(
  "/Users/Mitesh Gada/.npm-global/lib/node_modules/playwright/index.mjs"
);

const chunk = JSON.parse(readFileSync(join("data/build/chunks", CHUNK), "utf8"));
const b = chunk.b.find((x) => x.id === ID);
if (!b) throw new Error(`${ID} not in ${CHUNK}`);
console.log(`${ID}  verts=${b.r.length}  H=${b.H}`);

const out = "shots/repro-roof";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ executablePath: exe, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 840 } });
  await page.goto(`http://localhost:${PORT}/repro-roof.html`, { waitUntil: "load" });
  await page.waitForFunction(() => typeof window.run === "function");

  for (const mode of ["fan", "ear"]) {
    const info = await page.evaluate(
      ([ring, H, m]) => window.run(ring, H, m),
      [b.r, b.H ?? 30, mode],
    );
    const file = join(out, `${b.id}-${mode}.png`);
    await page.locator("#c canvas").screenshot({ path: file });
    console.log(`  ${mode.padEnd(4)} triangles=${info.tris} -> ${file}`);
  }

  // Aggregate: every roof cap in the chunk, from above.
  if (process.argv.includes("--chunk")) {
    const list = chunk.b.map((x) => ({ r: x.r, H: x.H ?? 20 }));
    for (const mode of ["fan", "ear"]) {
      const info = await page.evaluate(
        ([l, m]) => window.runChunk(l, m),
        [list, mode],
      );
      const file = join(out, `${CHUNK.replace(".json", "")}-${mode}.png`);
      await page.locator("#c canvas").screenshot({ path: file });
      console.log(`  chunk ${mode.padEnd(4)} triangles=${info.tris} -> ${file}`);
    }
  }
} finally {
  await browser.close();
}
