/**
 * The station building — the massing the whole view is missing.
 *
 * Both visual QA passes landed on the same finding: the frame had a platform
 * canopy and a train but no *station*, so there was no subject and nothing for
 * the eye to rest on. The reference build gets its "lifelike" read from a
 * designed silhouette with a large bilingual fascia in the middle third of the
 * frame, and that is what this file exists to supply.
 *
 * The profile is the real three-part one used on a Western Railway suburban
 * station: a plinth with steps, a body holding the concourse, and a projecting
 * canopy with a fascia band carrying the name.
 */
import * as THREE from 'three';
import { cel, flat } from '../engine/toon.js';
import { PAL } from '../engine/palette.js';
import { fasciaTexture, plateTexture, numberTexture } from '../engine/signage.js';
import { L } from './layout.js';
import { HOME_STATION } from './stations.js';
import { rng } from './station.js';

/**
 * Build the station building on the road side of the running lines, so it is
 * seen across the carriageway the way a station is actually approached.
 */
export function buildStationBuilding(): THREE.Group {
  const g = new THREE.Group();
  const r = rng(7788);
  const home = HOME_STATION;

  // Sit it just behind the far footpath, facing the road (toward -Z).
  const faceZ = L.footpathFar[0] - 1.0;
  const cx = -6; // roughly opposite the middle of the platform
  const w = 34; // frontage along the line
  const plinthH = 1.0;
  const bodyH = 7.2;
  const canopyProj = 3.4; // how far the roof oversails the front
  const faceDir = -1; // the building looks toward -Z (the carriageway)

  /* ---- plinth: the raised base, with a flight of steps at each end ---- */
  const plinth = new THREE.Mesh(
    new THREE.BoxGeometry(w, plinthH, 9),
    cel({ color: PAL.concrete, bands: 3 }),
  );
  plinth.position.set(cx, plinthH / 2, faceZ - 3.5);
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  g.add(plinth);

  for (const sx of [-1, 1]) {
    // 6 broad steps, 0.17 m each — a real suburban station step
    const steps = 6;
    for (let i = 0; i < steps; i++) {
      const step = new THREE.Mesh(
        new THREE.BoxGeometry(4.4, 0.17, 0.42),
        cel({ color: PAL.platformEdge, bands: 2 }),
      );
      step.position.set(
        cx + sx * (w / 2 - 3),
        0.085 + i * 0.17,
        faceZ - 0.2 - i * 0.42,
      );
      step.receiveShadow = true;
      g.add(step);
    }
    // a handrail up the middle of each flight
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.05, 2.6),
        cel({ color: PAL.wrGreen, bands: 2 }),
      );
      rail.position.set(
        cx + sx * (w / 2 - 3) + side * 0.9,
        0.95,
        faceZ - 1.0,
      );
      rail.rotation.x = -0.55;
      g.add(rail);
    }
  }

  /* ---- body: the concourse mass, set back behind the plinth ---- */
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(w, bodyH, 8),
    cel({ color: PAL.chawl, bands: 3 }),
  );
  body.position.set(cx, plinthH + bodyH / 2, faceZ - 3.5);
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);

  // a band course, so the body is not one flat slab
  const band = new THREE.Mesh(
    new THREE.BoxGeometry(w + 0.3, 0.5, 8.3),
    cel({ color: PAL.canopyUnder, bands: 2 }),
  );
  band.position.set(cx, plinthH + 3.1, faceZ - 3.5);
  g.add(band);

  /* ---- upper storey with a run of windows ---- */
  const winY = plinthH + 4.9;
  for (let i = 0; i < 9; i++) {
    const x = cx - w / 2 + 2.6 + i * ((w - 5.2) / 8);
    const win = new THREE.Mesh(
      new THREE.BoxGeometry(2.1, 1.7, 0.12),
      flat({ color: PAL.trainWindow, toneMapped: false }),
    );
    win.position.set(x, winY, faceZ + 0.5);
    g.add(win);
    // a shallow arched head, the way WR suburban upper windows are done
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(2.3, 0.22, 0.16),
      cel({ color: PAL.canopyUnder, bands: 2 }),
    );
    head.position.set(x, winY + 0.95, faceZ + 0.52);
    g.add(head);
  }

  /* ---- projecting canopy + fascia band: the signature element ---- */
  const canopyY = plinthH + 2.6;
  const canopy = new THREE.Mesh(
    new THREE.BoxGeometry(w, 0.5, canopyProj),
    cel({ color: PAL.canopyRoof, bands: 3 }),
  );
  canopy.position.set(cx, canopyY, faceZ + canopyProj / 2 - 0.2);
  canopy.castShadow = true;
  g.add(canopy);

  // the fascia band, in WR green, hanging just under the canopy lip
  const fascia = new THREE.Mesh(
    new THREE.BoxGeometry(w, 1.15, 0.3),
    cel({ color: PAL.wrGreen, bands: 3 }),
  );
  fascia.position.set(cx, canopyY - 0.7, faceZ + canopyProj - 0.2);
  g.add(fascia);

  // the name, painted large across the fascia — the single largest graphic.
  // It must sit just proud of the fascia's +Z face (the side the camera on the
  // carriageway sees) and face +Z, or it disappears inside the band box.
  const fasciaZ = canopyY - 0.7;
  const fasciaFront = faceZ + canopyProj - 0.2 + 0.16; // +Z face of the band
  const nameSign = new THREE.Mesh(
    new THREE.PlaneGeometry(15, 1.0),
    flat({ map: fasciaTexture(home.deva, home.latin), toneMapped: false }),
  );
  nameSign.position.set(cx, fasciaZ, fasciaFront);
  g.add(nameSign);

  // canopy support brackets under the lip
  for (let i = 0; i < 5; i++) {
    const x = cx - w / 2 + 3 + i * ((w - 6) / 4);
    const bracket = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.9, 0.12),
      cel({ color: PAL.wrGreenDark, bands: 2 }),
    );
    bracket.position.set(x, canopyY - 1.2, faceZ + canopyProj - 0.7);
    g.add(bracket);
  }

  /* ---- ground floor: a colonnade of openings under the canopy ---- */
  for (let i = 0; i < 6; i++) {
    const x = cx - w / 2 + 3.4 + i * ((w - 6.8) / 5);
    const opening = new THREE.Mesh(
      new THREE.BoxGeometry(2.6, 2.3, 0.1),
      flat({ color: PAL.glassDark }),
    );
    opening.position.set(x, plinthH + 1.2, faceZ + 0.05);
    g.add(opening);
  }

  /* ---- signage: platform numerals, a facility plate, a clock ---- */
  for (const sx of [-1, 1]) {
    const num = new THREE.Mesh(
      new THREE.PlaneGeometry(0.7, 0.7),
      flat({ map: numberTexture(sx > 0 ? '1' : '2'), toneMapped: false }),
    );
    num.position.set(cx + sx * 6, canopyY - 1.9, faceZ + canopyProj + 0.05);
    g.add(num);
  }

  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2, 0.8),
    flat({ map: plateTexture('निकास अंतिम', 'Terminus'), toneMapped: false }),
  );
  plate.position.set(cx - 11, canopyY - 1.9, faceZ + canopyProj + 0.05);
  g.add(plate);

  // wall clock, the way every WR station carries one
  const clockBody = new THREE.Mesh(
    new THREE.CylinderGeometry(0.42, 0.42, 0.16, 20),
    cel({ color: PAL.wrGreen, bands: 2 }),
  );
  clockBody.rotation.x = Math.PI / 2;
  clockBody.position.set(cx + 12, canopyY - 0.4, faceZ + canopyProj + 0.1);
  g.add(clockBody);
  const clockFace = new THREE.Mesh(
    new THREE.CircleGeometry(0.36, 20),
    flat({ color: 0xf6f2e6, toneMapped: false }),
  );
  clockFace.position.set(cx + 12, canopyY - 0.4, faceZ + canopyProj + 0.2);
  g.add(clockFace);

  /* ---- a forecourt strip of ground so the building does not float ---- */
  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(w + 10, 7),
    flat({ color: PAL.footpath }),
  );
  apron.rotation.x = -Math.PI / 2;
  apron.position.set(cx, 0.02, faceZ + 3);
  apron.receiveShadow = true;
  g.add(apron);

  return g;
}
