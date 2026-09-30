import { vlyPlugin } from "@vly-ai/integrations";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { cpSync, existsSync } from "node:fs";
import path from "path";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    vlyPlugin(),
    tailwindcss(),
    // The world streams its geometry at runtime from data/build/, which lives
    // outside public/ and so never reached the build output. In dev Vite serves
    // the project root, so this only ever bit a production bundle: /dashboard
    // 404'd on the first chunk, and the sea with it.
    //
    // A copy rather than a symlink, because the Hono static server at main.ts
    // serves ./dist from disk. Only the files the runtime actually fetches are
    // copied: the raw `tile_*.json` ingest scratch is ~224 MB that
    // enrich-chunks consumes once and never reads again, and the `wtile_*.json`
    // boxes are the water ingest's resume cache. Shipping either would triple
    // the bundle to make a directory bigger.
    {
      name: "copy-world-data",
      apply: "build",
      closeBundle() {
        const from = path.resolve(__dirname, "data/build");
        const to = path.resolve(__dirname, "dist/data/build");
        // The committed Fort slice travels with the bundle even when there is no
        // data/build/ at all, so a build from a fresh clone still has a city.
        const starter = path.resolve(__dirname, "data/starter");
        if (existsSync(starter)) {
          cpSync(starter, path.resolve(__dirname, "dist/data/starter"), {
            recursive: true,
          });
        }
        if (!existsSync(from)) {
          this.warn(
            "data/build is missing — shipping only the committed starter slice around Fort. Run `bun run setup` for the full metro.",
          );
          return;
        }
        // Every layer `fetch()` reaches at runtime, and nothing else. Keep this
        // list in step with the `data/build/...` URLs in src/ — a layer that is
        // built but not listed here works in dev and is silently absent from
        // the build, because every loader in src/ fails soft rather than error.
        const WANTED = [
          "chunks",
          "manifest.json",
          "water.json",
          "landmask.json",
          "citymap.json",
        ];
        for (const name of WANTED) {
          const src = path.join(from, name);
          if (!existsSync(src)) {
            this.warn(
              `data/build/${name} is missing — the world will be missing that layer.`,
            );
            continue;
          }
          cpSync(src, path.join(to, name), { recursive: true });
        }
      },
    },
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    // Force a single copy of React across all packages (including vlyPlugin).
    // Without this, @vly-ai/integrations can resolve its own React copy, which
    // triggers "Invalid hook call" errors at runtime.
    dedupe: ["react", "react/jsx-runtime", "react-dom", "react-dom/client"],
  },
  build: {
    // Enable source maps for better debugging (disable in production if needed)
    sourcemap: false,
    // Optimize chunk splitting
    rollupOptions: {
      output: {
        // Manual chunk splitting for better caching and lazy loading
        manualChunks: {
          // Vendor chunks for large libraries
          "react-vendor": ["react", "react-dom", "react-router"],
          // Large UI library chunks
          "radix-ui": [
            "@radix-ui/react-accordion",
            "@radix-ui/react-alert-dialog",
            "@radix-ui/react-avatar",
            "@radix-ui/react-checkbox",
            "@radix-ui/react-collapsible",
            "@radix-ui/react-context-menu",
            "@radix-ui/react-dialog",
            "@radix-ui/react-dropdown-menu",
            "@radix-ui/react-hover-card",
            "@radix-ui/react-label",
            "@radix-ui/react-menubar",
            "@radix-ui/react-navigation-menu",
            "@radix-ui/react-popover",
            "@radix-ui/react-progress",
            "@radix-ui/react-radio-group",
            "@radix-ui/react-scroll-area",
            "@radix-ui/react-select",
            "@radix-ui/react-separator",
            "@radix-ui/react-slider",
            "@radix-ui/react-switch",
            "@radix-ui/react-tabs",
            "@radix-ui/react-toggle",
            "@radix-ui/react-toggle-group",
            "@radix-ui/react-tooltip",
          ],
          // Heavy optional libraries - separate chunks for better lazy loading
          "framer-motion": ["framer-motion"],
          charts: ["recharts"],
          forms: ["react-hook-form", "@hookform/resolvers", "zod"],
        },
        // Optimize chunk size
        chunkFileNames: "assets/[name]-[hash].js",
        entryFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash].[ext]",
      },
    },
    // Increase chunk size warning limit for better chunking
    chunkSizeWarningLimit: 1000,
    // Target modern browsers for better optimization
    target: "esnext",
    // Minify options - using esbuild (faster than terser)
    minify: "esbuild",
  },
  // Optimize dependencies
  optimizeDeps: {
    // Only scan the app entry HTML; avoids crawling unrelated *.html files
    // if a legacy snapshot accidentally contains leaked package folders.
    entries: ["index.html"],
    include: [
      "react",
      "react/jsx-runtime",
      "react-dom",
      "react-dom/client",
      "react-router",
      "framer-motion",
      // vlyPlugin() injects this import at serve time, so the dep scanner
      // never sees it. Without it here the first page load discovers it,
      // re-optimizes and full-reloads the preview mid-screenshot.
      "@vly-ai/integrations",
    ],
  },
  // Performance hints
  server: {
    // Bind to all interfaces so the browser runtime's server-ready event fires.
    host: true,
    port: 5173,
    // Keep HMR on, but disable full-screen error overlay
    hmr: {
      overlay: false,
    },
  },
});
