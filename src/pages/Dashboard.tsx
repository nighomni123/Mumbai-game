import { Hud } from "@/mumbai/Hud";
import MumbaiWorld from "@/mumbai/MumbaiWorld";
import { useAuth } from "@/hooks/use-auth";
import { useNavigate } from "react-router";

/**
 * The product: a full-screen, walkable cel-shaded 3D model of a Mumbai
 * Western line station district. The route is protected by RequireAuth
 * (see main.tsx).
 */
export default function Dashboard() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <main className="relative h-[100dvh] w-full overflow-hidden bg-background">
      <MumbaiWorld />
      <Hud
        userName={user?.name ?? undefined}
        onHome={() => navigate("/")}
        onSignOut={handleSignOut}
      />
    </main>
  );
}
