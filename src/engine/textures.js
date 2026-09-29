/**
 * The one texture the ported sky module needs.
 *
 * The upstream sakura-crossing `textures.js` is 4,397 lines of Japanese
 * signage and paint masks — porting it wholesale would drag in 4k lines of
 * content we do not use. Its only cross-module export is `cloudTex()`, so
 * that is all that is implemented here; Mumbai signage lives in
 * `signage.ts` instead.
 */
import * as THREE from 'three';

let cached = null;

/** A soft, flat cel cloud puff, drawn once and shared by every billboard. */
export function cloudTex() {
  if (cached) return cached;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');

  ctx.clearRect(0, 0, 256, 256);
  // a puff built from overlapping circles, so the silhouette is lumpy rather
  // than a plain disc — that lumpiness is what makes it read as painted cloud
  const lobes = [
    [128, 150, 62],
    [86, 158, 48],
    [170, 156, 52],
    [110, 128, 44],
    [150, 126, 46],
    [200, 164, 36],
    [56, 168, 32],
  ];
  ctx.fillStyle = '#ffffff';
  for (const [x, y, r] of lobes) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // flatten the base so it sits on a horizon line
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.rect(0, 186, 256, 70);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  cached = tex;
  return tex;
}
