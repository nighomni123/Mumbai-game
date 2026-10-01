# Palette V2 — experiment record (2026-09-30)

Controlled: only the palette vocabulary, secondary facade regions and semantic
accents changed. Geometry, families, street layer, levels, priors, lighting,
camera, post-processing and the metric implementation all held constant.
Deterministic toggle: `?palette=v1` / `?palette=v2`, default v2.

25 poses on a grid over the Fort slice (the six fixed benchmark poses frame
mostly the same few buildings and under-sample a palette change).

| metric | V1 | V2 | delta | reference |
|---|---:|---:|---:|---:|
| chroma p99.9 | 0.339 | 0.340 | +0.001 | 0.950 |
| accent % | 1.01 | 2.37 | +1.36 | 20.56 |
| hue families | 4.6 | 4.6 | +0.0 | 7.0 |
| flat regions @5 | 313 | 319 | +6 | 917 |
| largest colour region % | 41.5 | 41.5 | -0.0 | 9.7 |
| tones to cover half | 2.4 | 2.4 | +0.0 | 33.0 |
| effective tones | 11.4 | 11.6 | +0.2 | 191.5 |

## Verdict

The accents work; the area work did not.

- **accent 1.01% -> 2.37%** — semantic shopfront/fascia/awning/door accents are
  real and visible. That part of the design is sound.
- **hue families 4.6 -> 4.6, largest region 41.5% -> 41.5%, tones to cover half
  2.4 -> 2.4** — unchanged, despite the enrichment assigning 27 palettes
  across the slice instead of 14.

The secondary regions and the wider palette are being assigned but are not
changing the picture, because the dominant mass is not buildings. Largest single
colour region is 41.5% of the frame and 2.4 tones cover half of it; the lower band
sits at chroma 30 and the upper band at 58, and neither moved. That mass is
ground, sky and the large flat facades of the buildings directly in front of the
camera — none of which the palette vocabulary reaches.

So: the experiment answers its question negatively. Colour-region work on
buildings alone cannot close this gap, because buildings are not most of the
frame. The next lever is the large flat planes (ground, sky, and the near facade
masses), not the palette vocabulary.
