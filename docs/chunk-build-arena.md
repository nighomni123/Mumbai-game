# The chunk build arena

Measured 2026-10-01. What changed, what it bought, and what is left.

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
**4.4x the triangles the city needed**: 896,180 instead of 202,308. All of it
coplanar overdraw at identical depth, so it drew nothing new — it only cost
fill rate, vertex bandwidth and about a third of the entire chunk build.

It affected every enriched building, including the setback crowns.

## Measured

`bun scripts/bench-chunk.ts` — the whole shipped slice (17 chunks, 8,798
buildings), both paths interleaved on the same data in one process so the
comparison cannot drift with machine load.

| | before | after |
|---|---|---|
| chunk build, whole slice | 441.7 ms | 125.0 ms |
| **speedup** | | **3.5x** |

In the running renderer, at six fixed street-level poses, captured after the
build queue drained (so both sides show the same resident set):

| spot | chunks | tris before | tris after | Δ |
|---|---|---|---|---|
| fort-esplanade | 8 | 5,193k | 4,798k | −7.6% |
| kala-ghoda | 10 | 7,077k | 6,481k | −8.4% |
| gateway | 11 | 4,131k | 3,816k | −7.6% |
| churchgate | 12 | 6,990k | 6,490k | −7.2% |
| charni-road | 13 | 8,055k | 7,674k | −4.7% |
| colaba-causeway | 12 | 3,731k | 2,585k | −30.7% |

Draw calls are unchanged at these poses. The triangle drop is the roof fix;
the time drop is the arena.

### It is visually a no-op

Pixel-diffed before/after at all six poses: **0.00–0.01% of pixels differ**, and
every differing pixel falls inside one 25x57 box at (195,105) — the HUD's
`fps`/`chunks` readout. The 3D render is pixel-identical.

That is the point: the unenriched buildings now go through the same `mass()`
prism every enriched building already used, instead of a separate
`THREE.ExtrudeGeometry` path, so there is one code path and one look.

## What is left, measured

After the change, where a full slice of the starter slice goes:

| phase | ms |
|---|---|
| emitting triangles into the `Facet` | 180.7 |
| `computeVertexNormals` | 69.2 |
| `computeBoundingSphere` | 64.7 |
| Float32Array / Uint8Array conversion | 33.7 |

`Facet` still pushes into plain JS arrays (~1.66M pushes per slice). Writing
into growable typed arrays instead is the next cheap win and needs no worker.
After that, moving this path to a worker is the obvious next step — the seam is
already in place and the payload is already one typed array per layer.