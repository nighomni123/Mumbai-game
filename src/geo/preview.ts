/**
 * Dev-only harness for the geographic Greater Mumbai world.
 *
 * This used to own the scene, the camera and the render loop. It no longer
 * does: src/geo/world.ts owns them and this mounts the same thing, so what the
 * harness inspects and what ships cannot drift. Everything here is inspection
 * surface — the counters, the teleport hook, the mode switch.
 *
 * QA: __geo.teleport('andheri') for any of the real named places,
 *     __geo.planet() to open the P view, __geo.game for the live bridge.
 *
 * No React, no HUD, not part of the product build.
 */
import { mountCity } from "./world";
import { game } from "./bridge";
import { PLACE_BY_NAME } from "./places";
import { toLocal, toWgs84 } from "./geo-constants.js";

const el = document.getElementById("geo");
const info = document.getElementById("info");
const modeEl = document.getElementById("mode");

if (el) {
  const handle = mountCity(el);

  // Input works without pointer lock here, which a harness driving the page
  // programmatically can never get.
  game.start = () => {
    game.playing = true;
  };
  window.addEventListener("mousedown", () => (game.playing = true));
  window.addEventListener("keyup", (e) => {
    if (["KeyW", "KeyA", "KeyS", "KeyD", "ShiftLeft", "Space"].includes(e.code))
      game.playing = true;
  });

  let flight = false;
  el.addEventListener("dblclick", () => {
    flight = !flight;
    game.setFly?.(flight);
    if (modeEl) modeEl.textContent = flight ? "CREATIVE FLIGHT" : "ON FOOT";
  });
  if (modeEl)
    modeEl.textContent = "ON FOOT · dbl-click toggles creative flight";

  function teleport(name: string): boolean {
    const p = PLACE_BY_NAME.get(name.toLowerCase());
    if (!p) return false;
    const l = toLocal(p.lon, p.lat);
    handle.teleport(l.x, l.y, Math.PI);
    return true;
  }

  // The counters. A "1k tris" frame means nothing is being drawn; a 1.2M frame
  // means it is. Read these before trusting any visual impression.
  (function readout() {
    requestAnimationFrame(readout);
    const w = toWgs84(game.x, game.z);
    if (info) {
      info.textContent =
        `chunks ${game.chunks}${game.pending ? ` (+${game.pending})` : ""} · calls ${game.calls} · tris ${(game.triangles / 1000) | 0}k · ` +
        `fps ${game.fps} · ${game.mode} · ${w.lat.toFixed(4)}N ${w.lon.toFixed(4)}E · alt ${game.y.toFixed(0)}m` +
        (game.near ? ` · near ${game.near}` : "") +
        (game.atSea ? " · AT SEA" : "");
    }
  })();

  (window as unknown as { __geo: unknown }).__geo = {
    teleport,
    place: teleport,
    map: () => handle.openMap(),
    game,
  };
  console.log(
    "[geo] mounted — real Greater Mumbai. QA: __geo.teleport('andheri'), __geo.planet()",
  );
}
