/**
 * The built environment: platform, track, canopy, footbridge, road and every
 * sign in the station.
 *
 * The composition rule from the reference — and the reason the district reads
 * as dense rather than empty — is that every depth band is populated. From
 * the platform: a person within a metre, a taxi at two to four, the road and
 * crossing at six to ten, the train and canopy at twelve to twenty-five, and
 * the trees and sky beyond. Nothing is left as a bare plane.
 */
import * as THREE from 'three';
import { cel, flat } from '../engine/toon.js';
import { PAL } from '../engine/palette.js';
import {
  fasciaTexture,
  platformBoardTexture,
  departureBoardTexture,
  plateTexture,
  numberTexture,
} from '../engine/signage.js';
import { L } from './layout.js';
import { HOME_STATION, departuresFrom, next, prev } from './stations.js';

/** Deterministic RNG so the district is identical on every visit. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const box = (w: number, h: number, d: number, color: number, extra = {}) =>
  new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    cel({ color, ...extra }),
  );

/* ------------------------------------------------------------------ *
 * Ground: platform, footpaths, carriageway
 * ------------------------------------------------------------------ */
function ground(g: THREE.Group) {
  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(L.halfX * 2, L.road[0] - L.road[1]),
    cel({ color: PAL.road }),
  );
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0, (L.road[0] + L.road[1]) / 2);
  road.receiveShadow = true;
  g.add(road);

  for (const [z0, z1] of [L.footpathNear, L.footpathFar]) {
    const p = new THREE.Mesh(
      new THREE.PlaneGeometry(L.halfX * 2, Math.abs(z1 - z0)),
      cel({ color: PAL.footpath }),
    );
    p.rotation.x = -Math.PI / 2;
    p.position.set(0, 0.01, (z0 + z1) / 2);
    p.receiveShadow = true;
    g.add(p);
  }

  // platform slab
  const plat = new THREE.Mesh(
    new THREE.BoxGeometry(L.platformLength, L.platformH, L.platformZ * 2),
    cel({ color: PAL.platform }),
  );
  plat.position.set(0, L.platformH / 2, 0);
  plat.receiveShadow = true;
  plat.castShadow = true;
  g.add(plat);

  // yellow safety line along both platform edges
  for (const s of [-1, 1]) {
    const line = new THREE.Mesh(
      new THREE.PlaneGeometry(L.platformLength, 0.6),
      flat({ color: 0xd6b463, toneMapped: false }),
    );
    line.rotation.x = -Math.PI / 2;
    line.position.set(0, L.platformH + 0.012, s * (L.platformZ - 0.35));
    g.add(line);
  }
}

/* ------------------------------------------------------------------ *
 * Track: ballast, sleepers, rails — four running lines
 * ------------------------------------------------------------------ */
function track(g: THREE.Group) {
  const half = L.platformLength / 2;
  for (const z of L.trackZ) {
    const ballast = new THREE.Mesh(
      new THREE.BoxGeometry(L.platformLength, 0.28, L.ballastHalfWidth * 2),
      cel({ color: PAL.ballast }),
    );
    ballast.position.set(0, 0.14, z);
    ballast.receiveShadow = true;
    g.add(ballast);

    // sleepers
    const n = Math.floor(L.platformLength / L.sleeperStep);
    const sleepers = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.26, 0.16, 2.6),
      cel({ color: PAL.sleeper }),
      n,
    );
    sleepers.receiveShadow = true;
    const m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      m.makeTranslation(-half + i * L.sleeperStep, 0.36, z);
      sleepers.setMatrixAt(i, m);
    }
    sleepers.instanceMatrix.needsUpdate = true;
    g.add(sleepers);

    // rails
    for (const s of [-1, 1]) {
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(L.platformLength, 0.14, 0.1),
        cel({ color: PAL.rail, bands: 4 }),
      );
      rail.position.set(0, 0.5, z + (s * L.gauge) / 2);
      g.add(rail);
    }
  }
}

/* ------------------------------------------------------------------ *
 * Platform canopy — green steel columns, corrugated roof
 * ------------------------------------------------------------------ */
