# Surface-area attribution — 2026-09-30

Which layer owns the frame? Measured from the RENDERER's own geometry: each
layer rendered alone, framebuffer read back. Not a colour rule.

25 poses on a 320x200 grid over the Fort slice.

## Area share by layer (mean % of frame)

| layer | share |
|---|---:|
| buildings | 55.0 |
| background | 19.1 |
| land | 15.5 |
| sea | 10.4 |
| streetkit | 0.0 |

## The dominant colour region, decomposed

The largest single colour region covers 43.8% of the frame on average. Which layers make it up:

| layer | share of frame |
|---|---:|
| buildings | 43.8 |

## Low-chroma area per layer (chroma < 26/255, mean % of frame)

| layer | low-chroma share |
|---|---:|
| buildings | 50.9 |
| land | 15.4 |
| streetkit | 0.0 |

Total low-chroma: 66.3% of frame.
