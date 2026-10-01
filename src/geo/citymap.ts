/**
 * The whole city, on a piece of paper you can see all of.
 *
 * The 3D world streams ~13k buildings around the camera out of 260k, and the
 * planet is a 3D globe you have to orbit. Neither is a good way to answer "what
 * is over there?" — which is the question that matters when you are looking for
 * a gap, a bug, or a place worth going. This renders the entire metro in a few
 * milliseconds, once, into an offscreen canvas: land from the same mask the
 * world uses, the arterial road skeleton from `citymap.json`, and the named
 * places. Everything after that is a `drawImage` plus a player dot.
 *
 * Two consumers, one render:
 *   - the HUD minimap, bottom right, ~190 px wide, live player + heading
 *   - the `/map` route, full page, with labels and the 36 ground-truth sites,
 *     for pointing at what is wrong
 *
 * The base is drawn at whatever size it is asked for and cached by size, so
 * resizing the window redraws at most once.
 */

import { PAL } from "../engine/palette.js";
import { METRO_BOUNDS, ACTIVE_BOUNDS, toLocal } from "./geo-constants.js";
import { PLACES, MAJOR_PLACES } from "./places.js";
import { projectorFor } from "./citymap-math.js";
import { landRuns } from "./citymap-math.js";
import type { WaterData } from "./water.js";
import { fetchData } from "./data-path.js";

export interface CityMapData {
  v: number;
  bounds: { x0: number; x1: number; y0: number; y1: number };
  q: number;
  of: number;
  kept: number;
  /** Flat [x0, y0, x1, y1, ...] in units of `q` metres, world y up. */
  roads: number[][];
  named: { i: string; n: string; len: number; p: number[] }[];
}

/** `path` is relative to the data root — see src/geo/data-path.ts. */
export async function loadCityMap(path: string): Promise<CityMapData | null> {
  return fetchData<CityMapData>(path);
}

export interface Project {
  /** world x -> px */
  x(x: number): number;
  /** world z (northing) -> px, flipped so north is up */
  y(z: number): number;
  /** px -> world x */
  invX(px: number): number;
  /** px -> world z */
  invY(py: number): number;
  scale: number;
}

const B = METRO_BOUNDS;

/** Fit the whole metro into a w x h box, centred, preserving aspect. */
export const projector = (w: number, h: number): Project =>
  projectorFor(B, w, h);

export interface CityMap {
  data: CityMapData | null;
  water: WaterData | null;
}

const cache = new Map<string, HTMLCanvasElement>();

/**
 * Draw the base map once at this size and cache it. Caller owns subsequent
 * frames: `drawMinimap` blits this and adds only the live layer on top.
 */
