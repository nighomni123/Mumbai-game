import { BeachSketch } from "@/components/BeachSketch";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { ArrowRight, Compass, PenLine, Sparkles } from "lucide-react";
import { Link } from "react-router";

const fadeUp = {
  initial: { opacity: 0, y: 26 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, amount: 0.25 },
  transition: { duration: 0.55, ease: "easeOut" as const },
};

const MAPPED = [
  {
    n: "01",
    title: "The shoreline",
    text: "Wade into the surf, feel the seabed drop, watch the sky do its evening routine.",
    note: "shoes off!",
  },
  {
    n: "02",
    title: "Chaat row",
    text: "Six stalls firing on all cylinders — pav bhaji, bhel puri, sugarcane, chai.",
    note: "extra butter",
  },
  {
    n: "03",
    title: "The promenade",
    text: "Lamps, benches, families on the wall, the welcome sign everyone photographs.",
    note: "evening crowd",
  },
  {
    n: "04",
    title: "Gully cricket",
    text: "Two sets of stumps, one red ball, and kids who never stop running.",
    note: "no LBW",
  },
  {
    n: "05",
    title: "The cattle",
    text: "Mumbai's most unbothered residents grazing straight through chaat row.",
    note: "they own it",
  },
  {
    n: "06",
    title: "The skyline",
    text: "Towers, water tanks and hoardings stacked behind the beach road.",
    note: "concrete jungle",
  },
];

const ENTRIES = [
  {
    text: "stood waist-deep for twenty minutes and the sky just kept changing. nobody spoke.",
    by: "entry 04 · low tide",
    rot: "-1.6deg",
  },
  {
    text: "found all six field notes before the sun went down. the pav bhaji one was accurate.",
    by: "entry 09 · completed",
    rot: "1.2deg",
  },
  {
    text: "tip from a local: chaat row is west, run before the melt. also — look up, the kites.",
    by: "entry 07 · margin note",
    rot: "-0.8deg",
  },
];

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="note inline-grid h-7 min-w-7 place-items-center rounded border border-foreground/45 bg-card px-1.5 text-base leading-none ink-shadow-sm">
      {children}
    </kbd>
  );
}

