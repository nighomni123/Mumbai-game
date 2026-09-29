/**
 * Dev-only preview harness.
 *
 * Mounts the world straight into the page with no React and no router, so the
 * 3D can be inspected and screenshotted in isolation. Served by Vite in dev
 * at /world.html; it is not part of the product build.
 */
import { mount } from "./index";
import { game } from "./bridge";

const el = document.getElementById("world");
if (el) {
  const teardown = mount(el);
  // The product gates movement on pointer lock behind a "click to walk"
  // overlay. The harness has no overlay, so force input on — otherwise
  // nothing can be walked and the scene cannot be inspected.
  game.playing = true;
  // expose for quick poking from the console
  (window as unknown as { __world: () => void; __game: typeof game }).__world = teardown;
  (window as unknown as { __game: typeof game }).__game = game;
  console.log("[world] mounted (input forced on)");
}
