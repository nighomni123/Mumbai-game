/**
 * Eye-level clutter — the platform and footpath.
 *
 * The reference build this is modelled on has a deliberate gap here: all its
 * interesting signage sits above 2 m and its platforms are nearly empty.
 * This module is the answer to that. Every prop is real Indian suburban- and
 * street-railway furniture, placed at true scale from the shared `L` layout,
 * and seeded so the district is identical on every visit.
 */
import * as THREE from 'three';
import { cel, flat } from '../engine/toon.js';
import { PAL } from '../engine/palette.js';
import { L } from './layout.js';
import { rng } from './station.js';

const M = (w: number, h: number, d: number, color: number, extra = {}) =>
  new THREE.Mesh(new THREE.BoxGeometry(w, h, d), cel({ color, ...extra }));

/** A teal-and-cream plastic water cooler with a stack of upside-down cups. */
function waterCooler(x: number, z: number, r: () => number) {
  const g = new THREE.Group();
  const body = M(0.42, 0.68, 0.42, r() > 0.5 ? 0x2e8fb0 : 0xc23a2c);
  body.position.y = 0.34;
  g.add(body);
  const lid = M(0.46, 0.06, 0.46, 0xf2ede0);
  lid.position.y = 0.71;
  g.add(lid);
  for (let i = 0; i < 3; i++) {
    const cup = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.028, 0.07, 6),
      cel({ color: 0xdfe6ea, bands: 2 }),
    );
    cup.position.set(0.2, 0.4 + i * 0.02, 0.1 - i * 0.09);
    g.add(cup);
  }
  g.position.set(x, L.platformH, z);
  g.rotation.y = r() * Math.PI;
  return g;
}

/** A chai stall: wooden cart, cloth canopy, chimney, glasses. */
function chaiStall(x: number, z: number, r: () => number) {
  const g = new THREE.Group();
  const cart = M(1.5, 0.8, 0.7, 0x6d5539);
  cart.position.y = 0.55;
  g.add(cart);
  const counter = M(1.6, 0.06, 0.78, 0x8a6b4a);
  counter.position.y = 0.98;
  g.add(counter);
  // four corner posts
  for (const [px, pz] of [[-0.7, -0.3], [0.7, -0.3], [-0.7, 0.3], [0.7, 0.3]]) {
    const post = M(0.05, 1.05, 0.05, 0x5a4433);
    post.position.set(px, 1.5, pz);
    g.add(post);
  }
  // striped canopy
  const canopy = M(1.9, 0.05, 1.1, PAL.sariAlt);
  canopy.position.y = 2.02;
  g.add(canopy);
  // chimney + pot
  const chim = M(0.3, 0.55, 0.3, 0x4a4a52);
  chim.position.set(-0.5, 1.3, 0);
  g.add(chim);
  const pot = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.14, 0.16, 10),
    cel({ color: 0x8a8a92, bands: 2 }),
  );
  pot.position.set(0.3, 1.1, 0);
  g.add(pot);
  // tea glasses in a row
  for (let i = 0; i < 6; i++) {
    const glass = new THREE.Mesh(
      new THREE.CylinderGeometry(0.032, 0.026, 0.09, 6),
      cel({ color: r() > 0.4 ? 0xd8c9a0 : 0xe8e2d2, bands: 2 }),
    );
    glass.position.set(-0.5 + i * 0.2, 1.05, 0.22);
    g.add(glass);
  }
  g.position.set(x, L.platformH, z);
  g.rotation.y = r() * 0.6 - 0.3;
  return g;
}

