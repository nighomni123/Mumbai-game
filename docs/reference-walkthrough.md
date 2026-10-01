# What walking around actually looks like

Observations from driving `gulmohar-local.pages.dev/?city=mumbai` on 2026-09-30,
and the gap against our `/dashboard`. Everything below was **looked at or
measured**, not inferred — the frames are in `shots/ref/`, the comparison in
`shots/compare/`, and the numbers came from PIL on those files.

Reproduce with:

```
bun scripts/ref-recon.mjs    # what the build is: DOM, console, network, chunks
bun scripts/ref-tour.mjs     # 28 district poses via its own debug API
bun scripts/shot-compare.mjs # our /dashboard on the same beats
bun scripts/shot-scope.mjs   # the ACTIVE_BOUNDS wash and the deferred areas
```

---

## 1. How it is put together

The reference is **not** a geographic city — it is a hand-built linear corridor
bent onto a tiny planet. Worth knowing because it explains both its strengths
and the ceiling it cannot break through.

Its build log (captured live) shows the whole world assembled in named passes:

```
terrain 1252ms · roads 351ms · railway 3547ms · north 1853ms · seafront 1197ms
south 1423ms (12 sub-districts, 348k tris) · churchgate · marinelines · grant
central · mahalaxmi · lowerparel · dadar · marinewest · fill · vehicles · life
finalize 3303ms {"cel":3082078,"soft":594836,"noshadow":1600018,"pool":23888,
                 "sign":1770,"sign1":96956,"sign2":418,"meshes":855}
```

Three things fall out of that number, and they are the real lesson:

- **~5.4 M triangles in 855 meshes.** Six material buckets (`cel`, `soft`,
  `noshadow`, `pool`, `sign`, `sign1/2`) merged into a handful of big buffers.
  Every plant, kerb, window box and railing is *baked into the merge*. That is
  what makes 473 buildings + 1301 trees + 54 lamps + 22 hand-written prop types
  affordable on an integrated GPU.
- **`pool` is a material bucket**, not an effect: streetlamps drop a flat disc
  of sodium-coloured ground. Cheap fake light pooling, and it is why the night
  frames read.
- **It publishes `window.__api`** — `{pose, tod, player, post, audio, fpsPoses,
  step}` plus `player.physics.{groundAt,collide}` — and reads `?x= &z= &yaw=
  &t= &rain= &only=`. Every pose in the tour is validated against the game's own
  collision before it is shot. This is the single most reusable thing here and
  it costs about fifteen lines.

## 2. The anatomy of a frame

Take `shots/ref/tour/04-khau-galli.png` — a lane off Station Road — and
unpack why it works. Five depth bands, every one populated:

| band | what is in it |
|---|---|
| near, < 1 m | a crow mid-lane, plastic stools, a red umbrella, scattered chaff |
| body, 1–2 m | the chai kettle on its burner, a bharni with its lid, idli baskets |
| stall, 2–4 m | counters, a handcart, Devanagari shop boards, a blue plastic bin |
| street, 6–12 m | string lights on catenary, wires, a hand pump, the far corner |
| beyond, 12 m+ | the hill, the temple, banded green and ochre, then the sky |

What actually sells it, in order of impact:

1. **String lights on catenary wires.** `north-props` has one prop that is
   nothing but a sagging cable with coloured bulbs. It is the single most
   effective object in the whole build, and it costs one line of geometry.
2. **One low sun, long hard shadows** raking across the lane floor as
   diagonals. Shadows are compositional, not incidental.
3. **The sky.** A cel-painted dome: lavender and peach cloud lobes with hard
   edges, a pale low sun, no gradient. It is the largest single area in most
   frames and it is *painted*, not simulated.
4. **Overlapping silhouettes.** Every band partly covers the one behind it, so
   the eye always has three or four things at different depths.
5. **Specifics with no data behind them** — the black-and-yellow kerb, the
   `MH 02 J 7290` plate, the WR red-and-cream coach, the yellow `चर्नी रोड`
   board, Mogra for the flower seller. None of this came from OSM.

## 3. Systems worth stealing

### 3.1 Life finds the city by scanning it — `mumbai-people`

This is the best idea in the reference and we have nothing like it.

