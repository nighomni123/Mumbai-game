/**
 * The whole city, flat, on top of the world. Press P.
 *
 * This replaced a 3D planet: the same "see all of Mumbai at once" idea, but flat
 * and on top of a frozen frame instead of a sphere. Three reasons, and all
 * three were measured before the change:
 *
 *  - The planet rendered 4.0M triangles and 58 draw calls — 18x the street
 *    view's triangles — for a view of 133,328 buildings at 4 m quantisation.
 *  - It froze the build queue at 440 entries, because `drain()` is not called in
 *    planet mode, so nothing ever finished building behind it.
 *  - It was unreadable. The land mask it drew was the broken coastline scanline
 *    (4,161 km2 of false land), so the globe was two thirds empty ocean with a
 *    crescent of city stuck to one edge.
 *
 * A flat map costs one canvas blit, freezes nothing, and reads at a glance.
 *
 * Zoom and pan are here because a single fixed view of 67 x 82 km is only
 * legible down to a district; the point of the map is to answer "what is over
 * there", and that needs to work at two scales.
 */

import { placeDots, projector, type CityMap } from "./citymap.js";
import { landRuns } from "./citymap-math.js";
import { toLocal, METRO_BOUNDS } from "./geo-constants.js";
import { PLACES } from "./places.js";

/** Zoom is a divisor on the whole-metro fit: 1 = all of it, 8 = a district. */
const MIN_ZOOM = 1;
const MAX_ZOOM = 9;

export class MapOverlay {
  private el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D | null;
  private map: CityMap | null = null;
  private onPick: (name: string) => void;

  /** Centre of the view, in local metres. */
  private cx: number;
  private cz: number;
  private zoom = 1;

  private disposers: (() => void)[] = [];

  constructor(host: HTMLElement, onPick: (name: string) => void) {
    this.onPick = onPick;
    this.cx = (METRO_BOUNDS.x0 + METRO_BOUNDS.x1) / 2;
    this.cz = (METRO_BOUNDS.y0 + METRO_BOUNDS.y1) / 2;

    this.el = document.createElement("div");
    this.el.style.cssText =
      "position:absolute;inset:0;z-index:8;background:rgba(20,18,24,0.86);display:grid;place-items:center;font-family:ui-sans-serif,system-ui,sans-serif";
    this.canvas = document.createElement("canvas");
    this.canvas.style.cssText =
      "max-width:min(94vw,760px);max-height:86vh;cursor:grab;box-shadow:0 18px 60px rgba(0,0,0,0.5);border-radius:2px";
    this.el.appendChild(this.canvas);

    const hint = document.createElement("div");
    hint.style.cssText =
      "color:#efe6c4;opacity:0.8;margin-top:10px;font-size:13px;text-align:center";
    hint.textContent =
      "drag to pan · wheel to zoom · click a place to travel there · P or Esc to close";
    this.el.appendChild(hint);

    host.appendChild(this.el);
    this.g = this.canvas.getContext("2d");

    this.attachInput();
    this.resize();
    const onWinResize = () => this.resize();
    window.addEventListener("resize", onWinResize);
    this.disposers.push(() =>
      window.removeEventListener("resize", onWinResize),
    );

    // The mask may still be loading; draw what we have and pick it up when it
    // lands rather than opening an empty blue rectangle.
    this.map = null;
  }

  setMap(map: CityMap | null): void {
    this.map = map;
  }

  private resize(): void {
    const w = Math.min(window.innerWidth * 0.94, 760);
    const h = Math.min(window.innerHeight * 0.86, 1040);
    this.canvas.width = Math.round(
      w * Math.min(window.devicePixelRatio || 1, 2),
    );
    this.canvas.height = Math.round(
      h * Math.min(window.devicePixelRatio || 1, 2),
    );
    this.canvas.style.width = `${Math.round(w)}px`;
    this.canvas.style.height = `${Math.round(h)}px`;
  }

  /** Fit the metro to the canvas at the current zoom, centred on cx,cz. */
  private view() {
    const p = projector(this.canvas.width, this.canvas.height);
    const s = p.scale * this.zoom;
    return {
      x: (x: number) => (x - this.cx) * s + this.canvas.width / 2,
      y: (z: number) => this.canvas.height / 2 - (z - this.cz) * s,
      invX: (px: number) => (px - this.canvas.width / 2) / s + this.cx,
      invY: (py: number) => (py - this.canvas.height / 2) / s + this.cz,
      scale: s,
    };
  }

