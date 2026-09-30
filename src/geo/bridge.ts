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

export const game = {
  /** Input captured and the player is on foot. */
  playing: false,
  /** Called by the HUD to start a session; requests pointer lock. */
  start: null as null | (() => void),
  /** Creative flight, shared with the authored world's `admin power` toggle. */
  fly: false,
  setFly: null as null | ((on: boolean) => void),
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

  /** World view vs planet view (the P key). */
  mode: "world" as WorldMode,
  /** Km² of land in the world, read off the mask for the HUD. */
  landKm2: 0,
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
