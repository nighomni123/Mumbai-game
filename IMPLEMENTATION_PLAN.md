# Implementation plan

Two things live here: what is being built next, and what has been deliberately
deferred. `AGENTS.md` is the rules; this is the sequence.

Decisions taken 2026-09-30, which this plan does not re-open:

- `/dashboard` is the **real city**; the authored station is `/station`.
- The primary camera is **fly AND walk**.
- Cheap speed work happens now; the larger product happens later.
- **The world is geographically 1:1. The experience is not temporally 1:1.**
  Geography, buildings, roads and distances stay real; walking time, travel
  time and level of detail do not. The planet view is a second representation
  of the same real data, never a replacement world.
- **The mainland is the build scope.** `ACTIVE_BOUNDS` is 27 × 47 km — west of
  72.9934722, south of 19.315608, north of 18.8907500. The whole metro is still
  ingested and still drawn on the map, washed and dashed as deferred; the city
  is only built inside the box. Decided 2026-09-30, "for when the mainland is
  complete". `check:active-bounds` holds both copies in sync.

---

## Now — the walkable, whole-city loop

### Reference findings, 2026-09-30

`docs/reference-walkthrough.md` has the full walkthrough, the screenshots and the
measurements. Three findings changed this plan:

- **Ours has three hues and no accents.** Measured: our street frames carry
  1.9k–2.4k distinct colours across 3 real hue families, with `mixed` and
  `magenta` at literally 0%. The reference carries 8k–13k across 9. The gap is
  the entire 0–4 m band, not the geometry.
- **The reference is not a slacker than we recorded.** It already has
  neighbourhood kind vectors (`society/chawl/basti/tower/maidan`), rooftop
  tanks and tarpaulins, and a live place-name readout. "Neighbourhood style
  vectors" moves from deferred to Tier 2.
- **It finds life by scanning its own geometry.** `flush()` rasterises every
  triangle into a roof-height and canopy grid, then derives crow perches, shade
  spots and gardens from it. We have real footprints and could do the same
  thing; it is listed below.

### Landed 2026-09-30

- [x] **Black ground** — the ground quad was the only surface built from `cel()`
      while every sibling used unlit `flat()`, and it rendered near-black at eye
      level. Then superseded: the per-chunk ground quad is gone entirely,
      because ground is now the land mask, which knows where the harbour is.
- [x] **The sea** — `scripts/ingest-water.mjs` pulls coastline and water from
      the OSM editing API and scanline-fills a land mask.
      `scripts/validate-water.mjs` is the gate.
- [x] **Walk mode** — `src/geo/walker.ts`, a port of the authored player with
      exact ring collision against real footprints.
- [x] **The whole city on a map** — `P` puts the metro on screen, flat, over a
      frozen frame. Pan, zoom, click a place to travel there.
- [x] **The planet is gone.** Measured against it: 4.0M triangles and 58 draw
      calls for a view that was unreadable anyway, and it froze the build queue
      at 440 entries because `drain()` is not called in that mode.
- [x] **The land is real.** Built from 260,890 building footprints, 1,382 km2,
      36/36 sites on land, 13/13 water probes still water. The coastline scanline
      that preceded it claimed 4,161 km2 and is now provenance only.
- [x] **The whole city on a map** — a minimap in the HUD and `/map` for the
      full page, drawn from the same land mask as the 3D world. Clicking a place
      travels there by the planet's dive path.
- [x] **`bun run check`** — seven gates, one command.
- [x] **`data/build/` now reaches the build output** (a `closeBundle` copy of
      the five files the runtime fetches). It never did, so a production
      `/dashboard` 404'd on its first chunk.

### Land

- [ ] **Terrain (SRTM terrarium z12).** 45 tiles, ~1.5 MB, public domain. The
      Ghats rise fast east of the city, and the walker currently assumes a flat
      floor at y = 0. The single `ponytail:` in `walker.ts` names this.
- [ ] **Crossings** at junctions (kerbs and footpaths are in; zebras are not).

### What a street has to look like — Tier 1

Measured against the reference; this is the whole difference between a model
and a place. Full rationale and frames in `docs/reference-walkthrough.md`.

