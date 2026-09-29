import { Hud } from "@/mumbai/Hud";
import MumbaiWorld from "@/mumbai/MumbaiWorld";

/**
 * The product: a full-screen, walkable cel-shaded 3D model of a Mumbai
 * Western line station district. Public — no sign-in.
 */
export default function Dashboard() {
  return (
    <main className="relative h-[100dvh] w-full overflow-hidden bg-background">
      <MumbaiWorld />
      <Hud />
    </main>
  );
}
