/**
 * The city beyond the station, and the trees.
 *
 * The reference build has no rooftop clutter at all. On a real Mumbai street
 * the roofline is the densest, most recognisable thing above eye level —
 * black poly water tanks, dish antennas, drying laundry and blue tarpaulin —
 * and none of it needs any geographic data. Filling that gap is the single
 * biggest visual win available here, so it gets its own generator.
 */
import * as THREE from 'three';
import { cel, flat } from '../engine/toon.js';
import { PAL } from '../engine/palette.js';
import { L } from './layout.js';
import { rng } from './station.js';
import { shopSignTexture } from '../engine/signage.js';

const rnd = rng(31337);

/* ------------------------------------------------------------------ *
 * Rooftop clutter
 * ------------------------------------------------------------------ */
function waterTank(x: number, y: number, z: number, s: number) {
  const g = new THREE.Group();
  const tank = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55 * s, 0.6 * s, 0.9 * s, 10),
    cel({ color: rnd() > 0.5 ? PAL.tank : PAL.tankBlue, bands: 3 }),
  );
  tank.position.y = 0.45 * s;
  tank.castShadow = true;
  g.add(tank);
  // the moulded foot it stands on
  const foot = new THREE.Mesh(
    new THREE.BoxGeometry(1.3 * s, 0.22 * s, 1.3 * s),
    cel({ color: 0x6d675c, bands: 2 }),
  );
  foot.position.y = 0.11 * s;
  g.add(foot);
  g.position.set(x, y, z);
  return g;
}

function dish(x: number, y: number, z: number) {
  const g = new THREE.Group();
  const d = new THREE.Mesh(
    new THREE.SphereGeometry(0.34, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.42),
    cel({ color: PAL.dish, bands: 2, side: THREE.DoubleSide }),
  );
  d.rotation.x = -1.0;
  d.position.y = 0.42;
  d.castShadow = true;
  g.add(d);
  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 0.5, 6),
    cel({ color: 0x555a63, bands: 2 }),
  );
  mast.position.y = 0.25;
  g.add(mast);
  g.position.set(x, y, z);
  return g;
}

function laundry(x: number, y: number, z: number, w: number) {
  const g = new THREE.Group();
  const rope = new THREE.Mesh(
    new THREE.BoxGeometry(w, 0.02, 0.02),
    flat({ color: 0xd8d2c4 }),
  );
  g.add(rope);
  // A line strung between two poles, not a row of boxes hanging in space.
  for (const px of [-w / 2, w / 2]) {
    const pole = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.7, 0.05),
      cel({ color: PAL.timber, bands: 2 }),
    );
    pole.position.set(px, -0.35, 0);
    g.add(pole);
  }
  const cols = [PAL.laundry, PAL.laundryAlt, PAL.sariAlt, PAL.kurta, PAL.taxiYellow];
  for (let i = 0; i < 4; i++) {
    const cw = 0.3 + rnd() * 0.3;
    const ch = 0.5 + rnd() * 0.5;
    const cloth = new THREE.Mesh(
      new THREE.PlaneGeometry(cw, ch),
      cel({ color: cols[Math.floor(rnd() * cols.length)], bands: 2, side: THREE.DoubleSide }),
    );
    cloth.position.set(-w / 2 + (i + 0.6) * (w / 4.4), -ch / 2 - 0.03, 0);
    g.add(cloth);
  }
  g.position.set(x, y, z);
  return g;
}

function tarp(x: number, y: number, z: number, w: number, d: number) {
  const g = new THREE.Mesh(
    new THREE.BoxGeometry(w, 0.08, d),
    cel({ color: rnd() > 0.5 ? PAL.tarpaulin : PAL.tarpaulinAlt, bands: 2 }),
  );
  g.position.set(x, y + 0.04, z);
  g.rotation.z = (rnd() - 0.5) * 0.08;
  g.castShadow = true;
  return g;
}

/** Dress a roofline: parapet, tanks, dishes, laundry and tarpaulin. */
function roofClutter(g: THREE.Group, w: number, d: number, y: number, cx: number, cz: number, density: number) {
  // parapet
  for (const [pw, pd, px, pz] of [
    [w, 0.16, 0, -d / 2],
    [w, 0.16, 0, d / 2],
    [0.16, d, -w / 2, 0],
    [0.16, d, w / 2, 0],
  ] as const) {
    const par = new THREE.Mesh(
      new THREE.BoxGeometry(pw, 0.55, pd),
      cel({ color: PAL.concrete, bands: 2 }),
    );
    par.position.set(cx + px, y + 0.27, cz + pz);
    g.add(par);
  }

  const n = Math.round(2 + rnd() * 3 * density);
  for (let i = 0; i < n; i++) {
    const x = cx + (rnd() - 0.5) * (w - 1.4);
    const z = cz + (rnd() - 0.5) * (d - 1.4);
    const roll = rnd();
    if (roll < 0.5) g.add(waterTank(x, y + 0.02, z, 0.9 + rnd() * 0.5));
    else if (roll < 0.78) g.add(dish(x, y + 0.02, z));
    else if (roll < 0.9) g.add(laundry(x, y + 1.5, z + d / 2 - 0.1, Math.min(w * 0.5, 3)));
    else g.add(tarp(x, y + 0.02, z, 1.6 + rnd() * 2, 1.2 + rnd() * 1.6));
  }
}

