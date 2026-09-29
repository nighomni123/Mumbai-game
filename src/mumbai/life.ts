/**
 * Everything that moves: the local train, the taxi rank, and the crowd.
 *
 * The reference build's platform was conspicuously empty and its roads had no
 * moving traffic, so density here is a deliberate improvement rather than a
 * copy. People are placed across every depth band because a crowd that only
 * exists at mid-distance reads as wallpaper.
 */
import * as THREE from 'three';
import { cel, flat } from '../engine/toon.js';
import { PAL } from '../engine/palette.js';
import { coachTexture } from '../engine/signage.js';
import { L } from './layout.js';
import { rng } from './station.js';

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/* ------------------------------------------------------------------ *
 * The local — a three-car EMU in Western Railway livery
 * ------------------------------------------------------------------ */
export function buildTrain(): THREE.Group {
  const g = new THREE.Group();
  const carLen = 19;
  const bodyTex = coachTexture(hex(PAL.trainRed), hex(PAL.trainCream), hex(PAL.trainStripe));
  bodyTex.wrapS = THREE.RepeatWrapping;
  bodyTex.repeat.set(2, 1);

  for (let c = 0; c < 3; c++) {
    const x = (c - 1) * (carLen + 0.6);
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(carLen, 2.9, 2.7),
      cel({ map: bodyTex, bands: 3 }),
    );
    body.position.set(x, 1.95, 0);
    body.castShadow = true;
    g.add(body);

    // roof
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(carLen - 0.4, 0.22, 2.6),
      cel({ color: PAL.trainRoof, bands: 2 }),
    );
    roof.position.set(x, 3.5, 0);
    g.add(roof);

    // doorway recess, so the side is not one flat band
    for (const dx of [-5.5, 0, 5.5]) {
      const door = new THREE.Mesh(
        new THREE.BoxGeometry(1.5, 2.1, 0.08),
        cel({ color: PAL.trainWindow, bands: 2 }),
      );
      door.position.set(x + dx, 1.75, 1.38);
      g.add(door);
    }

    // bogies
    for (const bx of [x - 6, x + 6]) {
      const bogie = new THREE.Mesh(
        new THREE.BoxGeometry(3.2, 0.7, 2.0),
        cel({ color: 0x2a2e34, bands: 2 }),
      );
      bogie.position.set(bx, 0.62, 0);
      g.add(bogie);
    }

    // coach number
    const num = new THREE.Mesh(
      new THREE.PlaneGeometry(1.4, 0.4),
      flat({ color: PAL.trainCream, toneMapped: false }),
    );
    num.position.set(x + 8, 0.75, 1.4);
    g.add(num);
  }
  return g;
}

/* ------------------------------------------------------------------ *
 * Vehicles — the black-and-yellow taxi is the single most recognisable
 * object in the whole city, so it gets the most accurate proportions.
 * ------------------------------------------------------------------ */
function buildTaxi(): THREE.Group {
  const g = new THREE.Group();
  // Padmini/Fiat Ambassador proportions: short, tall, upright.
  const lower = new THREE.Mesh(
    new THREE.BoxGeometry(3.6, 0.95, 1.55),
    cel({ color: PAL.taxiBlack, bands: 3 }),
  );
  lower.position.y = 0.85;
  lower.castShadow = true;
  g.add(lower);

  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(2.5, 0.85, 1.45),
    cel({ color: PAL.taxiBlack, bands: 3 }),
  );
  cabin.position.set(-0.15, 1.7, 0);
  cabin.castShadow = true;
  g.add(cabin);

  // yellow roof — the whole point of the thing
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(2.45, 0.18, 1.42),
    cel({ color: PAL.taxiYellow, bands: 2 }),
  );
  roof.position.set(-0.15, 2.18, 0);
  g.add(roof);

  // glass
  for (const [w, d, px, pz] of [
    [2.3, 0.06, -0.15, 0.72],
    [2.3, 0.06, -0.15, -0.72],
    [0.06, 1.3, 1.12, 0],
    [0.06, 1.3, -1.42, 0],
  ] as const) {
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(w, 0.62, d),
      flat({ color: PAL.glassTint, transparent: true, opacity: 0.55 }),
    );
    glass.position.set(px, 1.75, pz);
    g.add(glass);
  }

  // wheels
  for (const [px, pz] of [
    [1.25, 0.78],
    [1.25, -0.78],
    [-1.25, 0.78],
    [-1.25, -0.78],
  ]) {
    const wheel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.32, 0.32, 0.2, 10),
      cel({ color: 0x1a1a1e, bands: 2 }),
    );
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(px, 0.32, pz);
    g.add(wheel);
  }
  return g;
}

function buildAuto(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(2.5, 1.0, 1.4),
    cel({ color: PAL.autoRed, bands: 3 }),
  );
  body.position.y = 0.8;
  body.castShadow = true;
  g.add(body);
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(1.7, 0.9, 1.3),
    cel({ color: PAL.autoYellow, bands: 3 }),
  );
  roof.position.set(-0.2, 1.7, 0);
  g.add(roof);
  for (const [px, pz] of [
    [0.85, 0.68],
    [0.85, -0.68],
    [-0.85, 0.68],
    [-0.85, -0.68],
  ]) {
    const wheel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.28, 0.18, 8),
      cel({ color: 0x1a1a1e, bands: 2 }),
    );
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(px, 0.28, pz);
    g.add(wheel);
  }
  return g;
}

