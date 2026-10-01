/**
 * The walker: standing in real Greater Mumbai on the ground.
 *
 * This is a deliberate port of src/mumbai/player.ts, not a second controller.
 * The movement constants are the same — WALK 2.2, RUN 5.0, GRAVITY 18,
 * JUMP 5.0, EYE 1.70, CAM_DIST 4.0, FLY 12, SENS 0.0022 — so the authored
 * station and the real city feel like one product. Three things changed:
 *
 *   1. the collider source. The station has a hand-authored box list; this one
 *      collides against the real OSM footprint rings in the resident chunks.
 *   2. there is no district clamp and no rail-level ground. You are somewhere
 *      in 67 x 81 km, so the bounds are the metro's and the floor is flat.
 *   3. walk/run/fly are all multiplied by `game.speedMul`, the HUD slider's
 *      value, and by BOOST while Z is held. A 67 x 81 km city at 2.2 m/s is a
 *      commute simulator; this is the one place the two worlds deliberately
 *      stop matching, because the distances do not.
 *
 * Unify the two only when the authored station is retired; until then a shared
 * file would import both worlds' data and neither would want it.
 *
 * COLLISION IS EXACT, NOT AABB. Local streets here are 7 m kerb to kerb
 * (ROAD_HALF_WIDTH in GeoCity.ts), and Mumbai's footprints are concave often
 * enough that an AABB per building puts an invisible wall down the middle of
 * the road. The test is distance-to-nearest-ring-edge, and the resolve pushes
 * the player to R clear of that edge — which is the shortest exit whether they
 * are inside the building or outside it, so no point-in-polygon test is needed.
 */

import * as THREE from "three";
import { game, SPEED_MIN, SPEED_MAX } from "./bridge.js";
import { PLACES } from "./places.js";
import { toLocal } from "./geo-constants.js";
import type { GeoCity } from "./GeoCity.js";
import { LandMask } from "./water.js";

const WALK = 2.2;
const RUN = 5.0;
const GRAVITY = 18;
const JUMP = 5.0;
const EYE = 1.7;
const CAM_DIST = 4.0;
const SENS = 0.0022;
/** Creative flight speed, m/s — same as every direction, as in Minecraft. */
const FLY = 12;
/** Hold-to-boost on top of the HUD slider, for crossing the metro in one go. */
const BOOST = 3;
const DOUBLE_TAP = 280;
/** Player radius, and how far ahead of the feet a footprint is tested. */
const RADIUS = 0.45;

/** Squared distance from (px,pz) to segment (ax,az)-(bx,bz), plus the closest point. */
function segDist(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  out: { x: number; z: number },
) {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 1e-12 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  out.x = ax + dx * t;
  out.z = az + dz * t;
  return (px - out.x) ** 2 + (pz - out.z) ** 2;
}

export class Walker {
  readonly object = new THREE.Group();
  readonly pos = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private vy = 0;
  private grounded = true;
  private fly = false;
  private yaw = 0;
  private pitch = 0.05;
  private lastTap = 0;
  private keys = new Set<string>();
  private dragging = false;
  private hadLock = false;
  private lastLook = 0;
  private camera: THREE.PerspectiveCamera;
  private dom: HTMLElement;
  private city: GeoCity;
  /** Null until water.json loads; the walker still works, it just cannot say. */
  private sea: LandMask | null = null;
  /** Metro bounds; the walker is kept inside them so you cannot walk to nowhere. */
  private bounds: { x0: number; x1: number; y0: number; y1: number };
  /** Local-metre coordinates of the named places, for the nearest-place readout. */
  private locals: [string, number, number][] = [];
  /** Bring the sea test online once water.json has loaded. */
  setSea(sea: LandMask | null): void {
    this.sea = sea;
  }

  /** scratch: no per-frame allocation in the collision resolve */
  private near = { x: 0, z: 0 };

  constructor(
    camera: THREE.PerspectiveCamera,
    dom: HTMLElement,
    city: GeoCity,
    bounds: Walker["bounds"],
  ) {
    this.camera = camera;
    this.dom = dom;
    this.city = city;
    this.bounds = bounds;
    this.locals = PLACES.map((p) => {
      const l = toLocal(p.lon, p.lat);
      return [p.name, l.x, l.y] as [string, number, number];
    });
    const start = this.locals.find(([n]) => n === "fort") ?? this.locals[0];
    this.pos.set(start[1], 0, start[2]);
    this.yaw = Math.PI; // look south, down the length of the peninsula
    game.x = this.pos.x;
    game.y = 0;
    game.z = this.pos.z;
    game.setFly = (on) => this.setFly(on);
  }

