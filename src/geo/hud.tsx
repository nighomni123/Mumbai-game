import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { game, SPEED_MIN, SPEED_MAX, type Toast } from "./bridge";
import { toWgs84 } from "./geo-constants.js";
import {
  renderPlayableMap,
  drawMinimapPlayable,
  playableScreenToWorld,
  type CityMap,
} from "./citymap.js";
import { toLocal } from "./geo-constants.js";
import { PLACES } from "./places.js";
import {
  searchDestinations,
  inDevArea,
  KIND_LABEL,
  type Destination,
} from "./destinations.js";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { Slider } from "@/components/ui/slider";

function Card({
  className = "",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`sketch-soft pointer-events-auto bg-card/92 backdrop-blur-[2px] ${className}`}
    >
      {children}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="opacity-60">{k}</span>
      <span className="note">{v}</span>
    </div>
  );
}


/**
 * Where do you want to go?
 *
 * A command palette rather than a bare input, because `cmdk` gives arrow-key
 * navigation and fuzzy ranking for free and this is a keyboard-first world —
 * the player is usually walking with WASD held. Opened with `/` or clicking the
 * field; Escape closes it and the key is not swallowed by the world.
 *
 * Destinations outside the development explore area are still listed and still
 * travel there — the data and the map are whole — but they are marked and sorted
 * below what you can actually walk to, so the box never looks broken while the
 * cut-off is in place.
 */
function SearchBar() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const results = useMemo(
    () => (q.trim() ? searchDestinations(q, 24) : []),
    [q],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing =
        e.target instanceof HTMLElement &&
        (e.target.tagName === "INPUT" || e.target.isContentEditable);
      if (e.code === "Slash" && !typing) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const go = (d: Destination) => {
    game.goTo?.(d.name);
    setOpen(false);
    setQ("");
  };

  // Clear on close, not only on select. Otherwise dismissing with Escape leaves
  // the last query in the box, the next "/" reopens with stale text, and the
  // player has to backspace before they can type a new one.
  const close = (next: boolean) => {
    setOpen(next);
    if (!next) setQ("");
  };

  return (
    <div className="pointer-events-auto absolute left-1/2 top-3 -translate-x-1/2">
      <button
        type="button"
        onClick={() => close(!open)}
        className="sketch-soft note flex items-center gap-2 bg-card/92 px-3 py-2 text-sm opacity-90 backdrop-blur-[2px] hover:opacity-100"
        aria-label="Search for a place to travel to"
      >
        <span className="opacity-60">Go to</span>
        <span className="opacity-40">press /</span>
      </button>

      {open && (
      <Command
        className="absolute left-1/2 top-full z-20 mt-1 w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2"
        shouldFilter={false}
        onKeyDown={(e) => {
          // cmdk's input swallows Escape for itself and only clears the query,
          // so without this the panel cannot be dismissed with Escape at all —
          // it just silently stays open, and the next click on the button closes
          // it instead of opening it.
          if (e.key === "Escape") {
            e.stopPropagation();
            close(false);
          }
        }}
      >
        <CommandInput
          autoFocus
          value={q}
          onValueChange={setQ}
          placeholder="a landmark, a station, a place…"
        />
        <CommandList className="max-h-72">
          <CommandEmpty>
            {q.trim() ? "no match" : "type a name"}
          </CommandEmpty>
          {!q.trim() && (
            <div className="note px-3 py-2 text-xs opacity-60">
              Try CSMT, Gateway, Charni Road, Juhu.
            </div>
          )}
          <CommandGroup>
            {results.map((d) => {
              const reachable = inDevArea(d);
              return (
                <CommandItem
                  key={d.name + d.kind}
                  value={d.name}
                  onSelect={() => go(d)}
                  className="gap-2"
                >
                  <span className="note">{d.name}</span>
                  <span className="text-xs opacity-60">{KIND_LABEL[d.kind]}</span>
                  {d.note && (
                    <span className="ml-auto max-w-[12rem] truncate text-xs opacity-50">
                      {d.note}
                    </span>
                  )}
                  {!reachable && (
                    <span className="text-xs opacity-70">outside</span>
                  )}
                </CommandItem>
              );
            })}
          </CommandGroup>
        </CommandList>
      </Command>
      )}
    </div>
  );
}