function canopy(g: THREE.Group) {
  const half = L.platformLength / 2;
  const deck = L.platformH;
  const roofY = deck + 4.4;
  const z0 = -L.platformZ + 0.3;
  const z1 = L.platformZ - 0.3;

  for (let x = -half + 4; x <= half - 4; x += 6) {
    for (const z of [z0 + 0.4, z1 - 0.4]) {
      // straight steel column with a base plate — a tapered cylinder reads as
      // a cone, and real WR canopy posts are a constant section
      const col = new THREE.Mesh(
        new THREE.BoxGeometry(0.24, roofY - deck, 0.24),
        cel({ color: PAL.wrGreen, bands: 3 }),
      );
      col.position.set(x, deck + (roofY - deck) / 2, z);
      col.castShadow = true;
      g.add(col);
      const base = new THREE.Mesh(
        new THREE.BoxGeometry(0.36, 0.16, 0.36),
        cel({ color: PAL.wrGreenDark, bands: 2 }),
      );
      base.position.set(x, deck + 0.09, z);
      base.receiveShadow = true;
      g.add(base);

      // bracket arm
      const arm = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 0.1, z1 - z0 - 0.8),
        cel({ color: PAL.wrGreenDark }),
      );
      arm.position.set(x, roofY - 0.3, 0);
      g.add(arm);
    }
    // cross truss
    const truss = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.12, z1 - z0),
      cel({ color: PAL.wrGreenDark }),
    );
    truss.position.set(x, roofY - 0.55, 0);
    g.add(truss);
  }

  // roof slab, slightly pitched
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(L.platformLength, 0.18, z1 - z0 + 1.6),
    cel({ color: PAL.canopyRoof }),
  );
  roof.position.set(0, roofY, 0);
  roof.castShadow = true;
  g.add(roof);

  // purlins under the roof — the detail that stops it reading as a slab
  for (let x = -half; x <= half; x += 1.5) {
    const p = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.1, z1 - z0 + 1.4),
      cel({ color: PAL.canopyUnder }),
    );
    p.position.set(x, roofY - 0.14, 0);
    g.add(p);
  }

  // fluorescent tubes
  for (let x = -half + 6; x <= half - 6; x += 6) {
    for (const z of [z0 + 1.2, z1 - 1.2]) {
      const tube = new THREE.Mesh(
        new THREE.BoxGeometry(1.6, 0.08, 0.16),
        flat({ color: 0xfff6dc, toneMapped: false }),
      );
      tube.position.set(x, roofY - 0.28, z);
      g.add(tube);
    }
  }
}

/* ------------------------------------------------------------------ *
 * Footbridge — green steel span with stair towers
 * ------------------------------------------------------------------ */
function footbridge(g: THREE.Group) {
  const { bridgeZ, bridgeDeckY, bridgeWidth } = L;
  const bx = 34; // sits toward the north end, as in the reference
  const len = bridgeZ[1] - bridgeZ[0];
  const midZ = (bridgeZ[0] + bridgeZ[1]) / 2;

  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(bridgeWidth, 0.22, len),
    cel({ color: PAL.steel }),
  );
  deck.position.set(bx, bridgeDeckY, midZ);
  deck.castShadow = true;
  g.add(deck);

  // railings
  for (const s of [-1, 1]) {
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 1.05, len),
      cel({ color: PAL.wrGreen }),
    );
    rail.position.set(bx + (s * bridgeWidth) / 2, bridgeDeckY + 0.62, midZ);
    g.add(rail);
    for (let z = bridgeZ[0]; z <= bridgeZ[1]; z += 1.2) {
      const post = new THREE.Mesh(
        new THREE.BoxGeometry(0.07, 1.0, 0.07),
        cel({ color: PAL.wrGreen }),
      );
      post.position.set(bx + (s * bridgeWidth) / 2, bridgeDeckY + 0.6, z);
      g.add(post);
    }
  }

  // roof over the bridge
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(bridgeWidth + 0.8, 0.14, len),
    cel({ color: PAL.canopyRoof }),
  );
  roof.position.set(bx, bridgeDeckY + 2.5, midZ);
  roof.castShadow = true;
  g.add(roof);
  for (let z = bridgeZ[0]; z <= bridgeZ[1]; z += 3) {
    for (const s of [-1, 1]) {
      const col = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.1, 2.5, 6),
        cel({ color: PAL.wrGreen }),
      );
      col.position.set(bx + (s * (bridgeWidth + 0.4)) / 2, bridgeDeckY + 1.25, z);
      g.add(col);
    }
  }

  // stair towers down to the platform and the road side
  for (const [zTop, zBot, yBot] of [
    [bridgeZ[0] + 1, bridgeZ[0] - 5, L.platformH],
    [bridgeZ[1] - 1, bridgeZ[1] + 5, 0],
  ] as const) {
    const steps = 16;
    const dz = (zTop - zBot) / steps;
    const dy = (bridgeDeckY - yBot) / steps;
    for (let i = 0; i < steps; i++) {
      const s = new THREE.Mesh(
        new THREE.BoxGeometry(bridgeWidth, 0.08, Math.abs(dz) + 0.06),
        cel({ color: PAL.concrete }),
      );
      s.position.set(bx, yBot + (i + 0.5) * dy, zBot + (i + 0.5) * dz);
      s.castShadow = true;
      g.add(s);
    }
  }
}

