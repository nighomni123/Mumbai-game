/**
 * The objects layer: vehicles, people, and street furniture that is a solid.
 *
 * The street experiment in `street.ts` established the shape of the problem.
 * Kerb paint, lamps, poles and wires fixed the 0-4 m band's *colour* — a
 * Magenta went from literally 0% of the frame to present — but the layer is
 * still mostly flat: every one of those props is a painted plane or a thin
 * post, and the reference build fills the same band with OBJECTS. Objects are
 * what put a hard silhouette against the sky and a dark mass against the road,
 * and those are the two things a quad cannot do.
 *
 * So this file is the object pass, and it is budgeted like one. The city is
 * already at 6-7M triangles, which means every prop here is priced in tens of
 * triangles, not hundreds, and pays for itself with silhouette rather than with
 * modelled detail. A car is a body, a cabin, four wheels and a glazing band:
 * about 70 triangles, and it reads as a car at 30 m. Modelling a door handle on
 * top of that would spend 6 triangles on something that is sub-pixel at every
 * distance the camera is ever at.
 *
 * Nothing here is placed. Placement is the caller's job — these take a world
 * position, an along-street heading, and one deterministic 0..1 `r`, so a
 * placement pass can vary them per slot without the geometry holding any state
 * of its own.
 */

import { PAL } from "../engine/palette.js";
import { Facet } from "./buildings.js";

/* ------------------------------------------------------------------ *
 * Local helpers.
 *
 * Everything with an along-street heading needs to place a thin thing — a
 * glazing band, a shutter slat, a kerb-side face — along a direction that is
 * not an axis. `Facet.box` and `Facet.rbox` both give volume; these give the
 * flat panel that a volumed version would spend 10 triangles on for 2.
 * ------------------------------------------------------------------ */

/** Unit along the heading, and its left normal. */
function axes(yaw: number): [number, number, number, number] {
  return [Math.cos(yaw), Math.sin(yaw), -Math.sin(yaw), Math.cos(yaw)];
}

/**
 * A vertical panel of `half` length running along `yaw`, `off` metres to the
 * left of (x, z), between two heights.
 *
 * `quadY` is flat-shaded as a single brightness, so the face direction decides
 * whether the thing is lit or in shadow — hence taking `k` rather than deriving
 * it.
 */
function qalong(
  out: Facet, x: number, z: number, yaw: number,
  half: number, off: number, y0: number, y1: number,
  hex: number, k: number, flip = false,
): void {
  const [ax, az, nx, nz] = axes(yaw);
  const px = x + nx * off, pz = z + nz * off;
  out.quadY(px - ax * half, pz - az * half, px + ax * half, pz + az * half, y0, y1, hex, k, flip);
}

/**
 * A flat panel spanning `depth` metres outward from (x, z) at height `y`,
 * running `half` metres along `yaw`. `pitch` drops it by that many metres per
 * metre of depth, which is what turns a slab into a sloping canvas.
 */
function qflat(
  out: Facet, x: number, z: number, yaw: number,
  half: number, off: number, depth: number, y: number, pitch: number,
  hex: number, k: number,
): void {
  const [ax, az, nx, nz] = axes(yaw);
  const o0 = off, o1 = off + depth;
  const x0 = x + nx * o0, z0 = z + nz * o0;
  const x1 = x + nx * o1, z1 = z + nz * o1;
  const y0 = y - o0 * pitch, y1 = y - o1 * pitch;
  const ax0 = x0 - ax * half, az0 = z0 - az * half;
  const bx0 = x0 + ax * half, bz0 = z0 + az * half;
  const ax1 = x1 - ax * half, az1 = z1 - az * half;
  const bx1 = x1 + ax * half, bz1 = z1 + az * half;
  out.tri(ax0, y0, az0, bx0, y0, bz0, bx1, y1, bz1, hex, k);
  out.tri(ax0, y0, az0, bx1, y1, bz1, ax1, y1, az1, hex, k);
}

/* ------------------------------------------------------------------ *
 * Vehicles.
 * ------------------------------------------------------------------ */

/**
 * A parked car.
 *
 * Two volumes and four wheels, plus a glazing band and a livery band. The
 * livery band is the point of the whole prop: an unbroken field of one colour
 * in a street of parked cars reads as a row of shipping crates, and the
 * black-and-yellow banding is what the reference does with the half of its
 * vehicles.
 */
