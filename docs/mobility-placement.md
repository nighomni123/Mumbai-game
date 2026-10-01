# Mobility placement — depth composition, 2026-09-30

Street density was shown sufficient but spatially wrong: uniform 6.5 m kerb
spacing fills the near frame with the nearest vehicle and blocks the view down
the street. This is the placement rule, and it is the last piece before
promoting a tier to the baseline.

## The rule, and the constraint that shaped it

Chunk groups are built once and frozen (`matrixAutoUpdate = false`), and a chunk
is only rebuilt when it crosses the residency ring. **A rule that read the camera
would be stale while you stand still and would pop on every chunk rebuild** — a
worse artefact than the one it fixes. So the rhythm is a property of the STREET,
derived from arc length, not a property of the viewer.

Six-step acceptance, in order. The first four are exact; the last two are
approximated by clustering, and that is worth stating plainly:

1. inside the parking band — exact (offset from the centreline)
2. orientation plausible — exact (strictly the street tangent)
3. no overlap with a sibling — exact (min gap by summed vehicle length)
4. clear of the kerb ends — exact (7 m set-back)
5. not excessive near area — approximate (larger vehicles need longer slots, so
   small ones dominate by count)
6. does not block the view — approximate (enforced by on/off **clusters** along
   the street, ~38 m period, ~52% occupied, rather than by raycasting the
   sightline)

The vehicle mix is weighted by size — 34% car, 50% two-wheeler, 16% auto — so a
crowded stretch fills with scooters and the large objects stay sparse.

## Result — 6 street poses, 1920x1080, near-field ROI

| variant | object coverage | eff. tones | flat regions |
|---|---:|---:|---:|
| A current (no mobility) | 22.5% | 10.1 | 268 |
| E uniform (V1) | 24.1% | 13.3 | 307 |
| **E clustered (V2)** | 23.9% | **13.3** | 290 |
| F uniform (V1) | 26.2% | 18.9 | 334 |
| **F clustered (V2)** | 25.9% | **19.1** | 321 |
| *reference lane* | *50.8%* | *48.2* | *328* |

**V2 keeps the effective-tone gain and gives back 13–16 flat regions** — fewer
large identical regions, which is the composition win. Visually, the middle
distance opens up under clustering where the uniform rule built a car wall.

`?place=1` restores the uniform rule so the two remain A/B-able and the claim
stays checkable.

## What I did NOT do

- **F is not promoted to the default.** It has not yet been signed off for
  visual quality and FPS; the working tree default stays at the current tier
  until that review happens.
- I did not chase object coverage toward the reference's 50.8%. That number is
  evidence about visual composition, not a target to hit mechanically.
- I did not attempt an exact camera-relative "blocks the sightline" test, for
  the static-chunk reason above.

## The remaining weakness, honestly

The clustered vehicles are geometrically correct but read as untextured blocks
at very close range — a car 2–3 m from the camera is a large flat mass before it
is a car. Near-field prop fidelity is the next thing that would need work, not
density.
