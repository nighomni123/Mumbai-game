/**
 * Pointer-lock walker for flat ground.
 *
 * Written for this project rather than ported: the sakura-crossing original
 * is written against its planet projection (it calls `basisAt`/`positionAt` to
 * stand the camera on a sphere), and the planet is deliberately out of scope
 * for the district. The approach is the same — pointer-lock look, WASD
 * relative to camera yaw, AABB collision resolve, terrain height query — so
 * the upstream implementation can be swapped in later without touching callers.
 */
import * as THREE from 'three';
import { L, onPlatform } from './layout.js';
import { game } from './bridge.js';

const WALK = 2.2;
const RUN = 5.0;
const GRAVITY = 18;
const JUMP = 5.0;
const EYE = 1.70;
const CAM_DIST = 4.0;
const SENS = 0.0022;

/** Boxes the player cannot walk through, in world space. */
interface Box2 {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  top: number;
}

export class Player {
  readonly object = new THREE.Group();
  private pos = new THREE.Vector3();
  private vel = new THREE.Vector3();
  /**
   * Standing on the carriageway looking at the station building. Both QA
   * passes said the same thing: from the platform the frame has no subject —
   * a canopy, a train and a corridor. The building facade with its bilingual
   * fascia is the subject, and the carriageway is where a station is actually
   * approached from. The platform, the local and the footbridge all sit
   * behind and beside the camera, so this is the establishing shot.
   */
  private yaw = 0.30;
  private pitch = 0.06;
  private vy = 0;
  private grounded = true;
  private keys = new Set<string>();
  private dragging = false;
  private hadLock = false;
  private box: Box2[] = [];
  /** Colliders that move each frame (the local). Rewritten every frame. */
  private dyn: Box2[] = [];
  private lastLook = 0;
  private camera: THREE.PerspectiveCamera;
  private dom: HTMLElement;

  constructor(camera: THREE.PerspectiveCamera, dom: HTMLElement) {
    this.camera = camera;
    this.dom = dom;
    this.pos.set(L.spawn.x, L.platformH, L.spawn.z);
    this.buildStatic();
  }

  /**
   * Invisible walls: the four running lines are not walkable, and the station
   * building is solid. Without these the player walks into the ballast and
   * the camera ends up under the sleepers.
   */
  private buildStatic() {
    const half = L.halfX;
    for (const z of L.trackZ) {
      this.box.push({ x0: -half, x1: half, z0: z - 1.9, z1: z + 1.9, top: 0.5 });
    }
    // station building on the far road side
    this.box.push({ x0: -24, x1: 12, z0: L.footpathFar[0] - 6, z1: L.footpathFar[0], top: 9 });
  }

  /** Register a solid box (the player is kept on top of it when standing on it). */
  addBlock(b: Box2) {
    this.box.push(b);
  }

  /**
   * Set the solid volume of a MOVING object (the local). Called every frame
   * with the coach's current AABB. Without this the player walks straight
   * through the train and the camera ends up inside a coach.
   */
  setMoving(b: Box2 | null) {
    this.dyn.length = 0;
    if (b) this.dyn.push(b);
  }

  start = () => {
    game.playing = true;
    try {
      const p = this.dom.requestPointerLock() as unknown as Promise<void> | undefined;
      if (p && typeof p.catch === 'function') p.catch(() => undefined);
    } catch {
      /* pointer lock unavailable — drag-to-look still works */
    }
  };

  attach() {
    const el = this.dom;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        game.playing = false;
        if (document.pointerLockElement === el) document.exitPointerLock();
        return;
      }
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code) && game.playing) {
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
      // ignore the huge synthetic jump some browsers emit on lock acquisition
      if (now - this.lastLook < 8) return;
      this.lastLook = now;
      this.yaw -= mx * SENS;
      this.pitch = THREE.MathUtils.clamp(this.pitch + my * SENS, -0.45, 0.9);
    };
    const onMove = (e: MouseEvent) => {
      if (document.pointerLockElement === el || this.dragging) look(e.movementX, e.movementY);
    };
    const onDown = () => {
      if (game.playing && document.pointerLockElement !== el) this.dragging = true;
    };
    const onUp = () => (this.dragging = false);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    document.addEventListener('pointerlockchange', onLock);
    document.addEventListener('mousemove', onMove);
    el.addEventListener('mousedown', onDown);
    window.addEventListener('mouseup', onUp);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('pointerlockchange', onLock);
      document.removeEventListener('mousemove', onMove);
      el.removeEventListener('mousedown', onDown);
      window.removeEventListener('mouseup', onUp);
      game.start = null;
      game.playing = false;
    };
  }

  private resolve(p: THREE.Vector3) {
    for (const b of [...this.box, ...this.dyn]) {
      // only collide if the player's feet are below the block's top
      if (p.y > b.top - 0.05) continue;
      const dxL = p.x - b.x0;
      const dxR = b.x1 - p.x;
      const dzL = p.z - b.z0;
      const dzR = b.z1 - p.z;
      if (dxL > 0 && dxR > 0 && dzL > 0 && dzR > 0) {
        const m = Math.min(dxL, dxR, dzL, dzR);
        if (m === dxL) p.x = b.x0;
        else if (m === dxR) p.x = b.x1;
        else if (m === dzL) p.z = b.z0;
        else p.z = b.z1;
      }
    }
  }

  update(dt: number) {
    const k = this.keys;
    const fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const str = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);

    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const dir = new THREE.Vector3(-sin * fwd + cos * str, 0, -cos * fwd - sin * str);
    if (dir.lengthSq() > 1e-6) dir.normalize();

    const running = k.has('ShiftLeft') || k.has('ShiftRight');
    const target = game.playing ? (dir.lengthSq() > 1e-6 ? (running ? RUN : WALK) : 0) : 0;
    this.vel.lerp(dir.multiplyScalar(target), 1 - Math.exp(-11 * dt));

    this.pos.x = THREE.MathUtils.clamp(this.pos.x + this.vel.x * dt, -L.halfX - 20, L.halfX + 20);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z + this.vel.z * dt, L.road[0] - 4, L.buildingFar + 8);
    this.resolve(this.pos);

    // ground height: the island platform, everything else at rail level
    const ground = onPlatform(this.pos.x, this.pos.z) ? L.platformH : 0;
    if (game.playing && this.grounded && k.has('Space') && ground > 0) {
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

    // camera
    const cp = Math.cos(this.pitch);
    const cam = this.camera;
    cam.position.set(
      this.pos.x + Math.sin(this.yaw) * cp * CAM_DIST,
      this.pos.y + EYE + Math.sin(this.pitch) * CAM_DIST,
      this.pos.z + Math.cos(this.yaw) * cp * CAM_DIST,
    );
    if (cam.position.y < ground + 0.6) cam.position.y = ground + 0.6;
    cam.lookAt(this.pos.x, this.pos.y + EYE - 0.15, this.pos.z);

    this.object.position.copy(this.pos);

    // publish
    game.x = this.pos.x;
    game.y = this.pos.y;
    game.z = this.pos.z;
    game.heading = this.yaw;
    game.speed = Math.hypot(this.vel.x, this.vel.z);
    game.onPlatform = onPlatform(this.pos.x, this.pos.z);
  }
}