export function parkedCar(out: Facet, x: number, z: number, yaw: number, r: number): void {
  // Livery first, because on a taxi it is the body's own colour and on a white
  // car it is a stripe; the split at 0.55 is roughly the real proportion of
  // black-and-yellow taxis in a Mumbai street scene.
  const taxi = r < 0.55;
  const body = taxi ? PAL.taxiYellow : PAL.carWhite;
  const band = taxi ? PAL.taxiBlack : PAL.taxiYellow;

  // lower body: 4.3 x 1.7 m, sitting so its floor is just under the wheel
  // centres — a box that reaches the ground reads as a slab, because the
  // shadow it implies has no gap under it.
  out.rbox(x, 0.62, z, 2.15, 0.30, 0.85, body, 1.0, yaw);
  // cabin, set back and narrower: the taper is the whole car silhouette
  out.rbox(x - 0.1 * Math.cos(yaw), 1.16, z - 0.1 * Math.sin(yaw), 1.20, 0.30, 0.74, body, 1.04, yaw);

  // glazing: one band per side, sitting proud of the cabin so it is not z-fought
  qalong(out, x - 0.1 * Math.cos(yaw), z - 0.1 * Math.sin(yaw), yaw, 1.05, 0.75, 0.98, 1.36, PAL.glassDark, 1.0);
  qalong(out, x - 0.1 * Math.cos(yaw), z - 0.1 * Math.sin(yaw), yaw, 1.05, -0.75, 0.98, 1.36, PAL.glassTint, 0.9);

  // livery: a waist stripe, the cheapest thing that stops one colour filling
  // 4.3 m of frame
  qalong(out, x, z, yaw, 2.13, 0.86, 0.55, 0.72, band, taxi ? 1.12 : 1.16);
  qalong(out, x, z, yaw, 2.13, -0.86, 0.55, 0.72, band, taxi ? 0.9 : 0.94);

  // four wheels. Boxes, not cylinders: at 0.33 m radius a cylinder's extra 20
  // triangles are sub-pixel from any distance the camera stands at, and the
  // dark disc they buy is the same dark disc either way.
  const wy = 0.33, wr = 0.33, ww = 0.15;
  for (const fx of [-1.35, 1.35]) {
    for (const fz of [-1, 1]) {
      out.rbox(
        x + fx * Math.cos(yaw) + fz * 0.83 * -Math.sin(yaw),
        wy,
        z + fx * Math.sin(yaw) + fz * 0.83 * Math.cos(yaw),
        wr, wy, ww, PAL.kerbDark, 0.92, yaw,
      );
    }
  }
}

/** A scooter or motorbike — two wheels, a frame, a seat, bars. */
export function bike(out: Facet, x: number, z: number, yaw: number, r: number): void {
  const paint = r < 0.34 ? PAL.signRed : r < 0.67 ? PAL.signBlue : PAL.signGreen;
  // wheels first so the frame reads over them
  for (const fx of [-0.62, 0.62]) {
    out.rbox(
      x + fx * Math.cos(yaw), 0.28, z + fx * Math.sin(yaw),
      0.28, 0.28, 0.07, PAL.kerbDark, 0.95, yaw,
    );
  }
  // frame / tank, thin and long — 1.8 m end to end is the real wheelbase ratio
  out.rbox(x, 0.52, z, 0.68, 0.16, 0.16, paint, 1.05, yaw);
  // seat, higher and behind the bars
  out.rbox(x - 0.34 * Math.cos(yaw), 0.74, z - 0.34 * Math.sin(yaw), 0.3, 0.06, 0.18, PAL.kerbDark, 1.0, yaw);
  // handlebars: a cross-bar is what says "handlebars" and costs 10 triangles
  out.rbox(x + 0.6 * Math.cos(yaw), 0.98, z + 0.6 * Math.sin(yaw), 0.06, 0.06, 0.34, PAL.steel, 1.05, yaw);
  // a pale headlamp disc, because a bike with no bright point disappears
  out.rbox(x + 0.78 * Math.cos(yaw), 0.86, z + 0.78 * Math.sin(yaw), 0.08, 0.08, 0.12, PAL.signWhite, 1.2, yaw);
}

/**
 * An auto-rickshaw.
 *
 * The icon, so the silhouette gets the budget: a long low nose, a single tall
 * boxy cabin, and a roof that steps inward as it rises. Real autos have a
 * rounded canopy; a step is the cheapest approximation that still reads as
 * domed at 30 m, and three narrowing slabs are 30 triangles against the ~90 a
 * real revolve would cost.
 */
