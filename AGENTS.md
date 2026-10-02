# Agent Instructions (User Preferences)

Adapted from `/Users/Mitesh Gada/Documents/Projects/AGENTS.md`. The parent's
three rules — Web searches, `subagent_opencode` delegation, Ponytail — are
carried over. The `subagent_opencode` section is additionally adapted to this
project's visual-QA lessons (measure it yourself; fix the `read_image` modality
config rather than delegating around it). The project section at the bottom is
the adaptation.

## Web searches
- ALWAYS use `monid` (the Monid CLI) for web searches and web research.
- NEVER use the built-in `web_search` tool/plugin (or any DeepSeek/Exa-backed built-in search).
- Workflow: `monid discover --query "<what you need>"` to find a suitable data endpoint, then `monid inspect` and `monid run` to execute it.
- monid is installed at `/Users/Mitesh Gada/.npm-global/bin/monid`.
- monid writes its config/state via XDG paths, which the sandbox denies under `~/.config`. In THIS workspace you must use the project-local copy, because the sandbox is scoped to `Beach-game/` and monid needs write access beside its config:
  `XDG_CONFIG_HOME="/Users/Mitesh Gada/Documents/Projects/Beach-game/.monid/xdg"`
  That directory contains `monid/config.yaml` + `credentials.yaml` (mode 600) and is git-ignored.
  **Verified 2026-09-29:** pointing `XDG_CONFIG_HOME` at the *parent* `/Users/Mitesh Gada/Documents/Projects/.monid/xdg` from this workspace fails with `EPERM ... .monid/xdg/monid/config.yaml.tmp-<pid>` — monid writes a temp file beside the config. Do not "fix" this back to the parent path; use the local one.
- Proven working call: `XDG_CONFIG_HOME=".../.monid/xdg" monid run --provider tinyfish --endpoint /search --query '{"query":"...","domain_type":"web"}' --wait 90 -j` (free endpoint; pass params via `--query`, not `-i`).
- **`/fetch` is the exception — it takes `-i`, NOT `--query`**: `monid run --provider tinyfish --endpoint /fetch -i '{"urls":["https://..."]}' --wait 90 -j`. Passing `--query` returns `HTTP_400 body.urls: expected array, received undefined` (verified 2026-09-28). `/search` uses `--query`; `/fetch` uses `-i`.

## Delegating to `subagent_opencode`
- **It is the multi-modal one** — it can `read_image` a PNG/JPEG/WebP/GIF, so it
  can judge screenshots, rendered HTML, charts, and decks as a viewer. Use it
  for genuine visual judgement, and for an independent second opinion on a large
  screenshot set.
- **But a MEASURED claim is yours to make — never delegate a measurement.** A
  delegate cannot crop, crop-compare, or measure pixels, and it will confidently
  narrate instead of admitting it cannot see. Verified 2026-09-29: delegating a
  screenshot review to `subagent_opencode` produced a confident, wrong claim
  (that a foreground NPC was "1.7× out of scale"), which a two-minute crop
  refuted. You have the tooling — Playwright + Chromium render the app, PIL
  quantifies it, `python3 -c` crops regions for close comparison. **Measure,
  don't delegate the measurement.**
- **If `read_image` says "model ... does not declare image input", that is a
  CONFIG bug, not a reason to delegate.** It means the model entry is missing
  `input: [text, image]` under its provider in `~/.dsh/settings.yaml`, so the
  harness is advertising a vision model as text-only. Add the declaration; do not
  route around it by handing images to a subagent. Verified 2026-09-29: every
  OpenRouter model in `settings.yaml` was silently declared text-only, which
  blocked image input on all four image paths at once.