/** Fruit cart with a push handle. */
function fruitCart(x: number, z: number, r: () => number) {
  const g = new THREE.Group();
  const top = M(1.3, 0.08, 0.72, 0x9a7a52);
  top.position.y = 0.72;
  g.add(top);
  const shelf = M(1.2, 0.06, 0.64, 0x7d5f42);
  shelf.position.y = 0.34;
  g.add(shelf);
  for (const [px, pz] of [[-0.55, -0.28], [0.55, -0.28], [-0.55, 0.28], [0.55, 0.28]]) {
    const wheel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.1, 0.05, 8),
      cel({ color: 0x2b2b31, bands: 2 }),
    );
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(px, 0.1, pz);
    g.add(wheel);
  }
  const handle = M(0.05, 0.4, 0.05, 0x6d5539);
  handle.position.set(-0.7, 0.9, 0);
  g.add(handle);
  // fruit mounds
  const cols = [0xd8452c, 0xe0a03c, 0x6f9c3a];
  for (let i = 0; i < 3; i++) {
    const mound = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 8, 6),
      cel({ color: cols[i], bands: 2 }),
    );
    mound.scale.set(1, 0.5, 1);
    mound.position.set(-0.4 + i * 0.4, 0.82, 0);
    g.add(mound);
  }
  g.position.set(x, 0, z);
  g.rotation.y = r() * Math.PI;
  return g;
}

/** Luggage trolley — the flat platform handcart. */
function luggageTrolley(x: number, z: number, r: () => number) {
  const g = new THREE.Group();
  const bed = M(1.5, 0.07, 0.8, 0x4a5a63);
  bed.position.y = 0.5;
  g.add(bed);
  for (const [px, pz] of [[-0.62, -0.34], [0.62, -0.34], [-0.62, 0.34], [0.62, 0.34]]) {
    const wheel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.16, 0.07, 10),
      cel({ color: 0x22242a, bands: 2 }),
    );
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(px, 0.18, pz);
    g.add(wheel);
  }
  for (const pz of [-0.34, 0.34]) {
    const rail = M(1.5, 0.5, 0.05, 0x39434a);
    rail.position.set(0, 0.78, pz);
    g.add(rail);
  }
  // stacked suitcases
  for (let i = 0; i < 3; i++) {
    const bag = M(0.42, 0.3, 0.3, [0x2f4a6b, 0x6b3a2f, 0x3a4a3a][i]);
    bag.position.set(-0.4 + i * 0.45, 0.68, r() * 0.2 - 0.1);
    bag.rotation.y = r() * 0.3;
    bag.castShadow = true;
    g.add(bag);
  }
  g.position.set(x, L.platformH, z);
  g.rotation.y = r() * Math.PI;
  return g;
}

/** Fire bucket on a stand. */
function fireBucket(x: number, z: number, r: () => number) {
  const g = new THREE.Group();
  const stand = M(0.06, 1.1, 0.06, 0x4a4a52);
  stand.position.y = 0.55;
  g.add(stand);
  const bucket = new THREE.Mesh(
    new THREE.CylinderGeometry(0.14, 0.11, 0.24, 8),
    cel({ color: 0xb03a2a, bands: 2 }),
  );
  bucket.position.y = 0.12;
  g.add(bucket);
  g.position.set(x, L.platformH, z);
  g.rotation.y = r();
  return g;
}

/** A parked bicycle leaning on its stand. */
function bicycle(x: number, z: number, r: () => number) {
  const g = new THREE.Group();
  const frame = M(0.9, 0.04, 0.04, 0x2f3a44);
  frame.position.y = 0.5;
  g.add(frame);
  for (const px of [-0.42, 0.42]) {
    const wheel = new THREE.Mesh(
      new THREE.TorusGeometry(0.3, 0.03, 5, 14),
      cel({ color: 0x22242a, bands: 2 }),
    );
    wheel.position.set(px, 0.32, 0);
    g.add(wheel);
  }
  const bar = M(0.05, 0.28, 0.05, 0x2f3a44);
  bar.position.set(0.45, 0.66, 0);
  g.add(bar);
  g.position.set(x, 0, z);
  g.rotation.y = r() * Math.PI;
  g.rotation.z = 0.12; // leaning
  return g;
}