export function autoRickshaw(out: Facet, x: number, z: number, yaw: number, r: number): void {
  const [c, s] = axes(yaw);
  const along = (d: number) => [x + c * d, z + s * d] as const;
  const roofHue = r < 0.5 ? PAL.autoYellow : PAL.autoRed;

  // nose / engine cowl, tapering forward and lower than the cabin
  const [nx0, nz0] = along(-1.28);
  out.rbox(nx0, 0.62, nz0, 0.62, 0.34, 0.62, roofHue, 1.0, yaw);
  // the yellow lower skirt is the auto's signature: black above, yellow below
  out.rbox(x, 0.3, z, 1.3, 0.2, 0.66, PAL.autoYellow, 1.06, yaw);

  // cabin: one wheel forward, so the cabin sits aft of centre and the nose
  // sticks out past it — that overhang is what makes an auto an auto and not a
  // small van
  const [cx0, cz0] = along(0.18);
  out.rbox(cx0, 1.06, cz0, 0.78, 0.52, 0.66, PAL.taxiBlack, 1.0, yaw);
  // glazing across the open front
  qalong(out, x, z, yaw, 0.62, 0.6, 1.0, 1.46, PAL.glassDark, 1.0);

  // canopy in three shrinking steps
  out.rbox(cx0, 1.72, cz0, 0.8, 0.14, 0.68, roofHue, 1.08, yaw);
  out.rbox(cx0, 1.96, cz0, 0.66, 0.12, 0.56, roofHue, 1.12, yaw);
  out.rbox(cx0, 2.14, cz0, 0.46, 0.08, 0.4, PAL.taxiBlack, 1.06, yaw);

  // three wheels: one at the nose, two under the cabin
  for (const [d, lat] of [[-1.1, 0], [0.62, -0.6], [0.62, 0.6]] as const) {
    const [wx, wz] = along(d);
    out.rbox(
      wx + lat * -s, 0.3, wz + lat * c,
      0.3, 0.3, lat ? 0.13 : 0.1, PAL.kerbDark, 0.92, yaw,
    );
  }
}

/* ------------------------------------------------------------------ *
 * People.
 * ------------------------------------------------------------------ */

/**
 * A person.
 *
 * Proportion is doing all the work here, and it is the whole reason a person is
 * in the frame: a human silhouette is the one shape the eye has a built-in
 * scale for, so a street with people in it reads as a street people walk down
 * rather than a model of one. Three stacked volumes plus a head gets that
 * scale; a face gets nothing at any distance the camera is at.
 *
 * Silhouette varies by dress rather than by face: a saree is a long unbroken
 * column to the ankle, a kurta is a column to mid-thigh with legs showing, a
 * shirt is a shorter box with two clear legs. Those are three different
 * outlines, which is what the reference gets from people and what a single
 * capsule cannot.
 */
export function pedestrian(out: Facet, x: number, z: number, yaw: number, r: number): void {
  const [c, s] = axes(yaw);
  const at = (d: number, lat: number): [number, number] => [x + c * d - s * lat, z + s * d + c * lat];
  const dress = r < 0.42 ? "sari" : r < 0.72 ? "kurta" : "shirt";
  const cloth = dress === "sari"
    ? (r < 0.21 ? PAL.sari : r < 0.31 ? PAL.sariAlt : PAL.sariWarm)
    : dress === "kurta" ? PAL.kurta : PAL.shirt;

  // legs. A saree has none below the knee — that is the silhouette, so the
  // column runs to the ground instead and the legs are skipped entirely.
  if (dress !== "sari") {
    for (const lat of [-0.11, 0.11]) {
      const [lx, lz] = at(0, lat);
      out.rbox(lx, 0.4, lz, 0.09, 0.4, 0.09, PAL.trousers, 0.95, yaw);
    }
  }
  // torso / column. Saree is a full-height cone of cloth, which is also the
  // most saturated colour the palette has — deliberately, per PAL's own note.
  const bodyH = dress === "sari" ? 0.72 : 0.28;
  const bodyY = dress === "sari" ? 0.72 : 1.02;
  const [tx, tz] = at(0, 0);
  out.rbox(tx, bodyY, tz, dress === "shirt" ? 0.2 : 0.17, bodyH, dress === "sari" ? 0.22 : 0.14, cloth, 1.04, yaw);
  // a saree's shoulder drape, one panel offset so it is not one flat prism
  if (dress === "sari") out.rbox(tx - c * 0.1, 1.16, tz - s * 0.1, 0.16, 0.12, 0.24, cloth, 1.14, yaw);

  // neck + head
  const [hx, hz] = at(0, 0);
  out.rbox(hx, 1.42, hz, 0.06, 0.05, 0.06, PAL.skinDeep, 1.0, yaw);
  out.rbox(hx, 1.56, hz, 0.11, 0.13, 0.11, r < 0.5 ? PAL.skin : PAL.skinDeep, 1.06, yaw);
  // hair, as a cap box rather than geometry — a dark top half is all that reads
  out.rbox(hx, 1.66, hz, 0.115, 0.05, 0.115, PAL.hair, 1.0, yaw);

  // umbrella, monsoon. A low cone approximated by two slabs plus a shaft; the
  // bright disc under it is what actually reads at distance, not the ribs.
  if (r > 0.86) {
    const [ux, uz] = at(0.04, 0);
    out.rbox(ux, 1.2, uz, 0.03, 0.5, 0.03, PAL.steel, 1.0, yaw);
    out.rbox(ux, 1.74, uz, 0.46, 0.05, 0.46, dress === "sari" ? PAL.signRed : PAL.signBlue, 1.12, yaw);
    out.rbox(ux, 1.83, uz, 0.3, 0.05, 0.3, PAL.signWhite, 1.16, yaw);
  }
}

