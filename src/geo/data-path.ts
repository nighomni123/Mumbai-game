/**
 * Where the world's runtime data lives, and how to get it.
 *
 * `data/build/` is git-ignored and ~155 MB, so a fresh clone has none of it. The
 * committed `data/starter/` slice (see scripts/make-starter.mjs) covers Fort, so
 * the world is real on first run and `bun run setup` rebuilds the full metro.
 *
 * This is the ONLY place that knows about the two roots. Callers pass a path
 * relative to the root ("landmask.json", "chunks/chunk_-3_-8.json") rather than
 * spelling out `data/build/...`, because a hardcoded root is exactly the bug
 * that made landmask.json work in dev and vanish from the production bundle.
 */

/** Full built world first, committed starter slice as the fallback. */
const ROOTS = ["data/build/", "data/starter/"];

/**
 * Whether `data/build/` has answered. `null` = not yet known.
 *
 * Latched because a fresh clone would otherwise pay a failed request per chunk
 * for the whole session — and at the metro edge, where tiles are legitimately
 * missing from the full world, that is the common case.
 */
let fullWorldAvailable: boolean | null = null;

/** True once something under `data/build/` has been answered (or definitively missed). */
export function isFullWorld(): boolean {
  return fullWorldAvailable === true;
}

/**
 * Fetch and parse a data file from the first root that has it.
 *
 * Returns null when no root has it, which every caller already treats as "this
 * layer is absent" — the world still runs, it is just missing that piece.
 */
export async function fetchData<T>(path: string): Promise<T | null> {
  const roots =
    fullWorldAvailable === false
      ? ROOTS.slice(1)
      : fullWorldAvailable === true
        ? ROOTS.slice(0, 1)
        : ROOTS;

  for (const root of roots) {
    try {
      const res = await fetch(`${root}${path}`);
      // Vite's dev SPA fallback answers a missing file with 200 text/html
      // (index.html), not a 404 — so `res.ok` is NOT enough. Check the type.
      const type = res.headers.get("content-type") || "";
      if (!res.ok || !type.includes("json")) continue;
      if (root === ROOTS[0]) fullWorldAvailable = true;
      return (await res.json()) as T;
    } catch {
      // network error — try the next root
    }
  }
  if (fullWorldAvailable === null) fullWorldAvailable = false;
  return null;
}