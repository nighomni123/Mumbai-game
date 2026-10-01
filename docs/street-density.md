# Street density experiment — 2026-09-30

Six tiers, `?street=A|B|C|D|E|F`, all other systems frozen (facade D is now the
default, palette V2, ground, lighting, camera, post-processing). Each tier is A
plus **one** class, so each class's marginal contribution is measurable rather
than confounded. Six street-level poses at 1920x1080, measured in the near-field
region of interest.

| tier | adds | object coverage | eff. tones | flat regions | edge (ROI) |
|---|---|---:|---:|---:|---:|
| A current | — | 22.5% | 10.1 | 268 | 4.22 |
| B vegetation | trees, shrubs | 23.9% | 11.6 | 280 | 4.32 |
| C furniture | benches, bollards | 22.8% | 10.4 | 271 | 4.26 |
| D commercial | awnings, shutters | 23.0% | 10.4 | 268 | 4.29 |
| **E mobility** | cars, bikes, autos | **24.5%** | **14.0** | **302** | 4.19 |
| **F combined** | B+C+D+E+people | **26.4%** | **20.2** | **332** | 4.40 |
| *reference lane* | | *50.8%* | *48.2* | *328* | *13.35* |

## What this says

- **Mobility is the strongest single class**, as predicted: E alone takes
  effective tones 10.1 → 14.0 (+39%). Vegetation adds a little; furniture and
  commercial frontage add almost nothing on their own.
- **The combined tier roughly doubles effective tones** (10.1 → 20.2) and adds
  64 flat regions. Density is not free but it is cheap — draw calls were flat and
  the whole thing merges into the existing per-chunk buffer.
- **But F still only reaches 20.2 effective tones against the reference's 48.2**,
  and object coverage 26.4% against 50.8%. So street objects, even all of them,
  do not close the gap on their own.

## The problem the pictures show that the numbers do not

Comparing F against the reference lane, the issue is not density, it is
**composition and placement**:

- My tier spacing puts a parked car every ~6.5 m, so the *nearest* one fills the
  near frame and blocks the view down the street. The reference places a hero
  object in the foreground and keeps the middle distance legible.
- The reference scene is a composed shot — a foreground car, a lit stall in the
  midground, a designed backdrop. Mine is objects strewn at the camera.
- So more density is the right direction, but the *placement rule* needs to be
  hero-objects-on-the-kerb-and-keep-the-middle-clear, not uniform-every-6m.

## Caveats the metric itself has

- `objectCoverage` is an upper bound: it fires on tree dapple, road wear, kerb
  edges and window frames as well as on real objects. It is only valid
  frame-to-frame at a matched camera.
- The reference's wider seafront frame outscores the lane, but that is an
  elevated shot, not a denser street. Do not compare across framings.
- `wash` counts as object, which is inconsistent with the layer's own meaning and
  slightly inflates the number on hazy frames.

## What I'd keep and what I'd change

Keep: the prop kit (`src/geo/props.ts`, all props under the triangle budget,
colours all from `PAL`), the tier switch, and the near-field ROI metric.

Change: the placement rule — sparse along the near kerb with deliberate gaps so
the middle distance stays readable, rather than uniform spacing. That is a
placement tuning pass, not a new system, and it is the obvious next thing.

Facade D stays the default. Facade LOD remains worth building later; street
density was the right call to make first, as the attribution predicted.
