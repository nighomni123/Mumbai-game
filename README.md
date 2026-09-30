# Beach-game

A walkable, cel-shaded 3D Mumbai in the browser, rendered client-side with
vanilla three.js. No backend, no accounts, no network calls at runtime.

Two separate worlds live in this repo. **`src/mumbai/` is the product** — a
walkable Western-line station district served at `/dashboard`. **`src/geo/` is
a data-sourced model of the whole of Greater Mumbai**, currently reachable only
through its dev harness (`/geo.html`) and not yet wired to a route. They are
different products with different provenance; see below.

## Overview

Tech stack:

- **Vite** + **React 19** + **TypeScript**
- **React Router v7** — import from `react-router`, not `react-router-dom`
- **Tailwind v4** (oklch tokens) + **shadcn/ui** (`src/components/ui`)
- **Three.js** — vanilla, *not* React Three Fiber
- **Framer Motion** for UI animation
- **Lucide** for icons, **Sonner** for toasts
- **Hono** on Deno (`main.ts`) to serve the production `dist/`
- **bun** as the package manager (`bun.lock` is authoritative)

All app code lives in `src/`. Import with the `@/` alias (`@/components/ui/button`).

## Getting started

```bash
bun install
bun run dev        # vite dev server -> http://localhost:5173
bun run build      # tsc -b && vite build
bun run lint       # eslint
```

The production build in `dist/` is served by `main.ts`, a Deno/Hono static
server with SPA fallback.

There are **no required environment variables**. The world is entirely
client-side. The only optional ones are `VITE_VLY_APP_ID` /
`VITE_VLY_MONITORING_URL` for the Vly preview toolbar.

## Routes and entry points

| Path | What it is |
|---|---|
| `/` | Landing page (`src/pages/Landing.tsx`) |
| `/dashboard` | The product — the 3D world, public, no sign-in (`src/pages/Dashboard.tsx`) |
| `/world.html` | **Dev-only harness** — the `src/mumbai/` world with no React and no router |
| `/geo.html` | **Dev-only harness** — the `src/geo/` city in free-fly mode |

Routes are declared in `src/main.tsx`. The two `.html` harnesses are not part
of the product build; they exist so the 3D can be inspected in isolation
(`npx vite`, then open the page).

## The two worlds

Do not conflate them. They are different products with different provenance
and different licence obligations.

| | `src/mumbai/` | `src/geo/` |
|---|---|---|
| What | Authored Charni Road station district | Data-sourced Greater Mumbai |
| Data | Literals in source: station list, livery, signage, crowd | Real footprints ingested from Mumbai_WFL1 (OSM-derived) |
| Scale | One station district, walkable at 1 unit = 1 m | Whole metro area, tiled and streamed |
| Licence | None owed | **ODbL 1.0 attaches to the data** — see below |
| Entry | `/world.html`, `/dashboard` | `/geo.html` (dev only; not wired to a route) |

### `src/mumbai/` — the station district

`src/mumbai/index.ts` exports `mount(container) -> teardown`. `MumbaiWorld.tsx`
calls it from a `useEffect`. **This seam is deliberate:** React owns the page,
the world owns the canvas and the render loop.

**Player and camera state is not React state.** It lives in the plain mutable
`game` object in `src/mumbai/bridge.ts`, which the HUD polls on
`requestAnimationFrame`, so movement never re-renders the React overlay. Do not
lift it into `useState`, context, Zustand, or a store.

World geometry is in **world units where 1 unit = 1 metre**, which keeps walk
and sprint speeds and prop sizes honest.

Key modules: `stations.ts` (the ordered Western line), `layout.ts` (every
dimension), `station.ts`, `building.ts`, `city.ts`, `life.ts`, `props.ts`,
`player.ts`, `bridge.ts`, `Hud.tsx`.

### `src/engine/` — the cel-shading stack

