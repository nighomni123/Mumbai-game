#!/usr/bin/env node
// measure-scene.mjs — layer breakdown + architectural metrics for city-render screenshots.
//
// This REPLACES the old "distinct pixel colours per frame" metric, which rewarded
// foliage and signage without rewarding better architecture. Everything here is
// computed from the decoded pixels; nothing is read from the renderer.
//
//   node scripts/measure-scene.mjs                     # enrich/ + reference frames
//   node scripts/measure-scene.mjs shots/ref/tour/04-khau-galli.png
//   node scripts/measure-scene.mjs <img> --compare     # vs the recorded reference numbers
//   node scripts/measure-scene.mjs <img> --json
//
// No network. No dependencies beyond node stdlib (zlib). ~40ms per 1440x900 frame.
//
// ---------------------------------------------------------------------------
// RULES — every threshold below is a judgement call, not a physical constant.
// All are stated here and reprinted by --rules so a reviewer can argue with them.
// ---------------------------------------------------------------------------
// WORKING GRIDS
//   gridA 200x125 area-average downsample. Colour/coverage metrics run here
//          because the recorded calibration numbers (13,121 colours etc.) were
//          measured at this resolution.
//   gridB w/3 x h/3. Structure metrics (silhouette, window rhythm, detail)
//          need resolution that 200x125 destroys.
//
// CHROMA, NOT HSL SATURATION — this is the single most important correction in
//   this file. HSL saturation is undefined at lightness extremes and inflates
//   badly for pale warm tones: #f0d0a8 (a cream) has HSL S = 0.70, so an
//   "accent = saturated" rule scores an untextured cream ground plane at 41%
//   accent. Chroma = max(r,g,b) - min(r,g,b) is lightness-independent and does
//   not have that failure. Measured on these frames: our palette's maximum
//   chroma is 0.278 and NOT ONE pixel exceeds 0.30, while the reference reaches
//   0.89 with 14% of pixels above 0.30. So ACCENT RATE is defined on chroma.
//
// SKY IS POSITIONAL, NOT COLOUR — sky-by-hue fails on every frame that matters:
//   golden-hour sky is warm, night sky is dark, and the reference lane's sky is
//   cream (the same tone as our ground plane). So sky is found by walking down
//   each column until the first sharp step (|dL| > 0.06 or chroma > 0.30), which
//   is the skyline. Everything above is sky. This is a better rule but it means
//   a frame with no skyline (all sky, or a wall filling the frame) scores oddly.
//
// LAYER CLASSIFICATION (per gridA cell, first matching rule wins)
//   1 shadow      L < 0.20
//   2 vegetation  hue 70..170 deg, chroma >= 0.10, 0.10 <= L <= 0.80
//   3 wash        L >= 0.62 and chroma >= 0.18
//   4 accent      chroma >= 0.30 and L >= 0.22
//   5 vehicle     chroma >= 0.22 and L < 0.22
//   6 road        chroma <= 0.14 and 0.08 <= L <= 0.45 and row >= 0.45*H
//   7 building    chroma <= 0.30 and L >= 0.20
//   8 ground      chroma <= 0.30 and L >= 0.08
//   9 other       remainder
//
//   "wash" is deliberately a layer of its own and not folded into sky or ground:
//   it is the untextured bright field — sky, haze, or an untextured ground plane.
//   This tool cannot tell those three apart, and refusing to pretend is the point.
//   It is also the metric that separates our frames from the reference most
//   cleanly (ours 43-48%, reference 5-13%).
//
// ACCENT RATE — chroma >= 0.30, over the building mask. Also reported at 0.22,
//   and over all non-sky pixels, because a small building mask makes the
//   headline number statistically fragile (the cell count is printed with it).
//   The HSL-saturation variant is printed only as a cautionary contrast.
//
// HUE FAMILIES — 12 families of 30 deg. Cells with chroma < 0.10 are excluded
//   (their hue is quantisation noise, not a colour decision).
//
// WINDOW RHYTHM — on gridB, a "dark rectangle" is a building-mask cell with
//   L < median(L of building cells) - 0.10 and S < 0.40. Rows are grouped into
//   8-row bands; a band's rhythm is the median count of maximal horizontal dark
//   runs across the band's qualifying rows. This counts window-LIKE dark runs.
//   It does not verify windows. Tree dapple, deep shadow, railings and balcony
//   voids all inflate it. Treat it as an upper bound on window density.
//
// DETAIL DENSITY — lower third of gridB. For each cell, local contrast = max-min
//   of L over the 2x2 neighbourhood. Fraction with contrast > 0.08. This counts
//   ANY high-frequency thing — railings, litter, kerb edges, window frames — not
//   specifically street furniture.
//
// KNOWN WEAKNESSES (repeated in the report output)
//   * "vehicle" and "accent" are not separable from saturated building trim at
//     this resolution. Both are upper bounds on real vehicle/signage coverage.
//   * "shadow" folds genuine darkness, night frames, and dark paint into one bin.
//   * Sky-by-hue fails on golden hour (warm sky is classified ground/building) and
//     on night (everything is shadow). Reference night frames are NOT comparable.
//   * Silhouette components MERGE when two buildings abut, so silhouette COUNT is
//     a lower bound; the height spread is the more robust half of that metric.
//   * None of this measures recognisability. See the printed note.
//
// NEAR-FIELD ROI — objectCoverage reads near-field cells that are not large flat
//   surfaces. Two details are not judgement calls but consequences of gridA resolution:
//   the horizon needs an 8-row run to clear before it is believed (any single row
//   qualifies one row under the skyline, which makes the ROI the whole frame), and the
//   flat-surface test needs a local-texture term (at gridA a parked car IS the road
//   colour). KNOWN WEAKNESS: local texture counts tree dapple, road wear, kerb edges
//   and shadow noise as objects, so it is an upper bound on real street furniture —
//   and the seafront wide reads higher than the lane because it has more water sparkle
//   and vegetation, not more objects.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { basename } from 'node:path'

// ---------------------------------------------------------------- PNG decode

/** Decode an 8-bit non-interlaced PNG to {width,height,rgb:Uint8Array}.
 * @param {Buffer} buf
 * @returns {{width:number,height:number,rgb:Uint8Array}}
 */
export function decodePng (buf) {
  const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  for (let i = 0; i < 8; i++) if (buf[i] !== SIG[i]) throw new Error('not a PNG')
  let off = 8
  let ihdr = null
  const idat = []
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('latin1', off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        depth: data[8],
        colorType: data[9],
        interlace: data[12]
      }
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    off += 12 + len
  }
  if (!ihdr) throw new Error('no IHDR')
  if (ihdr.depth !== 8) throw new Error(`unsupported bit depth ${ihdr.depth} (need 8)`)
  if (ihdr.interlace !== 0) throw new Error('interlaced PNG unsupported')
  const bpp = { 0: 1, 2: 3, 4: 2, 6: 4 }[ihdr.colorType]
  if (!bpp) throw new Error(`unsupported colour type ${ihdr.colorType}`)

  const { width, height } = ihdr
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * bpp
  const out = new Uint8Array(stride * height)
  let p = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[p++]
    const row = out.subarray(y * stride, y * stride + stride)
    const src = raw.subarray(p, p + stride)
    p += stride
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? row[x - bpp] : 0
      const b = y > 0 ? out[(y - 1) * stride + x] : 0
      const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0
      let v = src[x]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const pp = a + b - c
        const pa = Math.abs(pp - a); const pb = Math.abs(pp - b); const pc = Math.abs(pp - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      } else if (filter !== 0) throw new Error(`bad filter ${filter} on row ${y}`)
      row[x] = v & 0xff
    }
  }
  const rgb = new Uint8Array(width * height * 3)
  for (let i = 0, n = width * height; i < n; i++) {
    if (bpp === 3) { rgb[i * 3] = out[i * 3]; rgb[i * 3 + 1] = out[i * 3 + 1]; rgb[i * 3 + 2] = out[i * 3 + 2] } else if (bpp === 4) { rgb[i * 3] = out[i * 3]; rgb[i * 3 + 1] = out[i * 3 + 1]; rgb[i * 3 + 2] = out[i * 3 + 2] } else if (bpp === 1) { rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = out[i] } else { rgb[i * 3] = rgb[i * 3 + 1] = out[i * 2]; rgb[i * 3 + 2] = out[i * 2 + 1] }
  }
  return { width, height, rgb }
}

