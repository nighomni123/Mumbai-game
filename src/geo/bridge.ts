/**
 * The seam between the geographic world and React.
 *
 * Same rule as src/mumbai/bridge.ts, and for the same reason: the world is
 * imperative and owns its render loop, so movement must never re-render the
 * React overlay. This is a plain mutable object that the HUD polls on
 * requestAnimationFrame. Lifting any of it into useState, context or a store
 * library is a performance regression, not a cleanup.
 */

import type { CityMap } from "./citymap.js";

export interface Toast {
  id: number;
  title: string;
  text: string;
}

export type WorldMode = "world" | "planet";

/**
 * The speed option's range, in multiples of the walker's own WALK/RUN/FLY.
 *
 * Shared rather than repeated so the slider the HUD draws and the clamp the
 * walker applies cannot drift apart. 1x is the real-world pace; 10x is a fast
 * scooter across a 67 x 81 km city. The default is 3x because walking 2.2 m/s
 * to Kala Ghoda from Fort is four minutes of nothing happening.
 */
export const SPEED_MIN = 1;
export const SPEED_MAX = 10;
export const SPEED_DEFAULT = 3;

/**
 * The render-distance slider, as a multiplier on the altitude-driven budget.
 *
 * A scale rather than an absolute metre figure, because the distance is
 * computed from altitude every frame: an absolute slider would be a dead
 * control at ground level (the automatic value is already 2.6 km, so dragging
 * past it does nothing) and a lie while flying (2.6 km means nothing at 2 km
 * up). Scaling keeps the shape of the world intact and only spends fewer or
 * more pixels on it.
 *
 * 1 is exactly the automatic behaviour, so the default is a no-op rather than
 * a new thing to tune. Below 1 the win is steep because resident chunks scale
 * with area, not radius: at 0.3x the ring drops from 49 candidate tiles to 25
 * and the distance cull trims those to the handful actually on screen.
 */
export const RENDER_MIN = 0.2;
export const RENDER_MAX = 2;
export const RENDER_DEFAULT = 1;

export const game = {
  /** Input captured and the player is on foot. */
  playing: false,
  /** Called by the HUD to start a session; requests pointer lock. */
  start: null as null | (() => void),
  /** Creative flight, shared with the authored world's `admin power` toggle. */
  fly: false,
  setFly: null as null | ((on: boolean) => void),
  /**
   * Movement speed multiplier, written by the HUD slider and read by the
   * walker every frame. On the bridge rather than in React state because the
   * render loop must never wait on a render. Clamped to [SPEED_MIN, SPEED_MAX]
   * at the read, so a stale or hand-set value cannot make the city unplayable.
   */
  speedMul: SPEED_DEFAULT,
  /**
   * Render-distance multiplier, written by the HUD slider and read by the render
   * loop every frame. Clamped to [RENDER_MIN, RENDER_MAX] at the read so a
   * stale or hand-set value cannot strand the player in fog.
   */
  renderScale: RENDER_DEFAULT,
  /** Live player transform in local metres, written every frame. */
  x: 0,
  y: 0,
  z: 0,
  heading: 0,
  speed: 0,

  /** Standing on the sea rather than on land. Obvious feedback at the edge. */
  atSea: false,
  /** Nearest named real place and how far, in metres. */
  nearest: "",
  nearestM: 0,

  /** Rendered frames per second, for the HUD readout. */
  fps: 0,
  /** Resident chunks, chunks still building, and what the GPU is actually doing. */
  chunks: 0,
  pending: 0,
  calls: 0,
  triangles: 0,
  /** Buildings tested against the walker this frame — the collision cost. */
  near: 0,

  /**
   * What the enrichment pipeline is actually doing in view, for the QA
   * overlay. A pipeline whose failure mode is "buildings quietly fall back to
   * the default family" needs a panel that says so out loud.
   */
  enrich: {
    buildings: 0,
    enriched: 0,
    fronted: 0,
    families: [] as string[],
    palettes: [] as string[],
    landmarks: [] as string[],
  } as {
    buildings: number;
    enriched: number;
    fronted: number;
    families: string[];
    palettes: string[];
    landmarks: string[];
  },

  /** World view vs planet view (the P key). */
  mode: "world" as WorldMode,
  /** Km² of land in the world, read off the mask for the HUD. */
  landKm2: 0,
  /**
   * Did the ground/sea actually get built and added to the scene?
   *
   * QA invariant. A builder that throws leaves the world rendering happily over
   * bare background, which reads as a finished frame and silently corrupts every
   * visual measurement. `null` = still loading.
   */
  waterAttached: null as boolean | null,
  /** Metres of geometry the renderer is currently willing to draw. */
  renderDistance: 0,

  /**
   * The whole city, drawn once, for the HUD minimap and the /map page. Set by
   * world.ts once water.json and citymap.json have both landed. Until then the
   * minimap waits rather than showing a grid that lies about the harbour.
   */
  map: null as null | CityMap,

  /**
   * Travel to a named place, by the same path the planet's pins use: place the
   * walker at the real coordinates and stream the chunks in. Set by world.ts.
   * Deliberately not a teleport the walker can trigger — the world is
   * geographically 1:1 and the journey is the point, so the map is a way to
   * choose a destination, not a way to skip one.
   */
  goTo: null as null | ((name: string) => void),

  /** Engine readiness — chunks stream in progressively. */
  ready: false,
  toast: null as Toast | null,
  seq: 0,
};

export function toast(title: string, text: string): void {
  game.toast = { id: ++game.seq, title, text };
}