Ported from [`Kenton-GMI/sakura-crossing`](https://github.com/Kenton-GMI/sakura-crossing)
(**MIT**). `toon.js` (quantised `MeshToonMaterial`), `post.js` (screen-space ink
from depth plus FXAA), `outline.js` (inverted hull), `sky.js`, `signage.ts`,
`textures.ts`, `palette.js`.

The upstream licence is kept verbatim at `src/engine/LICENSE.sakura` and **must
travel with any further vendoring**. These files are deliberately plain JS;
`tsconfig` runs `allowJs: true, checkJs: false`, so they bundle but are not
type-checked.

The app ships **zero binary assets** — every sign and texture is painted with
Canvas2D at runtime.

### `src/geo/` — the geographic city

`src/geo/GeoCity.ts` is a tiled, streaming renderer. The whole city
(260k+ buildings) never lives in the GPU or in memory at once: chunks are 2 km
squares, and the renderer keeps only the chunks near the camera, loads their
JSON on demand, builds one `InstancedMesh` per facade class per chunk, and
disposes chunks that fall out of range. Geometry is extruded from the real
footprint rings at real local coordinates; facade variation is procedural and
Mumbai-specific but never moves or invents a building.

`src/geo/preview.ts` is the dev harness: CREATIVE free-fly by default (`WASD`,
`Space`/`Ctrl` up/down, `Shift` sprint, drag to look, double-click to toggle
ORBIT), a live readout of chunks / draw calls / triangles / lon-lat /
altitude, and `__geo.teleport('<place>')` for 24 real locations (`fort`,
`charni`, `bkc`, `ghatkopar`, `powai`, `thane`, …). Read the counters before
trusting any visual impression — a "1k tris" frame means nothing is being
drawn.

**`scripts/geo.mjs` and `src/geo/geo-constants.ts` MUST stay in sync** (same
`ORIGIN`, same `TILE_M`, same `METRO_BOUNDS`), or every building lands in the
wrong place.

## The data pipeline

Runs in order. Output goes to `data/build/`, which is **git-ignored and
regenerable**.

```bash
node scripts/ingest-mumbai.mjs    # 1. paged, concurrent, resumable ingest
node scripts/enrich-chunks.mjs    # 2. dedupe + heights + project to local metres
node scripts/validate-geo.mjs     # 3. the geographic gate — run before styling
```

1. **`scripts/ingest-mumbai.mjs`** — paged, concurrent, resumable, retrying
   ingest from the public Mumbai_WFL1 ArcGIS FeatureServer. MCGM's own
   authoritative layer is token-gated (HTTP 499) and is not ingestible;
   `source_priority: 1` is reserved for it if credentials ever arrive. The last
   full run: **269,284 buildings / 239,157 streets / 39,959 points**, 0 failures.
2. **`scripts/enrich-chunks.mjs`** — assigns every building to the tile that
   contains its **centroid** (so tile-straddling footprints are not
   double-counted), classifies facades, assigns heights, and projects WGS84
   rings to the local metric frame. The raw WGS84 stays for provenance.
3. **`scripts/validate-geo.mjs`** — the gate. Checks the built chunks against
   the source data and the 36 ground-truth sites in
   `scripts/validation-sites.mjs`, across all 24 required areas. Run it
   **before** touching visual styling.

### Heights are currently estimated

`height_source: "estimated"`, confidence capped at 0.45, by a documented
per-class rule in `scripts/enrich-chunks.mjs` (zone prior plus a damped
**non-monotonic** area term — in Mumbai a bigger footprint means a *shorter*
building). This is the biggest remaining quality gap.

The measured source is **Google Open Buildings 2.5D Temporal**, which is *not*
Earth-Engine-gated: its GCS bucket is publicly readable over anonymous HTTP.
`scripts/ob_height.py` does the anonymous reads, manifest parsing and
lon/lat → UTM 43N → pixel addressing; **the TIFF pixel decode is still wrong**
(1e37-range values), so `sample_footprint_height` raises rather than emit a
fake height. Do not loosen that gate.

Full derivation, exact paths, traps and the confidence contract:
**[`docs/height-sources.md`](docs/height-sources.md)**.

## Data licensing — ODbL 1.0 is live

`src/geo/` ingests from Mumbai_WFL1, which is **OSM-derived**, so the stored
chunks are a **Derivative Database**. The obligation is real:

- The **renderer and app code** is a Produced Work. Per the OSMF FAQ you may
  apply whatever terms you like to it — the application is *not* copyleft.
- The **chunk data** must be offered under
  [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
- Attribution belongs **in the data or metadata**, not only in the app UI.
- The compliant route taken here: commit `scripts/ingest-mumbai.mjs` — the
  "means of creating" the Derivative Database — and publish the ODbL notice
  alongside the data rather than shipping an opaque blob.

`src/mumbai/` is authored and carries **no** ODbL obligation. Never present
OSM-derived geometry as first-party; keep the credit in the pipeline.

**If `data/build/` is ever committed** rather than regenerated, add
`© OpenStreetMap contributors` to a `README`/`LICENCE` beside the data, and
show a one-time splash ("3D data © OpenStreetMap contributors") plus an
in-app About with full licence detail.

OSMF's own guidance is "not a comprehensive list" and is explicitly not legal
advice. If this becomes commercial, get a lawyer to confirm.

## Checks and harnesses

Runnable checks — no test framework, no fixtures:

```bash
bun run check:stations   # station order, unique codes, increasing chainage, real Devanagari
bun run check:fly        # the admin-power (creative) flight movement maths, headless
node scripts/validate-geo.mjs   # the geographic gate (needs data/build/)
```

Run `check:stations` after touching `src/mumbai/stations.ts` — every sign,
board and departure LED derives from that list by adjacency, so if the order
drifts the place stops reading as a real railway.

### Live testing — `scripts/live.mjs`

Headed Playwright, no new dependency (it uses the global install, same import
path as `shot-fly.mjs`). Start `bun run dev` first.

```bash
bun scripts/live.mjs                # scripted play-through -> screenshots + trace
bun scripts/live.mjs --watch 3      # you play, it samples every ~3s
```

The scripted run writes `shots/live/trace.zip` — scrub the whole run with
`npx playwright show-trace shots/live/trace.zip`. `--watch` instead appends one
JSON line per sample to `shots/live/telemetry.jsonl` plus
`shots/live/latest.png`; no trace, deliberately, since Playwright only records
actions it issues itself.

Telemetry reads `window.__game` — the same bridge `Hud.tsx` polls — so the
numbers are the numbers on screen. It is exposed only under
`import.meta.env.DEV`, so this works against the dev server and never a
production bundle.

`bun scripts/shot-fly.mjs` is a smaller scratch harness that screenshots the
admin-power toggle in both states.

**Known issue:** every run logs
`GL_INVALID_OPERATION: Vertex buffer is not big enough for the draw call`
repeatedly on `/dashboard`. It does not visibly break the frame, but it is a
real error.

The harness's own capture taxes the game (~9 fps average under
headed-Chromium-under-automation). That is not a verdict on the engine —
measure real performance in your own browser before optimising against it.

## Frontend conventions

These are the product conventions. Follow them for any UI work.

### Pages and components

- Pages in `src/pages`, components in `src/components`, shadcn primitives in
  `src/components/ui` (use by default).
- Register every new page in the router in `src/main.tsx`.
- Wrap pages in a container so they don't stretch on wide screens, centred,
  and **always mobile responsive** — verify max/min widths, don't assume.
- Navbars for landing pages, sidebars for protected dashboard pages. The logo
  on either bar links to the index page.
- Clickable elements get `cursor-pointer` (it is not the default).

### shadcn/ui

- Title text uses `tracking-tight font-bold`.
- **Avoid nested cards.** Cards inside cards, borders inside borders — it
  clutters the page.
- **Avoid shadows.** Use a thin border instead.
- Avoid skeletons; use the `loader2` spinner for loading states.
- Larger dialogs must scroll internally so content is never cut off on small
  screens. Prefer a Dialog over a whole new page for secondary content.

### Landing pages

Designer-level styling, well animated, with a coherent theme (neo-brutalist,
retro, neumorphism, glass morphism…). If the user is signed in, the primary
button should say "Dashboard" or "Profile" and go there.

### Animation

Use Framer Motion (`motion` from `framer-motion`) for fades, slide-ins,
rendering animations, button clicks, and UI elements. Animate across the app,
landing page included.

### Three.js in the app

The world is **imperative vanilla three.js mounted from a React effect**.
`src/engine/*` builds a scene graph directly, so wrapping world geometry in
React Three Fiber would mean rewriting the engine, not adapting it.

### Colours and theming

Tokens are oklch CSS variables in `src/index.css`, set with the `dark` /
`light` class on a parent. Always use the variable names; avoid hardcoded hex
unless a value is a genuinely fixed material colour (a sea shader, a 3D
texture). Components must work in both light and dark mode. When changing the
theme, change it app-wide: the shadcn primitives under `src/components/ui` and
the colours in `index.css`. Do not override colours locally in a component.

### The hand-drawn theme already exists

`src/index.css` defines a custom utility vocabulary for this app's look. Use
it instead of inventing near-duplicates:

`display` · `hand` · `note` · `ruled` · `ruled-tight` · `sketch` ·
`sketch-soft` · `sticky-note` · `index-card` · `tape` · `stamp` ·
`check-box` · `ink-shadow` · `ink-shadow-sm`

plus `--font-hand` (Caveat) and `--font-note` (Patrick Hand).
`src/components/BeachSketch.tsx` is pure inline SVG — the house approach to
illustration. No image assets.

### Toasts

Report results — confirmations, errors, outcomes — with a toast, using the
shadcn Sonner toaster:

```ts
import { toast } from "sonner";

toast("Event has been created", {
  description: "Sunday, December 03, 2023 at 9:00 AM",
  action: { label: "Undo", onClick: () => console.log("Undo") },
});
```

## Removed — do not reintroduce

**There is no backend.** The Convex backend and the whole auth flow were
removed on 2026-09-29 (`a72552c`). There is no `ConvexAuthProvider`, no
`useAuth`, no `RequireAuth`, no `VITE_CONVEX_URL`, and `/dashboard` is public.
If a future task needs persistence or accounts, that is a fresh decision — do
not reintroduce Convex by reflex or assume the wiring still exists.

Also out of scope unless deliberately reopened: Google Earth imagery
(forbidden by Google's terms in three separate ways), a build-time OSM/DEM
height pipeline, and any "true to scale" claim. Sentinel-2 (10 m/px) is the
open-licence imagery fallback if real imagery is ever genuinely needed.

## Where to look next

- [`docs/NEXT-SESSION.md`](docs/NEXT-SESSION.md) — current state, the Open
  Buildings decode blocker, known bugs, what is still open.
- [`docs/height-sources.md`](docs/height-sources.md) — the height research.
- [`AGENTS.md`](AGENTS.md) — workflow rules for agents working in this repo.
