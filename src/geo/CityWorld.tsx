import { useEffect, useRef } from "react";
import { mountCity } from "./world";
import { game } from "./bridge";

/**
 * Mounts the real Greater Mumbai into a plain <div>.
 *
 * The world is imperative and owns its own render loop, so this component never
 * re-renders while walking — it mounts once, tears down on unmount, and does
 * nothing else. Deliberately the same shape as src/mumbai/MumbaiWorld.tsx, for
 * the same reason: the HUD polls the bridge, not React.
 */
export default function CityWorld() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Dev-only, so the live harness and a console can read the same numbers the
    // HUD shows. Stripped from the production build.
    if (import.meta.env.DEV) {
      (window as unknown as { __city: typeof game }).__city = game;
    }
    const handle = mountCity(el);
    return handle.teardown;
  }, []);

  return <div ref={ref} className="h-full w-full" />;
}