- **It does its own web search and fetch — do NOT tell it to use monid.** It has native `web_search`/`web_fetch` and is not bound by the monid rule above; that rule governs my own searches, not work handed to this subagent. Just state the research goal (or say "use your built-in web search and fetch"). Sending it to monid adds a setup step and buys nothing.
- **NEVER let it fan out — no task/subagent tool, no nested subagents, no workflow.** This is absolute, not "unless it's a big job". Every opencode run in this project that spawned nested subagents via the task tool hung on its first tool call (the 2026-09-27 academic tension scan, and the 2026-09-29 India equity-research run: 4 children froze within seconds and sat `status:"running"` for ~1h). Every run that worked alone finished cleanly. It must do all the work itself in one session.
- If a task is big enough that one context cannot hold it, split it into several smaller `subagent_opencode` calls **you** control and sequence — never hand it "the whole thing" and let it decompose.
- **ALWAYS end the prompt with a hard stop.** Otherwise the child never returns a final message and the call runs until something times out. Every prompt must include, in substance: *do the work yourself in this single context, do NOT spawn or delegate to any subagent, agent, or workflow, and when you are finished stop and return the complete result as your final message.*

Prompt skeleton — prepend the guard, then the task, then the hard stop:

```
MANDATORY: do NOT use the task/subagent tool and do NOT spawn any nested subagents.
Do all work yourself in this single session. Every bash command must end with
</dev/null so it can never block on stdin, and never pass an unquoted glob as the
final argument of wc/ls/cat/head — an empty directory leaves the glob literal and
the command hangs forever (use `find <dir> -maxdepth 1 -type f | wc -l` instead).
Write your output file EARLY and rewrite it as you go, so a stall leaves a partial
file rather than nothing.

<task, fully self-contained>
Do this work yourself in this single context. Do NOT spawn, delegate to, or wait on
any subagent, background job, or workflow. When you are done, stop and return the
complete result as your final message.
```

### Triaging an opencode job (hung vs done)
- **Do not trust the UI "running" state.** It can be unsettled-job lag, not work in flight. A clean `step-finish reason=stop` with 0 children means it already finished — cancel the job and use the report it produced; do not wait on it.
- **Verify progress against the opencode DB, not the UI.** `idle_s` in the tens/low-hundreds = working. `idle_s` in the thousands with a tool part stuck on `status:"running"` = hung. `children>0` means it fanned out and is heading for the hang.

```
DB=~/.dsh/opencode-data/opencode/opencode.db
sqlite3 -header -column "$DB" "
SELECT substr(s.id,1,14) sess, COALESCE(s.title,'?') title,
       datetime(MAX(p.time_created)/1000,'unixepoch','localtime') last,
       CAST((strftime('%s','now')-MAX(p.time_created)/1000) AS INT) idle_s,
       COUNT(*) parts, COUNT(c.id) children
FROM part p JOIN session s ON s.id=p.session_id
LEFT JOIN session c ON c.parent_id=s.id
GROUP BY s.id HAVING idle_s<3600 ORDER BY MAX(p.time_created) DESC;"
```

- **To stop a hung job: `job_list` → `job_kill` the JOB only. NEVER kill the shared opencode ACP process** — it is shared across all sessions, so killing it takes down every other opencode run.

## Ponytail — lazy senior dev mode (installed, applies to every project here)

You are a lazy senior developer. Lazy means efficient, not careless. The best code is the code never written.

Before writing any code, stop at the first rung that holds:

1. Does this need to be built at all? (YAGNI)
2. Does it already exist in this codebase? Reuse the helper, util, or pattern that's already here, don't re-write it.
3. Does the standard library already do this? Use it.
4. Does a native platform feature cover it? Use it.
5. Does an already-installed dependency solve it? Use it.
6. Can this be one line? Make it one line.
7. Only then: write the minimum code that works.

The ladder runs after you understand the problem, not instead of it: read the task and the code it touches, trace the real flow end to end, then climb.

Bug fix = root cause, not symptom: a report names a symptom. Grep every caller of the function you touch and fix the shared function once — one guard there is a smaller diff than one per caller, and patching only the path the ticket names leaves a sibling caller still broken.

Rules:

- No abstractions that weren't explicitly requested.
- No new dependency if it can be avoided.
- No boilerplate nobody asked for.
- Deletion over addition. Boring over clever. Fewest files possible.
- Shortest working diff wins, but only once you understand the problem. The smallest change in the wrong place isn't lazy, it's a second bug.
- Question complex requests: "Do you actually need X, or does Y cover it?"
- Pick the edge-case-correct option when two stdlib approaches are the same size, lazy means less code, not the flimsier algorithm.
- Mark deliberate simplifications that cut a real corner with a known ceiling (global lock, O(n²) scan, naive heuristic) with a `ponytail:` comment naming the ceiling and upgrade path.