At `flush()` the builder rasterises **every triangle of every bucket** into an
848 × 690 grid at 0.5 m cells, producing `top[]` (roof height), `canopy[]`
(shade) and a `flame[]` mask (any triangle with a flame colour). Then:

- `perches({minRise: 2.5, maxRise: 60})` — a roof 2.5–60 m up with a drop on ≥1
  side → **a crow perches there**. Visible in `b9-talkies-lane.png`.
- `shade({minH: 3})` — canopy ≥3 m over ground → **a person stands in shade**.
- `gardens()` — canopy 0.3–3.2 m → **plants**.
- `flames()` — flame-coloured geometry under canopy → **flame props**.

Nothing is hand-placed. 760 walkers in 4 lanes, 16 per platform, plus 7 named
talkers each with Marathi and English lines that are actually about Mumbai
(*"ढग बघा. आठवडाभरात पाऊस." — "Look at those clouds. Rain within the week."*).

**This maps onto our data for free.** We already have real footprints with real
roofs. A single rasterisation pass over the near ring gives perches, shade and
parapet edges, and life stops being a list of coordinates someone typed.

### 3.2 Neighbourhood style vectors — the `kinds()` function

`kinds(x, z)` returns one of `society | old | chawl | basti | tower | maidan |
hill` from five weighted bands of position. Fort gets society/old/chawl; the
southern suburbs get tower/society/maidan; the hill gets hill. `fill` then lays
buildings along block **fronts only**, width 9–17 m for society, 18–32 m for
chawl, 20–26 m for tower, 10–16 floors for tower, 3–4 for chawl.

So the reference *does* have the thing our plan lists as deferred. Our
`enrich-chunks.mjs` already classifies facades and assigns heights — the missing
half is the **kind**, and the block-front typology.

### 3.3 The post stack — all hand-written GLSL, no dependency

Bloom → grade → paper grain → ink → FXAA. Measured from its shaders:

- **Ink**: depth-buffer edge detect, linear + concave thresholds scaled by
  depth, distance-faded (`uFadeStart/uFadeEnd`), and at night the line colour
  lerps to blue and thins out (`mix(uInk, vec3(0.05,0.05,0.12), uNight*0.6)`)
  so lamps glow *through* the outlines.
- **Grade**: shadow/light split-tone by luma, saturation, lift, warmth,
  exposure, `pow(r, 2.4)` vignette, then a **soft highlight rolloff** so glows
  do not clip to flat white, then animated paper grain.

We have `post.js` and `outline.js` from sakura-crossing already. The two we do
not have are the **split-tone grade** and the **night-aware ink**.

### 3.4 Time of day is a single 0→1 float

`F.t`: 0 golden hour, 0.5 blue hour, 1 night, lerped at 0.22/s, with a separate
`rain` float. Every colour in the scene — sun, hemisphere, sky clouds, water,
shadow tint, ink — is a function of it. `T` cycles, `K` toggles rain. One
number drives the whole atmosphere. We have no equivalent.

## 4. Measured against ours

Same metric, same code, 200 × 125 downsample, distinct colour count and the
hue-family split:

| frame | distinct colours | families present |
|---|---|---|
| ref — Marine Drive, golden | **13,121** | 9 |
| ref — seafront wide, golden | **11,745** | 9 |
| ref — Khau Galli lane | **8,005** | 8 |
| ref — Marine Drive, night | **13,204** | 9 |
| **ours — Fort, walking** | **1,865** | 6 (four of them ~0%) |
| **ours — Fort, further** | **2,366** | 6 (four of them ~0%) |

Ours is `warm 45–57% / amber 27–28% / grey 10–23%` with **`mixed` and `magenta`
at literally 0%**. The reference at golden hour is `warm 32–40%` but spreads
the rest across grey, amber, magenta, green and cool. At night it is `blue 39%`
against `amber 17%` — the warm-window-against-cool-street split.

**So the gap is not "ours is uglier". It is that ours has three hues and no
accents.** A frame with no magenta and no mixed has nothing to look at except
shape, and shape alone is not a city.

Reference and ours, same beat, on foot:

- `ref 15-marine-drive.png` — Art Deco curved-corner balconies, neon
  `MOONLIGHT` / `OCEANIC`, spherical hedge planters, palms, raking shadows.
