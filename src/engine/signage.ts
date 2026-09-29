/**
 * Canvas2D sign painter.
 *
 * Ported in approach from the sakura-crossing `textures.js` (MIT) — every
 * sign in the world is drawn at runtime on a canvas rather than shipped as a
 * PNG, which is how the whole project carries zero binary assets. The
 * implementation here is Mumbai-specific: Devanagari/Latin bilingual fascias,
 * Indian Railways green platform boards, and an amber dot-matrix departure LED.
 */
import * as THREE from 'three';

const DEVA = "'Noto Sans Devanagari', 'Kohinoor Devanagari', 'Nirmala UI', 'Mangal', system-ui, sans-serif";
const LATIN = "'Patrick Hand', 'Segoe UI', system-ui, sans-serif";
const SERIF = "'Georgia', 'Times New Roman', serif";

function canvas2d(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  return { c, ctx };
}

function finish(c: HTMLCanvasElement, repeatX = 1, repeatY = 1) {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  if (repeatX !== 1 || repeatY !== 1) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatX, repeatY);
  }
  return tex;
}

/** Webfonts land after first paint; redraw once they are ready. */
function afterFonts(redraw: () => void, tex: THREE.CanvasTexture) {
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    document.fonts.ready.then(() => {
      redraw();
      tex.needsUpdate = true;
    });
  }
}

function fitText(ctx: CanvasRenderingContext2D, text: string, max: number) {
  if (ctx.measureText(text).width <= max) return;
  let s = 1;
  while (s > 0.3) {
    ctx.font = ctx.font.replace(/\d+(\.\d+)?px/, `${parseFloat(ctx.font) * 0.97 | 0}px`);
    if (ctx.measureText(text).width <= max) return;
    s -= 0.05;
  }
}

/* ------------------------------------------------------------------ *
 * Station fascia — the big sign over the platform.
 * Devanagari in dark red above the name in black serif caps, exactly as
 * the reference station reads.
 * ------------------------------------------------------------------ */
export function fasciaTexture(deva: string, latin: string) {
  const { c, ctx } = canvas2d(1024, 256);
  const tex = finish(c);
  const draw = () => {
    ctx.fillStyle = '#f4ede0';
    ctx.fillRect(0, 0, 1024, 256);
    // panel rules
    ctx.strokeStyle = 'rgba(60,50,40,0.25)';
    ctx.lineWidth = 4;
    ctx.strokeRect(10, 10, 1004, 236);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#a8332a';
    ctx.font = `600 82px ${DEVA}`;
    ctx.fillText(deva, 512, 88, 940);
    ctx.fillStyle = '#201c1a';
    ctx.font = `700 64px ${SERIF}`;
    fitText(ctx, latin.toUpperCase(), 940);
    ctx.fillText(latin.toUpperCase(), 512, 178, 940);
  };
  draw();
  afterFonts(draw, tex);
  return tex;
}

/* ------------------------------------------------------------------ *
 * Platform board — Indian Railways green, name in both scripts.
 * ------------------------------------------------------------------ */
export function platformBoardTexture(deva: string, latin: string) {
  const { c, ctx } = canvas2d(512, 128);
  const tex = finish(c);
  const draw = () => {
    ctx.fillStyle = '#1f6b43';
    ctx.fillRect(0, 0, 512, 128);
    ctx.fillStyle = '#f2f0e4';
    ctx.fillRect(0, 0, 512, 6);
    ctx.fillRect(0, 122, 512, 6);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f6f4e8';
    ctx.font = `600 40px ${DEVA}`;
    ctx.fillText(deva, 256, 48, 470);
    ctx.font = `600 34px ${LATIN}`;
    fitText(ctx, latin, 460);
    ctx.fillText(latin, 256, 92, 460);
  };
  draw();
  afterFonts(draw, tex);
  return tex;
}

/* ------------------------------------------------------------------ *
 * Departure LED — amber dot-matrix, service / destination / time.
 * Drawn as a grid of dots so it reads as a real matrix at distance.
 * ------------------------------------------------------------------ */