// ------------------------------------------------------------------- resample

/** Area-average resample to an exact target size. Returns interleaved 0..1 RGB.
 * @param {{width:number,height:number,rgb:Uint8Array}} img
 * @param {number} tw
 * @param {number} th
 * @returns {{width:number,height:number,data:Float32Array}}
 */
function resample (img, tw, th) {
  const { width: w, height: h, rgb } = img
  const out = new Float32Array(tw * th * 3)
  const sx = w / tw; const sy = h / th
  for (let ty = 0; ty < th; ty++) {
    const y0 = ty * sy; const y1 = (ty + 1) * sy
    const iy0 = Math.floor(y0); const iy1 = Math.max(iy0 + 1, Math.ceil(y1))
    for (let tx = 0; tx < tw; tx++) {
      const x0 = tx * sx; const x1 = (tx + 1) * sx
      const ix0 = Math.floor(x0); const ix1 = Math.max(ix0 + 1, Math.ceil(x1))
      let r = 0; let g = 0; let b = 0; let n = 0
      for (let y = iy0; y < iy1 && y < h; y++) {
        const wy = Math.min(y + 1, y1) - Math.max(y, y0)
        if (wy <= 0) continue
        for (let x = ix0; x < ix1 && x < w; x++) {
          const wx = Math.min(x + 1, x1) - Math.max(x, x0)
          if (wx <= 0) continue
          const wt = wx * wy
          const i = (y * w + x) * 3
          r += rgb[i] * wt; g += rgb[i + 1] * wt; b += rgb[i + 2] * wt
          n += wt
        }
      }
      const o = (ty * tw + tx) * 3
      if (n > 0) { out[o] = r / n / 255; out[o + 1] = g / n / 255; out[o + 2] = b / n / 255 }
    }
  }
  return { width: tw, height: th, data: out }
}

// ----------------------------------------------------------------- colour math

const TAU = Math.PI * 2

/** RGB (0..1) to hue in degrees 0..360, s 0..1, l 0..1.
 * @param {number} r @param {number} g @param {number} b
 */
function toHsl (r, g, b) {
  const max = Math.max(r, g, b); const min = Math.min(r, g, b)
  const d = max - min
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (d > 1e-6) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60
    else if (max === g) h = ((b - r) / d + 2) * 60
    else h = ((r - g) / d + 4) * 60
  }
  return { h, s, l }
}

const HUE_FAMILIES = [
  'red', 'orange', 'amber', 'chartreuse', 'green', 'spring', 'cyan', 'azure', 'blue', 'violet', 'magenta', 'rose'
]
/** @param {number} h degrees */
const hueFamily = h => Math.min(11, Math.floor(h / 30)) % 12

/** @param {number[]} xs */
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
/** @param {number[]} xs */
const median = xs => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
/** Percentile of a numeric array (linear interpolation). Callers pass a sorted copy.
 * @param {number[]} sorted @param {number} q 0..100
 */
const percentile = (sorted, q) => {
  if (!sorted.length) return 0
  const pos = (q / 100) * (sorted.length - 1)
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

/** @param {number[]} xs */
const stdev = xs => {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length)
}
/** Percentage, with extra precision below 1% so a near-zero rate does not print as "0.0%"
 * and hide the fact that the sample was tiny.
 * @param {number} x
 */
const pct = x => `${(x * 100).toFixed(x < 0.01 ? 3 : 1)}%`
/** @param {number} x */
const f3 = x => x.toFixed(3)

// -------------------------------------------------------------- layer classes

const LAYERS = ['sky', 'building', 'vegetation', 'road', 'ground', 'vehicle', 'accent', 'wash', 'shadow', 'other']

/** Classify one non-sky cell. First matching rule wins; the order is the contract.
 * @param {{h:number,c:number,l:number}} x chroma-based colour
 * @param {number} rowFrac 0..1 down the frame
 * @returns {string} layer name
 */
function classify (x, rowFrac, roadL) {
  const { h, c, l } = x
  if (l < 0.20) return 'shadow'
  if (h >= 70 && h <= 170 && c >= 0.10 && l >= 0.10 && l <= 0.80) return 'vegetation'
  if (l >= 0.62 && c >= 0.18) return 'wash'
  if (c >= 0.30 && l >= 0.22) return 'accent'
  if (c >= 0.22 && l < 0.22) return 'vehicle'
  // road is ADAPTIVE: below the median lightness of the lower frame, not below a fixed
  // number. An absolute cutoff cannot serve both a bright Marine Drive and a dark night
  // lane: at a fixed L<=0.45 the reference lane reads 51.6% road, which is simply wrong.
  if (c <= 0.14 && rowFrac >= 0.50 && l < roadL) return 'road'
  if (c <= 0.30 && l >= 0.20) return 'building'
  if (c <= 0.30 && l >= 0.08) return 'ground'
  return 'other'
}

/** Shannon entropy in bits of a count array.
 * @param {number[]} counts
 */
function entropy (counts) {
  const total = counts.reduce((a, b) => a + b, 0)
  if (total === 0) return { bits: 0, normalised: 0, families: 0 }
  let bits = 0
  let present = 0
  for (const c of counts) {
    if (c <= 0) continue
    present++
    const p = c / total
    bits -= p * Math.log2(p)
  }
  return { bits, normalised: present > 1 ? bits / Math.log2(present) : 0, families: present }
}

// ------------------------------------------------------------- connected comps

/** 4-connected component labelling with a Uint8Array predicate.
 * @param {number} w @param {number} h
 * @param {(i:number)=>boolean} pred
 * @returns {{minRow:number[],maxRow:number[],areas:number[]}}
 */
function components (w, h, pred) {
  const seen = new Uint8Array(w * h)
  const stack = new Int32Array(w * h)
  const minRow = []; const maxRow = []; const areas = []
  for (let s = 0; s < w * h; s++) {
    if (seen[s] || !pred(s)) continue
    let sp = 0
    stack[sp++] = s
    seen[s] = 1
    let lo = Infinity; let hi = -Infinity; let area = 0
    while (sp > 0) {
      const c = stack[--sp]
      const cy = (c / w) | 0
      if (cy < lo) lo = cy
      if (cy > hi) hi = cy
      area++
      const cx = c - cy * w
      if (cx > 0 && !seen[c - 1] && pred(c - 1)) { seen[c - 1] = 1; stack[sp++] = c - 1 }
      if (cx < w - 1 && !seen[c + 1] && pred(c + 1)) { seen[c + 1] = 1; stack[sp++] = c + 1 }
      if (cy > 0 && !seen[c - w] && pred(c - w)) { seen[c - w] = 1; stack[sp++] = c - w }
      if (cy < h - 1 && !seen[c + w] && pred(c + w)) { seen[c + w] = 1; stack[sp++] = c + w }
    }
    minRow.push(lo); maxRow.push(hi); areas.push(area)
  }
  return { minRow, maxRow, areas }
}

