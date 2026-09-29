/**
 * The seam between the vanilla three.js world and React.
 *
 * This is deliberately a plain mutable object, not a store. The HUD polls it
 * on requestAnimationFrame precisely so that walking never re-renders the
 * React overlay — the same pattern the previous engine used, kept because it
 * is the right one, not because it is what was there before.
 */

export interface Toast {
  id: number;
  title: string;
  text: string;
}

export const game = {
  /** Is the player actually walking (input captured, HUD dimmed)? */
  playing: false,
  /** Called by the HUD to start a session; requests pointer lock. */
  start: null as null | (() => void),
  /** Live player transform, written every frame by the engine. */
  x: 0,
  y: 0,
  z: 0,
  heading: 0,
  speed: 0,
  /** True when the player is standing on the platform rather than the road. */
  onPlatform: true,
  /** Which station the player is nearest, and how far. */
  nearest: '',
  /** Engine readiness — the world builds progressively, so the HUD waits. */
  ready: false,
  /** Rendered frames per second, for the HUD readout. */
  fps: 0,
  /** Latest station announcement. */
  toast: null as Toast | null,
  seq: 0,
};

export function resetGame() {
  game.playing = false;
  game.speed = 0;
  game.toast = null;
}