- [ ] **Facade banding and an accent palette.** 3–4 bands per building class
      (plinth / body / cornice / parapet) and one class carrying a saturated
      accent. Target ≥8 hue families and ≥6k distinct colours in a street frame;
      today we measure 1.9k across 3. `enrich-chunks.mjs` already classifies
      facades — this is where that stops being an unused field.
- [ ] **The 0–4 m band.** Black-and-yellow kerb paint, footpath/road
      separation, streetlamps with a flat light-pool disc, electric poles with
      catenary wires, string lights over the narrow streets. No new data needed.
- [ ] **A cel-painted sky.** Banded cloud lobes with hard edges and a low sun.
      It is most of the screen in every street frame and we have none.
- [ ] **Signage on the street.** Devanagari + Latin shop and society boards on
      street-facing ground floors. `places.ts` and the existing sign renderer
      are already there.

### Life

- [ ] **Neighbourhood kind vectors** — `society | old | chawl | basti | tower |
      maidan` from a position field, driving a block-front typology. Moved up
      from deferred: the reference has this and we do not.
- [ ] **Scan the built geometry for life.** Rasterise roof heights and canopy
      per near ring, then derive crow perches, shade spots and parapet seats —
      the reference's best idea, and we have the roofs to do it with.
- [ ] **Time of day as one float** driving sun, hemisphere, sky, water, shadow
      tint and the ink colour. `T` cycles, `K` toggles rain.
- [ ] **Rooftops**: water tanks, dish antennas, drying laundry, tarpaulins.
      Tanks and tarps exist in the reference; dishes and laundry do not.

### Performance

- [x] **Render distance is capped** and follows altitude: 2.6 km on foot, 6 km
      climbing, 9 km absolute. Applied before the fetch. Only the near ring
      casts shadows. Pixel ratio adapts 0.75-1.5 on frame time.
- [x] **The chunk queue is not re-fetched every frame** — the actual cause of the
      11 fps street view, measured at 440 queued entries and 386 MB of heap.
- [ ] LOD tiers per chunk (near full / mid simplified / far silhouette / skip).
- [ ] Direction-biased pre-warm of the ring ahead of travel.
- [ ] Adaptive frame-time guard (shed far detail -> distant shadows -> resolution).
- [ ] Fix the `GL_INVALID_OPERATION: Vertex buffer is not big enough` error.
      It was still reported on the station world, not the real city.

### Reference to beat, not copy

Its foliage is the weakest thing in it — gulmohar canopies are overlapping flat
lozenges and bushes are faceted icospheres. So are blank NPC faces, vehicles
that go flat black when backlit, blank building flanks, an empty maidan, and
depth-sort artefacts. Do not inherit any of those.

### Data hygiene

- [ ] Delete the 233 MB of raw ingest tiles after `enrich-chunks.mjs`.
- [ ] Quantise chunks to typed arrays (129 MB -> ~65 MB).
- [ ] District-level rebuild target.
- [ ] `new check-geo-render`: asserts a known chunk's mesh has correct bounds
      and a pooled material. `tsc` cannot catch that class of bug — the
      mirrored-Z bug shipped with `tsc` and `build` both green.
- [ ] Merge vertically-adjacent land-mask runs, so the planet's surface is fewer,
      larger quads instead of ~12,000 strips.
- [ ] **Water rings are no longer used for anything** — lakes, tanks and the
      Back Bay edge are mapped in `water.json` but the land mask is built from
      buildings, so those small water bodies do not punch through. They are
      inside the built-up area and therefore read as land.
- [ ] The far north of the bounds is genuinely sparse in the source data; the
      map shows isolated clusters past Thane. That is the data, not the mask.

### Product

- [ ] Update landing copy — it still points at the authored station.
- [ ] One-time OSM attribution splash, and an in-app About with licence detail.
      The HUD carries the credit line; the splash does not exist yet.

---

## Deferred — deliberately not now

Recorded so it is not lost. None of this is in the current build.

### Architecture

- **Unified spatial layer.** Buildings, roads, terrain, landmarks and walkability
  should become views of _one_ dataset rather than parallel systems. This is the
  architecturally right answer and it is deliberately sequenced _after_
  walkable: cheaper to add later than to retrofit.