// ------------------------------------------------------------------ main metric

/** @typedef {{width:number,height:number,data:Float32Array}} Grid */

/** Build the per-cell hue/chroma/l arrays and a positional sky mask for a grid.
 * Sky is found by walking down each column to the first sharp step.
 * @param {Grid} g
 */
function fields (g) {
  const n = g.width * g.height
  const h = new Float32Array(n); const c = new Float32Array(n); const l = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const r = g.data[i * 3]; const gg = g.data[i * 3 + 1]; const b = g.data[i * 3 + 2]
    const mx = Math.max(r, gg, b); const mn = Math.min(r, gg, b)
    const d = mx - mn
    l[i] = (mx + mn) / 2
    c[i] = d
    if (d <= 1e-6) h[i] = 0
    else if (mx === r) h[i] = (((gg - b) / d) + (gg < b ? 6 : 0)) * 60
    else if (mx === gg) h[i] = ((b - r) / d + 2) * 60
    else h[i] = ((r - gg) / d + 4) * 60
  }
  // 'sky' is index 0, so layer must NOT be default-initialised to 0: an untouched
  // cell would read as sky and silently swallow the whole frame. Seed with 'other'
  // and keep sky in its own mask.
  const layer = new Uint8Array(n).fill(LAYERS.indexOf('other'))
  const isSky = new Uint8Array(n)
  const horizon = new Int32Array(g.width)
  for (let x = 0; x < g.width; x++) {
    let stop = 0
    for (let y = 1; y < g.height; y++) {
      const i = y * g.width + x
      if (Math.abs(l[i] - l[i - g.width]) > 0.06 || c[i] > 0.30) break
      stop = y
    }
    horizon[x] = stop
    for (let y = 0; y <= stop; y++) { isSky[y * g.width + x] = 1; layer[y * g.width + x] = LAYERS.indexOf('sky') }
  }
  const lower = []
  for (let y = Math.floor(g.height * 0.5); y < g.height; y++) {
    for (let x = 0; x < g.width; x++) { const i = y * g.width + x; if (!isSky[i]) lower.push(l[i]) }
  }
  const roadL = median(lower)
  for (let i = 0; i < n; i++) {
    if (isSky[i]) continue
    layer[i] = LAYERS.indexOf(classify({ h: h[i], c: c[i], l: l[i] }, ((i / g.width) | 0) / g.height, roadL))
  }
  return { h, c, l, layer, isSky, horizon }
}

/** Layers that can be a large flat surface. Reported in the result; the object metric
 * subtracts flat-surface CELLS from these layers, not the layers wholesale. */
const FLAT_SURFACE_LAYERS = ['sky', 'road', 'ground', 'building']

/** Layers that are unconditionally "object" — none of them can be a large flat surface. */
const OBJECT_LAYERS = LAYERS.filter(k => !FLAT_SURFACE_LAYERS.includes(k))

/** Horizon row used when no horizon is detected: the lower 45% of the frame. */
const HORIZON_FALLBACK_FRAC = 0.45

/** Row share of building+road above which a row counts as below the horizon. */
const HORIZON_MIN_SHARE = 0.60

/** How many consecutive rows must stay above HORIZON_MIN_SHARE before the first of
 * them is accepted. Without this the naive topmost-row rule fires on the first facade
 * below the skyline and the "near field" becomes the whole frame — on charni-road it
 * returns row 5 of 125 instead of row 55, and the ROI stops measuring anything. */
const HORIZON_RUN = 8

/** Local lightness spread, over a 3x3 gridA neighbourhood, above which a cell counts as
 * textured rather than flat. This is what separates "a car is standing on that road" from
 * "that road is a large flat surface". See nearField for why the layer list alone cannot. */
const FLAT_TOLERANCE = 0.03

/** Locate the horizon on gridA: the topmost row whose building+road share clears
 * HORIZON_MIN_SHARE for HORIZON_RUN consecutive rows. Persistence is the whole point —
 * building starts one row under the skyline in every frame.
 * Returns {row, method} so the caller reports which was used.
 * @param {ReturnType<typeof fields>} f @param {number} w @param {number} h gridA size
 */
function findHorizon (f, w, h) {
  const B = LAYERS.indexOf('building'); const R = LAYERS.indexOf('road')
  const share = new Float32Array(h)
  for (let y = 0; y < h; y++) {
    let n = 0
    for (let x = 0; x < w; x++) {
      const layer = f.layer[y * w + x]
      if (layer === B || layer === R) n++
    }
    share[y] = n / w
  }
  for (let y = 0; y + HORIZON_RUN <= h; y++) {
    let ok = true
    for (let k = 0; k < HORIZON_RUN; k++) if (share[y + k] <= HORIZON_MIN_SHARE) { ok = false; break }
    if (ok) return { row: y, method: 'detected' }
  }
  return { row: Math.round(h * HORIZON_FALLBACK_FRAC), method: 'fallback' }
}

/** Max-min of lightness over the 3x3 gridA neighbourhood of a cell.
 * @param {Float32Array} l @param {number} w @param {number} h @param {number} i
 */
function localSpread (l, w, h, i) {
  const x = i % w; const y = (i / w) | 0
  let lo = Infinity; let hi = -Infinity
  for (let dy = -1; dy <= 1; dy++) {
    const yy = y + dy
    if (yy < 0 || yy >= h) continue
    for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx
      if (xx < 0 || xx >= w) continue
      const v = l[yy * w + xx]
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
  }
  return hi - lo
}

/** Every near-field statistic, computed over gridA cells from horizonRow down, with the
 * three-scale edge density measured only on those rows.
 * @param {{A:Grid,B:Grid,fa:ReturnType<typeof fields>,fb:ReturnType<typeof fields>,
 *          img:{width:number,height:number},gray:Float32Array,
 *          dens:(w:number,h:number,frac?:number)=>object, horizonRow:{row:number,method:string}}} o
 */