Not lazy about: understanding the problem (read it fully and trace the real flow before picking a rung, a small diff you don't understand is just laziness dressed up as efficiency), input validation at trust boundaries, error handling that prevents data loss, security, accessibility, the calibration real hardware needs (the platform is never the spec ideal, a clock drifts, a sensor reads off), anything explicitly requested. Lazy code without its check is unfinished: non-trivial logic leaves ONE runnable check behind, the smallest thing that fails if the logic breaks (an assert-based demo/self-check or one small test file; no frameworks, no fixtures). Trivial one-liners need no test.

Canonical install: `.tools/ponytail` (update with `git pull`; source of the six `/ponytail*` skills — review, audit, debt, gain, help — and of this ruleset). When asked to review a diff or repo for over-engineering, follow `skills/ponytail-review/SKILL.md` and `skills/ponytail-audit/SKILL.md` there.

## Beach-game project rules

**`README.md` is the source of truth for product conventions.** It already
documents the stack, the `@/...` import aliases, shadcn/ui usage, Tailwind v4
oklch tokens in `src/index.css`, the "no nested cards / no shadows / use toasts"
rules, Framer Motion expectations, and the mobile responsiveness bar. (Its
Convex/Auth sections are historical — that backend was removed; ignore them.) Read it and follow it. Do **not** copy or paraphrase it
here — two copies drift, and a stale one is worse than none.

What follows is only what the README does not tell you.

### Package manager
- **`bun`**, never npm or pnpm. `bun.lock` is the ONLY lockfile — the stale
  `package-lock.json` was deleted 2026-09-30. Do not add a third lockfile, and
  do not run `npm ci`: it installs strictly from its lockfile, and the old one
  never listed `three`, so it produced a tree the 3D world cannot build.
- **Why it matters, since the two look interchangeable when running:** both
  `bun run dev` and `npm run dev` just exec `node_modules/.bin/vite` and behave
  identically *today*. The difference is who owns the tree. `node_modules` was
  installed by bun — there is no `node_modules/.package-lock.json`, which npm
  writes on every install — and `npm ls` reports much of it as `extraneous`
  while `bun pm ls` reads all 450 packages clean. `npm install` does not just
  do nothing wrong-looking, it rewrites the lockfile and drifts you toward the
  broken state above.
- Dev server is `bun run dev`. Build is `bun run build` (`tsc -b && vite build`).
  `main.ts` at the repo root is a Deno/Hono static server for `dist/`.

### The 3D world: vanilla three, NOT React Three Fiber
- **The world is imperative vanilla three.js mounted from a React effect.**
  `src/mumbai/index.ts` exports `mount(container) -> teardown`. `MumbaiWorld.tsx`
  calls it in a `useEffect`. React owns the page; the world owns the canvas and
  the render loop. **Do not wrap world geometry in R3F** — the engine modules
  (`toon.js`, `post.js`, `outline.js`, `sky.js`) are imperative and build a
  scene graph directly, so they would have to be unwritten, not adapted.
- `src/engine/` is ported from **`Kenton-GMI/sakura-crossing` (MIT)** — its
  licence is kept verbatim at `src/engine/LICENSE.sakura` and must travel with
  any further vendoring. It is deliberately plain JS; `tsconfig` runs with
  `"allowJs": true, "checkJs": false` so it is bundled but not type-checked
  against our stricter settings.
- `src/mumbai/` is the content: `stations.ts` (the ordered Western line),
  `layout.ts` (every dimension, 1 unit = 1 m), `station.ts`, `city.ts`,
  `life.ts`, `props.ts`, `signage` textures, `player.ts`, `bridge.ts`.
- **Player and camera state is deliberately NOT React state.** It lives in the
  plain mutable `game` object in `src/mumbai/bridge.ts`, which the HUD polls on
  `requestAnimationFrame`. This exists so movement never re-renders the React
  overlay. Do not lift it into `useState`, context, Zustand, or any store
  library — converting it is a performance regression, not a cleanup.
- World geometry is in **world units where 1 unit = 1 metre**, which keeps
  walk/sprint speeds and prop sizes honest. The "tiny planet" wrap from the
  reference is deliberately NOT implemented: build flat, bend onto a sphere in
  one final pass later if it is ever wanted.
- `src/engine/signage.ts` paints every sign with Canvas2D, and
  `src/engine/textures.ts` has the one cloud puff `sky.js` needs. The app ships
  with zero binary assets; adding a procedural texture is almost always cheaper
  than shipping a PNG.
- **`world.html` is a dev-only harness** that mounts the world with no React and
  no router, so the 3D can be inspected and screenshotted in isolation
  (`npx vite`, then `/world.html`). It is not part of the product build. It
  forces `game.playing = true` so input works without pointer lock.
- **`bun run check:stations`** is the one runnable check: it asserts the station
  list is in true Western Railway order, codes are unique and correct, chainages
  increase, and the Devanagari fields really contain Devanagari. Run it after
  touching `stations.ts`. It parses the TS by regex — no TS runtime, no deps.
- Only dependency left for 3D is `three` itself.

### Live testing harness — `scripts/live.mjs`
For watching the game run and reporting back while you play it. Headed
Playwright, **no new dependency** — the global install, same import path
`shot-fly.mjs` already uses. Start the dev server first (`bun run dev`); the
script says so plainly if it cannot reach the page.

- **`bun scripts/live.mjs`** — the harness drives a scripted play-through
  (start → walk → look → run → admin power → climb → power off), screenshotting
  and measuring each beat. Writes `shots/live/trace.zip`; scrub the whole run
  with `npx playwright show-trace shots/live/trace.zip` — every action it took,
  with a screenshot before and after, plus network and console. This is the way
  to see *what the harness did*. One beat produced a valid 19 MB trace
  (verified 2026-09-30).
- **`bun scripts/live.mjs --watch 3`** — hands-off. You play in the window, it
  samples every ~3s: `shots/live/latest.png` plus one JSON line per sample
  appended to `shots/live/telemetry.jsonl` (fps, position, speed, platform/road,
  nearest station, fly, canvas size). **No trace in this mode, deliberately** —
  Playwright only records actions *it* issues, so a session you drive yourself
  yields a near-empty trace while still staging ~17 MB of staged screenshots
  that fail to assemble on a long run. Screenshots and telemetry are the honest
  artefact for a session you are playing.
- Telemetry reads `window.__game` — the same bridge `Hud.tsx` polls — so the
  numbers are the numbers on screen, not a guess; `fps` and the HUD's own
  readout agree. `MumbaiWorld.tsx` exposes it under `import.meta.env.DEV`, the
  same hook `preview.ts` has always had. It is stripped from the build, so this
  only works against `bun run dev`, never a production bundle.
- **Fixed (2026-10-02):** the harness used to log
  `GL_INVALID_OPERATION: Vertex buffer is not big enough for the draw call`
  repeatedly — it came from the *station* world's tactile-dots mesh (capacity
  1028, drawn 1030), not the city. The loop is now index-based; runs are
  error-free and the error is gone from every "problems" list.
