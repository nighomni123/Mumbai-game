# Facade readability experiment (Experiment C) — 2026-09-30

Four controlled treatments, `?facade=A|B|C|D`, all other systems frozen
(geometry, families, palette V2, lighting, camera, post-processing). A is what
ships today.

## A failed first pass, and what it taught

The first run used a 25-pose flyover grid. All four treatments came out
identical — edge density 4.01 / 4.17 / 4.01 / 4.14 percent.

That was not a null result. It was a broken benchmark. On that grid the median
pose is 37% sky and the buildings are a thin strip on the horizon, where facade
detail is sub-pixel. Measured directly: A-vs-D differ by **0.0** in the sky and
**0.0** in the lower frame of a horizon pose, and by **25.6** in the mid band of
a close pose. The treatments were real; the poses could not see them.

This is the same failure class as the missing ground and the `sea=96%` gate: a
measurement that cannot distinguish "not there" from "not looked at properly".
The flyover grid is kept as a valid aerial benchmark, and the experiment was
rebuilt on six curated street positions.

## Result — street poses, 1920x1080, n=6

| treatment | edge native | effective tones | flat@5 | accent % | tris | draws | fps |
|---|---:|---:|---:|---:|---:|---:|---:|
| A current | 4.58% | 14.1 | 288 | 5.40 | 6.47M | 47 | 21 |
| B segmentation | 4.69% | 14.4 | 293 | 5.20 | 6.13M | 47 | 24 |
| C massing | 4.83% | 14.9 | 293 | 5.63 | 7.09M | 47 | 23 |
| **D dense** | **4.96%** | **15.5** | **301** | 5.40 | 6.92M | 36 | 21 |
| *ref seafront* | *17.49%* | *191.5* | *917* | *20.56%* | — | — | — |
| *ref khau galli* | *11.31%* | *87.3* | *504* | *1.83%* | — | — | — |

## Reading it

- **The treatments work and are ordered correctly.** Edge density and effective
  tones rise monotonically A < B < C < D; segmentation and massing are additive.
- **They are nearly free.** Draw calls are flat, triangle count stays in
  6.1–7.1M regardless of treatment, fps 21–24. This answers the "cheapest
  feature set" question, and the answer is good news: facade detail is cheap. We
  have simply not been putting enough of it in.
- **But it is not the whole gap.** The densest treatment (D) reaches 4.96% edge
  density against the reference's 11–17%. D recovers roughly a fifth of the
  difference to Khau Galli and a quarter of it to seafront.

## What this means for the LOD plan

The honest conclusion is that facade detail is a real but *modest* lever, and
it is cheap. That supports building a facade LOD system on top of D — the cost
is negligible, so LOD buys more coverage, not fewer polygons. But D alone is not
where the city turns from beige to recognisable.

The remaining difference is more likely in the near-field — the 0–4 m band
(street furniture, foliage, signage, people) — and in the fact that the
reference fills the frame with objects while we still fill it with large flat
planes. That matches the attribution result: buildings own 55% of the frame and
50.9 points of it are low-chroma, but the treatments that subdivide those
buildings only move the number a little. Something other than facade detail is
setting the overall flatness.

## Files

- `src/geo/buildings.ts` — the four treatments behind `?facade=`
- `scripts/shoot-facade.mjs` — flyover grid (kept; valid aerial benchmark)
- `scripts/shoot-facade-street.mjs` — street-level grid (the one that shows the effect)
- `scripts/measure-scene.mjs` — three-scale edge density, added for this