/**
 * The minimap is portrait because the playable area is: DEV_BOUNDS is
 * 17.9 km wide by 26.1 km tall, which is what the whole walkable box is fitted
 * to. Bigger than before, because it is now the readable resolution rather than
 * a few magnified pixels of a metro-wide bitmap.
 */
const MM_W = 224;
const MM_H = 326;
/** Base is drawn at 4x and downsampled, so nothing on screen is ever upscaled. */
const MM_BASE_SCALE = 4;

/**
 * The whole metro, live.
 *
 * A 260k-building city that streams 13k around the camera is mostly invisible by
 * construction, so this is the other half of the answer: everything, at once,
 * with you on it. The base is drawn once into an offscreen canvas from the same
 * land mask the 3D world uses, and each frame is a blit plus the player dot and
 * its view cone.
 *
 * Clicking a place does not teleport. It calls the same path the planet's pins
 * use — place the walker on the real coordinates and stream the chunks in —
 * because the world is 1:1 and the journey is the point.
 */
function Minimap({ map }: { map: CityMap }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const base = useMemo(
    () =>
      renderPlayableMap(
        `hud-playable-${MM_W}x${MM_H}`,
        MM_W,
        MM_H,
        MM_BASE_SCALE,
        map.data,
        map.water,
      ),
    [map],
  );
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv || !base) return;
    const g = cv.getContext("2d");
    if (!g) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      drawMinimapPlayable(g, base, game.x, game.z, game.heading, MM_W, MM_H);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [base]);

  if (!base) return null;

  // Nearest place under the cursor, within a tolerance. A click that hits
  // nothing does nothing rather than guessing a destination.
  //
  // Inverted through the SAME DEV_BOUNDS projection the draw used, so the two
  // can never disagree about where a pixel is.
  const at = (e: React.MouseEvent<HTMLCanvasElement>): string | null => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * MM_W;
    const py = ((e.clientY - rect.top) / rect.height) * MM_H;
    if (!base) return null;
    const world = playableScreenToWorld(px, py, MM_W, MM_H);
    let best: string | null = null;
    let bestD = 220; // metres — a click snaps to a place within ~one block
    for (const pl of PLACES) {
      const l = toLocal(pl.lon, pl.lat);
      const d = Math.hypot(l.x - world.x, l.y - world.z);
      if (d < bestD) {
        bestD = d;
        best = pl.name;
      }
    }
    return best;
  };

  const pick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const name = at(e);
    setHover(name);
    if (name) game.goTo?.(name);
  };

  return (
    <div
      className="pointer-events-auto absolute bottom-3 right-3"
      style={{ width: MM_W }}
    >
      <canvas
        ref={ref}
        width={MM_W}
        height={MM_H}
        onMouseMove={pick}
        onClick={pick}
        className="sketch-soft block w-full cursor-pointer"
        title="Click a place to travel there"
      />
      <div className="mt-1 flex items-center justify-between text-[10px] opacity-70">
        <span>{hover ?? "Greater Mumbai"}</span>
        <a
          href="/map"
          className="underline decoration-dotted underline-offset-2"
        >
          open map
        </a>
      </div>
    </div>
  );
}

/**
 * The speed option.
 *
 * One slider, one multiplier, applied to walk, run and fly alike so the two
 * halves of the world stay related — nothing here has a separate "fly speed".
 * The value lives on the bridge because the walker reads it every frame and
 * must never wait on a React render; the local copy exists only so the thumb
 * tracks the pointer instead of the HUD's 5 Hz readout.
 */