- The harness's own capture taxes the game: it reported **~9 fps** average, but
  that is a headed-Chromium-under-automation number, not a verdict on the
  engine. Measure real performance in your own browser before optimising
  against it. Screenshots also cost ~2s each here, so `--watch 3` really lands
  at roughly a 5s cadence.

**Two machine gotchas, both already worked around inside the script:**
- `PLAYWRIGHT_BROWSERS_PATH` is exported pointing at a folder that does not
  exist (`.../Projects/Do not delete folder/.pw-browsers`). Chromium is really
  in `~/Library/Caches/ms-playwright`. The script repairs it in-process, but
  **only when the configured path is unusable**, so a working environment is
  left alone. Worth fixing the shell export.
- Playwright's **ffmpeg is not installed** and `playwright install ffmpeg`
  times out on this network, so there is **no video recording**. The trace does
  not need ffmpeg and is unaffected. Re-try the install if video is ever wanted.

### No backend — the world is the whole product
- **The Convex backend and the whole auth flow were removed on 2026-09-29**
  (`a72552c`). `/dashboard` is public. There is no `ConvexAuthProvider`, no
  `useAuth`, no `RequireAuth`, and no `VITE_CONVEX_URL`. If a future task needs
  persistence or accounts, that is a fresh decision — do not reintroduce Convex
  by reflex or assume the wiring still exists.