/* ------------------------------------------------------------------ *
 * A person. Blocky, flat-shaded, with a face — the reference build
 * leaves NPCs as blank ovals up close, which is the first thing that
 * reads as fake. A brow and two eyes cost almost nothing.
 * ------------------------------------------------------------------ */
export function buildPerson(opts: { cloth: number; skin?: number; sari?: boolean; height?: number }) {
  const g = new THREE.Group();
  const h = opts.height ?? 1.7;
  const sc = h / 1.7;
  const skin = opts.skin ?? PAL.skin;
  // sleeves a touch off the torso colour, or the arms fuse with the body
  const sleeve = new THREE.Color(opts.cloth).multiplyScalar(0.86).getHex();

  // Legs, with a gap between them and a foot at the bottom — two adjacent
  // slabs read as a wardrobe, a gap plus feet is what reads as legs.
  const legs = new THREE.Group();
  for (const sx of [-0.13, 0.13]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.74, 0.19), cel({ color: PAL.trousers, bands: 2 }));
    leg.position.set(sx, 0.46, 0);
    leg.castShadow = true;
    legs.add(leg);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.09, 0.26), cel({ color: 0x241c17, bands: 2 }));
    foot.position.set(sx, 0.045, 0.03);
    legs.add(foot);
  }

  // Torso: shoulders narrower than the hip block, with arms set slightly
  // forward so the silhouette has a waist break.
  const torso = new THREE.Mesh(
    new THREE.BoxGeometry(0.44, 0.56, 0.24),
    cel({ color: opts.cloth, bands: 3 }),
  );
  torso.position.y = 1.11;
  torso.castShadow = true;

  const arms = new THREE.Group();
  for (const sx of [-0.29, 0.29]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.5, 0.15), cel({ color: sleeve, bands: 2 }));
    arm.position.set(sx, 1.1, 0);
    arm.castShadow = true;
    arms.add(arm);
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.13, 0.12), cel({ color: skin, bands: 2 }));
    hand.position.set(sx, 0.82, 0.01);
    arms.add(hand);
  }

  // Neck: the small vertical gap that separates head from shoulders is the
  // single cheapest thing that stops a figure reading as a box.
  const neck = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.09, 0.12),
    cel({ color: skin, bands: 2 }),
  );
  neck.position.y = 1.43;

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.125, 12, 9),
    cel({ color: skin, bands: 2 }),
  );
  head.position.y = 1.585;
  head.castShadow = true;

  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.133, 12, 9, 0, Math.PI * 2, 0, Math.PI * 0.55),
    cel({ color: PAL.hair, bands: 2 }),
  );
  hair.position.y = 1.6;

  const face = new THREE.Group();
  const eyeGeo = new THREE.BoxGeometry(0.03, 0.02, 0.012);
  for (const ex of [-0.045, 0.045]) {
    const eye = new THREE.Mesh(eyeGeo, flat({ color: 0x20191a, toneMapped: false }));
    eye.position.set(ex, 1.605, 0.113);
    face.add(eye);
  }
  const brow = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.018, 0.012),
    flat({ color: PAL.hair, toneMapped: false }),
  );
  brow.position.set(0, 1.645, 0.113);
  face.add(brow);

  g.add(legs, torso, arms, neck, head, hair, face);

  if (opts.sari) {
    // a sari falls from the waist — a wide drape that hides the legs
    const drape = new THREE.Mesh(
      new THREE.BoxGeometry(0.56, 0.86, 0.36),
      cel({ color: opts.cloth, bands: 3 }),
    );
    drape.position.y = 0.76;
    drape.castShadow = true;
    g.add(drape);
  }

  g.scale.setScalar(sc);
  g.userData.legs = legs;
  return g;
}

/* ------------------------------------------------------------------ *
 * Assembly: train on a running line, taxi rank, crowd
 * ------------------------------------------------------------------ */
export interface Life {
  /** The geometry group to add to the scene. */
  group: THREE.Group;
  update: (t: number, dt: number) => void;
}

