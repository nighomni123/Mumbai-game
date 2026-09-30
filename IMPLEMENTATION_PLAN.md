# Implementation plan

Two things live here: what is being built next, and what has been deliberately
deferred. `AGENTS.md` is the rules; this is the sequence.

Decisions taken 2026-09-30, which this plan does not re-open:
- `/dashboard` becomes the **real city**; the authored station moves to `/station`.
- The primary camera is **fly AND walk**.
- Cheap speed work happens now; the larger product happens later.

---

## Now — finish the walkable core

### Street-level layers (a walker needs ground to stand on)
- [x] **Road surfaces** — ribbons from real centrelines, width DERIVED from
      `road_class` (no true width field exists; `w` duplicates `c`). `18d5840`
- [x] **Kerbs + footpaths** — 0.15 m raised kerb, 1.8 m footpath bands
- [x] **Ground plane** per chunk at y=0
- [ ] **Open: ground renders near-black at eye level.** Quad is correctly wound
      (normal +Y) and placed at y=0; cause is the sun shadow camera covering only
      +/-420 units while the ground quad extends far past it. Lighting fix, not
      geometry. This is the FIRST thing to chase — a black floor blocks walk
      mode regardless of what else lands.
- [ ] **Crossings** at junctions.
- [ ] **Terrain (SRTM terrarium z12).** 45 tiles, ~1.5 MB, public domain. The
      Ghats rise fast east of the city, so this is not decoration.
- [ ] **Water + coastline** (OSM land polygons, same ODbL family as buildings).

### Walk mode
- [ ] First/third-person walker: gravity, ground height, AABB collision against
      the real footprint rings already in the chunk data.
- [ ] Reuse the authored world's `admin power` fly toggle so both feel like one product.
- [ ] Fast travel: the 27 real places are already in the harness, surface as a menu.

### Remaining performance
- [ ] LOD tiers per chunk (near full / mid simplified / far silhouette / skip).
- [ ] Hysteresis on chunk eviction, so a chunk at the boundary is not thrashed.
- [ ] Direction-biased pre-warm of the ring ahead of travel.
- [ ] Adaptive frame-time guard (shed far detail -> distant shadows -> resolution).
- [ ] Fix the `GL_INVALID_OPERATION: Vertex buffer is not big enough` error.

### Data hygiene
- [ ] Delete the 233 MB of raw ingest tiles after `enrich-chunks.mjs`.
- [ ] Quantise chunks to typed arrays (129 MB -> ~65 MB).
- [ ] District-level rebuild target.
- [ ] One `check` command: `check:stations` + `validate-geo` + `check-geo-transform`.
- [ ] New `check-geo-render`: asserts a known chunk's mesh has correct bounds and
      a pooled material. `tsc` cannot catch that class of bug — the mirrored-Z
      bug shipped with `tsc` and `build` both green.

### Product
- [ ] `/dashboard` -> real city; station to `/station`.
- [ ] Update landing copy (it still points at the authored station).

---

## Deferred — deliberately not now

Recorded so it is not lost. None of this is in the current build.

### Architecture
- **Unified spatial layer.** Buildings, roads, terrain, landmarks and walkability
  should become views of *one* dataset rather than parallel systems. This is the
  architecturally right answer and it is deliberately sequenced *after*
  walkable: cheaper to add later than to retrofit.
- Worker geometry generation, transferable buffers, binary tiles.
- Instanced representation for repeated props.

### The city as a place
- Neighbourhood style vectors, so **Fort != BKC != Dharavi != Powai != Thane**.
- Landmarks, and signage derived from where you actually are.
- Traffic and pedestrian agents, density driven by land use.
- Time of day and monsoon as world state.

### Social layer
**A Club-Penguin / GTA-Online shape: players enter, chat in boxes, share
favourite spots, find each other.**

Read on this, honestly: **it is in direct tension with a decision we made
earlier this project.** The Convex backend and the whole auth flow were removed
(`a72552c`) precisely so the world would need no backend. Social play needs the
opposite — identity, a server, real-time messaging, and moderation. That is not a
feature, it is a different product with different obligations, and it should be
a deliberate decision rather than something that creeps back in.

There is a version that fits the current architecture, and it is probably the
better first step: **shared spots as static data.** No accounts, no realtime — a
curated or published JSON of places people like, loaded like any other chunk. It
delivers the "share favourite spots / places to go IRL" value with none of the
multiplayer surface. If that lands, realtime can be layered on deliberately.

### Geolocated photographs
**Show a photo from your gallery at the exact place and angle it was taken —
a shot of the horizon from a beach appears when you look at that horizon.**

This one is a good fit, and unusually cheap for what it is. It needs no new
subsystem: the world already has a WGS84 <-> local metric transform, so a
photo with EXIF GPS drops straight into the coordinate system we already use.
The "when you look that way" part is just a bearing test against the camera.

Sketch: extract EXIF GPS + timestamp on import; place a camera-facing quad at
`(lon, lat, height)`; show it when the camera's bearing is within a few degrees
and the player is in range. A photo of the skyline from Malad is then simply
*there* when you stand on the Sea Link and look north.

It also has the property that makes it feel like a real place rather than a
demo: it accumulates. A collage of the same corner at dawn, at dusk, in
monsoon, shot by people who never met — the city remembered rather than
rebuilt. Local-only needs no backend (import from your own gallery); shared
version needs one, and is a separate decision.

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