function nearField (o) {
  const { A, fa, img, horizonRow } = o
  const y0 = horizonRow.row
  const wA = A.width
  const rows = A.height - y0
  const cells = rows * wA

  const coverage = Object.fromEntries(LAYERS.map(k => [k, 0]))
  const Q5 = 31
  const areaHist = new Map()
  const flat = { 5: new Set(), 4: new Set(), 3: new Set() }
  const fam = new Array(12).fill(0)
  let lowC = 0; let chromas = 0

  for (let y = y0; y < A.height; y++) {
    for (let x = 0; x < wA; x++) {
      const i = y * wA + x
      coverage[LAYERS[fa.layer[i]]]++
      for (const bits of [3, 4, 5]) {
        const q = 2 ** bits
        flat[bits].add(
          (Math.round(A.data[i * 3] * (q - 1)) << (2 * bits)) |
          (Math.round(A.data[i * 3 + 1] * (q - 1)) << bits) |
          Math.round(A.data[i * 3 + 2] * (q - 1))
        )
      }
      const key = (Math.round(A.data[i * 3] * Q5) << 10) |
        (Math.round(A.data[i * 3 + 1] * Q5) << 5) |
        Math.round(A.data[i * 3 + 2] * Q5)
      areaHist.set(key, (areaHist.get(key) || 0) + 1)
      if (fa.c[i] < 0.10) lowC++
      else fam[hueFamily(fa.h[i])]++
      chromas++
    }
  }
  for (const k of LAYERS) coverage[k] /= cells

  const ranked = [...areaHist.values()].sort((a, b) => b - a)
  const shareOf = (k) => ranked.slice(0, k).reduce((a, b) => a + b, 0) / cells
  // Object coverage. NOT "share of cells not in the four flat-surface layers": at gridA a
  // parked car is a few cells averaged into the road's colour and comes back 'road', so the
  // layer-only rule scores the reference lane at 1.2% and ours at 1.3% — no signal at all.
  // A flat-surface cell only counts as flat if it is ALSO locally flat; anything with local
  // spread above FLAT_TOLERANCE is an object sitting on that surface. Sky is excluded from
  // the object side entirely: a bright textured cloud is not street furniture.
  let objectCells = 0; let layerObjectCells = 0
  const SKY = LAYERS.indexOf('sky')
  const FLATSET = new Set(FLAT_SURFACE_LAYERS)
  for (let y = y0; y < A.height; y++) {
    for (let x = 0; x < wA; x++) {
      const i = y * wA + x
      if (OBJECT_LAYERS.includes(LAYERS[fa.layer[i]])) { objectCells++; layerObjectCells++; continue }
      if (fa.layer[i] === SKY) continue
      if (localSpread(fa.l, wA, A.height, i) > FLAT_TOLERANCE) objectCells++
    }
  }

  return {
    horizonRow: y0,
    horizonMethod: horizonRow.method,
    horizonFrac: y0 / A.height,
    rows,
    size: `${wA}x${rows}`,
    shareOfFrame: (rows * wA) / (A.width * A.height),
    cells,
    /** Share of near-field cells that are not large flat surfaces. Flat-surface LAYERS
     * still contribute where the cell carries local texture above FLAT_TOLERANCE. */
    objectCoverage: objectCells / cells,
    /** The layer-only reading of the same idea, for callers who want the classification
     * without the texture term. It does not separate the reference lane from ours. */
    objectCoverageLayersOnly: layerObjectCells / cells,
    objectLayers: OBJECT_LAYERS,
    flatSurfaceLayers: FLAT_SURFACE_LAYERS,
    flatTolerance: FLAT_TOLERANCE,
    coverage,
    flatColours: { bits5: flat[5].size, bits4: flat[4].size, bits3: flat[3].size },
    hueFamilies: fam.map((c, i) => ({ name: HUE_FAMILIES[i], share: c / Math.max(1, chromas - lowC) })).filter(f => f.share > 0),
    hueEntropy: entropy(fam),
    lowChromaExcluded: lowC,
    colourArea: {
      distinct: ranked.length,
      largest: ranked[0] / cells,
      top5: shareOf(5),
      top10: shareOf(10),
      top25: shareOf(25),
      forHalf: (() => { let a = 0; for (let i = 0; i < ranked.length; i++) { a += ranked[i]; if (a / cells >= 0.5) return i + 1 } return ranked.length })(),
      effective: (() => { let h = 0; for (const v of ranked) { const p = v / cells; h -= p * Math.log(p) } return Math.exp(h) })()
    },
    edgeDensity: {
      native: { px: `${img.width}x${img.height}`, ...o.dens(img.width, img.height, y0 / A.height) },
      gridB: { px: `${o.B.width}x${o.B.height}`, ...o.dens(o.B.width, o.B.height, y0 / A.height) },
      gridA: { px: `${wA}x${A.height}`, ...o.dens(wA, A.height, y0 / A.height) }
    }
  }
}

/** Full metric run over one image.
 * @param {string} file
 */