/** Gas cylinders stacked against a wall. */
function gasCylinders(x: number, z: number, r: () => number) {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const cyl = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.16, 0.6, 10),
      cel({ color: i === 0 ? 0xc0392b : 0x2f6f86, bands: 2 }),
    );
    cyl.position.set(i * 0.36, 0.3, (r() - 0.5) * 0.1);
    cyl.castShadow = true;
    g.add(cyl);
  }
  g.position.set(x, 0, z);
  return g;
}

/** Cobbler's low stool under a market umbrella. */
function cobbler(x: number, z: number, r: () => number) {
  const g = new THREE.Group();
  const stool = M(0.4, 0.24, 0.34, 0x6d5539);
  stool.position.y = 0.12;
  g.add(stool);
  const umbrella = new THREE.Mesh(
    new THREE.ConeGeometry(0.8, 0.3, 8, 1, true),
    cel({ color: r() > 0.5 ? PAL.taxiYellow : PAL.sariAlt, side: THREE.DoubleSide, bands: 2 }),
  );
  umbrella.position.y = 1.5;
  g.add(umbrella);
  const pole = M(0.04, 1.5, 0.04, 0x5a4433);
  pole.position.y = 0.75;
  g.add(pole);
  g.position.set(x, 0, z);
  return g;
}

/** Milk cans in a row. */
function milkCans(x: number, z: number, r: () => number) {
  const g = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const can = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.13, 0.42, 8),
      cel({ color: 0xa8b0b8, bands: 3 }),
    );
    can.position.set((r() - 0.5) * 0.6, 0.21, (r() - 0.5) * 0.4);
    can.castShadow = true;
    g.add(can);
  }
  g.position.set(x, 0, z);
  return g;
}

/** A painted wall advertisement panel. */
function wallAd(x: number, y: number, z: number, r: () => number) {
  const cols = [0xc23a2c, 0x2b5f9e, 0xe0a03c, 0x2e7d4f];
  const bg = cols[Math.floor(r() * cols.length)];
  const ad = new THREE.Mesh(
    new THREE.PlaneGeometry(2.2, 1.3),
    flat({ color: bg, toneMapped: false }),
  );
  ad.position.set(x, y, z);
  ad.rotation.y = r() > 0.5 ? 0 : Math.PI;
  return ad;
}

/** Build all eye-level clutter. */
export function buildProps(): THREE.Group {
  const g = new THREE.Group();
  const r = rng(5150);

  // --- vendors and stalls along the platform ----------------------------
  const nearX = L.spawn.x;
  g.add(chaiStall(nearX + 6, 0.9, r));
  g.add(waterCooler(nearX + 8.4, 1.1, r));
  g.add(luggageTrolley(nearX - 5, 1.0, r));
  g.add(fireBucket(nearX + 3.2, 1.2, r));

  // a spread of smaller props down the platform, kept off the spawn line
  for (let i = 0; i < 5; i++) {
    const x = -L.halfX + 14 + i * 32 + r() * 10;
    if (Math.abs(x - nearX) < 5) continue;
    const pick = r();
    if (pick < 0.34) g.add(luggageTrolley(x, 0.9, r));
    else if (pick < 0.6) g.add(waterCooler(x, 1.1, r));
    else g.add(fireBucket(x, 1.2, r));
  }

  // --- footpath clutter (road side) -------------------------------------
  for (let i = 0; i < 5; i++) {
    const x = -L.halfX + 12 + i * 36 + r() * 12;
    const z = L.footpathFar[0] - 1.0;
    const pick = r();
    if (pick < 0.3) g.add(fruitCart(x, z, r));
    else if (pick < 0.55) g.add(milkCans(x, z + (r() - 0.5), r));
    else if (pick < 0.78) g.add(bicycle(x, z, r));
    else g.add(cobbler(x, z, r));
  }
  g.add(gasCylinders(-40, L.footpathFar[0] - 1.2, r));
  g.add(gasCylinders(46, L.footpathFar[0] - 1.2, r));

  // --- wall ads on the station back wall --------------------------------
  for (let i = 0; i < 6; i++) {
    g.add(wallAd(-70 + i * 28, 2.4, L.footpathNear[1] - 0.1, r));
  }

  return g;
}