function SpeedControl() {
  const [mul, setMul] = useState(game.speedMul);
  return (
    <div className="mt-2 border-t border-foreground/30 pt-2">
      <div className="flex justify-between text-xs">
        <span className="opacity-60">speed</span>
        <span className="note">×{mul.toFixed(1)}</span>
      </div>
      <Slider
        value={[mul]}
        min={SPEED_MIN}
        max={SPEED_MAX}
        step={0.5}
        aria-label="movement speed multiplier"
        onValueChange={([v]) => {
          setMul(v);
          game.speedMul = v;
        }}
        className="mt-1.5"
      />
      <div className="mt-1 text-[10px] opacity-60">
        hold Z for a burst — up to 3×
      </div>
    </div>
  );
}

/**
 * The overlay for the real city.
 *
 * Polls the plain `game` bridge on requestAnimationFrame rather than
 * subscribing to it, so walking and flying never re-render React. Same rule,
 * same reason as src/mumbai/Hud.tsx — the world owns the render loop; this
 * component only ever looks at it.
 *
 * It deliberately shows the numbers the harness would otherwise have to reach
 * for: chunks resident, chunks still building, draw calls, triangles, and how
 * many footprints the collision test actually touched. Those are how you tell
 * a black frame ("1k tris") from a working one, and they are what the live
 * harness reads.
 */