- Worker geometry generation, transferable buffers, binary tiles.
- Instanced representation for repeated props.

### The city as a place

- Neighbourhood style vectors, so **Fort != BKC != Dharavi != Powai != Thane**.
  The planet already colours by zone; the street does not yet.
- Landmarks, and signage derived from where you actually are.
- Traffic and pedestrian agents, density driven by land use.
- Time of day and monsoon as world state.

### Transport — the thing that makes 1:1 Mumbai traversable

This is the answer to "Greater Mumbai is 67 x 81 km and exhausting to cross".
Walking is for experiencing a place; the network is for moving between places.
Nothing needs the city to shrink.

- [ ] Ingest rail (`Overture theme=transportation/type=segment`, 72 GB theme,
      reachable) and station points, so the Local / Metro / harbour lines exist
      as real geometry rather than as a wish.
- [ ] Boarding: walk to a station, ride it compressed, arrive somewhere real.
- [ ] Roads as the second tier: arterials fully navigable, local lanes visual.
- [ ] City-as-menu: the planet already is this; wiring pins to real journeys
      makes it travel rather than teleport.

### Social layer

**A Club-Penguin / GTA-Online shape: players enter, chat in boxes, share
favourite spots, find each other.**

Read on this, honestly: **it is in direct tension with a decision we made
earlier this project.** The Convex backend and the whole auth flow were removed
(`a72552c`) precisely so the world would need no backend. Social play needs the
opposite — identity, a server, real-time messaging, and moderation. That is not
a feature, it is a different product with different obligations, and it should
be a deliberate decision rather than something that creeps back in.

There is a version that fits the current architecture, and it is probably the
better first step: **shared spots as static data.** No accounts, no realtime — a
curated or published JSON of places people like, loaded like any other chunk. It
delivers the "share favourite spots / places to go IRL" value with none of the
multiplayer surface. `src/geo/places.ts` is already the shape of it: 33 real
coordinates, one list, shared by the harness, the HUD and the planet's pins. If
that lands, realtime can be layered on deliberately.

### Geolocated photographs

**Show a photo from your gallery at the exact place and angle it was taken —
a shot of the horizon from a beach appears when you look at that horizon.**

This one is a good fit, and unusually cheap for what it is. It needs no new
subsystem: the world already has a WGS84 <-> local metric transform, so a photo
with EXIF GPS drops straight into the coordinate system we already use. The
"when you look that way" part is just a bearing test against the camera.

Sketch: extract EXIF GPS + timestamp on import; place a camera-facing quad at
`(lon, lat, height)`; show it when the camera's bearing is within a few degrees
and the player is in range. A photo of the skyline from Malad is then simply
_there_ when you stand on the Sea Link and look north.

Local-only needs no backend (import from your own gallery); the shared version
needs one, and is a separate decision.

Cautions: storage and bandwidth for user media; a photo is personal data, so
shared uploads need consent and moderation; and it must be clear a photo is
someone's memory, not a live view.

### Presentation and product

- Map mode, loading UX, settings, localStorage persistence.
- Positional audio, dynamic soundscape.
- Photo mode.
- Golden-location visual regression, tile-seam tests, spatial anomaly detector.

---

## Done

- [x] Real Greater Mumbai ingested: 269,284 buildings / 239,157 streets, 0 failures
- [x] Conflated to 260,890 buildings after tile-boundary dedup
- [x] Tiled three.js renderer, real footprints at real coordinates
- [x] Fixed: footprints were mirrored in Z, so the whole city was ~10 km off and
      rendered as bare street lines (`690b630`)
- [x] Geographic validation: 36/36 sites across 24 required areas
- [x] Height rule corrected — area is non-monotonic in Mumbai (`ebe6a6c`)
- [x] Speed pass: 1,005 -> 261 draw calls, ~245 -> 7 materials, Uint8 colours,
      time-sliced builds, frozen transforms (`aebe2da`)
- [x] Data-size discipline: 129 MB regenerable, cache untracked
- [x] **Water**: coastline + water ingested from OSM, land mask, `check:water`
- [x] **Walk mode** in the real city, exact footprint collision
- [x] **Planet view**: `P` shows all of Greater Mumbai, click a pin to arrive
- [x] One `check` command for all six gates