export function buildLife(): Life {
  const g = new THREE.Group();
  const r = rng(4242);

  // --- the train, on the NEAR down line, looping ---
  // Track index 0 (z = -10) — the outer near line, so the inner near track at
  // z = -6 stays open and reads as depth between viewer and train.
  const train = buildTrain();
  train.position.set(0, 0, L.trackZ[0]);
  g.add(train);

  // --- taxi rank on the far side of the road ---
  const taxis: THREE.Group[] = [];
  for (let i = 0; i < 6; i++) {
    const t = buildTaxi();
    t.position.set(-20 + i * 6.4, 0, L.footpathFar[0] - 3.2 - (i % 2) * 4.2);
    t.rotation.y = Math.PI / 2 + (r() - 0.5) * 0.12;
    taxis.push(t);
    g.add(t);
  }
  // and two out on the carriageway, queued
  for (let i = 0; i < 2; i++) {
    const t = buildTaxi();
    t.position.set(-34 + i * 6.4, 0, L.road[0] - 2.6);
    t.rotation.y = Math.PI / 2;
    g.add(t);
  }

  // --- autos ---
  for (let i = 0; i < 3; i++) {
    const a = buildAuto();
    a.position.set(24 + i * 4.2, 0, L.road[1] + 2.4 + (i % 2) * 3.6);
    a.rotation.y = Math.PI / 2;
    g.add(a);
  }

  // --- crowd, spread across every depth band ---
  const people: { obj: THREE.Group; phase: number; speed: number; axis: 'x' | 'z'; lo: number; hi: number; bob: number }[] = [];
  const CLOTH = [PAL.sari, PAL.sariAlt, PAL.sariWarm, PAL.kurta, PAL.shirt];
  const place = (x: number, z: number, sari: boolean) => {
    const p = buildPerson({ cloth: CLOTH[Math.floor(r() * CLOTH.length)], sari, skin: r() > 0.5 ? PAL.skin : PAL.skinDeep });
    p.position.set(x, L.platformH, z);
    p.rotation.y = r() * Math.PI * 2;
    g.add(p);
    people.push({
      obj: p,
      phase: r() * 100,
      speed: 0.4 + r() * 0.5,
      axis: r() > 0.5 ? 'x' : 'z',
      lo: x - 6,
      hi: x + 6,
      bob: r() * 6,
    });
  };

  // A person standing inside the camera's near plane does not read as a
  // person, it reads as an unidentifiable slab across the frame. Keep a clear
  // radius around the spawn so the foreground band holds someone who is
  // actually whole — this is the "near human" the composition needs, and
  // cropping one at 1.5 m is exactly how you get a floating coloured box.
  const clearOfSpawn = (x: number, z: number, rad = 5.5) =>
    Math.hypot(x - L.spawn.x, z - L.spawn.z) > rad;

  // band 1-2: right on the platform, close enough to read a face
  // Concentrate them in the stretch a player actually sees from the spawn —
  // 12 figures spread evenly over 180 m leaves the frame reading empty, while
  // the same 12 inside the first 70 m read as a working station.
  let placed = 0;
  for (let tries = 0; tries < 120 && placed < 13; tries++) {
    const px = L.spawn.x - 8 + r() * 76;
    const pz = (r() - 0.5) * 2.6;
    if (!clearOfSpawn(px, pz, 3.6)) continue;
    place(px, pz, r() > 0.45);
    placed++;
  }
  // band 3: the crossing and the road
  for (let i = 0; i < 6; i++) {
    const p = buildPerson({ cloth: CLOTH[Math.floor(r() * CLOTH.length)], sari: r() > 0.4 });
    p.position.set(-8 + (r() - 0.5) * 3, 0, L.road[0] + r() * (L.road[1] - L.road[0]));
    p.rotation.y = Math.PI;
    g.add(p);
  }
  // The deliberate near-camera human: a whole figure, standing, offset from
  // the centre so it frames the shot instead of blocking it. This is the
  // single highest-value prop in the composition -- the eye accepts the
  // whole scene the moment it accepts a person at reading distance.
  {
    const p = buildPerson({ cloth: PAL.kurta, sari: false, skin: PAL.skinDeep });
    p.position.set(L.spawn.x + 7.5, L.platformH, 1.15);
    p.rotation.y = -0.35;
    g.add(p);
    people.push({ obj: p, phase: 3, speed: 0, axis: 'x', lo: p.position.x, hi: p.position.x, bob: 0 });
  }

  // band 4: the far footpath by the taxi rank
  for (let i = 0; i < 5; i++) {
    const p = buildPerson({ cloth: CLOTH[Math.floor(r() * CLOTH.length)], sari: r() > 0.5 });
    p.position.set(-40 + r() * 80, 0, L.footpathFar[0] - 1.6);
    p.rotation.y = r() * Math.PI * 2;
    g.add(p);
  }

  return {
    group: g,
    update(t: number, dt: number) {
      // train: runs in, dwells, runs out, on a 46 s cycle
      const cycle = (t % 46) / 46;
      let tx: number;
      if (cycle < 0.28) tx = -90 + (cycle / 0.28) * 150;
      else if (cycle < 0.52) tx = -30 + (cycle - 0.28) / 0.24 * 12;
      else if (cycle < 0.78) tx = 0 + ((cycle - 0.52) / 0.26) * 190;
      else tx = 190;
      train.position.x = tx;

      // crowd drift + gait
      for (const p of people) {
        const o = p.obj;
        if (p.axis === 'x') {
          o.position.x += Math.sin(t * p.speed + p.phase) * 2.2 * dt;
          o.position.x = THREE.MathUtils.clamp(o.position.x, p.lo, p.hi);
        } else {
          o.position.z += Math.cos(t * p.speed + p.phase) * 0.5 * dt;
        }
        o.position.y += Math.abs(Math.sin(t * 4 + p.phase + p.bob)) * 0.02;
      }
    },
  };
}

export { buildTaxi, buildAuto };
