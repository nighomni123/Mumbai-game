import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { game, type Toast } from "./bridge";
import { HOME_STATION, WESTERN_LINE } from "./stations";

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="note inline-grid h-6 min-w-6 place-items-center rounded border border-foreground/45 bg-card px-1.5 text-sm leading-none">
      {children}
    </kbd>
  );
}

function Card({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={`sketch-soft pointer-events-auto bg-card/92 backdrop-blur-[2px] ${className}`}>
      {children}
    </div>
  );
}

/**
 * The notebook overlay.
 *
 * Polls the plain `game` bridge on rAF rather than subscribing, so walking
 * never re-renders React. The hand-drawn utility classes all predate this
 * world and are reused unchanged.
 */
export function Hud({
  userName,
  onHome,
  onSignOut,
}: {
  userName?: string;
  onHome: () => void;
  onSignOut: () => void;
}) {
  const [playing, setPlaying] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [fps, setFps] = useState(0);
  const [where, setWhere] = useState("platform");
  const lastToast = useRef(0);
  const lastFps = useRef(0);

  useEffect(() => {
    let raf = 0;
    let wasPlaying = false;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (game.playing !== wasPlaying) {
        wasPlaying = game.playing;
        setPlaying(game.playing);
      }
      if (game.toast && game.toast.id !== lastToast.current) {
        lastToast.current = game.toast.id;
        setToast(game.toast);
      }
      if (game.fps !== lastFps.current) {
        lastFps.current = game.fps;
        setFps(game.fps);
      }
      setWhere(game.onPlatform ? "platform" : "road");
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(t);
  }, [toast]);

  const dim = playing ? "opacity-0 pointer-events-none" : "opacity-100";

  return (
    <div className="pointer-events-none absolute inset-0 z-40 select-none font-[system-ui]">
      {/* ------------------------------------------------ status card */}
      <div className={`absolute left-3 top-3 transition-opacity duration-300 sm:left-5 sm:top-5 ${dim}`}>
        <Card className="w-60 rotate-[-0.6deg] px-4 py-3">
          <p className="hand text-[15px] leading-none text-muted-foreground">
            western railway · field notebook
          </p>
          <h2 className="display mt-1 text-[26px] leading-none text-foreground">
            {HOME_STATION.latin}
          </h2>
          <p className="hand mt-1 text-lg leading-none text-primary">{HOME_STATION.deva}</p>
          <div className="mt-3 flex items-center justify-between border-t border-dashed border-foreground/25 pt-2">
            <span className="note text-sm text-muted-foreground">standing by</span>
            <span className="hand text-lg font-bold leading-none text-primary">{where}</span>
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-dashed border-foreground/25 pt-2">
            <span className="note text-sm text-muted-foreground">render</span>
            <span className="hand text-lg font-bold leading-none text-foreground">
              {fps} fps
            </span>
          </div>
          {userName ? (
            <p className="hand mt-1 text-base leading-none text-muted-foreground">
              walking as {userName}
            </p>
          ) : null}
        </Card>
      </div>

      {/* ------------------------------------------------ controls note */}
      <div className={`absolute right-3 top-3 hidden transition-opacity duration-300 sm:right-5 sm:top-5 sm:block ${dim}`}>
        <div className="sticky-note pointer-events-auto w-44 rotate-[1.4deg] px-4 py-3">
          <p className="hand text-lg leading-none text-foreground/80">controls!</p>
          <ul className="mt-2 space-y-1.5 text-sm text-foreground/85">
            <li className="flex items-center gap-2">
              <span className="flex gap-1">
                <Kbd>W</Kbd>
                <Kbd>A</Kbd>
                <Kbd>S</Kbd>
                <Kbd>D</Kbd>
              </span>
              walk
            </li>
            <li className="flex items-center gap-2">
              <Kbd>shift</Kbd> run
            </li>
            <li className="flex items-center gap-2">
              <Kbd>space</Kbd> jump
            </li>
            <li className="flex items-center gap-2">
              <Kbd>mouse</Kbd> look
            </li>
            <li className="flex items-center gap-2">
              <Kbd>esc</Kbd> pause
            </li>
          </ul>
        </div>
      </div>

      {/* ------------------------------------------------ line card */}
      <div className={`absolute bottom-3 left-3 transition-opacity duration-300 sm:bottom-5 sm:left-5 ${dim}`}>
        <Card className="w-56 rotate-[-0.8deg] px-4 py-3">
          <div className="flex items-baseline justify-between">
            <span className="display text-[15px] text-foreground">the line</span>
            <span className="hand text-base leading-none text-muted-foreground">s → n</span>
          </div>
          <ol className="mt-2 space-y-1">
            {WESTERN_LINE.map((s) => (
              <li key={s.code} className="flex items-baseline gap-2">
                <span
                  className={`note w-9 shrink-0 text-[13px] ${
                    s.code === HOME_STATION.code ? "text-primary" : "text-muted-foreground/70"
                  }`}
                >
                  {s.code}
                </span>
                <span
                  className={`hand truncate text-[17px] leading-tight ${
                    s.code === HOME_STATION.code
                      ? "text-foreground"
                      : "text-muted-foreground/60"
                  }`}
                >
                  {s.latin}
                </span>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      {/* ------------------------------------------------ station toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, x: 40, rotate: 2 }}
            animate={{ opacity: 1, x: 0, rotate: -1 }}
            exit={{ opacity: 0, x: 30 }}
            transition={{ type: "spring", stiffness: 240, damping: 24 }}
            className="absolute bottom-24 left-1/2 w-[19rem] -translate-x-1/2 sm:bottom-8 sm:left-auto sm:right-80 sm:translate-x-0"
          >
            <div className="tape index-card border border-foreground/40 px-4 py-3 pt-4">
              <p className="hand text-lg leading-none text-primary">{toast.title}</p>
              <p className="note mt-1.5 text-[15px] leading-snug text-foreground/90">{toast.text}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ------------------------------------------------ start overlay */}
      <AnimatePresence>
        {!playing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="pointer-events-auto absolute inset-0 grid place-items-center overflow-auto bg-background/85 px-4 py-8 backdrop-blur-[3px]"
          >
            <motion.div
              initial={{ y: 24, rotate: -1 }}
              animate={{ y: 0, rotate: -0.5 }}
              transition={{ type: "spring", stiffness: 200, damping: 22 }}
              className="ruled index-card sketch w-full max-w-xl px-6 py-7 sm:px-10 sm:py-9"
            >
              <p className="hand text-xl leading-none text-primary">
                {userName ? `hey ${userName}, ` : "psst, "}the platform is ready —
              </p>
              <h1 className="display mt-1 text-4xl leading-none text-foreground sm:text-5xl">
                {HOME_STATION.deva}
              </h1>
              <p className="hand mt-2 text-xl text-muted-foreground">
                {HOME_STATION.latin} · western line · mumbai
              </p>

              <div className="mt-5 grid gap-5 sm:grid-cols-2">
                <div>
                  <p className="note text-sm uppercase tracking-wider text-muted-foreground">
                    what you&apos;re looking at
                  </p>
                  <ul className="mt-2 space-y-1.5">
                    <li className="flex items-start gap-2">
                      <span className="check-box">✓</span>
                      <span className="hand text-[19px] leading-tight text-foreground">
                        the real western line, in order, with real station codes
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="check-box">✓</span>
                      <span className="hand text-[19px] leading-tight text-foreground">
                        red-and-cream locals, green ironwork, black-and-yellow taxis
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="check-box">✓</span>
                      <span className="hand text-[19px] leading-tight text-foreground">
                        every board derives its text from the station next door
                      </span>
                    </li>
                  </ul>
                </div>
                <div>
                  <p className="note text-sm uppercase tracking-wider text-muted-foreground">
                    controls
                  </p>
                  <ul className="mt-2 space-y-1.5 text-sm text-foreground/85">
                    <li className="flex items-center gap-2">
                      <span className="flex gap-1">
                        <Kbd>W</Kbd>
                        <Kbd>A</Kbd>
                        <Kbd>S</Kbd>
                        <Kbd>D</Kbd>
                      </span>
                      walk the platform
                    </li>
                    <li className="flex items-center gap-2">
                      <Kbd>shift</Kbd> run for the local
                    </li>
                    <li className="flex items-center gap-2">
                      <Kbd>space</Kbd> jump
                    </li>
                    <li className="flex items-center gap-2">
                      <Kbd>mouse</Kbd> look around
                    </li>
                  </ul>
                </div>
              </div>

              <div className="mt-7 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => game.start?.()}
                  className="note cursor-pointer inline-flex items-center gap-2 rounded-md bg-primary px-7 py-3 text-lg text-primary-foreground transition-transform hover:-translate-y-0.5 active:translate-y-0"
                >
                  ✏️ click to walk
                </button>
                <button
                  type="button"
                  onClick={onHome}
                  className="note cursor-pointer rounded-md border border-foreground/40 bg-card px-4 py-2.5 text-base text-foreground transition-transform hover:-translate-y-0.5"
                >
                  ← back to the cover
                </button>
                <button
                  type="button"
                  onClick={onSignOut}
                  className="note cursor-pointer rounded-md px-3 py-2.5 text-base text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-foreground"
                >
                  sign out
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