- `shots/compare/02-walk-fwd.png` — a real street canyon in Fort, real
  crossings, correct long shadow, **and nothing else**: no kerb paint, no
  signage, no street furniture, no people, no vehicles, no trees, no shopfronts,
  no sky.

Our geometry is right and our collision is right. What is missing is the
entire **0–4 m band**.

## 5. Where the reference is weak — beat these, do not copy them

Confirmed by looking, not assumed:

1. **Foliage is the worst thing in the build.** Gulmohar canopies are
   overlapping flat lozenges (`13-malabar-hill.png`); bushes are faceted
   icospheres in flat pink and green. It is the first thing the eye finds wrong.
2. **Blank NPC faces.** Confirmed at close range in `06-look-right-140.png` —
   a pale blank oval under dark hair, no features.
3. **Vehicles go to black.** Backlit cars and autos lose all detail into flat
   silhouettes (`03-walk-fwd-2.5s.png`).
4. **Large blank flanks.** The big blue wall in `03-street-road.png`, the
   salmon planes right of the Art Deco in `15-marine-drive.png`. Side walls get
   no windows, no bays, no downpipes.
5. **Depth-sort artefacts.** An NPC standing on the platform has his legs
   intersecting the coach.
6. **The maidan is an empty green plane.** `10-mandi.png` is a bare field.
7. **No camera near-plane avoidance** — walk into a facade and you are inside it.
   Mine did, twice, before I started validating poses against `collide()`.

On the roofline, `AGENTS.md` is only half right: the reference *does* put
**water tanks** (0–2 per roof) and **tarpaulins** on roofs. It does **not** have
dish antennas, and drying laundry is chawl-only. So rooftop clutter is a real
gap but a smaller one than we assumed.

## 6. What to build, in order

Ranked by measured impact per unit of effort. Everything below is scoped to
`ACTIVE_BOUNDS` — the 27 × 47 km mainland box.

**Tier 1 — this is the product.** Nothing below matters until these are done.

1. **Facade banding + an accent palette.** One change, biggest measured
   difference in the whole comparison. Give each building class 3–4 bands
   (plinth / body / cornice / parapet) and let *one* class carry a saturated
   accent. Target ≥8 colour families and ≥6k distinct colours in a street frame.
   We already classify facades; this is where that classification gets used.
2. **The 0–4 m band.** Kerb paint (black-and-yellow), footpath/road separation,
   streetlamps with a `pool` disc, electric poles with catenary wires, and
   string lights over the narrow streets. Highest density-per-effort in the
   entire reference. No new data needed.
3. **The sky.** A cel-painted dome: banded lavender/peach cloud lobes with hard
   edges and a low sun. It is most of the screen and currently we have nothing.
4. **Signage.** We have Devanagari + Latin rendering and 33 real places. Put
   shop boards and society boards on street-facing ground floors. Cheapest
   possible specificity.

**Tier 2 — what makes it a place rather than a model.**

5. **Neighbourhood kind vectors** — `society | old | chawl | basti | tower |
   maidan`, from a position field. Block-front typology.
6. **The scan-for-life pass.** Rasterise roof heights and canopy from the built
   geometry, then derive perches, shade spots and parapet seats. Replaces
   hand-authored prop coordinates with a rule.
7. **Time of day as one float**, with the ink and grade following it.
8. **Rooftops**: tanks, dishes, drying laundry, tarpaulins.

**Tier 3 — the deferred product ideas, still deferred.**

The social layer and geolocated photographs are unaffected by any of this. They
need a backend and a decision, not a renderer. `IMPLEMENTATION_PLAN.md` keeps
them there.

## 7. One defect found by navigating, fixed

`src/geo/world.ts` set `game.start = () => canvas.requestPointerLock()` and
`walker.ts` only ever set `game.playing = true` inside the `pointerlockchange`
handler. **If the pointer lock is refused or rejected, walking never starts and
the entry card can never be dismissed.** It reproduces under automation, in an
iframe, and in any browser or embed that denies the lock.

The reference gets this right — `requestPointerLock()?.catch?.(() => {})`, with
`playing` set independently; the lock only gates mouse-look. Fixed the same way,
matching the pattern `preview.ts` already used. Verified: the card now dismisses
and the player moves (`fort · 0 m` → `18 m`).