- The 3D world is entirely client-side: it needs no backend, no key, and no
  network. Keep it that way where you can — that is what makes it trivially
  deployable and screenshot-able.
- Routes live in `src/main.tsx`: `/` (landing) and `/dashboard` (the world).

### Two worlds: `src/mumbai/` (authored station) and `src/geo/` (data-sourced city)
`src/mumbai/` is the hand-authored Charni Road station (ordered station list,
signage, livery, crowd). `src/geo/` is the NEW geographically-grounded Greater
Mumbai city built from real data. Both ship; they are different products and
should not be conflated. The notes below that say "explicit in source, not
data-sourced" apply ONLY to `src/mumbai/`.

The world is geometry plus content written out **literally in the source**, not
derived from a downloaded geographic dataset. It is **not** claiming to be
geographically accurate. Decision made 2026-09-29; treat it as settled unless
the user reopens it.

**The word that matters here is "explicit", not "hand-authored".** The reference
build this is modelled on (`gulmohar-local.pages.dev`) was produced by a model
run overnight from a one-line prompt — the author typed none of it. But the
output property is the same either way, and it is the property that matters:
every fact about the place is a **literal in the code** (a station array, a
colour, a string), rather than a value extruded from OSM, a DEM, or satellite
imagery. A model reproducing "correct Western Railway livery" and "Charni Road
sits between Marine Lines and Grant Road" is the model *recalling* that, not
scraping it. The knowledge channel is the model's weights, not a data feed —
which is exactly why the result needs no licence, no key, and no pipeline.
Do not describe this build, or ours, as "hand-authored"; say "explicit in
source, not data-sourced".

**What was verified about the reference:** all 10 of its JS chunks total 1.0 MB
with only two URLs in the entire codebase (an XML namespace and a cel-shading
paper citation), no `fetch`/asset loads, and a live Chromium network trace
showing 64 requests whose only non-asset entries are Cloudflare's own analytics
beacon. Its Mumbai chunk is **7.5 KB**.

**SUPERSEDED 2026-09-29 — this section is now history.** The world is
**data-sourced**, built on real Greater Mumbai geography, not authored. Two of
the claims above are now known to be wrong:
- **Open Buildings 2.5D Temporal is NOT Earth-Engine-gated.** The bucket
  `open-buildings-temporal-data` is public-read; verified directly with
  anonymous HTTP (manifest 200, Mumbai geotiff 206). It is the best available
  height source and is the next stage to wire in.
- **Overture is not a height source for Mumbai**: 2.59% coverage, 2.3 m median.
  It is a ~3x *footprint* fallback only.
MCGM's authoritative layer is still genuinely token-gated (499), so heights are
currently **estimated** by the documented rule in `scripts/enrich-chunks.mjs`
(zone prior + damped NON-MONOTONIC area term — in Mumbai a bigger footprint
means a *shorter* building). See `docs/height-sources.md` and
`scripts/validate-geo.mjs`.

**The mechanism, in priority order — this is the actual spec:**
1. **Real ordered place data, written out as literals.** A station list in correct
   sequence (Churchgate → Marine Lines → Charni Road → Grant Road → Mumbai
   Central → Mahalaxmi → Lower Parel → Dadar, with real Western Railway codes
   CCG/MEL/CYR/GTR/MMCT/MX/PL/DR). Locality is derived from *adjacency* — the
   next stop north, the correct terminus on the departure board — not from
   coordinates. This is the single highest-value, lowest-cost thing in the
   project and it is what makes the world read as researched rather than
   invented.
