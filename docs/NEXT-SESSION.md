# Next session — start here

State as of the end of 2026-09-29. Read this first, then `AGENTS.md`.

## Where things stand

**Two separate worlds ship in this repo. Do not conflate them.**

| | `src/mumbai/` | `src/geo/` |
|---|---|---|
| What | Hand-authored Charni Road station | Geographically-grounded Greater Mumbai |
| Data | Literals in source (station list, livery, signage) | Real footprints from Mumbai_WFL1 (OSM-derived) |
| Licence | None owed | **ODbL 1.0 is live** on the chunk data |
| Entry | `/world.html`, `/dashboard` | `/geo.html` (dev only, not wired to a route yet) |

`src/geo/` is the new work. It ingests **269,284 buildings / 239,157 streets /
39,959 points** across all of Greater Mumbai (0 ingest failures), conflated to
**260,890 buildings** after deduplicating tile-straddling footprints, and renders
as a tiled three.js city. `node scripts/validate-geo.mjs` passes **36/36** sites
across all 24 required areas.

## Start here: wire in measured heights

Heights are currently **estimated**, not measured. That is the single biggest
remaining quality gap and the reason the skyline is conservative.

The measured source is **Google Open Buildings 2.5D Temporal**, and the key
finding is that it is **not** Earth-Engine-gated — the GCS bucket
`open-buildings-temporal-data` is public-read. Verified this session with
anonymous curl:

- manifest: `https://storage.googleapis.com/open-buildings-temporal-data/v1/manifests/3b_EPSG_32643_2023_06_30.json` (200, 3.5 MB; cell `3b`, UTM 43N)
- Fort/Bandra tile: `.../v1/geotiffs/3be7c_2023_06_30/tile_OScHfh-5ubs.tif` (HTTP 206)

It is a **raster**, 4 m effective, band `building_height` (metres, 100 m cap,
nodata `-99.0`), with **no join key** to footprints — you sample it per
footprint. Sample the **75th percentile over high-`building_presence` pixels**,
not the mean (4 m pixels straddle roof edges and average against zeros).

Full derivation, exact paths, the three sampling traps, the sanity gate, and
the confidence contract are in **`docs/height-sources.md`**. Read that before
writing the sampler.

When it lands, set `height_source: "raster"` and `hc: 0.55` (vs the current
`"estimated"` / ≤0.45) and run `saneHeight()` on every sampled value — it
exists to reject outliers and it must apply to raster output too.

## Known-good debugging workflow

The geo harness is built for diagnosis, not screenshots:

```bash
npx vite --port 5199 --strictPort    # then open /geo.html
```

- **CREATIVE free-fly** is the default: `WASD` move, `Space`/`Ctrl` up/down,
  `Shift` sprint, drag to look, double-click to toggle ORBIT.
- `__geo.teleport('andheri')` — 27 real locations (fort, csmt, gateway,
  charni, ghatkopar, powai, thane, dahisar, bkc, …).
- The live readout shows **chunks, draw calls, triangles, lon/lat, altitude** —
  read that before trusting any visual impression. A "1k tris" frame means
  nothing is being drawn; "1.2M tris" means it is.

**Known limitation:** under headless SwiftShader, a dense frame (~1M+ tris)
can exceed the compositor's budget and `page.screenshot()` times out. That is a
capture limit, not a world bug — verify with the runtime counters, or capture
from a real GPU.

## Two bugs already found this way (don't reintroduce)

1. **Extrusion direction.** `ExtrudeGeometry` grows along +Z; `rotateX(-90°)`
   mapped that to **-Y**, burying every building. Now extruded upward and
   seated on y=0. If buildings vanish, check this first.
2. **Vite SPA fallback.** A missing chunk returns **200 text/html**
   (`index.html`), so `res.ok` passes and `res.json()` then throws. Must check
   `content-type` includes `json`.

## Still open

- **`src/geo/` is not wired into a product route.** It is dev-harness only.
  Decide whether it replaces `/dashboard`, sits beside it, or ships separately.
- **Mumbai_WFL1 has no height/floors.** Overture is not a substitute (2.59%
  coverage, 2.3 m median, measured). MCGM's authoritative layer is token-gated
  (499) — `source_priority: 1` is reserved for it if credentials ever arrive.
- **Water, coastline, parks, landuse, railways, metro, monorail, bridges** are
  not yet ingested. The streets layer is TomTom/Esri-derived and already gives
  real road geometry and names; the rest needs Overture `base/*` and
  `transportation` or OSM.
- **No elevation.** The brief calls for a coast and a terrain; Mumbai is
  low-lying but the Ghats rise fast east of it.
- **`data/build/` is git-ignored and regenerable.** If it is ever committed
  instead, the ODbL notice must go with it.