export function measure (file) {
  const img = decodePng(readFileSync(file))
  const A = resample(img, 200, 125)
  const B = resample(img, Math.floor(img.width / 3), Math.floor(img.height / 3))
  const fa = fields(A)
  const fb = fields(B)
  const nA = A.width * A.height
  const nB = B.width * B.height

  // 1. coverage
  const coverage = Object.fromEntries(LAYERS.map(k => [k, 0]))
  for (let i = 0; i < nA; i++) coverage[LAYERS[fa.layer[i]]]++
  for (const k of LAYERS) coverage[k] /= nA

  // 2. facade diversity on gridA, over the ARCHITECTURE mask.
  // The architecture mask is building + wash + accent, NOT the 'building' layer alone.
  // The 'building' layer is defined as chroma <= 0.30, so measuring the accent rate inside
  // it is tautologically zero — for the reference too. Architecture surfaces are what the
  // question is actually about.
  const ARCH = new Set(['building', 'wash', 'accent'].map(k => LAYERS.indexOf(k)))
  const bIdx = []
  let buildingLayer = 0
  for (let i = 0; i < nA; i++) {
    if (fa.layer[i] === LAYERS.indexOf('building')) buildingLayer++
    if (ARCH.has(fa.layer[i])) bIdx.push(i)
  }
  const bCount = bIdx.length
  const flat = { 5: new Set(), 4: new Set(), 3: new Set() }
  const fam = new Array(12).fill(0)
  let acc30 = 0; let acc22 = 0; let hslS55 = 0; let lowC = 0
  const chromas = []
  const accentCols = new Map()
  for (const i of bIdx) {
    for (const bits of [3, 4, 5]) {
      const q = 2 ** bits
      const key = (Math.round(A.data[i * 3] * (q - 1)) << (2 * bits)) |
        (Math.round(A.data[i * 3 + 1] * (q - 1)) << bits) |
        Math.round(A.data[i * 3 + 2] * (q - 1))
      if (flat[bits].size < 40000) flat[bits].add(key)
    }
    if (fa.c[i] < 0.10) lowC++
    else fam[hueFamily(fa.h[i])]++
    chromas.push(fa.c[i])
    if (fa.c[i] >= 0.30) {
      acc30++
      const q = 15
      const key = ((Math.round(A.data[i * 3] * q) << 8) | (Math.round(A.data[i * 3 + 1] * q) << 4) | Math.round(A.data[i * 3 + 2] * q))
      accentCols.set(key, (accentCols.get(key) || 0) + 1)
    }
    if (fa.c[i] >= 0.22) acc22++
    if (toHsl(A.data[i * 3], A.data[i * 3 + 1], A.data[i * 3 + 2]).s >= 0.55) hslS55++
  }
  // accent over all non-sky pixels: a stable denominator when the building mask is tiny
  let accAllNonSky = 0; let nonSky = 0
  const frameChroma = []
  for (let i = 0; i < nA; i++) {
    if (fa.isSky[i]) continue
    nonSky++
    if (fa.c[i] >= 0.30) accAllNonSky++
    frameChroma.push(fa.c[i])
  }
  frameChroma.sort((a, b) => a - b)
  const chromaFrameP999 = percentile(frameChroma, 99.9)
  const ent = entropy(fam)
  // With a near-zero accent rate the "top accent colours" are the 4-bit variants of a single
  // stray pixel (in our frames, a HUD element). Listing them would imply a palette that does
  // not exist, so anything under 1% of the architecture mask is reported as absent instead.
  const topAccents = acc30 / Math.max(1, bCount) < 0.01
    ? []
    : [...accentCols.entries()]
        .sort((x, y) => y[1] - x[1]).slice(0, 6)
        .map(([key, c]) => ({
          hex: `#${key.toString(16).padStart(3, '0')}`,
          share: c / Math.max(1, acc30)
        }))

  // 3. window rhythm, gridB
  const bbIdx = []
  for (let i = 0; i < nB; i++) if (ARCH.has(fb.layer[i])) bbIdx.push(i)
  const bL = bbIdx.map(i => fb.l[i])
  const bMedian = median(bL)
  const dark = new Uint8Array(nB)
  for (const i of bbIdx) if (fb.l[i] < bMedian - 0.10 && fb.c[i] < 0.25) dark[i] = 1
  const bands = []
  for (let y0 = 0; y0 < B.height; y0 += 8) {
    const rhythms = []
    let rows = 0; let darkCells = 0; let bCells = 0
    for (let y = y0; y < Math.min(y0 + 8, B.height); y++) {
      let bInRow = 0; let dInRow = 0; let runs = 0; let inRun = false
      for (let x = 0; x < B.width; x++) {
        const i = y * B.width + x
        if (dark[i]) {
          dInRow++
          if (!inRun) runs++
          inRun = true
        } else inRun = false
        if (ARCH.has(fb.layer[i])) bInRow++
      }
      if (bInRow >= 3) { rhythms.push(runs); rows++; darkCells += dInRow; bCells += bInRow }
    }
    if (rows >= 2) bands.push({ row: y0, rhythm: median(rhythms), darkFrac: darkCells / bCells })
  }
  const bandRhythms = bands.map(b => b.rhythm)

  // 4. silhouette diversity, gridB
  const SIL_MIN = 6
  const outline = new Uint8Array(nB)
  for (let y = 0; y < B.height; y++) {
    for (let x = 0; x < B.width; x++) {
      const i = y * B.width + x
      if (fb.isSky[i]) continue
      if (fb.layer[i] === LAYERS.indexOf('shadow') || fb.layer[i] === LAYERS.indexOf('vegetation')) continue
      if (x > 0 && fb.isSky[i - 1]) { outline[i] = 1; continue }
      if (x < B.width - 1 && fb.isSky[i + 1]) { outline[i] = 1; continue }
      if (y > 0 && fb.isSky[i - B.width]) { outline[i] = 1; continue }
      if (y < B.height - 1 && fb.isSky[i + B.width]) outline[i] = 1
    }
  }
  const comps = components(B.width, B.height, i => outline[i] === 1)
  const keep = []
  for (let k = 0; k < comps.areas.length; k++) if (comps.areas[k] >= SIL_MIN) keep.push(k)
  const heights = keep.map(k => comps.maxRow[k] - comps.minRow[k] + 1)
  const ranges = new Map()
  for (const k of keep) {
    const key = `${comps.minRow[k]}-${comps.maxRow[k]}`
    ranges.set(key, (ranges.get(key) || 0) + 1)
  }
  let largestBucket = 0
  for (const c of ranges.values()) largestBucket = Math.max(largestBucket, c)

  // 5. vegetation + lower-third detail, gridB
  let greenCells = 0
  for (let i = 0; i < nB; i++) if (fb.layer[i] === LAYERS.indexOf('vegetation')) greenCells++

  // --- COLOUR-AREA DISTRIBUTION ---------------------------------------------
  //
  // "How many distinct flat tones are there" says nothing about whether they are
  // doing any work. A scene can have 900 tones and still read as three enormous
  // masses if 80% of its area is one of them. This is the number that catches
  // that, and it is the one Palette V2 is actually trying to move.
  //
  // Quantised at 5 bits per channel, over the WHOLE frame (not just architecture,
  // because a contiguous sky or ground mass is exactly the thing that flattens a
  // picture). Each 5-bit value's share of total area, ranked.
  const Q5 = 31
  const areaHist = new Map()
  for (let i = 0; i < nA; i++) {
    const q = (Math.round(A.data[i * 3] * Q5) << 10) |
      (Math.round(A.data[i * 3 + 1] * Q5) << 5) |
      Math.round(A.data[i * 3 + 2] * Q5)
    areaHist.set(q, (areaHist.get(q) || 0) + 1)
  }
  const ranked = [...areaHist.values()].sort((x, y) => y - x)
  const totalArea = nA
  const shareOf = (k) => ranked.slice(0, k).reduce((a, b) => a + b, 0) / totalArea
  const colourArea = {
    distinct: ranked.length,
    largest: ranked[0] / totalArea,
    top5: shareOf(5),
    top10: shareOf(10),
    top25: shareOf(25),
    /** how many tones it takes to cover half the frame */
    forHalf: (() => { let a = 0; for (let i = 0; i < ranked.length; i++) { a += ranked[i]; if (a / totalArea >= 0.5) return i + 1 } return ranked.length })(),
    /** effective number of tones: 1 / Simpson, so a few big masses do not dominate */
    effective: (() => { let h = 0; for (const v of ranked) { const p = v / totalArea; h -= p * Math.log(p) } return Math.exp(h) })(),
  }
  let detail = 0; let detailCells = 0
  const yStart = Math.floor(B.height * 2 / 3)
  for (let y = yStart; y < B.height - 1; y++) {
    for (let x = 0; x < B.width - 1; x++) {
      const i = y * B.width + x
      const ls = [fb.l[i], fb.l[i + 1], fb.l[i + B.width], fb.l[i + B.width + 1]]
      detailCells++
      if (Math.max(...ls) - Math.min(...ls) > 0.08) detail++
    }
  }

  // --- EDGE DENSITY, measured at three scales --------------------------------
  //
  // This is the metric for the facade readability experiment, and the reason it
  // is measured at three scales is the whole point of that experiment.
  //
  // A window 1.4 m wide on a building 60 m away is roughly two pixels in a
  // 320x200 grid and eight in a 1080p one. If a benchmark only resamples to
  // 200x125 it cannot distinguish "this feature does not exist" from "this
  // feature exists and the measurement threw it away" — and those call for
  // completely different fixes: delete the feature, or change the measurement.
  //
  // So: gradient magnitude, computed on the FULL image and on two downsamples.
  // If a scale shows ~no edges where a finer scale shows plenty, the geometry is
  // there and the benchmark is the problem.
  const gray = new Float32Array(img.width * img.height)
  for (let i = 0; i < gray.length; i++) {
    const r = img.rgb[i * 3], g = img.rgb[i * 3 + 1], b = img.rgb[i * 3 + 2];
    gray[i] = (r * 0.299 + g * 0.587 + b * 0.114) / 255
  }
  const edgeAt = (src, w, h, thr, yFrom = 1, yTo = h - 1) => {
    let n = 0, c = 0
    for (let y = yFrom; y < yTo; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x
        const gx = src[i + 1] - src[i - 1]
        const gy = src[i + w] - src[i - w]
        const m = Math.hypot(gx, gy)
        c++
        if (m > thr) n++
      }
    }
    return c ? n / c : 0
  }
  // three thresholds so it is not one arbitrary constant doing all the work
  const dens = (w, h, frac) => {
    // frac === undefined means the whole frame, which is what the top-level edgeDensity uses.
    const band = frac === undefined
      ? [1, h - 1]
      : [Math.max(1, Math.round(h * frac)), Math.max(Math.round(h * frac) + 1, h - 1)]
    return {
      soft: edgeAt(gray, w, h, 0.02, band[0], band[1]),
      mid: edgeAt(gray, w, h, 0.05, band[0], band[1]),
      hard: edgeAt(gray, w, h, 0.10, band[0], band[1])
    }
  }

  // --- NEAR-FIELD ROI --------------------------------------------------------
  //
  // The whole frame is dominated by sky and distant massing, neither of which responds to
  // street density. Everything below is measured a second time over the near field only:
  // the lower part of the frame, from the horizon down, which is where parked cars,
  // pedestrians, benches and awnings actually live.
  const horizonRow = findHorizon(fa, A.width, A.height)
  const roi = nearField({ A, B, fa, fb, img, gray, dens, horizonRow })

  return {
    file,
    size: `${img.width}x${img.height}`,
    gridA: `${A.width}x${A.height}`,
    gridB: `${B.width}x${B.height}`,
    coverage,
    colourArea,
    facade: {
      buildingCells: bCount,
      buildingShare: bCount / nA,
      buildingLayerShare: buildingLayer / nA,
      flatColours: { bits5: flat[5].size, bits4: flat[4].size, bits3: flat[3].size },
      hueFamilies: fam.map((c, i) => ({ name: HUE_FAMILIES[i], share: c / Math.max(1, bCount - lowC) })).filter(f => f.share > 0),
      hueEntropy: ent,
      lowChromaExcluded: lowC,
      chromaP999: percentile([...chromas].sort((a, b) => a - b), 99.9),
      chromaP99: percentile([...chromas].sort((a, b) => a - b), 99),
      chromaMax: chromas.length ? Math.max(...chromas.slice(0, 50000)) : 0,
      bands: bands.slice(0, 14),
      bandRhythm: { median: median(bandRhythms), stdev: stdev(bandRhythms), bands: bandRhythms.length, bMedianL: bMedian }
    },
    accent: {
      rate30: acc30 / Math.max(1, bCount),
      rate22: acc22 / Math.max(1, bCount),
      hslS55: hslS55 / Math.max(1, bCount),
      allNonSky: accAllNonSky / Math.max(1, nonSky),
      nonSkyCells: nonSky,
      chromaFrameP999,
      top: topAccents
    },
    silhouette: {
      components: keep.length,
      minArea: SIL_MIN,
      heightMin: heights.length ? Math.min(...heights) : 0,
      heightMedian: median(heights),
      heightMax: heights.length ? Math.max(...heights) : 0,
      heightStdev: stdev(heights),
      identicalHeightBucket: largestBucket / Math.max(1, keep.length)
    },
    detail: {
      vegetation: greenCells / nB,
      lowerThirdDetail: detail / Math.max(1, detailCells),
      // edges at native resolution and at the two downsamples the rest of this
      // tool works on. The ratio between them is the readability signal.
      edgeDensity: {
        native: { px: `${img.width}x${img.height}`, ...dens(img.width, img.height) },
        gridB: { px: `${B.width}x${B.height}`, ...dens(B.width, B.height) },
        gridA: { px: `${A.width}x${A.height}`, ...dens(A.width, A.height) }
      }
    },
    nearField: roi
  }
}