/* ------------------------------------------------------------------ *
 * Building typologies
 * ------------------------------------------------------------------ */
function windows(g: THREE.Group, w: number, h: number, d: number, y: number, cx: number, cz: number, tint: number) {
  const cols = Math.max(2, Math.floor(w / 2.2));
  const rows = Math.max(2, Math.floor(h / 3));
  const geo = new THREE.BoxGeometry(0.9, 1.3, 0.1);
  const mat = flat({ color: tint, toneMapped: false });
  for (const [dz, rot] of [
    [d / 2 + 0.03, 0],
    [-d / 2 - 0.03, Math.PI],
    [w / 2 + 0.03, Math.PI / 2],
    [-w / 2 - 0.03, -Math.PI / 2],
  ] as const) {
    const n = rot === 0 || rot === Math.PI ? cols : rows;
    const along = rot === 0 || rot === Math.PI ? w : d;
    const im = new THREE.InstancedMesh(geo, mat, n * rows);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rot, 0));
    let i = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < n; c++) {
        const t = (c + 0.5) / n - 0.5;
        const p = new THREE.Vector3(t * (along - 1.4), 0, dz);
        if (rot === Math.PI / 2) p.set(dz, 0, -t * (along - 1.4));
        if (rot === -Math.PI / 2) p.set(dz, 0, t * (along - 1.4));
        p.applyQuaternion(q);
        p.add(new THREE.Vector3(cx, y + 1.6 + r * ((h - 2.4) / Math.max(1, rows - 1)), cz));
        m.compose(p, q, new THREE.Vector3(1, 1, 1));
        im.setMatrixAt(i++, m);
      }
    }
    im.count = i;
    im.instanceMatrix.needsUpdate = true;
    g.add(im);
  }
}

/** Old chawl: long, low, deep balconies running the full frontage. */
function chawl(g: THREE.Group, x: number, z: number, w: number, storeys: number) {
  const h = storeys * 3;
  const d = 11;
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    cel({ color: rnd() > 0.5 ? PAL.chawl : PAL.chawlAlt }),
  );
  body.position.set(x, h / 2, z);
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);

  // the balcony is what makes a chawl a chawl
  for (let s = 1; s <= storeys; s++) {
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(w, 0.16, 2.0),
      cel({ color: PAL.concrete, bands: 2 }),
    );
    deck.position.set(x, s * 3 - 0.1, z + (d / 2 + 1) * (z > 0 ? 1 : -1));
    deck.castShadow = true;
    g.add(deck);
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(w, 0.9, 0.08),
      cel({ color: PAL.balcony, bands: 2 }),
    );
    rail.position.set(x, s * 3 + 0.45, z + (d / 2 + 2) * (z > 0 ? 1 : -1));
    g.add(rail);
  }
  windows(g, w, h, d, 0, x, z, PAL.chawlShade);
  roofClutter(g, w, d, h, x, z, 0.8);
}

/** Mid-rise block with a ground-floor shopfront. */
function midrise(g: THREE.Group, x: number, z: number, w: number, d: number, storeys: number, shop?: { deva: string; latin: string; bg: number; fg: number }) {
  const h = storeys * 3.2;
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    cel({ color: rnd() > 0.5 ? PAL.midrise : PAL.concrete }),
  );
  body.position.set(x, h / 2, z);
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);

  if (shop) {
    const face = Math.sign(z) || 1;
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(Math.min(w * 0.8, 7), 1.8),
      flat({
        map: shopSignTexture(shop.deva, shop.latin, `#${shop.bg.toString(16).padStart(6, '0')}`, `#${shop.fg.toString(16).padStart(6, '0')}`),
        toneMapped: false,
      }),
    );
    sign.position.set(x, 4.1, z + face * (d / 2 + 0.08));
    sign.rotation.y = face > 0 ? 0 : Math.PI;
    g.add(sign);
    // shutter
    const shutter = new THREE.Mesh(
      new THREE.BoxGeometry(Math.min(w * 0.7, 6), 2.6, 0.1),
      cel({ color: 0x8a8579, bands: 2 }),
    );
    shutter.position.set(x, 1.3, z + face * (d / 2 + 0.06));
    g.add(shutter);
  }
  windows(g, w, h, d, 0, x, z, rnd() > 0.6 ? PAL.trainWindow : PAL.chawlShade);
  roofClutter(g, w, d, h, x, z, 1.2);
}

/** A tower, to give the skyline some vertical punctuation. */
function tower(g: THREE.Group, x: number, z: number) {
  const h = 34 + rnd() * 22;
  const w = 12;
  const d = 12;
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    cel({ color: PAL.tower, bands: 4 }),
  );
  body.position.set(x, h / 2, z);
  body.castShadow = true;
  g.add(body);
  windows(g, w, h, d, 0, x, z, PAL.towerGlass);
  roofClutter(g, w, d, h, x, z, 1.4);
}