2. **Overlay-language signage.** Devanagari + Latin at minimum; add Gujarati
   where it is genuinely spoken (the Western line's commuter base). Bilingual
   signage implies administration, which implies a real place.
3. **Correct livery and colour.** Western Railway red/cream coaches, the WR
   green on steel, black-yellow taxis and kerb paint. Each is a small prop that
   is instantly, specifically Mumbai.
4. **A five-band depth stack in every frame** — near human (<1 m) → vehicle
   (2–4 m) → road and crossing (6–10 m) → platform/station (12–25 m) →
   footbridge, trees, sky beyond. Every band populated; the eye must never find
   an empty layer. Cheap, and it is what sells density.
5. **One low sun, long hard shadows**, used as compositional diagonals.
6. **A tight, restricted palette** with no texture maps. Flat bands only.

**Where the reference build is weak — beat these, don't copy them:**
- No rooftop clutter at all. Water tanks, dish antennas, drying laundry and
  tarpaulin are the densest, most recognisable part of a Mumbai skyline and
  need **no** geographic data. Highest-value omission to fill.
- Nothing at pedestrian eye level; all the good signage sits above 2 m.
- Platforms are near-empty and the roads have no moving traffic.
- Tree canopies read as stacked flat discs. Give them trunk and clumping.
- Blank faces on close-up NPCs.

**Reference implementation to reuse, not rewrite:** `Kenton-GMI/sakura-crossing`
on GitHub is **MIT licensed** and its whole cel-shading stack is ~590 lines —
`toon.js` (quantised `MeshToonMaterial` with hue-shifted shadow bands),
`post.js` (screen-space ink from the *second* difference of linearised depth,
plus an FXAA resolve), `outline.js` (inverted-hull for hero props). Port or
adapt those with attribution rather than writing a new cel shader. Its
`planet.js` is also the reference for the "tiny planet" wrap: build flat on XZ,
bend it onto a sphere in **one** final pass, so nothing else has to know the
planet exists.

**Do not reintroduce** a build-time OSM/DEM/height pipeline, `InstancedMesh`
city massing derived from footprints, or any "and it's true to scale" claim.
**Do not use Google Earth imagery or screenshots** — Google's terms forbid
creating a new product from it, copying the content, and mass-downloading, on
three separate counts. Sentinel-2 is the open-licence fallback if real imagery
is ever genuinely needed (10 m/px — fine for ground tint, useless for facades).

### Data licensing — OSM/ODbL is NOW LIVE (the `src/geo/` city ships OSM-derived data)
**This obligation is real, not hypothetical.** `src/geo/` ingests from
Mumbai_WFL1, which is **OSM-derived**, and the stored chunks are a Derivative
Database. The short version of the rule already established below:

- The **renderer/app code** is a Produced Work — licence it however you like.
- The **chunk data files** must be offered under ODbL. The cheapest compliant
  route, and the one already taken, is: commit `scripts/ingest-mumbai.mjs`
  (the "means of creating" the Derivative Database) and publish the ODbL notice
  alongside the data rather than shipping an opaque blob.
- Attribution belongs **in the data or metadata**, not only in the app UI.

`src/mumbai/` (authored) still carries no ODbL obligation. Do not apply one
rule to both worlds. If `data/build/` is ever committed rather than
regenerated, add the © OpenStreetMap contributors notice to it.

If any OSM-derived data does end up in the repo, OSM is **ODbL 1.0** and the
share-alike obligation attaches to the **data file**, never to the application
code. The distinction is settled; do not re-derive it:

- The **React/Three.js renderer** is a **Produced Work**. Per the OSMF FAQ, "if
  you create a Produced Work, you can apply whatever terms you like to the
  Produced Work." The app code is therefore **not** copyleft and is free to
  license commercially.
- A **bundled, queryable geometry file** (buildings as JSON/PMTiles) is a
  **Derivative Database** that we publish to users. "Where you make our data or
  any Derivative Database available to others, it must continue to be licensed
  under the ODbL."
- The cheap way out, explicitly blessed by OSMF: rather than distributing a
  baked derivative, commit **the build script that creates it**. The condition
  is satisfied by offering "the means of creating the Derivative Databases upon
  request." Prefer that over shipping a large pre-baked file.

So when adding geo data:
- Put a `README`/`LICENCE` beside any data you ship, containing
  **© OpenStreetMap contributors**, the ODbL 1.0 text or a link to
  <https://opendatacommons.org/licenses/odbl/1-0/>, and note it is ODbL. The
  Attribution Guidelines require this notice "as part of the database …
  within the data or metadata" — inside the data, not only in the app.
- Show a one-time startup splash ("3D data © OpenStreetMap contributors") plus
  an in-app About with full licence detail. The "Computer games and
  simulations" guideline permits a splash that does not persist.
- Never present OSM-derived geometry as first-party. Keep the credit in the
  data pipeline, not as an afterthought.

Note OSMF's own caveat: its guidance is "not a comprehensive list" and is
explicitly not legal advice. If this ever becomes commercial, get a lawyer to
confirm rather than relying on this note.

### The geographic city (`src/geo/`) — pipeline and rules
- `scripts/geo.mjs` — projection + tiling, shared with the render side by
  `src/geo/geo-constants.ts`. **The two MUST stay in sync** (same ORIGIN, same
  TILE_M, same METRO_BOUNDS) or every building lands in the wrong place.
- `scripts/ingest-mumbai.mjs` — paged, concurrent, resumable, retrying ingest
  from the public Mumbai_WFL1 FeatureServer. MCGM's own layer is token-gated
  (499) and is not ingestible; source_priority 1 is reserved for it.
- `scripts/enrich-chunks.mjs` — dedupes tile-straddling buildings (centroid
  owner), classifies facades, assigns heights, projects to local metres.
- `scripts/validate-geo.mjs` — **the geographic gate. Run it before touching
  visual styling.** 36 ground-truth sites across all 24 required areas.
- `scripts/validation-sites.mjs` — those 36 sites, measured against the same
  source the pipeline ingests.
- `docs/height-sources.md` — the height research, including the two findings
  that overturned earlier decisions.
- `geo.html` / `src/geo/preview.ts` — dev harness in CREATIVE free-fly mode,
  with `__geo.teleport('<place>')` for 27 real locations. Use it to inspect
  the city; do not fight an orbit camera.
- Height is currently **estimated** (`height_source: "estimated"`, confidence
  capped at 0.45). The measured source is Open Buildings 2.5D, which is
  anonymously readable and is the next thing to wire in.

### Data size discipline — the world is ~130 MB and stays regenerable
Measured 2026-09-30. The derived chunks for the whole metro are **129 MB**
(1,109 chunks, mean 114 KB, max 1.4 MB). Nothing under `data/` is tracked in
git — it is all regenerated by `scripts/ingest-mumbai.mjs` +
`scripts/enrich-chunks.mjs`. A completed world with water, landuse, rail and
terrain is projected at **250-300 MB**, essentially all of it disposable.

- **Raw ingest tiles (`data/build/tile_*.json`, 233 MB) are an intermediate.**
  `enrich-chunks.mjs` should delete them when it finishes. They are only
  consumed once and are pure waste on disk.
- **`data/ob-cache/` is disposable raster cache — never commit it.** It was
  tracked by accident once (42 MB) and was removed in the same commit that
  noticed it.
- Chunk rings are quantised to centimetres. The planned next win is a
  quantised typed-array format (~65 MB, halving the payload, no visible change
  at 1:1 scale).
- A view only loads the chunks near the camera (~2-5 MB), so the full metro on
  disk is a developer/offline convenience, not a product cost.
- Disk is not the constraint to optimise against. Browser payload per view is.

### The geographic city (`src/geo/`) — route and camera are the next work
Decided 2026-09-30: `/dashboard` becomes the **real city**, and the primary
camera is **fly AND walk** (not aerial-only). Walk means ground level, which
means the street-level layers are on the critical path, not optional:
road surfaces, kerbs, crossings, footpaths, terrain and water all have to exist
before a walker has something to stand on.

### Performance budget — smooth by default, LOD and distance invisibly
The city is 260k buildings; the user must never feel a technique or wait on a
setting. Everything below is automatic and invisible. Measured cost drivers
(2026-09-30): loadRadius 3 = 49 chunks resident, ~13k buildings, ~245 merged
meshes; observed Fort at radius 2 = 1,005 draw calls and ~4M triangles/frame.

**The cost is split, and the two halves need different fixes:**
- **GPU/frame:** triangles, draw calls, and the shadow pass re-rendering every
  mesh into one 2048 map. This is what the user would feel as frame drops.
- **CPU/load:** `ExtrudeGeometry` runs once per building per chunk load (~265
  per chunk). This is what the user would feel as a stutter when flying fast —
  the main build is done incrementally across frames so it never blocks.

**Distance / LOD (invisible):**
- Chunk residency is an LRU ring around the camera, not a hard radius —
  raised ahead of the direction of travel, lowered behind. Flying forward never
  waits on a load.
- Beyond the near ring, chunks render as a cheap **impostor**: the merged
  silhouette at reduced detail, or skipped entirely past a far cutoff. Footprint
  geometry is invisible at range; nobody has ever noticed a missing cornice from
  400 m up.
- `frustumCulled` stays on and bounding spheres stay correct (see
  `check-geo-transform.mjs`); per-chunk culling is the cheap win that keeps
  off-screen chunks out of the draw entirely.

**CPU-first rendering, so the frame is built once and cheaply:**
- **Bake footprints to flat 2-D geometry on a worker** (or in idle slices), and
  extrude lazily/cheaply. Move triangle tessellation and normal computation off
  the main thread; the main thread should only be uploading buffers.
- **Merge per class per chunk (already done)**, and additionally merge
  *across* a whole LOD ring so distant chunks collapse into a handful of draws.
- **Frustum-cull chunks, not just meshes** — skip the whole chunk when none of
  its buildings are visible. A quarter of the grid is behind you at any time.
- Reuse typed arrays and pre-size buffers; never reallocate a big Float32Array
  per chunk (the current merge does — fix with a pooled builder).

**GPU-first, felt as nothing:**
- **A single cascade-less shadow strategy that follows the player** (already the
  plan): one tight 2048 map around the camera beats four large cascades on
  integrated GPUs.
- **Distance culling of shadows:** only near-ring chunks cast. Distant shadows
  are invisible at range and cost a full extra pass.
- Cap pixel ratio, and drop `dpr` adaptively if frame time rises — invisible
  until it saves you.

**Safety net:** an adaptive guard reads frame time and, before the user could
notice, (a) sheds far-chunk detail, (b) disables distant shadow casting, then
(c) reduces resolution. It never changes what the user is doing or shows a
setting unless they ask. All of it is measured, not guessed.

### The hand-drawn theme already exists
- Custom utility classes are defined in `src/index.css` and are the intended
  vocabulary for this app's look: `display`, `hand`, `note`, `ruled`, `sketch`,
  `sketch-soft`, `sticky-note`, `index-card`, `tape`, `stamp`, `check-box`,
  `ink-shadow`, `ink-shadow-sm`, plus the `--font-hand` (Caveat) and
  `--font-note` (Patrick Hand) variables. Use them instead of inventing
  near-duplicates.
- Colours are oklch CSS variables in `src/index.css`; set the theme with the
  `dark` / `light` class on a parent. Avoid hardcoding hex in components unless
  it is genuinely a fixed material colour (a sea shader, a 3D texture).
- `src/components/BeachSketch.tsx` is pure inline SVG — the house approach to
  illustration here. No image assets.


#User note done manually: Some use cases that i thought would be cool:
  1. Club penguin style game where people can enter and talk in chat boxes i guess more similar to GTA 5 online. People can share favourite spots make friends explore places to go to IRL
  2. Add photos from your gallery visible virtually at the exact place taken in that angle taken. for example a photo taken of the horizon from the beach if added will show that photo when you look at the horizon from in game. that way it becomes fun to take as many photos as possible of the city and add user added photos something like a collage of different times different people maybe even contributions by people