// ------------------------------------------------------------------- baseline

/** A synthetic flat mid-grey frame, scored through the identical pipeline.
 * It is the null: it wins nothing, and any metric the measured frame shares
 * with it is a metric that cannot separate the two.
 */
function baseline () {
  const w = 200; const h = 125
  const g = { width: w, height: h, data: new Float32Array(w * h * 3).fill(0.5) }
  const f = fields(g)
  let building = 0
  for (let i = 0; i < w * h; i++) if (f.layer[i] === LAYERS.indexOf('building')) building++
  // A featureless image has no skyline, so the positional sky rule calls all of it sky.
  // That is reported rather than hidden: it is why section 6 compares only accent, flat
  // colours, outlines and detail, and never layer coverage.
  return {
    buildingShare: building / (w * h),
    accentRate: 0,
    flatColours: 1,
    hueFamilies: 0,
    components: 0,
    detail: 0,
    skyShare: 1
  }
}

// --------------------------------------------------------------------- report

function report (m) {
  const L = []
  L.push(`\n  ${m.file}  (${m.size}; gridA ${m.gridA}, gridB ${m.gridB})`)
  L.push('')
  L.push('  1. COVERAGE (heuristic — first-matching-rule, see --rules)')
  const order = ['sky', 'building', 'vegetation', 'road', 'ground', 'vehicle', 'accent', 'wash', 'shadow', 'other']
  for (const k of order) {
    if (m.coverage[k] < 0.002 && k !== 'other') continue
    L.push(`       ${k.padEnd(12)} ${pct(m.coverage[k]).padStart(7)}  ${'#'.repeat(Math.round(m.coverage[k] * 60))}`)
  }
  L.push('')
  L.push('  2. FACADE DIVERSITY (architecture mask: building + wash + accent)')
  const fc = m.facade
  L.push(`       architecture pixels   ${pct(fc.buildingShare)} of frame (${fc.buildingCells} cells: building + wash + accent)`)
  L.push(`       of which 'building'   ${pct(fc.buildingLayerShare)}  (the strict low-chroma layer)`)
  L.push(`       flat colour regions   ${String(fc.flatColours.bits5).padStart(5)} @5-bit, ${String(fc.flatColours.bits4).padStart(4)} @4-bit, ${String(fc.flatColours.bits3).padStart(3)} @3-bit`)
  L.push(`       hue families          ${fc.hueEntropy.families}  (${fc.lowChromaExcluded} sub-chroma-0.10 cells excluded)`)
  L.push(`       chroma p99.9         ${f3(fc.chromaP999)} in architecture mask  <- robust palette ceiling`)
  L.push(`       chroma p99           ${f3(fc.chromaP99)}`)
  L.push(`       chroma max           ${f3(fc.chromaMax)}   <- ONE pixel; ours all read 0.388, i.e. a UI accent, not architecture`)
  L.push(`       hue entropy           ${f3(fc.hueEntropy.bits)} bits, ${pct(fc.hueEntropy.normalised)} normalised`)
  for (const f of fc.hueFamilies) L.push(`         ${f.name.padEnd(11)} ${pct(f.share)}  ${'#'.repeat(Math.round(f.share * 40))}`)
  L.push(`       window rhythm         ${fc.bandRhythm.median} dark runs/row (median over ${fc.bandRhythm.bands} bands, stdev ${f3(fc.bandRhythm.stdev)})`)
  L.push(`       per-band rhythm       ${fc.bands.map(b => `${b.row}:${b.rhythm}`).join('  ')}`)
  L.push('')
  L.push('  3. ACCENT RATE (of architecture pixels)')
  const thin = m.facade.buildingCells < 500 ? '  [architecture mask is THIN - treat this rate as unreliable]' : ''
  L.push(`       chroma >= 0.30        ${pct(m.accent.rate30).padStart(7)} of architecture pixels <- headline${thin}`)
  L.push(`       chroma >= 0.22        ${pct(m.accent.rate22)}   <- sensitivity check`)
  L.push(`       chroma >= 0.30        ${pct(m.accent.allNonSky)} of all ${m.accent.nonSkyCells} non-sky cells   <- stable denominator`)
  L.push(`       chroma p99.9, frame  ${f3(m.accent.chromaFrameP999)}   (reference seafront reaches 0.96)`)
  L.push(`       HSL-S >= 0.55         ${pct(m.accent.hslS55)}   <- DO NOT USE: inflated by pale warm tones`)
  if (m.accent.top.length === 0) {
    L.push('         (no accent palette to list: under 1% of the architecture mask. Any stray')
    L.push('          saturated pixels here are UI, not buildings.)')
  }
  for (const a of m.accent.top) L.push(`         ${a.hex} ${pct(a.share)} of accent`)
  L.push('')
  L.push('  4. SILHOUETTE DIVERSITY (building outline against sky)')
  const s = m.silhouette
  L.push(`       distinct outlines     ${s.components}  (components >= ${s.minArea} cells; MERGED where buildings abut, so a lower bound)`)
  L.push(`       outline height px     min ${s.heightMin}  median ${s.heightMedian}  max ${s.heightMax}  stdev ${f3(s.heightStdev)}`)
  L.push(`       identical-height run  ${pct(s.identicalHeightBucket)} of outlines share one row range  <- 1.0 means a row of identical slabs`)
  L.push('')
  L.push('  5. VEGETATION / STREET DETAIL')
  L.push(`       green coverage        ${pct(m.detail.vegetation)} of frame`)
  L.push(`       lower-third detail    ${pct(m.detail.lowerThirdDetail)} of cells with local contrast > 0.08`)
  const n = m.nearField
  L.push('')
  L.push('  5b. NEAR FIELD (street-level ROI — lower frame, below the horizon)')
  L.push(`       horizon row          ${n.horizonRow} of ${String(m.gridA).split('x')[1]} (${pct(n.horizonFrac).padStart(7)} down) — ${n.horizonMethod}`)
  L.push(`       ROI size             ${n.rows} rows, ${n.size}, ${n.cells} gridA cells, ${pct(n.shareOfFrame)} of the frame`)
  L.push(`       object coverage      ${pct(n.objectCoverage).padStart(7)}  <- HEADLINE for the street-objects experiment`)
  L.push(`       object layers        ${n.objectLayers.join(', ')}`)
  L.push(`       flat-surface layers  ${n.flatSurfaceLayers.join(', ')}, counted as flat only when local spread <= ${n.flatTolerance}`)
  L.push(`       (layer-only reading  ${pct(n.objectCoverageLayersOnly)} — does NOT separate the reference lane; see --rules)`)
  L.push('       -- ROI layer coverage --')
  for (const k of order) {
    if (n.coverage[k] < 0.002 && k !== 'other') continue
    L.push(`         ${k.padEnd(12)} ${pct(n.coverage[k]).padStart(7)}  ${'#'.repeat(Math.round(n.coverage[k] * 60))}`)
  }
  L.push(`       flat colour regions  ${String(n.flatColours.bits5).padStart(5)} @5-bit, ${String(n.flatColours.bits4).padStart(4)} @4-bit, ${String(n.flatColours.bits3).padStart(3)} @3-bit`)
  L.push(`       effective tones      ${f3(n.colourArea.effective)}  (1/Simpson over ROI tones; ${n.colourArea.distinct} distinct)`)
  L.push(`       hue families         ${n.hueEntropy.families}  (${n.lowChromaExcluded} sub-chroma-0.10 cells excluded), entropy ${f3(n.hueEntropy.bits)} bits`)
  for (const f of n.hueFamilies) L.push(`         ${f.name.padEnd(11)} ${pct(f.share)}  ${'#'.repeat(Math.round(f.share * 40))}`)
  L.push(`       ROI edge density     native ${f3(n.edgeDensity.native.mid)} mid / ${f3(n.edgeDensity.native.hard)} hard`)
  L.push(`                          gridB  ${f3(n.edgeDensity.gridB.mid)} mid / ${f3(n.edgeDensity.gridB.hard)} hard`)
  L.push(`                          gridA  ${f3(n.edgeDensity.gridA.mid)} mid / ${f3(n.edgeDensity.gridA.hard)} hard`)
  L.push('')
  L.push('  6. RECOGNISABILITY — NOT a score')
  const bl = baseline()
  L.push(`       vs flat mid-grey baseline — accent ${pct(m.accent.allNonSky)}/${pct(bl.accentRate)}, flat colours ${m.facade.flatColours.bits5}/${bl.flatColours}, hue families ${m.facade.hueEntropy.families}/${bl.hueFamilies}, outlines ${m.silhouette.components}/${bl.components}, detail ${pct(m.detail.lowerThirdDetail)}/${pct(bl.detail)}`)
  L.push(`       layer coverage is NOT compared: a flat image has no skyline, so the sky rule`)
  L.push(`       reads ${pct(bl.skyShare)} sky. That failure is the honest weak point of this tool.`)
  L.push('       CAN tell you: whether the frame has separated layers at all, whether facades')
  L.push('         carry more than one material, whether the skyline is varied, and whether')
  L.push('         the ground plane has any small detail at all.')
  L.push('       CANNOT tell you: whether a person could name the location. Nothing here reads')
  L.push('         text, recognises a landmark silhouette, or knows what Mumbai looks like.')
  L.push('         Any frame that merely is not grey will beat this baseline.')
  L.push('')
  return L.join('\n')
}

