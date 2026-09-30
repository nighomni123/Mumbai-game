import { Hud } from "@/mumbai/Hud";
import MumbaiWorld from "@/mumbai/MumbaiWorld";

/**
 * The authored Western line station district. It moved here from /dashboard
 * when the real city took that route; the world itself is unchanged.
 */
export default function Station() {
  return (
    <main className="relative h-[100dvh] w-full overflow-hidden bg-background">
      <MumbaiWorld />
      <Hud />
    </main>
  );
}