export function CityHud() {
  const [playing, setPlaying] = useState(false);
  const [fly, setFly] = useState(false);
  const [mode, setMode] = useState(game.mode);
  const [map, setMap] = useState<CityMap | null>(null);
  const mapRef = useRef<CityMap | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [showEnrich, setShowEnrich] = useState(false);
  const [, redraw] = useState(0);

  // G: the enrichment QA panel. Off by default — it is an inspection tool, not
  // something a visitor should trip over while trying to walk to Kala Ghoda.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.code === "KeyG") setShowEnrich((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const lastToast = useRef(0);
  const lastPaint = useRef(0);

  useEffect(() => {
    let raf = 0;
    let wasPlaying = game.playing;
    let wasFly = game.fly;
    let wasMode = game.mode;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (game.playing !== wasPlaying) {
        wasPlaying = game.playing;
        setPlaying(game.playing);
      }
      if (game.fly !== wasFly) {
        wasFly = game.fly;
        setFly(game.fly);
      }
      // The map arrives once. A ref, not `map` in the dep list: this effect
      // must run once for the lifetime of the HUD, and reading a changing
      // `map` from inside the rAF loop would need it as a dependency and would
      // then re-subscribe on every load.
      if (game.map && !mapRef.current) {
        mapRef.current = game.map;
        setMap(game.map);
      }
      if (game.mode !== wasMode) {
        wasMode = game.mode;
        setMode(game.mode);
      }
      if (game.toast && game.toast.id !== lastToast.current) {
        lastToast.current = game.toast.id;
        setToast(game.toast);
      }
      // Coalesce the readout to 5 Hz. Re-rendering React at frame rate for a
      // coordinate readout is the exact thing the bridge exists to avoid; five
      // times a second is fast enough that a number never looks stuck.
      const now = performance.now();
      if (now - lastPaint.current > 200) {
        lastPaint.current = now;
        redraw((n) => (n + 1) & 0xffff);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const w = toWgs84(game.x, game.z);
  const planet = mode === "planet";
  const e = game.enrich;
  const enriched = e.buildings ? Math.round((e.enriched / e.buildings) * 100) : 0;
  const fronted = e.buildings ? Math.round((e.fronted / e.buildings) * 100) : 0;

  return (
    <div className="pointer-events-none absolute inset-0 z-10 font-note text-foreground">
      <Card className="absolute left-3 top-3 w-56 p-3 text-xs">
        <div className="display mb-2 text-sm">Greater Mumbai</div>
        {planet ? (
          <>
            <Row k="view" v="the whole city" />
            <Row k="land" v={`${game.landKm2} km²`} />
            <Row k="fps" v={String(game.fps)} />
            <div className="mt-2 opacity-60">
              Drag to pan, wheel to zoom, click a place to travel there.
            </div>
          </>
        ) : (
          <>
            <Row k="where" v={`${w.lat.toFixed(4)}°N ${w.lon.toFixed(4)}°E`} />
            <Row
              k="nearest"
              v={`${game.nearest} · ${Math.round(game.nearestM)} m`}
            />
            <Row
              k="surface"
              v={game.atSea ? "the water" : fly ? "flying" : "ground"}
            />
            <Row k="fps" v={String(game.fps)} />
            <Row
              k="chunks"
              v={`${game.chunks}${game.pending ? ` (+${game.pending})` : ""}`}
            />
            <Row k="draws" v={String(game.calls)} />
            <Row k="tris" v={`${(game.triangles / 1000) | 0}k`} />
            {game.near > 0 && <Row k="nearby" v={`${game.near} buildings`} />}
          </>
        )}
        {!planet && showEnrich && <EnrichPanel />}
        {!planet && (
          <button
            type="button"
            aria-pressed={fly}
            onClick={() => game.setFly?.(!fly)}
            className="mt-2 w-full cursor-pointer border border-foreground/40 px-2 py-1 text-center"
          >
            admin power: {fly ? "on" : "off"}
          </button>
        )}
        {!planet && <SpeedControl />}
      </Card>

      {!planet && !playing && game.ready && (
        <div className="absolute inset-0 grid place-items-center">
          <motion.button
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            onClick={() => game.start?.()}
            className="sticky-note pointer-events-auto cursor-pointer px-7 py-5 text-center text-lg"
          >
            <div className="display text-2xl">Greater Mumbai</div>
            <div className="mt-1 text-sm opacity-70">
              click to walk · WASD move · Shift run · Space jump · hold Z to
              burst · double-tap Space for admin power
            </div>
            <div className="mt-1 text-sm opacity-70">
              press P for the whole city
            </div>
          </motion.button>
        </div>
      )}

      {!planet && <SearchBar />}
      {!planet && map && <Minimap map={map} />}

      <div className="absolute bottom-3 left-3 text-[11px] opacity-55">
        3D data © OpenStreetMap contributors (ODbL 1.0)
      </div>

      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="absolute bottom-6 left-1/2 -translate-x-1/2"
          >
            <div className="sticky-note px-5 py-3 text-center text-sm">
              <div className="display text-base">{toast.title}</div>
              <div className="opacity-75">{toast.text}</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * The enrichment QA panel.
 *
 * A classification system's worst failure is silent: every family, palette and
 * roof id is a plain string, so a typo does not fail a build, it fails by
 * quietly rendering the default family for every building — and the frame still
 * looks like a city. This panel says what actually landed, next to the counts
 * the renderer already had.
 */
function EnrichPanel() {
  const e = game.enrich;
  const pct = (n: number) =>
    e.buildings ? `${Math.round((n / e.buildings) * 100)}%` : "0%";
  return (
    <div className="mt-2 border-t border-foreground/30 pt-2 text-[11px] leading-tight">
      <div className="display mb-1 text-xs">enrichment</div>
      <Row k="profiles" v={`${e.enriched}/${e.buildings} (${pct(e.enriched)})`} />
      <Row k="frontages" v={`${pct(e.fronted)}`} />
      <Row k="families" v={String(e.families.length)} />
      <Row k="palettes" v={String(e.palettes.length)} />
      <Row k="landmarks" v={String(e.landmarks.length)} />
      {e.families.length > 0 && (
        <div className="mt-1 opacity-70">{e.families.join(" · ")}</div>
      )}
      {e.landmarks.length > 0 && (
        <div className="mt-1 opacity-70">◆ {e.landmarks.slice(0, 6).join(", ")}</div>
      )}
      {e.buildings > 0 && e.enriched === 0 && (
        <div className="mt-1 text-foreground">
          no profiles here — this chunk is not enriched
        </div>
      )}
    </div>
  );
}
