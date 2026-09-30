/**
 * The geometry behind the map, with no canvas and no three.js in it.
 *
 * Plain JS on purpose, for the same reason as planet-math.js: the renderer is
 * TypeScript but a check script is not, and a duplicated copy of this maths is
 * one that drifts. The index arithmetic in particular was already wrong once —
 * the land mask is a flat [row, x0, x1, ...] array, and a renderer that walks
 * it with the wrong stride renders something plausible that is not the map.
 *
 * So there is ONE decomposition of a land run, `landRuns`, and both the 3D
 * world and the map draw from it.
 */

/** @typedef {{x0:number,x1:number,y0:number,y1:number}} Run */

/**
 * Decompose the flat land mask into axis-aligned boxes in local metres.
 *
 * The mask is one row per `maskCellM` northings, and each entry is
 * [rowIndex, x0, x1] — x already in local metres, y derived from the row.
 *
 * @param {{land:number[], bounds:{y0:number}, cellM:number}} mask
 * @returns {Run[]}
 */
export function landRuns(mask) {
  const out = [];
  const { land, bounds, cellM } = mask;
  for (let i = 0; i < land.length; i += 3) {
    const y0 = bounds.y0 + land[i] * cellM;
    out.push({ x0: land[i + 1], x1: land[i + 2], y0, y1: y0 + cellM });
  }
  return out;
}

/**
 * Fit a bounding box into a w x h pixel box, centred, aspect preserved.
 * North is up, so y is flipped.
 *
 * @param {{x0:number,x1:number,y0:number,y1:number}} bounds
 */
export function projectorFor(bounds, w, h) {
  const bw = bounds.x1 - bounds.x0;
  const bh = bounds.y1 - bounds.y0;
  const s = Math.min(w / bw, h / bh);
  const ox = (w - bw * s) / 2 - bounds.x0 * s;
  // oy is the pixel y of the NORTH edge, so y = oy - worldZ * s.
  const oy = (h - bh * s) / 2 + bounds.y1 * s;
  return {
    scale: s,
    x: (x) => x * s + ox,
    y: (z) => oy - z * s,
    invX: (px) => (px - ox) / s,
    invY: (py) => (oy - py) / s,
  };
}