/* ------------------------------------------------------------------ *
 * Road: kerbs in black and yellow, a crossing, lane paint
 * ------------------------------------------------------------------ */
function roadFurniture(g: THREE.Group) {
  const [rz0, rz1] = L.road;

  // kerbs, painted in alternating black and yellow segments
  const segN = Math.floor((L.halfX * 2) / L.kerbStripe);
  const kerbs = new THREE.InstancedMesh(
    new THREE.BoxGeometry(L.kerbStripe, L.kerbHeight, 0.5),
    cel({ color: 0xffffff, vertexColors: false }),
    segN * 2,
  );
  const col = new THREE.Color();
  const m = new THREE.Matrix4();
  let i = 0;
  for (let k = 0; k < segN; k++) {
    for (const [z, face] of [
      [rz1 + 0.25, 0],
      [rz0 - 0.25, 1],
    ] as const) {
      col.setHex(k % 2 === 0 ? PAL.kerbPaint : PAL.kerbDark);
      kerbs.setColorAt(i, col);
      m.makeTranslation(-L.halfX + k * L.kerbStripe + L.kerbStripe / 2, L.kerbHeight / 2, z);
      kerbs.setMatrixAt(i, m);
      i++;
    }
  }
  kerbs.instanceMatrix.needsUpdate = true;
  if (kerbs.instanceColor) kerbs.instanceColor.needsUpdate = true;
  g.add(kerbs);

  // zebra crossing outside the station, linking platform to the taxi rank
  const bars = 9;
  for (let b = 0; b < bars; b++) {
    const bar = new THREE.Mesh(
      new THREE.PlaneGeometry(0.55, L.road[0] - L.road[1] - 1),
      flat({ color: PAL.zebra, toneMapped: false }),
    );
    bar.rotation.x = -Math.PI / 2;
    bar.position.set(-8 + b * 0.8, 0.015, (rz0 + rz1) / 2);
    g.add(bar);
  }

  // centre line
  for (let x = -L.halfX; x < L.halfX; x += 6) {
    const dash = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 0.14),
      flat({ color: 0xe8dfc0, toneMapped: false }),
    );
    dash.rotation.x = -Math.PI / 2;
    dash.position.set(x, 0.012, (rz0 + rz1) / 2);
    g.add(dash);
  }
}

/* ------------------------------------------------------------------ *
 * Signage — every board's text comes from the station adjacency data
 * ------------------------------------------------------------------ */
function signage(g: THREE.Group) {
  const home = HOME_STATION;
  const roofY = L.platformH + 4.4;

  // fascia on the canopy beam
  const fascia = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 2),
    flat({ map: fasciaTexture(home.deva, home.latin), toneMapped: false }),
  );
  fascia.position.set(-24, roofY - 0.42, L.platformZ - 0.2);
  fascia.rotation.y = Math.PI;
  g.add(fascia);

  const fascia2 = fascia.clone();
  fascia2.position.set(-24, roofY - 0.42, -L.platformZ + 0.2);
  fascia2.rotation.y = 0;
  g.add(fascia2);

  // hanging platform boards, tucked up under the roof so they frame the scene
  // rather than filling it
  const boardTex = platformBoardTexture(home.deva, home.latin);
  for (let x = -72; x <= 72; x += 24) {
    if (Math.abs(x - L.spawn.x) < 7) continue; // not directly over the spawn
    for (const s of [-1, 1]) {
      const b = new THREE.Mesh(
        new THREE.PlaneGeometry(3.2, 0.8),
        flat({ map: boardTex, toneMapped: false }),
      );
      b.position.set(x, roofY - 0.34, s * (L.platformZ - 0.5));
      b.rotation.y = s > 0 ? Math.PI : 0;
      g.add(b);
      // hanger rods
      for (const hx of [-1.2, 1.2]) {
        const rod = new THREE.Mesh(
          new THREE.BoxGeometry(0.04, 0.34, 0.04),
          cel({ color: PAL.steel, bands: 2 }),
        );
        rod.position.set(x + hx, roofY - 0.17, s * (L.platformZ - 0.5));
        g.add(rod);
      }
    }
  }

  // platform number
  for (const s of [-1, 1]) {
    const n = new THREE.Mesh(
      new THREE.PlaneGeometry(0.7, 0.7),
      flat({ map: numberTexture(s > 0 ? '1' : '2'), toneMapped: false }),
    );
    n.position.set(-8, roofY - 0.5, s * (L.platformZ - 0.5));
    n.rotation.y = s > 0 ? Math.PI : 0;
    g.add(n);
  }

  // departure LED on the platform
  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(5.2, 1.95),
    flat({ map: departureBoardTexture(departuresFrom(home.code, 19 * 60 + 6)), toneMapped: false }),
  );
  board.position.set(8, roofY - 1.0, -L.platformZ + 0.5);
  board.rotation.y = 0;
  g.add(board);

  // footbridge sign
  const fb = new THREE.Mesh(
    new THREE.PlaneGeometry(3.6, 0.9),
    flat({ map: plateTexture('फुट ब्रिज', 'Foot Bridge'), toneMapped: false }),
  );
  fb.position.set(34, L.bridgeDeckY + 1.9, L.bridgeZ[0] + 0.1);
  g.add(fb);
}