const RULES = `  RULES
    CHROMA not HSL saturation. HSL S is degenerate at lightness extremes: #f0d0a8 (cream)
      has HSL S = 0.70, so a saturation-based accent rule scores an untextured cream ground
      plane at 41% accent. Chroma = max(r,g,b)-min(r,g,b) does not. Measured here: our palette
      tops out at chroma 0.278 with ZERO pixels above 0.30; the reference reaches 0.89.
    SKY is positional, not colour. Walk down each column to the first sharp step
      (|dL| > 0.06 or chroma > 0.30); that is the skyline, and everything above is sky.
      Sky-by-hue fails on golden hour (warm), at night (dark), and here (the reference sky is
      cream, the same tone as our ground plane).
    LAYERS (gridA 200x125, first match wins)
      shadow      L < 0.20
      vegetation  hue 70..170, chroma >= 0.10, 0.10 <= L <= 0.80
      wash        L >= 0.62 and chroma >= 0.18
      accent      chroma >= 0.30 and L >= 0.22
      vehicle     chroma >= 0.22 and L < 0.22
      road        chroma <= 0.14 and 0.08 <= L <= 0.45 and row >= 0.45*H
      building    chroma <= 0.30 and L >= 0.20
      ground      chroma <= 0.30 and L >= 0.08
      other       remainder
    "wash" is the untextured bright field: sky, haze, or an untextured ground plane. This tool
      cannot tell those three apart and will not pretend to. As measured here: our frames 30-32%
      of the frame, reference 10-18%. That gap is the clearest single signal this tool produces.
    ACCENT       chroma >= 0.30 over the ARCHITECTURE mask (building + wash + accent), also 0.22,
      and over all non-sky cells. It is NOT measured inside the 'building' layer, which is
      defined as chroma <= 0.30 and would therefore score 0% for every image including the
      reference. Flagged THIN below 500 architecture cells because the sample is then fragile.
    HUE          12 families of 30 deg; chroma < 0.10 cells excluded.
    FLAT COLOURS RGB quantised to 3/4/5 bits per channel. Per-pixel counting was the old
                  metric's mistake: anti-aliasing and gradients inflate it with no change in
                  architecture. Quantising counts flat material regions instead. Three bit depths
                  are printed so you can see the curve rather than trust one knife-edge count.
    WINDOW       gridB dark cell = building & L < median(L)-0.10 & chroma < 0.25. Bands of 8 rows;
                  rhythm = median dark runs per qualifying row. UPPER BOUND on window density:
                  dapple, shadow, railings and balcony voids all count as windows.
    SILHOUETTE   gridB non-sky, non-shadow, non-vegetation cell touching sky; components >= 6
                  cells. Count is a LOWER BOUND (abutting buildings merge). Height stdev and
                  identical-height bucket are the robust half.
    DETAIL       gridB lower third; local 2x2 L range > 0.08. Counts ANY high-frequency thing.
    NEAR FIELD   Horizon = topmost gridA row whose building+road share exceeds 0.60 for 8
                  consecutive rows; fallback is row 0.45*H when no such run exists. The run
                  length is load-bearing: without it the first facade under the skyline
                  qualifies and the ROI is the whole frame (charni-road: row 5, not row 55).
                  The ROI is every gridA row from the horizon down, full width.
    OBJECT COVER Share of ROI cells that are NOT large flat surfaces. A cell counts as a
                  flat surface only if its layer is one of sky/road/ground/building AND its
                  local 3x3 gridA lightness spread is <= 0.03. Layers other than those four
                  always count as object. Sky never counts as object. The texture term is not
                  optional: at gridA a parked car averages into the road colour and comes back
                  'road', so the layer-only rule reads 1.2% for the reference lane and 1.3% for
                  ours — no separation at all. With the texture term the same lane reads ~51%
                  against ~13%. That is the number the street-objects experiment should move.
    KNOWN WEAK   vehicle/accent not separable from saturated trim; shadow folds night into one
                  bin; window rhythm is an upper bound; silhouette count is a lower bound;
                  a frame with no detectable skyline (all sky, or a wall filling frame) scores
                  sky incorrectly; NONE of this measures recognisability.`