export function renderCityMap(
  key: string,
  w: number,
  h: number,
  data: CityMapData | null,
  water: WaterData | null,
  opts: { labels?: boolean } = {},
): HTMLCanvasElement | null {
  const hit = cache.get(key);
  if (hit) return hit;
  if (!water) return null; // without the land mask this is just a grid, which is worse than nothing

  const cv = document.createElement("canvas");
  cv.width = Math.max(2, Math.round(w));
  cv.height = Math.max(2, Math.round(h));
  const g = cv.getContext("2d");
  if (!g) return null;
  const p = projector(cv.width, cv.height);

  // Sea, then land. The land comes from the same mask the 3D world draws, so
  // the map cannot show a harbour the world does not have.
  g.fillStyle = hex(PAL.sea);
  g.fillRect(0, 0, cv.width, cv.height);
  g.fillStyle = hex(PAL.groundLand);
  // The same landRuns the 3D world extrudes its ground from, so the map cannot
  // show a harbour the world does not have.
  for (const r of landRuns(water)) {
    const left = p.x(r.x0);
    const right = p.x(r.x1);
    const top = p.y(r.y1);
    const bottom = p.y(r.y0);
    g.fillRect(left, top, Math.max(1, right - left), Math.max(1, bottom - top));
  }

  if (data) {
    const q = data.q;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.strokeStyle = "rgba(90,86,78,0.55)";
    g.lineWidth = 1;
    g.beginPath();
    for (const flat of data.roads) {
      for (let i = 0; i < flat.length; i += 2) {
        const px = p.x(flat[i] * q);
        const py = p.y(flat[i + 1] * q);
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
    }
    g.stroke();

    g.strokeStyle = "rgba(58,54,48,0.85)";
    g.lineWidth = 1.6;
    g.beginPath();
    for (const r of data.named) {
      const flat = r.p;
      for (let i = 0; i < flat.length; i += 2) {
        const px = p.x(flat[i] * q);
        const py = p.y(flat[i + 1] * q);
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
    }
    g.stroke();

    if (opts.labels) labelRoads(g, data, p);
  }

  // The metro is fully mapped; only ACTIVE_BOUNDS is built. Wash out what is
  // deferred so it reads as "later" rather than "missing", and draw the edge.
  // Placed before the pins, so place markers in the deferred area stay visible
  // and still clickable.
  greyDeferred(g, p, cv.width, cv.height);

  placeDots(g, p, cv.width, cv.height, false);
  cache.set(key, cv);
  return cv;
}

const A = ACTIVE_BOUNDS;

/** Wash everything outside the build scope, and outline the scope's edge. */
function greyDeferred(
  g: CanvasRenderingContext2D,
  p: Project,
  w: number,
  h: number,
): void {
  const left = Math.max(0, p.x(A.x0));
  const right = Math.min(w, p.x(A.x1));
  const top = Math.max(0, p.y(A.y1));
  const bottom = Math.min(h, p.y(A.y0));
  if (right <= left || bottom <= top) return;

  g.fillStyle = "rgba(236,232,222,0.66)";
  g.fillRect(0, 0, w, top);
  g.fillRect(0, bottom, w, h - bottom);
  g.fillRect(0, top, left, bottom - top);
  g.fillRect(right, top, w - right, bottom - top);

  g.save();
  g.setLineDash([6, 4]);
  g.lineWidth = 1.5;
  g.strokeStyle = "rgba(120,96,72,0.85)";
  g.strokeRect(left + 0.5, top + 0.5, right - left - 1, bottom - top - 1);
  g.restore();
}

function labelRoads(
  g: CanvasRenderingContext2D,
  data: CityMapData,
  p: Project,
): void {
  g.font = "10px ui-sans-serif, system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  // One label per road name, at the midpoint of its longest surviving piece, so
  // the Sea Link is labelled once rather than eight times.
  const best = new Map<string, { x: number; z: number; len: number }>();
  const q = data.q;
  for (const r of data.named) {
    const mid = r.p.length >> 2;
    const x = r.p[mid * 2] * q;
    const z = r.p[mid * 2 + 1] * q;
    const prev = best.get(r.n);
    if (!prev || prev.len < r.len) best.set(r.n, { x, z, len: r.len });
  }
  const seen = new Set<string>();
  for (const [name, at] of best) {
    const px = p.x(at.x);
    const py = p.y(at.z);
    if (px < 30 || py < 12 || px > p.x(B.x1) + 30 || py > p.y(B.y0) + 12)
      continue;
    if (seen.has(name.slice(0, 8))) continue;
    seen.add(name.slice(0, 8));
    g.lineWidth = 3;
    g.strokeStyle = "rgba(255,255,255,0.75)";
    g.strokeText(name, px, py);
    g.fillStyle = "#2b2733";
    g.fillText(name, px, py);
  }
}

/** Place markers, biggest for the major ones. `labels` also writes the names. */
export function placeDots(
  g: CanvasRenderingContext2D,
  p: Project,
  w: number,
  h: number,
  labels: boolean,
): void {
  g.textAlign = "center";
  g.textBaseline = "top";
  for (const pl of PLACES) {
    const l = toLocal(pl.lon, pl.lat);
    const px = p.x(l.x);
    const py = p.y(l.y);
    if (px < -20 || py < -20 || px > w + 20 || py > h + 20) continue;
    const major = MAJOR_PLACES.has(pl.name);
    g.beginPath();
    g.arc(px, py, major ? 3.2 : 2, 0, Math.PI * 2);
    g.fillStyle = major ? "#c23a2c" : "rgba(43,39,51,0.55)";
    g.fill();
    if (labels) {
      g.font = major
        ? "600 11px ui-sans-serif, system-ui, sans-serif"
        : "10px ui-sans-serif, system-ui, sans-serif";
      g.lineWidth = 3;
      g.strokeStyle = "rgba(255,255,255,0.8)";
      g.strokeText(pl.name, px, py + 6);
      g.fillStyle = "#2b2733";
      g.fillText(pl.name, px, py + 6);
    } else if (major) {
      g.beginPath();
      g.arc(px, py, 7, 0, Math.PI * 2);
      g.strokeStyle = "rgba(194,58,44,0.4)";
      g.lineWidth = 1;
      g.stroke();
    }
  }
}

/**
 * Blit the base and draw the live layer: the player, heading, and a viewport
 * ring. This is the only per-frame work the minimap does.
 */
export function drawMinimap(
  g: CanvasRenderingContext2D,
  base: HTMLCanvasElement,
  x: number,
  z: number,
  heading: number,
  w: number,
  h: number,
): void {
  g.clearRect(0, 0, w, h);
  g.drawImage(base, 0, 0, w, h);
  const p = projector(w, h);
  const px = p.x(x);
  const py = p.y(z);
  if (px < -20 || py < -20 || px > w + 20 || py > h + 20) return;

  // A view cone, so "which way am I looking" is readable at a glance.
  g.save();
  g.translate(px, py);
  g.rotate(heading);
  g.beginPath();
  g.moveTo(0, 0);
  g.arc(0, 0, 22, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5);
  g.closePath();
  g.fillStyle = "rgba(255,214,92,0.28)";
  g.fill();
  g.restore();

  g.beginPath();
  g.arc(px, py, 4, 0, Math.PI * 2);
  g.fillStyle = "#c23a2c";
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = "#fff";
  g.stroke();
}

function hex(n: number): string {
  return `#${n.toString(16).padStart(6, "0")}`;
}