/* ------------------------------------------------------------------ *
 * Furniture.
 * ------------------------------------------------------------------ */

/** A public bench: seat slats, cast legs, backrest. */
export function bench(out: Facet, x: number, z: number, yaw: number, r: number): void {
  const wood = r < 0.5 ? PAL.timber : PAL.brick;
  // two cast ends, which is what a Mumbai municipal bench actually is
  for (const d of [-0.75, 0.75]) {
    const [lx, lz] = [x + Math.cos(yaw) * d, z + Math.sin(yaw) * d];
    out.rbox(lx, 0.21, lz, 0.07, 0.21, 0.26, PAL.kerbDark, 1.0, yaw);
  }
  // seat: three slats with gaps, because a single slab reads as a step
  for (let i = 0; i < 3; i++) {
    const off = -0.22 + i * 0.22;
    qalong(out, x, z, yaw, 0.9, off, 0.42, 0.48, wood, 1.06 + i * 0.04);
  }
  // backrest slats
  for (let i = 0; i < 2; i++) {
    qalong(out, x, z, yaw, 0.9, -0.26, 0.6 + i * 0.16, 0.7 + i * 0.16, wood, 1.0 - i * 0.06, true);
  }
  // back posts
  for (const d of [-0.82, 0.82]) {
    out.rbox(x + Math.cos(yaw) * d, 0.5, z + Math.sin(yaw) * d, 0.06, 0.3, 0.06, PAL.kerbDark, 1.0, yaw);
  }
}

/**
 * A kerb bollard, banded.
 *
 * ~28 triangles for an object the eye uses as a depth cue, which is the best
 * ratio in this file. The banding is not decoration: an unbanded post at 40 m
 * is one dark pixel against one dark road, and the band is what separates the
 * pavement from the carriageway at exactly that distance.
 */
export function bollard(out: Facet, x: number, z: number, r: number): void {
  out.box(x, 0.45, z, 0.09, 0.45, 0.09, PAL.kerbDark, 1.0);
  const bandHex = r < 0.5 ? PAL.kerbPaint : PAL.signWhite;
  qalong(out, x, z, 0, 0.095, 0.095, 0.55, 0.7, bandHex, 1.1);
  qalong(out, x, z, 0, 0.095, -0.095, 0.55, 0.7, bandHex, 0.9);
  qalong(out, x, z, Math.PI / 2, 0.095, 0.095, 0.55, 0.7, bandHex, 0.98);
  qalong(out, x, z, Math.PI / 2, 0.095, -0.095, 0.55, 0.7, bandHex, 0.82);
  // a domed cap, one small box proud of the post
  out.box(x, 0.93, z, 0.1, 0.04, 0.1, PAL.kerbDark, 1.14);
}

/**
 * A low shrub or clipped hedge block.
 *
 * Genuinely missing from `street.ts`: `planter` gives topiary on a pot and
 * `tree` gives a 3.5 m canopy, and nothing covered the 0.8 m planting-bed case
 * that most of Fort's street edges are. Two offset masses rather than one,
 * because a single box hedge reads as a kerb stone and the offset is the
 * silhouette.
 */