const SHOPS = [
  { deva: 'गणेश किराणा', latin: 'Ganesh Kirana', bg: 0xf2c230, fg: 0xa3221a },
  { deva: 'नवीन मेडिकल', latin: 'Navin Medical', bg: 0x2e8a5e, fg: 0xffffff },
  { deva: 'श्री चाय', latin: 'Shree Chai', bg: 0xc0392b, fg: 0xfdf6e7 },
  { deva: 'मिठाई', latin: 'Mithai', bg: 0xe07f4e, fg: 0x2b2118 },
  { deva: 'स्टेशनरी', latin: 'Stationery', bg: 0x2b5f9e, fg: 0xf2f4f8 },
];

/* ------------------------------------------------------------------ *
 * Gulmohar — a real tree: trunk, branches, clumped canopy. The
 * reference build uses stacked flat discs on a bare stick, which reads
 * as a lollipop.
 * ------------------------------------------------------------------ */
function gulmohar(g: THREE.Group, x: number, z: number, scale: number) {
  const t = new THREE.Group();
  const h = (5.2 + rnd() * 3.2) * scale;

  // Trunk tapers, and is hidden by the canopy mass — the previous version had
  // splayed limbs poking out BELOW the foliage, which read as black spider
  // legs under a parasol.
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.13 * scale, 0.26 * scale, h, 8),
    cel({ color: PAL.trunk, bands: 2 }),
  );
  trunk.position.y = h / 2;
  trunk.castShadow = true;
  t.add(trunk);

  // No separate limbs. A real gulmohar is a thick straight trunk under a
  // rounded crown; drawn limbs that reach up into the foliage only ever poke
  // out beneath it and read as black spider legs, which is exactly what the
  // first version did. The canopy mass alone carries the silhouette.
  const crownY = h * 0.98;

  // Canopy: a mass of squashed spheres, mostly flame-of-the-forest red with
  // real green foliage mixed in. A single-hue canopy reads as a parasol.
  const cluster = new THREE.Group();
  const blobs = 11;
  for (let i = 0; i < blobs; i++) {
    const a = (i / blobs) * Math.PI * 2 + rnd() * 0.5;
    const rr = (i === 0 ? 0 : 0.75 + rnd() * 1.25) * scale;
    const rad = (1.0 + rnd() * 0.75) * scale;
    const roll = rnd();
    const colour = roll < 0.34 ? PAL.gulmoharDeep : roll < 0.74 ? PAL.gulmohar : PAL.gulmoharLeaf;
    const blob = new THREE.Mesh(
      new THREE.IcosahedronGeometry(rad, 0),
      cel({ color: colour, bands: 3, flat: true }),
    );
    blob.position.set(
      Math.cos(a) * rr,
      crownY + 0.5 * scale + rnd() * 0.9 * scale,
      Math.sin(a) * rr,
    );
    blob.scale.set(1, 0.66, 1);
    blob.castShadow = true;
    cluster.add(blob);
  }
  t.add(cluster);
  t.position.set(x, 0, z);
  return t;
}

/* ------------------------------------------------------------------ *
 * Assemble the city block on both sides
 * ------------------------------------------------------------------ */
export function buildCity(): THREE.Group {
  const g = new THREE.Group();
  const line = L.buildingLine;

  // Road side — the frontage the player looks across at.
  let x = -L.halfX;
  while (x < L.halfX) {
    const w = 12 + rnd() * 10;
    if (rnd() > 0.72) {
      chawl(g, x + w / 2, line - 6, w, 3 + Math.floor(rnd() * 2));
    } else {
      midrise(g, x + w / 2, line - 8, w, 13, 4 + Math.floor(rnd() * 4), SHOPS[Math.floor(rnd() * SHOPS.length)]);
    }
    x += w + 1.2 + rnd() * 2.5;
  }

  // Station side — behind the footbridge, deeper and taller.
  x = -L.halfX;
  while (x < L.halfX) {
    const w = 14 + rnd() * 12;
    if (rnd() > 0.82) tower(g, x + w / 2, L.buildingFar + 16);
    else midrise(g, x + w / 2, L.buildingFar, w, 16, 5 + Math.floor(rnd() * 6), rnd() > 0.4 ? SHOPS[Math.floor(rnd() * SHOPS.length)] : undefined);
    x += w + 2 + rnd() * 3;
  }

  // Trees along both footpaths — band 5, the thing that closes the frame.
  for (let tx = -L.halfX + 6; tx < L.halfX; tx += 11 + rnd() * 7) {
    if (rnd() > 0.25) g.add(gulmohar(g, tx, L.footpathFar[0] - 1.4, 1.0 + rnd() * 0.3));
    if (rnd() > 0.55) g.add(gulmohar(g, tx + 4, L.footpathNear[0] - 1.2, 0.9 + rnd() * 0.3));
  }
  // a stand behind the station
  for (let i = 0; i < 10; i++) {
    g.add(gulmohar(g, -70 + i * 16 + rnd() * 6, L.buildingFar + 30 + rnd() * 12, 1.1 + rnd() * 0.4));
  }

  return g;
}
