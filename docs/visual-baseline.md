# Visual baseline — retaken 2026-09-30

Taken **after** the ground-winding fix, with geometry, families, street layer,
levels, priors, lighting, camera poses, post-processing and the metric
implementation all held constant. This replaces every earlier visual number:
they were taken with the ground and sea missing from the scene, so ~39% of each
frame was `scene.background` and the whole comparison was contaminated.

## What the contamination was

The ground and sea quads were wound to face **down**. `flat()` is a
`MeshBasicMaterial`, which is FrontSide by default, so both were culled and
**neither had ever rendered**. Buildings and streets drew over bare background and
it looked like a finished render.

Found by painting the land mesh magenta and getting 0.0% of the frame back, then
setting `side: DoubleSide` and getting 39.2%. Same class as the mirrored-Z bug
this project shipped once already — invisible to `tsc` and to `build`.

Two consequences that invalidated prior conclusions:

- The `building` coverage metric moving 32.2% → 54.9% was not a palette
  change; it was the ground reappearing and being classified as low-chroma
  architecture.
- The `chroma p99.9 = 0.277` that repeated on three frames was **the background
  colour in three different places**, not a palette ceiling. That hypothesis is
  withdrawn. Charni Road, which has coloured facades in shot, reads 0.438; the
  others sit at 0.279.

## Baseline

| pose | sky | building | wash | road | chroma p99.9 | accent | hues | flat@5 | outlines | outline h.stdev | vegetation | lower-3rd detail |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| fort-esplanade | 17.4 | 46.3 | 5.0 | 24.6 | 0.279 | 0.039 | 4 (orange) | 301 | 34 | 21.5 | 7.0 | 5.0 |
| kala-ghoda | 16.0 | 54.9 | 2.7 | 24.7 | 0.279 | 0.028 | 4 (orange) | 276 | 20 | 32.0 | 1.0 | 6.4 |
| gateway | 43.9 | 46.7 | 0.1 | 9.3 | 0.279 | 0.034 | 4 (orange) | 129 | 51 | 46.7 | 0.0 | 4.3 |
| churchgate | 20.2 | 48.7 | 0.0 | 19.5 | 0.279 | 0.033 | 4 (orange) | 168 | 39 | 33.0 | 0.0 | 4.1 |
| charni-road | 25.0 | 47.1 | 2.1 | 24.5 | 0.438 | 0.663 | 4 (orange) | 422 | 31 | 25.4 | 0.3 | 4.1 |
| colaba-causeway | 5.8 | 66.7 | 0.2 | 24.5 | 0.279 | 0.030 | 4 (orange) | 269 | 40 | 45.1 | 0.0 | 4.1 |
| **mean** | 21.4 | 51.8 | 1.7 | 21.2 | 0.305 | 0.1 | 4.0 | 260.8 | 35.8 | 33.9 | 1.4 | 4.7 |

### Reference, same metrics and same tool

| seafront wide | 8.4 | 44.0 | 17.9 | 24.5 | 0.950 | 20.56 | 7 | 917 | 58 | 37.5 | 1.1 | 5.6 |

## Reading this

- **Every pose is now surface-dominated.** sky is 5.8–43.9% (mean 21.4%) and
  building+road+wash is 79–94%. That is what a street view should look like.
- **The palette is not uniform.** `p99.9` is 0.279 on five poses and 0.438 on
  Charni Road. The earlier `0.277/0.277/0.277` uniformity was an artefact.
- **Orange still dominates every pose** — hue families = 4 in all six, with
  orange >90% share on Fort and Kala Ghoda. That is a real finding and it is
  about the palette, not the ground.
- **Accent is ~0.03% on five poses.** Charni Road reaches 0.663%. Against the
  reference's 20.56%, this is the largest single gap and it is still open.
- **flat@5 260 vs the reference's 917** — the reference carries roughly three and
  a half times as many distinct flat tones in the same frame size.
- **outline height stdev 33.9 vs 37.5** is already close. Silhouette variety is
  not the problem, which is worth knowing before anyone spends effort there.

## What this baseline does NOT license

Accent rate moves easily — one saturated shopfront changes it far more than a
fixed facade does. So hue families and flat-tone count are the guard against
reading an accent win as an architectural win.

