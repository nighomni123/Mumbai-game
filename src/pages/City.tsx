import CityWorld from "@/geo/CityWorld";
import { CityHud } from "@/geo/hud";

/**
 * The product: a walkable, streamed model of real Greater Mumbai, with a
 * planet you can pull out of and click to travel. Public — no sign-in, no
 * backend, no network beyond the chunk files it already streams.
 */
export default function City() {
  return (
    <main className="relative h-[100dvh] w-full overflow-hidden bg-background">
      <CityWorld />
      <CityHud />
    </main>
  );
}
