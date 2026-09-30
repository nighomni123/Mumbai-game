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

## START HERE: finish the Open Buildings 2.5D height decode

Heights are currently **estimated** (documented non-monotonic rule), not
measured. That is the biggest remaining quality gap.

**Everything around the decode is done and verified** — do not redo it. What is
built in `scripts/ob_height.py`:
- anonymous GCS reads (bucket is public; no Earth Engine, no account)
- the 3.5 MB manifest for cell `3b` (UTM 43N) is parsed
- lon/lat -> UTM 43N -> pixel via the tile `affineTransform` is exact
- tile URL join is the trap: `uriPrefix` `.../geotiffs/3b` + `e7c_2023_06_30/...`
  concatenates with NO separator
- the TIFF is tiled 512x512, deflate (compression 8), 3 planar bands
  (fractional_count / **height** / **presence**), 7203 tile offsets, 2401/plane
- band-tile bytes are read by byte-range and decompressed; tiles are disk-cached

**THE BLOCKER:** the partial TIFF **pixel decode is wrong.** Reading a band tile
and interpreting the decompressed bytes as little-endian float32 gives values in
the **1e37 range, 99% whole numbers** (measured). A misaligned float read. The
`sample_footprint_height` function therefore RAISES by default
(`_DECODE_VALIDATED = False`) rather than emit a fake height — do not "fix" this
by loosening that gate.

**To finish it** (pick one):
1. Install a real reader — `pip install rasterio` (or GDAL bindings) and read
   the byte-range window properly. Fastest, most reliable. This is the
   recommended route; it also removes the need to hand-roll the TIFF.
2. If staying dependency-free, cross-check the hand-rolled decode against a
   reference decoder on ONE tile (verify value range is 0..100 m, nodata -99)
   before flipping `_DECODE_VALIDATED`.

Once decoded, the sampling rule is already in place and correct: take the **75th
percentile of `building_height` over pixels where `building_presence >= 0.5`**
(not the mean — 4 m pixels straddle roof edges and average against zeros). Set
`height_source: "raster"`, `hc: 0.55`, and run `sane_height()` on every value.

Full derivation, exact paths, traps and the confidence contract:
**`docs/height-sources.md`**. Read it before touching the sampler.

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