  /** Drop the player at a place (used by the planet's district dive). */
  placeAt(x: number, z: number, heading = 0): void {
    this.pos.set(x, 0, z);
    this.vel.set(0, 0, 0);
    this.vy = 0;
    this.grounded = true;
    this.yaw = heading;
    this.pitch = 0.02;
  }

  setFly(on: boolean): void {
    if (on === this.fly) return;
    this.fly = on;
    this.vel.set(0, 0, 0);
    this.vy = 0;
    this.grounded = on;
    game.fly = on;
  }

  attach(): () => void {
    const el = this.dom;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Escape") {
        game.playing = false;
        if (document.pointerLockElement === el) document.exitPointerLock();
        return;
      }
      // Double-tap space is Minecraft's flight toggle, same as the station.
      if (e.code === "Space" && !e.repeat) {
        const t = performance.now();
        if (t - this.lastTap < DOUBLE_TAP) {
          this.lastTap = 0;
          this.setFly(!this.fly);
          return;
        }
        this.lastTap = t;
      }
      this.keys.add(e.code);
      if (
        ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(
          e.code,
        ) &&
        game.playing
      ) {
        e.preventDefault();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
    const onBlur = () => this.keys.clear();
    const onLock = () => {
      const locked = document.pointerLockElement === el;
      if (locked) {
        this.hadLock = true;
        game.playing = true;
      } else if (this.hadLock) {
        this.hadLock = false;
        game.playing = false;
        this.keys.clear();
      }
    };
    const look = (mx: number, my: number) => {
      if (!game.playing) return;
      const now = performance.now();
      if (now - this.lastLook < 8) return; // browsers emit a jump on lock
      this.lastLook = now;
      this.yaw -= mx * SENS;
      const lim = this.fly ? 1.5 : 0.9;
      this.pitch = THREE.MathUtils.clamp(
        this.pitch + my * SENS,
        this.fly ? -lim : -0.45,
        lim,
      );
    };
    const onMove = (e: MouseEvent) => {
      if (document.pointerLockElement === el || this.dragging)
        look(e.movementX, e.movementY);
    };
    const onDown = () => {
      if (game.playing && document.pointerLockElement !== el)
        this.dragging = true;
    };
    const onUp = () => (this.dragging = false);

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    document.addEventListener("pointerlockchange", onLock);
    document.addEventListener("mousemove", onMove);
    el.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("pointerlockchange", onLock);
      document.removeEventListener("mousemove", onMove);
      el.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
      game.start = null;
      game.setFly = null;
      game.playing = false;
    };
  }

  /**
   * Push the player clear of every real footprint within RADIUS.
   *
   * Two passes. The first resolves the common case — one wall — exactly; the
   * second settles the case where the player is wedged into a corner between
   * two buildings and the first push shoved them into the other. Three would
   * help in a tight alley and costs more than it is worth at 1.4 m/s.
   *
   * Returns how many footprints were tested, which is the collision's real cost.
   */
  private resolve(): number {
    let tested = 0;
    for (let pass = 0; pass < 2; pass++) {
      let moved = false;
      tested = this.city.forEachBuildingNear(
        this.pos.x,
        this.pos.z,
        RADIUS + 1.5,
        (b) => {
          const r = b.r;
          if (r.length < 3) return;
          let best = Infinity;
          for (let i = 0; i < r.length - 1; i++) {
            const d = segDist(
              this.pos.x,
              this.pos.z,
              r[i][0],
              r[i][1],
              r[i + 1][0],
              r[i + 1][1],
              this.near,
            );
            if (d < best) {
              best = d;
              this.bestX = this.near.x;
              this.bestZ = this.near.z;
            }
          }
          if (best >= RADIUS * RADIUS) return;
          // Shortest exit, inside or outside: step to R clear of the nearest edge.
          let dx = this.bestX - this.pos.x;
          let dz = this.bestZ - this.pos.z;
          const len = Math.hypot(dx, dz);
          if (len < 1e-6) {
            // Dead centre of a degenerate ring: push along +x deterministically.
            dx = 1;
            dz = 0;
          } else {
            dx /= len;
            dz /= len;
          }
          this.pos.x = this.bestX + dx * RADIUS;
          this.pos.z = this.bestZ + dz * RADIUS;
          moved = true;
        },
      );
      if (!moved) break;
    }
    return tested;
  }

  private bestX = 0;
  private bestZ = 0;

  update(dt: number): void {
    const k = this.keys;
    const fwd =
      (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) -
      (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0);
    const str =
      (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) -
      (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);

    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const running = k.has("ShiftLeft") || k.has("ShiftRight");
    const live = game.playing;
    let speed = 0;
    let near = 0;
    // Clamped at the read, not at the write: the slider is bounded, but this is
    // a plain mutable field and the dev harnesses set it directly.
    const mul =
      THREE.MathUtils.clamp(game.speedMul, SPEED_MIN, SPEED_MAX) *
      (k.has("KeyZ") ? BOOST : 1);

    if (this.fly) {
      const cp = Math.cos(this.pitch);
      const lift = (k.has("Space") ? 1 : 0) - (running ? 1 : 0);
      const dx = -sin * cp * fwd + cos * str;
      const dy = -Math.sin(this.pitch) * fwd + lift;
      const dz = -cos * cp * fwd - sin * str;
      const len = Math.hypot(dx, dy, dz);
      if (len > 1e-6) {
        speed = live ? FLY * mul : 0;
        this.pos.x += (dx / len) * speed * dt;
        this.pos.y += (dy / len) * speed * dt;
        this.pos.z += (dz / len) * speed * dt;
      }
      this.pos.y = Math.max(this.pos.y, 0.4);
    } else {
      const dir = this.scratch.set(
        -sin * fwd + cos * str,
        0,
        -cos * fwd - sin * str,
      );
      if (dir.lengthSq() > 1e-6) dir.normalize();
      const target = live
        ? dir.lengthSq() > 1e-6
          ? (running ? RUN : WALK) * mul
          : 0
        : 0;
      this.vel.lerp(dir.multiplyScalar(target), 1 - Math.exp(-11 * dt));

      // Collision resolves in steps no longer than RADIUS. A single resolve
      // per frame is only correct while one frame of travel is smaller than
      // the player, and at 10x with Z held that is 3.3 m against a 0.45 m body.
      // ponytail: 8 substeps, so the ceiling is 3.6 m of travel per frame and
      // tunnelling starts only past 30x at the 20 fps dt clamp. Past that the
      // fix is a swept test against the ring, not a bigger cap.
      const mx = this.vel.x * dt;
      const mz = this.vel.z * dt;
      const steps = Math.min(
        8,
        Math.max(1, Math.ceil(Math.hypot(mx, mz) / RADIUS)),
      );
      for (let i = 0; i < steps; i++) {
        this.pos.x += mx / steps;
        this.pos.z += mz / steps;
        // The metro is 67 x 81 km; clamp to it plus a margin rather than to a
        // hand-authored district.
        const m = 400;
        this.pos.x = THREE.MathUtils.clamp(
          this.pos.x,
          this.bounds.x0 - m,
          this.bounds.x1 + m,
        );
        this.pos.z = THREE.MathUtils.clamp(
          this.pos.z,
          this.bounds.y0 - m,
          this.bounds.y1 + m,
        );
        near = this.resolve();
      }

      // Ground is flat: there is no terrain yet, so y = 0 everywhere. ponytail:
      // the floor is a constant until SRTM terrain lands; the upgrade is a
      // height query here and nowhere else.
      const ground = 0;
      if (live && this.grounded && k.has("Space")) {
        this.vy = JUMP;
        this.grounded = false;
      }
      if (!this.grounded || this.pos.y > ground + 0.001) {
        this.vy -= GRAVITY * dt;
        this.pos.y += this.vy * dt;
        if (this.pos.y <= ground) {
          this.pos.y = ground;
          this.vy = 0;
          this.grounded = true;
        }
      } else {
        this.pos.y = ground;
        this.grounded = true;
      }
      speed = Math.hypot(this.vel.x, this.vel.z);
    }

    // camera
    const cp = Math.cos(this.pitch);
    const cam = this.camera;
    cam.position.set(
      this.pos.x + Math.sin(this.yaw) * cp * CAM_DIST,
      this.pos.y + EYE + Math.sin(this.pitch) * CAM_DIST,
      this.pos.z + Math.cos(this.yaw) * cp * CAM_DIST,
    );
    if (!this.fly && cam.position.y < 0.6) cam.position.y = 0.6;
    cam.lookAt(this.pos.x, this.pos.y + EYE - 0.15, this.pos.z);
    this.object.position.copy(this.pos);

    // publish
    game.x = this.pos.x;
    game.y = this.pos.y;
    game.z = this.pos.z;
    game.heading = this.yaw;
    game.speed = speed;
    game.near = near;
    game.atSea = this.sea ? this.sea.isSea(this.pos.x, this.pos.z) : false;
    this.publishNearest();
  }

  /** Nearest named place, for the HUD. 27 linear tests is not worth indexing. */
  private publishNearest(): void {
    let best = "";
    let bestD = Infinity;
    for (const [name, x, z] of this.locals) {
      const d = (x - this.pos.x) ** 2 + (z - this.pos.z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = name;
      }
    }
    game.nearest = best;
    game.nearestM = Math.sqrt(bestD);
  }

  private scratch = new THREE.Vector3();
}