  private attachInput(): void {
    let dragging = false;
    let lx = 0;
    let ly = 0;

    this.canvas.addEventListener("mousedown", (e) => {
      dragging = true;
      lx = e.clientX;
      ly = e.clientY;
      this.canvas.style.cursor = "grabbing";
    });
    window.addEventListener("mouseup", () => {
      dragging = false;
      this.canvas.style.cursor = "grab";
    });
    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const v = this.view();
      this.cx -= (e.clientX - lx) / v.scale;
      this.cz += (e.clientY - ly) / v.scale;
      lx = e.clientX;
      ly = e.clientY;
      this.draw();
    });
    this.canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        // Zoom about the cursor, so the point under the pointer stays put.
        const rect = this.canvas.getBoundingClientRect();
        const px = ((e.clientX - rect.left) / rect.width) * this.canvas.width;
        const py = ((e.clientY - rect.top) / rect.height) * this.canvas.height;
        const before = this.view();
        const bx = before.invX(px);
        const bz = before.invY(py);
        this.zoom = Math.max(
          MIN_ZOOM,
          Math.min(MAX_ZOOM, this.zoom * (e.deltaY > 0 ? 0.85 : 1.18)),
        );
        const after = this.view();
        this.cx += bx - after.invX(px);
        this.cz += bz - after.invY(py);
        this.draw();
      },
      { passive: false },
    );
    this.canvas.addEventListener("click", (e) => {
      const name = this.hit(e);
      if (name) this.onPick(name);
    });
  }

  private hit(e: MouseEvent): string | null {
    const rect = this.canvas.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * this.canvas.width;
    const py = ((e.clientY - rect.top) / rect.height) * this.canvas.height;
    const v = this.view();
    let best: string | null = null;
    let bestD = 22;
    for (const pl of PLACES) {
      const l = toLocal(pl.lon, pl.lat);
      const d = Math.hypot(v.x(l.x) - px, v.y(l.y) - py);
      if (d < bestD) {
        bestD = d;
        best = pl.name;
      }
    }
    return best;
  }

  draw(): void {
    const g = this.g;
    if (!g) return;
    const W = this.canvas.width;
    const H = this.canvas.height;
    g.fillStyle = "#2f5a72";
    g.fillRect(0, 0, W, H);

    if (this.map?.water) {
      const runs = landRuns(this.map.water);
      g.fillStyle = "#d8d2c2";
      const v = this.view();
      for (const r of runs) {
        const left = v.x(r.x0);
        const right = v.x(r.x1);
        if (right < -4 || left > W + 4) continue; // off screen
        const top = v.y(r.y1);
        const bottom = v.y(r.y0);
        g.fillRect(
          left,
          top,
          Math.max(1, right - left),
          Math.max(1, bottom - top),
        );
      }
      if (this.map.data) this.drawRoads(g, v, W, H);
      placeDots(g, v, W, H, true);
    } else {
      g.fillStyle = "#efe6c4";
      g.font = "14px ui-sans-serif, system-ui, sans-serif";
      g.textAlign = "center";
      g.fillText("the land mask has not loaded", W / 2, H / 2);
    }
  }

  /** Roads, only where they would actually be visible as more than a smear. */
  private drawRoads(
    g: CanvasRenderingContext2D,
    v: ReturnType<MapOverlay["view"]>,
    W: number,
    H: number,
  ): void {
    const data = this.map!.data!;
    const q = data.q;
    // The arterials are the point of the map, so they are drawn at every zoom.
    // An earlier version dropped them below a scale threshold on the theory that
    // 20k hairlines at metro zoom are a grey wash; measured, they are not — they
    // are the only thing that makes a cluster of buildings read as a town.
    g.lineCap = "round";
    g.lineJoin = "round";
    {
      g.strokeStyle = "rgba(96,92,84,0.55)";
      g.lineWidth = 1;
      g.beginPath();
      for (const flat of data.roads) {
        let started = false;
        for (let i = 0; i < flat.length; i += 2) {
          const px = v.x(flat[i] * q);
          const py = v.y(flat[i + 1] * q);
          if (px < -40 || px > W + 40 || py < -40 || py > H + 40) {
            started = false;
            continue;
          }
          if (!started) {
            g.moveTo(px, py);
            started = true;
          } else g.lineTo(px, py);
        }
      }
      g.stroke();
    }
    const detail = v.scale > 0.02;
    g.strokeStyle = "rgba(45,42,38,0.9)";
    g.lineWidth = detail ? 1.8 : 1.4;
    g.beginPath();
    for (const r of data.named) {
      const flat = r.p;
      let started = false;
      for (let i = 0; i < flat.length; i += 2) {
        const px = v.x(flat[i] * q);
        const py = v.y(flat[i + 1] * q);
        if (px < -40 || px > W + 40 || py < -40 || py > H + 40) {
          started = false;
          continue;
        }
        if (!started) {
          g.moveTo(px, py);
          started = true;
        } else g.lineTo(px, py);
      }
    }
    g.stroke();
  }

  /**
   * Called once a frame while open, but only redraws when the view actually
   * moved. The world behind is frozen, so an idle map repainting itself at
   * 60 Hz would be pure cost.
   */
  private lastKey = "";
  tick(): void {
    const key = `${this.cx.toFixed(1)}|${this.cz.toFixed(1)}|${this.zoom.toFixed(3)}|${this.canvas.width}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.draw();
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.el.remove();
  }
}