export function departureBoardTexture(rows: { train: number; dest: string; time: string }[]) {
  const W = 1024;
  const H = 384;
  const { c, ctx } = canvas2d(W, H);
  const tex = finish(c);
  const draw = () => {
    ctx.fillStyle = '#14100c';
    ctx.fillRect(0, 0, W, H);
    ctx.font = `600 34px ${LATIN}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    const rowH = 84;
    rows.slice(0, 3).forEach((r, i) => {
      const y = 74 + i * rowH;
      ctx.fillStyle = '#e8a020';
      ctx.fillText(`#${r.train}`, 44, y);
      ctx.fillText(r.dest, 150, y, 520);
      ctx.textAlign = 'right';
      ctx.fillText(r.time, 980, y);
      ctx.textAlign = 'left';
      // faint dot-matrix grid over the whole board
      ctx.fillStyle = 'rgba(232,160,32,0.07)';
      for (let gx = 0; gx < W; gx += 4) {
        for (let gy = 0; gy < H; gy += 4) ctx.fillRect(gx, gy, 2, 2);
      }
      // row divider
      ctx.fillStyle = 'rgba(232,160,32,0.22)';
      ctx.fillRect(36, y + 44, W - 72, 2);
    });
  };
  draw();
  afterFonts(draw, tex);
  return tex;
}

/* ------------------------------------------------------------------ *
 * Directional / facility sign — blue bilingual plate.
 * ------------------------------------------------------------------ */
export function plateTexture(deva: string, latin: string) {
  const { c, ctx } = canvas2d(512, 128);
  const tex = finish(c);
  const draw = () => {
    ctx.fillStyle = '#1d4f8f';
    ctx.fillRect(0, 0, 512, 128);
    ctx.fillStyle = '#f2f4f8';
    ctx.fillRect(0, 0, 512, 5);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f4f6fa';
    ctx.font = `600 44px ${DEVA}`;
    ctx.fillText(deva, 256, 46, 470);
    ctx.font = `600 36px ${LATIN}`;
    fitText(ctx, latin.toUpperCase(), 460);
    ctx.fillText(latin.toUpperCase(), 256, 94, 460);
  };
  draw();
  afterFonts(draw, tex);
  return tex;
}

/* ------------------------------------------------------------------ *
 * Shop sign — the painted board that makes a Mumbai lane read as one.
 * ------------------------------------------------------------------ */
export function shopSignTexture(deva: string, latin: string, bg: string, fg: string) {
  const { c, ctx } = canvas2d(512, 160);
  const tex = finish(c);
  const draw = () => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 512, 160);
    ctx.strokeStyle = fg;
    ctx.lineWidth = 6;
    ctx.strokeRect(8, 8, 496, 144);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = fg;
    ctx.font = `600 48px ${DEVA}`;
    ctx.fillText(deva, 256, 58, 462);
    ctx.font = `700 34px ${LATIN}`;
    fitText(ctx, latin, 450);
    ctx.fillText(latin, 256, 116, 450);
  };
  draw();
  afterFonts(draw, tex);
  return tex;
}

/* ------------------------------------------------------------------ *
 * Number plate — platform "1", coach numbers.
 * ------------------------------------------------------------------ */
export function numberTexture(n: string) {
  const { c, ctx } = canvas2d(128, 128);
  const tex = finish(c);
  const draw = () => {
    ctx.fillStyle = '#1d4f8f';
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#f4f6fa';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 82px ${LATIN}`;
    ctx.fillText(n, 64, 68);
  };
  draw();
  afterFonts(draw, tex);
  return tex;
}

/* ------------------------------------------------------------------ *
 * Painted coach side — the WR red/cream livery with window band, drawn
 * once and tiled along the train so the body carries real detail.
 * ------------------------------------------------------------------ */
export function coachTexture(red: string, cream: string, stripe: string) {
  const { c, ctx } = canvas2d(1024, 256);
  const tex = finish(c, 1, 1);
  const draw = () => {
    // lower body
    ctx.fillStyle = red;
    ctx.fillRect(0, 0, 1024, 256);
    // upper body
    ctx.fillStyle = cream;
    ctx.fillRect(0, 86, 1024, 170);
    // waistline stripe
    ctx.fillStyle = stripe;
    ctx.fillRect(0, 168, 1024, 14);
    // window band
    ctx.fillStyle = '#33405a';
    for (let x = 40; x < 1000; x += 150) ctx.fillRect(x, 106, 108, 54);
    // window frames
    ctx.strokeStyle = 'rgba(240,235,220,0.55)';
    ctx.lineWidth = 3;
    for (let x = 40; x < 1000; x += 150) ctx.strokeRect(x, 106, 108, 54);
    // roof shading
    ctx.fillStyle = 'rgba(0,0,0,0.10)';
    ctx.fillRect(0, 86, 1024, 10);
    // dirt / wear toward the bottom
    ctx.fillStyle = 'rgba(30,20,16,0.18)';
    for (let i = 0; i < 320; i++) {
      ctx.fillRect(Math.random() * 1024, 200 + Math.random() * 56, 2, 2);
    }
  };
  draw();
  return tex;
}