export function shrub(out: Facet, x: number, z: number, r: number): void {
  const green = r < 0.4 ? PAL.hedge : r < 0.75 ? PAL.hedgeLight : PAL.hill;
  const s = 0.55 + r * 0.25;
  out.box(x, 0.4, z, s, 0.4, s * 0.9, green, 1.0);
  out.box(
    x + (r - 0.5) * 0.5, 0.72, z + (0.5 - r) * 0.4,
    s * 0.7, 0.14, s * 0.62, green, 1.12,
  );
  // a soil skirt at the base: it grounds the mass, and the dark contact is what
  // stops a hedge looking pasted onto the paving
  out.box(x, 0.06, z, s * 1.06, 0.06, s * 0.96, PAL.trunk, 0.9);
}

/**
 * A cloth awning over a shopfront.
 *
 * Angled to the facade it hangs from, sloping down and out over the footpath.
 * The pitch is the whole object — a flat panel at the same height is a shelf,
 * and it is the slope plus the pale valance that make it read as canvas. Two
 * arms carry it because an unsupported plane at 2.6 m is the one shape that
 * would look like a bug in a screenshot.
 */
export function awning(out: Facet, x: number, z: number, yaw: number, r: number): void {
  const canvasHue = r < 0.25 ? PAL.signRed : r < 0.5 ? PAL.signGreen : r < 0.75 ? PAL.signBlue : PAL.signAmber;
  const depth = 1.25, half = 1.5;
  const yWall = 2.75, yEdge = 2.32;
  const pitch = (yWall - yEdge) / depth;

  // the sloping deck in two runs — a steep drop off the wall, then a shallow
  // outer panel, which is the two-tier pitch real awnings are built with
  qflat(out, x, z, yaw, half, 0, depth * 0.65, yWall, pitch, canvasHue, 1.14);
  qflat(out, x, z, yaw, half, depth * 0.65, depth * 0.35, yWall - depth * 0.65 * pitch, 0.08, canvasHue, 1.04);
  // the outer lip, which is what gives the awning thickness from below
  qalong(out, x, z, yaw, half, depth, yEdge - 0.1, yEdge, canvasHue, 0.82);
  // a pale valance strip: the classic scalloped edge reduced to one bright band
  qalong(out, x, z, yaw, half, depth, yEdge - 0.34, yEdge - 0.1, PAL.signWhite, 1.16);
  // two arms back to the wall
  for (const d of [-1.32, 1.32]) {
    out.rbox(
      x + Math.cos(yaw) * d, (yWall + yEdge) / 2, z + Math.sin(yaw) * d,
      0.05, 0.05, depth * 0.6, PAL.steel, 1.0, yaw,
    );
  }
}

/**
 * A shuttered shopfront: a roller shutter with horizontal slats.
 *
 * Six slats, not twenty. At this distance a shutter is a value — a mid grey
 * field with a rhythm on it — and six bands put that rhythm in at 12 triangles.
 * The slats are what stop a closed shop reading as a black hole in the
 * frontage, which is what a plain dark panel always becomes.
 */
export function shutter(out: Facet, x: number, z: number, yaw: number, r: number): void {
  const hue = r < 0.5 ? PAL.steel : PAL.hedge;
  const half = 1.6, y0 = 0.25, y1 = 2.35;
  // the slatted field itself
  qalong(out, x, z, yaw, half, 0, y0, y1, hue, 0.95);
  const N = 6;
  for (let i = 0; i < N; i++) {
    const a = y0 + ((y1 - y0) * i) / N;
    const b = a + (y1 - y0) / N / 2;
    // alternate the two sides so the shutter has a lit face and a shadow face
    qalong(out, x, z, yaw, half, 0.03, a, b, i % 2 ? PAL.timber : hue, i % 2 ? 0.72 : 1.08, i % 2 === 0);
  }
  // a lintel / shutter box at the head, which is what closes the frontage
  qalong(out, x, z, yaw, half + 0.12, 0.12, y1, y1 + 0.24, PAL.concrete, 1.12);
  // and a dark reveal below, so the shutter is standing in a shop rather than
  // floating on the wall
  qalong(out, x, z, yaw, half, 0, 0.02, y0, PAL.kerbDark, 0.7);
}