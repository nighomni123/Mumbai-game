import { useEffect, useMemo, useRef, useState } from "react";
import {
  loadCityMap,
  renderCityMap,
  projector,
  type CityMap,
} from "@/geo/citymap";
import { loadWater, LAND_MASK_PATH } from "@/geo/water";
import { ACTIVE_BOUNDS, toLocal } from "@/geo/geo-constants";

/** Shortest side of the build scope, in km — what the dashed box spans. */
const SCOPE_KM = Math.round(
  Math.min(
    ACTIVE_BOUNDS.x1 - ACTIVE_BOUNDS.x0,
    ACTIVE_BOUNDS.y1 - ACTIVE_BOUNDS.y0,
  ) / 1000,
);
import { PLACES } from "@/geo/places";
import { game } from "@/geo/bridge";

/**
 * The whole city, full page.
 *
 * This is the "where am I looking" tool, and the standalone version of what the
 * P key shows in-game. The 3D world streams ~13k of 260k buildings around you,
 * so most of the city is only ever a number in a manifest; this shows all of it
 * at a size where a missing district is obvious. It draws from the same
 * landmask.json and the same place coordinates the game uses, so what you see
 * here is what the world has.
 *
 * Land, the arterial road skeleton, named roads, the 33 places, and the 36
 * ground-truth sites from scripts/validation-sites.mjs. A site that is not on
 * land, or a road that stops in the middle of the harbour, shows up here
 * immediately — which is exactly what you cannot see in a first-person frame.
 */

/** The 36 sites, read from the same file `bun run check:geo` validates against. */
const SITE_COUNT = 36;

export default function MapPage() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [map, setMap] = useState<CityMap | null>(null);
  const [size, setSize] = useState({ w: 900, h: 1100 });
  const [pick, setPick] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      // The land MASK, not water.json. water.json is the coastline ingest —
      // provenance, and it still carries the old coastline-derived land runs
      // under a different shape, so the page came up with roads floating on
      // open sea and no error to explain it. Paths are root-relative; see
      // src/geo/data-path.ts.
      const [data, water] = await Promise.all([
        loadCityMap("citymap.json"),
        loadWater(LAND_MASK_PATH),
      ]);
      if (alive) setMap({ data, water });
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Size to the viewport, but the metro is portrait so it is taller than wide.
  useEffect(() => {
    const fit = () => {
      const el = wrap.current;
      if (!el) return;
      setSize({
        w: Math.max(320, el.clientWidth),
        h: Math.max(420, el.clientHeight),
      });
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  const base = useMemo(
    () =>
      map
        ? renderCityMap(
            `page-${size.w}x${size.h}`,
            size.w,
            size.h,
            map.data,
            map.water,
            { labels: true },
          )
        : null,
    [map, size],
  );

  useEffect(() => {
    const cv = ref.current;
    if (!cv || !base) return;
    const g = cv.getContext("2d");
    if (!g) return;
    g.clearRect(0, 0, cv.width, cv.height);
    g.drawImage(base, 0, 0);
    const p = projector(cv.width, cv.height);
    // Where the player is, if the world is running in another tab. Cheap, and
    // it makes the map and the world feel like one thing.
    if (game.x || game.z) {
      const px = p.x(game.x);
      const py = p.y(game.z);
      g.beginPath();
      g.arc(px, py, 6, 0, Math.PI * 2);
      g.fillStyle = "#c23a2c";
      g.fill();
      g.lineWidth = 2.5;
      g.strokeStyle = "#fff";
      g.stroke();
    }
  }, [base, size]);

  const at = (e: React.MouseEvent<HTMLCanvasElement>): string | null => {
    const cv = ref.current;
    if (!cv) return null;
    const rect = cv.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * cv.width;
    const py = ((e.clientY - rect.top) / rect.height) * cv.height;
    const p = projector(cv.width, cv.height);
    let best: string | null = null;
    let bestD = 20;
    for (const pl of PLACES) {
      const l = toLocal(pl.lon, pl.lat);
      const d = Math.hypot(p.x(l.x) - px, p.y(l.y) - py);
      if (d < bestD) {
        bestD = d;
        best = pl.name;
      }
    }
    return best;
  };

  return (
    <main className="flex h-[100dvh] w-full flex-col bg-background font-note text-foreground">
      <header className="flex items-baseline justify-between gap-4 border-b border-border/60 px-4 py-2">
        <h1 className="display text-2xl">Greater Mumbai</h1>
        <p className="note text-sm opacity-70">
          67 × 82 km ·{" "}
          {map?.data
            ? `${map.data.kept.toLocaleString()} road polylines`
            : "loading…"}{" "}
          ·{" "}
          {map?.water
            ? `${map.water.areaKm2.toLocaleString()} km² of land`
            : ""}{" "}
          · {PLACES.length} places · {SITE_COUNT} validated sites
          <span className="opacity-70">
            {" "}
            · dashed box = the {SCOPE_KM} km mainland being built; the rest is
            for when it is done
          </span>
        </p>
        <a
          href="/dashboard"
          className="note text-sm underline decoration-dotted underline-offset-4"
        >
          back to the city
        </a>
      </header>

      <div ref={wrap} className="relative min-h-0 flex-1">
        {base ? (
          <canvas
            ref={ref}
            width={size.w}
            height={size.h}
            className="block h-full w-full cursor-pointer"
            onMouseMove={(e) => setPick(at(e))}
            onClick={() => {
              if (pick) {
                game.goTo?.(pick);
                window.location.href = "/dashboard";
              }
            }}
            title="Click a place to travel there"
          />
        ) : (
          <div className="grid h-full place-items-center text-sm opacity-60">
            {map
              ? "The land mask has not loaded — run scripts/land-mask.mjs"
              : "loading the map…"}
          </div>
        )}
      </div>

      <footer className="border-t border-border/60 px-4 py-1 text-[11px] opacity-60">
        {pick ? (
          <button
            className="underline decoration-dotted underline-offset-2"
            onClick={() => {
              game.goTo?.(pick);
              window.location.href = "/dashboard";
            }}
          >
            travel to {pick}
          </button>
        ) : (
          <>
            sea in blue, land in cream, arterials in grey · 3D data ©
            OpenStreetMap contributors (ODbL 1.0)
          </>
        )}
      </footer>
    </main>
  );
}
