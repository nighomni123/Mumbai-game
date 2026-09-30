import { useEffect, useRef } from "react";
import { mount } from "./index";
import { game } from "./bridge";

/**
 * Mounts the vanilla three.js district into a plain <div>.
 *
 * The world is imperative and owns its own render loop, so this component
 * never re-renders while walking — it mounts once, tears down on unmount,
 * and otherwise does nothing. That is deliberate: it is the same reason the
 * HUD polls the bridge on requestAnimationFrame rather than subscribing.
 */
export default function MumbaiWorld() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Dev-only: the live harness (scripts/live.mjs) reads this same bridge the
    // HUD polls, so its telemetry is the numbers on screen, not a guess.
    // Same hook world.html already exposes as `__game`; stripped from the build.
    if (import.meta.env.DEV) {
      (window as unknown as { __game: typeof game }).__game = game;
    }
    const teardown = mount(el);
    return teardown;
  }, []);

  return <div ref={ref} className="h-full w-full" />;
}
