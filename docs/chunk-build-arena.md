# The chunk build arena

Measured 2026-10-01, re-measured 2026-10-01 after the typed-arena change.
What changed, what it bought, what is left, and one measurement mistake worth
reading before trusting any of it.

## What the chunk build used to do

One `BufferGeometry` per building, then a merge:

```
for each building:
    Facet -> BufferGeometry     (allocate, fill, computeVertexNormals)
push onto an array
mergeGeometries(array)          (copy every vertex again)
dispose every original
```

Every step allocated, and the merge copied the whole city a second time for a
result that was always a single mesh.

## What it does now

One `Facet` per chunk, one `BufferGeometry`, no merge:

```
for each building: append into the chunk's shared Facet
once at the end:     Facet -> BufferGeometry
```

This works because `buildBuilding` already writes in absolute chunk-local
coordinates — there is no per-building transform to undo, so every building in
a chunk can simply append. The time-slice boundary is free too: a slice that
runs out of budget keeps the arena and appends where it left off.

`src/geo/chunk-build.ts` owns this path, has no DOM and no scene state, and is
importable by both the renderer and a benchmark. It is also the shape a worker
would need, if the work ever has to leave the frame thread.

## The bug that was bigger than the refactor

`mass()` drew the roof cap inside the per-edge wall loop. An n-vertex footprint
therefore drew its roof **n times** — a shadowed `let i` hid it.

The shipped starter slice averages 7.66 vertices per footprint, so that was
**4.4x the triangles the city actually needs**: 896,180 instead of 202,308.
Every one of those triangles is coplanar overdraw at identical depth, so it was
invisible: it cost fill rate, vertex bandwidth and about a third of the entire
chunk build.

`bun scripts/bench-chunk.ts` now asserts this cannot come back: it compares the
triangles actually emitted against `3 x ring.length` for every unenriched
building, and fails if the ratio exceeds 1.15.

## The typed arena

After the arena, `Facet` still pushed into plain JS arrays and only became
typed at the end. Replacing those with growable `Float32Array`/`Uint8Array`
plus a write cursor was the next experiment.

**It works, and it is worth roughly 2x on emit.** Both sides are the real
implementations — the array one is commit `51b5aa0` in a git worktree — and
they are interleaved, 15 rounds, minimum reported.

| | array-backed | typed growable | gain |
|---|---|---|---|
| starter slice, min | 34.2 ms | 20.1 ms | **1.70x** |
| full metro, min | 4792.7 ms | 2427.3 ms | **1.97x** |

`scripts/ab-facet.ts` prints min / p25 / median, and proves the two sides are
byte-identical before it times anything:

```
equivalence: OK — 1,662,102 floats compared byte-for-byte
```

The win is mostly in the finalisation: `Uint8Array.from()` over a 1.66M-element
JS array was 32% of the whole build. Typed storage makes it 6%.

### It is visually a no-op

Six fixed street-level poses, captured after the build queue drained, array vs
typed captured minutes apart with nothing else changed: **0 pixels differ
outside the HUD's fps readout.** (Capture both sides at the same moment — a
screenshot from an older commit will differ wherever the HUD has moved on.)

## A measurement mistake worth keeping

The first version of this experiment reported the typed arena as a wash —
`0.90x`, `0.99x`, `1.07x` across three runs — and the typed change was reverted
on that basis.

**That comparison was void.** The harness imported `Facet` once and handed the
same instance to both emitters, so the "array-backed" side was writing into the
typed class. It measured the new implementation against itself, and the spread
was pure machine noise.

Two lessons, both now encoded in the scripts:

1. **An oracle has to own its subject.** `ab-facet.ts` imports each side's own
   `Facet` from its own tree, and refuses to report timings unless the byte
   comparison passes first.
2. **This box cannot resolve small differences.** Several agents share it, and
   load averages of 25-50 turn a median into noise — the same code measured
   18 ms and 122 ms in consecutive runs. Everything reports the **minimum** over
   many rounds and prints the load average, so a reader can see how contended
   the run was.

## Where the remaining time goes

`bun scripts/bench-chunk.ts` decomposes one complete build; the phases sum to
the total. Shipped slice, minimum of 9 rounds:

| phase | ms | |
|---|---|---|
| emit (all building geometry) | 29.9 | 51% |
| array -> typed + attributes | 3.6 | 6% |
| `computeVertexNormals` | 12.1 | 20% |
| `computeBoundingSphere` | 13.6 | 23% |
| **sum** | **59.2** | |

So `emit` is now a bit over half, and the largest single remaining target is
still the procedural generation itself.

Two cheap ideas this measurement points at, in order:

- **`computeBoundingBounds` is free.** Every vertex is already written once,
  with nothing to copy: track min/max as they are emitted and set the bounding
  sphere analytically. That removes 23% for the cost of four comparisons per
  triangle.
- **Normals may not be needed at all.** `Facet` already bakes a fixed
  sun-azimuth face shade into the vertex **colour**; the comment above `box()`
  says "no normal is ever needed". The geometry is still paying for
  `computeVertexNormals` on unindexed data (20%). Whether the cel material
  tolerates `MeshBasicMaterial` + baked colour is a real experiment, not an
  assumption — it would change the lighting, so it needs the same pixel gate.

## Not done, deliberately

Workers. The seam is in place and the payload is already one typed array per
layer, but neither of the two things above needs them, and doing them first
would be paying the complexity before earning it.