// Recorded from the retired colour-count metric, 200x125 downsample.
const REFERENCE = {
  '15-marine-drive': { colours: 13121, hueFamilies: 9, note: 'Marine Drive golden hour' },
  '04-khau-galli': { colours: 8005, hueFamilies: 8, note: 'Khau Galli lane, richest street-level frame' },
  'fort (ours)': { colours: '1500-3800', hueFamilies: '3-6', note: 'our Fort frames, pre-enrichment' }
}

function compareBlock (m) {
  const name = Object.keys(REFERENCE).find(k => m.file.includes(k.replace(/ \(ours\)/, ''))) || '15-marine-drive'
  const ref = REFERENCE[name]
  const L = []
  L.push('')
  L.push(`  COMPARE vs recorded reference — "${ref.note}"`)
  L.push('')
  L.push('    metric                          measured        reference        old metric')
  const row = (label, meas, refv, old) => L.push(`    ${label.padEnd(30)} ${String(meas).padStart(10)} ${String(refv).padStart(14)} ${String(old).padStart(14)}`)
  row('architecture coverage', pct(m.facade.buildingShare), 'not recorded', '—')
  row('flat colour regions (5-bit)', m.facade.flatColours.bits5, 'not recorded', '—')
  row('hue families', m.facade.hueEntropy.families, ref.hueFamilies, ref.hueFamilies)
  row('hue entropy (bits)', f3(m.facade.hueEntropy.bits), 'not recorded', '—')
  row('window rhythm (runs/row)', m.facade.bandRhythm.median, 'not recorded', '—')
  row('accent rate, chroma>=0.30', pct(m.accent.allNonSky), '~8-10%', '—')
  row('distinct outlines', m.silhouette.components, 'not recorded', '—')
  row('outline height stdev', f3(m.silhouette.heightStdev), 'not recorded', '—')
  row('chroma p99.9, architecture', f3(m.facade.chromaP999), '0.96 (seafront)', '—')
  row('wash coverage', pct(m.coverage.wash), '5-13%', '—')
  row('green coverage', pct(m.detail.vegetation), 'not recorded', '—')
  row('lower-third detail', pct(m.detail.lowerThirdDetail), 'not recorded', '—')
  L.push('')
  L.push(`    Note on the "~8-10% accent" band: it was calibrated with HSL saturation, which this
    tool deliberately does not use (see --rules). On chroma the reference reads 1.8% (Khau Galli
    lane) to 20.6% (seafront wide). The band and the metric disagree; the metric survives, because
    HSL S scores a pale warm cream at 0.70. Treat 8-10% as a hint, not a threshold.`)
  L.push('    The colour-count column is shown only to be retired. It is absent from every other')
  L.push('    row because it was never a quality signal: it rose when foliage was added with no')
  L.push('    change to the buildings. The new metrics (accent rate, flat colour regions, outline')
  L.push('    count and height spread, window rhythm) are the ones that move when the architecture')
  L.push('    moves. "not recorded" is honest: these baselines do not exist yet — the correct')
  L.push('    comparison is to run this tool on the reference PNGs themselves.')
  L.push('')
  return L.join('\n')
}

// ------------------------------------------------------------------------ cli

/** True when this file is the process entry point, so importing { measure } stays silent.
 * @returns {boolean}
 */
const isMain = () => !!process.argv[1] && basename(process.argv[1]) === 'measure-scene.mjs'

if (isMain()) {
  const args = process.argv.slice(2)
  const json = args.includes('--json')
  const compare = args.includes('--compare')
  const wantRules = args.includes('--rules')
  const files = args.filter(a => !a.startsWith('--'))

  const REFERENCE_FILES = [
    'shots/ref/tour/15-marine-drive.png',
    'shots/ref/tour/04-khau-galli.png',
    'shots/ref/blocks/b13-seafront-wide.png'
  ]

  /** With no arguments: every shots/enrich frame, one before-enrichment frame, and the refs.
   * @returns {string[]}
   */
  function defaultFiles () {
    const ours = existsSync('shots/enrich')
      ? readdirSync('shots/enrich').filter(f => f.endsWith('.png')).sort().map(f => `shots/enrich/${f}`)
      : []
    return [...ours, 'shots/compare/02-walk-fwd.png', ...REFERENCE_FILES]
  }

  if (json) {
    const out = (files.length ? files : defaultFiles()).filter((f, i, a) => a.indexOf(f) === i).flatMap(f => {
      try { return [measure(f)] } catch (e) { return [{ file: f, error: String(e.message || e) }] }
    })
    process.stdout.write(`${JSON.stringify({ baseline: baseline(), frames: out }, null, 2)}\n`)
  } else {
    const list = (files.length ? files : defaultFiles()).filter((f, i, a) => a.indexOf(f) === i)
    process.stdout.write('\n  measure-scene — layer breakdown, replacing the distinct-colour-count metric\n')
    process.stdout.write(`  baseline (flat mid-grey): accent 0%, 1 flat colour, 0 outlines, 0 detail\n`)
    for (const f of list) {
      try {
        const m = measure(f)
        process.stdout.write(report(m))
        if (compare) process.stdout.write(compareBlock(m))
      } catch (e) {
        process.stdout.write(`\n  ${f}\n    SKIPPED: ${e.message || e}\n`)
      }
    }
    if (wantRules) process.stdout.write(`\n${RULES}\n`)
    else process.stdout.write('\n  run with --rules to reprint every threshold, or --compare for the reference table\n')
    process.stdout.write('\n')
  }
}