export default function Landing() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.45 }}
      className="page-margin ruled min-h-screen overflow-x-hidden"
    >
      {/* ------------------------------------------------------------ nav */}
      <header className="sticky top-0 z-30 border-b border-dashed border-foreground/25 bg-background/85 backdrop-blur-sm">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-8">
          <Link to="/" className="group flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-md border-2 border-foreground/80 bg-card ink-shadow-sm transition-transform group-hover:-rotate-6">
              <PenLine className="size-4.5 text-primary" />
            </span>
            <span className="leading-tight">
              <span className="display block text-base text-foreground">
                Charni Road
              </span>
              <span className="hand block text-base text-muted-foreground">
                field notebook
              </span>
            </span>
          </Link>

          <nav className="flex items-center gap-2 sm:gap-4">
            <a
              href="#mapped"
              className="note hidden text-base text-muted-foreground transition-colors hover:text-foreground sm:block"
            >
              what&apos;s mapped
            </a>
            <a
              href="#how"
              className="note hidden text-base text-muted-foreground transition-colors hover:text-foreground sm:block"
            >
              how to play
            </a>
            <Button asChild variant="ghost" className="note text-base">
              <Link to="/dashboard">walk in</Link>
            </Button>
            <Button asChild className="note gap-1.5 text-base ink-shadow">
              <Link to="/dashboard">
                open the map <ArrowRight className="size-4" />
              </Link>
            </Button>
          </nav>
        </div>
      </header>

      {/* ----------------------------------------------------------- hero */}
      <section className="mx-auto w-full max-w-6xl px-4 pb-16 pt-12 sm:px-8 sm:pt-20">
        <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_1fr]">
          <div>
            <div className="flex items-center gap-3">
              <span className="hand text-xl text-primary">notebook no. 01</span>
              <span className="h-px flex-1 border-t border-dashed border-foreground/35" />
              <span className="note text-sm uppercase tracking-[0.2em] text-muted-foreground">
                mumbai · 19.107°N
              </span>
            </div>

            <h1 className="mt-5">
              <span className="display block text-[clamp(2.6rem,9vw,5.4rem)] leading-[0.86] text-foreground">
                चर्नी रोड
              </span>
              <span className="display block text-[clamp(2.6rem,9vw,5.4rem)] leading-[0.86] text-foreground">
                <span className="marker-swipe text-primary">Western Line</span>
              </span>
              <span className="scribble-underline mt-2 block w-fit" />
            </h1>

            <p className="hand mt-4 text-[clamp(1.5rem,3vw,2.1rem)] leading-tight text-foreground/85">
              a walkable 3D map of mumbai&apos;s favourite shore —
              <span className="text-primary"> sketched like a field notebook.</span>
            </p>

            <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg">
              Drop in third-person, the way you&apos;d roam a city in your
              favourite open-world game. Walk the surf, sprint the promenade,
              out-run the sun, and collect six field notes before it goes down.
              Everything — the waves, the chaat, the cricket, the cows — is
              drawn live in your browser.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Button
                asChild
                size="lg"
                className="note gap-2 text-lg ink-shadow"
              >
                <Link to="/dashboard">
                  <Compass className="size-5" />
                  start walking
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="note gap-2 text-lg"
              >
                <Link to="/dashboard">
                  <PenLine className="size-4" />
                  I have an account
                </Link>
              </Button>
            </div>

            <ul className="mt-8 flex flex-wrap gap-x-7 gap-y-2">
              {["5 zones", "6 field notes", "1 sunset", "0 downloads"].map((s) => (
                <li key={s} className="flex items-center gap-2">
                  <span className="check-box">✓</span>
                  <span className="note text-base text-muted-foreground">{s}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* taped sketch */}
          <motion.div
            initial={{ opacity: 0, rotate: -3, y: 24 }}
            animate={{ opacity: 1, rotate: -1.4, y: 0 }}
            transition={{ duration: 0.7, delay: 0.15, ease: "easeOut" }}
            className="tape relative mx-auto w-full max-w-lg"
          >
            <div className="index-card sketch overflow-hidden p-3">
              <BeachSketch className="w-full" />
              <div className="mt-2 flex items-baseline justify-between px-1">
                <span className="hand text-xl text-foreground">
                  evening at the shore
                </span>
                <span className="note text-sm text-muted-foreground">
                  fig. 1
                </span>
              </div>
            </div>
            <span className="hand absolute -right-3 -bottom-6 hidden rotate-3 text-2xl text-primary sm:block">
              ← it actually looks like this
            </span>
          </motion.div>
        </div>
      </section>

      {/* --------------------------------------------------------- mapped */}
      <section id="mapped" className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-8">
        <motion.div {...fadeUp}>
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="hand text-xl text-primary">chapter one</p>
              <h2 className="display text-4xl leading-none text-foreground sm:text-5xl">
                What&apos;s on the map
              </h2>
            </div>
            <p className="hand hidden max-w-52 text-right text-xl leading-tight text-muted-foreground sm:block">
              everything you can walk up to ↓
            </p>
          </div>

          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {MAPPED.map((item, i) => (
              <motion.div
                key={item.n}
                {...fadeUp}
                transition={{ ...fadeUp.transition, delay: i * 0.06 }}
                className="index-card sketch-soft group relative px-5 py-4 transition-transform hover:-translate-y-1"
              >
                <div className="flex items-center gap-3">
                  <span className="check-box">✓</span>
                  <span className="display text-lg text-foreground">
                    {item.title}
                  </span>
                  <span className="hand ml-auto text-lg text-primary opacity-0 transition-opacity group-hover:opacity-100">
                    {item.note}
                  </span>
                </div>
                <p className="mt-2 pl-[1.7rem] text-sm leading-6 text-muted-foreground">
                  {item.text}
                </p>
                <span className="hand absolute right-4 bottom-3 text-base text-muted-foreground/60">
                  {item.n}
                </span>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </section>

      {/* ----------------------------------------------------------- how */}
      <section id="how" className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-8">
        <motion.div
          {...fadeUp}
          className="sketch-soft relative grid gap-8 bg-card/80 px-6 py-8 sm:px-10 lg:grid-cols-[1.2fr_1fr]"
        >
          <div>
            <p className="hand text-xl text-primary">instructions, page 2</p>
            <h2 className="display text-4xl leading-none text-foreground sm:text-5xl">
              How to play
            </h2>
            <ol className="mt-6 space-y-5">
              {[
                {
                  t: "Sign in (or continue as guest)",
                  d: "The map lives behind a quick sign-in so your field notes stay put.",
                },
                {
                  t: "Click to walk",
                  d: "Your pointer locks to the camera — mouse to look, exactly like a console free-roam.",
                },
                {
                  t: "Wander, sprint, jump, collect",
                  d: "Five zones announce themselves as you enter. Six loose pages wait to be found.",
                },
              ].map((s, i) => (
                <li key={s.t} className="flex gap-4">
                  <span className="display mt-0.5 w-9 shrink-0 text-3xl leading-none text-primary/80">
                    0{i + 1}
                  </span>
                  <span>
                    <span className="note block text-xl leading-tight text-foreground">
                      {s.t}
                    </span>
                    <span className="mt-1 block text-sm leading-6 text-muted-foreground">
                      {s.d}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </div>

          <div className="flex flex-col justify-center gap-5">
            <div className="sticky-note rotate-[1.5deg] px-5 py-4">
              <p className="hand text-2xl leading-none text-foreground/85">
                the keys
              </p>
              <ul className="mt-3 space-y-2.5 text-base text-foreground/90">
                <li className="flex items-center gap-3">
                  <span className="flex gap-1">
                    <Kbd>W</Kbd>
                    <Kbd>A</Kbd>
                    <Kbd>S</Kbd>
                    <Kbd>D</Kbd>
                  </span>
                  walk
                </li>
                <li className="flex items-center gap-3">
                  <Kbd>shift</Kbd> sprint
                </li>
                <li className="flex items-center gap-3">
                  <Kbd>space</Kbd> jump
                </li>
                <li className="flex items-center gap-3">
                  <Kbd>mouse</Kbd> look around
                </li>
                <li className="flex items-center gap-3">
                  <Kbd>esc</Kbd> pause the walk
                </li>
              </ul>
            </div>
            <p className="hand text-xl leading-tight text-muted-foreground">
              psst — head west first. the sun won&apos;t wait.
            </p>
          </div>
        </motion.div>
      </section>

      {/* ------------------------------------------------------ entries */}
      <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-8">
        <motion.div {...fadeUp}>
          <div className="flex items-center gap-3">
            <Sparkles className="size-5 text-primary" />
            <h2 className="display text-3xl leading-none text-foreground sm:text-4xl">
              From the notebook
            </h2>
            <span className="h-px flex-1 border-t border-dashed border-foreground/30" />
          </div>

          <div className="mt-8 grid gap-7 md:grid-cols-3">
            {ENTRIES.map((e) => (
              <motion.blockquote
                key={e.by}
                {...fadeUp}
                style={{ rotate: e.rot }}
                className="index-card px-5 py-5"
              >
                <p className="hand text-[1.55rem] leading-snug text-foreground">
                  “{e.text}”
                </p>
                <footer className="note mt-3 text-base text-muted-foreground">
                  — {e.by}
                </footer>
              </motion.blockquote>
            ))}
          </div>
        </motion.div>
      </section>

      {/* ----------------------------------------------------------- cta */}
      <section className="mx-auto w-full max-w-6xl px-4 pb-20 pt-4 sm:px-8">
        <motion.div
          {...fadeUp}
          className="sketch relative overflow-hidden bg-card px-6 py-10 text-center ink-shadow sm:px-12 sm:py-14"
        >
          <div className="hatch pointer-events-none absolute inset-0 opacity-40" />
          <div className="relative">
            <p className="hand text-2xl text-primary">so —</p>
            <h2 className="display text-[clamp(2.6rem,7vw,4.5rem)] leading-[0.9] text-foreground">
              Pack a pencil.
              <br />
              The shore is waiting.
            </h2>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
              <Button asChild size="lg" className="note gap-2 text-lg ink-shadow">
                <Link to="/dashboard">
                  walk the platform <ArrowRight className="size-5" />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="note text-lg"
              >
                <Link to="/dashboard">walk the platform</Link>
              </Button>
            </div>
          </div>
        </motion.div>
      </section>

      {/* -------------------------------------------------------- footer */}
      <footer className="border-t border-dashed border-foreground/30">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-3 px-4 py-6 text-center sm:flex-row sm:px-8 sm:text-left">
          <p className="hand text-lg text-muted-foreground">
            drawn live in your browser · no assets harmed
          </p>
          <p className="note text-sm text-muted-foreground/80">
            — western line · charni road ·{" "}
            <Link to="/dashboard" className="underline decoration-dotted underline-offset-4 hover:text-foreground">
              sign in
            </Link>
          </p>
        </div>
      </footer>
    </motion.div>
  );
}