/* ------------------------------------------------------------------ *
 * Platform furniture — benches, lamps, bins, a clock
 * ------------------------------------------------------------------ */
function furniture(g: THREE.Group) {
  const deck = L.platformH;
  const r = rng(9182);

  for (let x = -70; x <= 70; x += 16) {
    for (const s of [-1, 1]) {
      const z = s * (L.platformZ - 0.5);
      // bench
      const seat = new THREE.Mesh(
        new THREE.BoxGeometry(2.2, 0.1, 0.5),
        cel({ color: PAL.timber }),
      );
      seat.position.set(x, deck + 0.45, z);
      seat.castShadow = true;
      g.add(seat);
      const back = new THREE.Mesh(
        new THREE.BoxGeometry(2.2, 0.5, 0.07),
        cel({ color: 0x6d5539 }),
      );
      back.position.set(x, deck + 0.7, z + s * 0.24);
      g.add(back);
      for (const lx of [-0.9, 0.9]) {
        const leg = new THREE.Mesh(
          new THREE.BoxGeometry(0.09, 0.45, 0.45),
          cel({ color: 0x3f4a55 }),
        );
        leg.position.set(x + lx, deck + 0.22, z);
        g.add(leg);
      }

      // bin
      if (r() > 0.45) {
        const bin = new THREE.Mesh(
          new THREE.CylinderGeometry(0.28, 0.24, 0.8, 10),
          cel({ color: PAL.wrGreen }),
        );
        bin.position.set(x + 6, deck + 0.4, z);
        bin.castShadow = true;
        g.add(bin);
      }
    }
  }

  // platform clock on a post
  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.06, 3.2, 6),
    cel({ color: 0x4a5058 }),
  );
  post.position.set(4, L.platformH + 1.6, L.platformZ - 0.5);
  g.add(post);
  const face = new THREE.Mesh(
    new THREE.CircleGeometry(0.34, 20),
    flat({ color: 0xf6f2e6, toneMapped: false }),
  );
  face.position.set(4, L.platformH + 3.2, L.platformZ - 0.56);
  face.rotation.y = Math.PI;
  g.add(face);
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(0.34, 0.05, 6, 20),
    cel({ color: 0x39404a }),
  );
  rim.position.copy(face.position);
  g.add(rim);
}

/* ------------------------------------------------------------------ *
 * Lamp posts along the road — the vertical rhythm of a Mumbai street
 * ------------------------------------------------------------------ */
export function streetLamps(g: THREE.Group) {
  for (let x = -L.halfX + 8; x <= L.halfX - 8; x += 18) {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.12, 7, 8),
      cel({ color: 0x39404a }),
    );
    pole.position.set(x, 3.5, L.footpathFar[0] + 0.9);
    pole.castShadow = true;
    g.add(pole);
    const arm = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, 0.1, 0.1),
      cel({ color: 0x39404a }),
    );
    arm.position.set(x, 6.9, L.footpathFar[0] + 0.45);
    g.add(arm);
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.16, 0.34),
      flat({ color: 0xffe9b0, toneMapped: false }),
    );
    head.position.set(x, 6.8, L.footpathFar[0] + 0.1);
    g.add(head);
  }
}

/** Build the whole station district. */
export function buildStation(): THREE.Group {
  const g = new THREE.Group();
  ground(g);
  track(g);
  canopy(g);
  footbridge(g);
  roadFurniture(g);
  signage(g);
  furniture(g);
  streetLamps(g);
  return g;
}
