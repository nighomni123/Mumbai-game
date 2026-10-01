/**
 * Runnable check for the admin-power (Minecraft-creative) flight, and for the
 * geo city's speed option, which scales the same three constants.
 *
 * Runs the real `Player` and `Walker` classes headlessly: a
 * `PerspectiveCamera` is pure maths in three.js, and `update()` only ever
 * touches the camera, the position and the key set, so no WebGL and no browser
 * are needed. `keys` is a plain private-in-TS-only field, so the check can hold
 * keys down directly instead of faking a DOM — which keeps the test on the
 * movement maths, the part that is actually easy to get wrong.
 *
 * Two `game` objects, deliberately: the authored station and the geographic
 * city each have their own bridge, so the walker section below asserts against
 * `geoGame` and cannot accidentally be satisfied by the station's state.
 *
 *   bun run check:fly
 */
import * as THREE from "three";
import { Player } from "../src/mumbai/player.ts";
import { game } from "../src/mumbai/bridge.ts";
import { L } from "../src/mumbai/layout.ts";
import { Walker } from "../src/geo/walker.ts";
import { game as geoGame } from "../src/geo/bridge.ts";
import { METRO_BOUNDS } from "../src/geo/geo-constants.ts";

const DT = 1 / 60;
let failed = 0;

function ok(name, cond, detail = "") {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** New player with the key set held down, stepped for `secs`. */
function rig() {
  game.playing = true;
  const p = new Player(
    new THREE.PerspectiveCamera(52, 1.6, 0.25, 900),
    /** @type {any} */ ({}),
  );
  const keys = p.keys; // TS `private` is erased at runtime
  const step = (secs) => {
    for (let i = 0; i < Math.round(secs / DT); i++) p.update(DT);
  };
  return { p, keys, step };
}

const set = (keys, ...codes) => {
  keys.clear();
  for (const c of codes) keys.add(c);
};

console.log("admin power — creative flight");

/* 1. the bridge actually reports the toggle */
{
  const { p } = rig();
  p.setFly(true);
  ok("setFly(true) publishes game.fly", game.fly === true);
  p.setFly(false);
  ok("setFly(false) publishes game.fly", game.fly === false);
  p.setFly(false);
  ok("setFly is idempotent", game.fly === false);
}

/* 2. no gravity: space climbs in a straight line, it does not jump */
{
  const { p, keys, step } = rig();
  p.setFly(true);
  const y0 = p.pos.y;
  set(keys, "Space");
  step(0.5);
  const climbed = p.pos.y - y0;
  ok(
    "space climbs while flying",
    climbed > 5,
    `rose ${climbed.toFixed(2)}m in 0.5s`,
  );
  ok(
    "climb is a constant FLY rate, not a jump arc",
    Math.abs(climbed - 12 * 0.5) < 0.05,
    `expected ${(12 * 0.5).toFixed(2)}m, got ${climbed.toFixed(2)}m`,
  );
  ok("game.y is published", Math.abs(game.y - p.pos.y) < 1e-6);
}

/* 3. shift descends, and a held key is never faster than the base rate */
{
  const { p, keys, step } = rig();
  p.setFly(true);
  p.pos.y = 40;
  set(keys, "ShiftLeft");
  const y0 = p.pos.y;
  step(0.5);
  const fell = y0 - p.pos.y;
  ok(
    "shift descends while flying",
    fell > 5,
    `fell ${fell.toFixed(2)}m in 0.5s`,
  );
  ok(
    "descent matches the climb rate",
    Math.abs(fell - 6) < 0.05,
    `got ${fell.toFixed(2)}m`,
  );
}

/* 4. the Minecraft rule that is easiest to get wrong: W follows the LOOK
      vector, so looking down flies you into the ground plane.

      Pitch convention in this rig: the camera rides at pos.y + EYE +
      sin(pitch)·CAM_DIST, so POSITIVE pitch puts the camera above the player
      and it looks DOWN. Mouse-look matches (movementY down raises pitch). */
{
  const { p, keys, step } = rig();
  const { camera } = p;
  set(keys); // no input, so the frame only re-rigs the camera
  p.pitch = 0.6;
  p.update(DT); // the camera only moves on an update
  ok(
    "convention: positive pitch puts the camera above the player",
    camera.position.y > p.pos.y,
  );
  p.pitch = -0.6;
  p.update(DT);
  ok(
    "convention: negative pitch puts the camera below",
    camera.position.y < p.pos.y,
  );
  p.pitch = 0;

  p.setFly(true);
  p.pos.y = 30;
  p.pitch = 0.6; // looking down
  const y0 = p.pos.y;
  set(keys, "KeyW");
  step(0.5);
  const d = p.pos.y - y0;
  ok("W while looking down descends", d < -1, `y moved ${d.toFixed(2)}m`);
  // forward unit vector is (-sin y·cos p, -sin p, -cos y·cos p); the vertical
  // share must be sin(0.6) of the 12 m/s, i.e. -3.388 m in half a second
  ok(
    "W vertical share is sin(pitch) of the speed",
    Math.abs(d + 12 * 0.5 * Math.sin(0.6)) < 0.05,
    `got ${d.toFixed(3)}m`,
  );

  p.pos.y = 30;
  p.pitch = -0.6; // looking up
  step(0.5);
  ok(
    "W while looking up climbs",
    p.pos.y - 30 > 1,
    `y moved ${(p.pos.y - 30).toFixed(2)}m`,
  );
}

/* 5. strafe stays level, whatever the pitch */
{
  const { p, keys, step } = rig();
  p.setFly(true);
  p.pos.y = 30;
  p.pitch = -1.2;
  set(keys, "KeyD");
  const flat = Math.hypot(p.pos.x, p.pos.z);
  step(0.5);
  ok(
    "strafe D does not change altitude",
    Math.abs(p.pos.y - 30) < 1e-6,
    `y moved to ${p.pos.y.toFixed(3)}`,
  );
  ok(
    "strafe D still moves horizontally",
    Math.hypot(p.pos.x, p.pos.z) - flat > 1,
    `moved ${(Math.hypot(p.pos.x, p.pos.z) - flat).toFixed(2)}m`,
  );
}

/* 6. no collision: parked inside the station-building collider, nothing pushes */
{
  const { p, keys, step } = rig();
  p.setFly(false);
  p.pos.set(-6, L.platformH, L.footpathFar[0] - 3); // inside the building box
  p.resolve(p.pos);
  const pushedOut = Math.abs(p.pos.z - (L.footpathFar[0] - 3)) > 0.01;
  ok("walking: the building collider does push the player", pushedOut);

  p.pos.set(-6, L.platformH, L.footpathFar[0] - 3);
  p.setFly(true);
  set(keys);
  step(1 / 30);
  ok(
    "flying: the same collider is ignored",
    Math.abs(p.pos.z - (L.footpathFar[0] - 3)) < 1e-9,
    `z drifted to ${p.pos.z.toFixed(3)}`,
  );
}

/* 7. no district clamps: fly far outside the walkable box and stay there */
{
  const { p, keys, step } = rig();
  p.setFly(true);
  set(keys, "KeyW");
  p.pitch = 0;
  step(20);
  const span = p.pos.length();
  ok(
    "flying escapes the walkable district",
    span > 100,
    `travelled ${span.toFixed(0)}m from the origin`,
  );
  ok(
    "published speed is the fly speed, not the walk speed",
    game.speed > 5,
    `speed ${game.speed}`,
  );
}

/* 8. dropping the power restores gravity and lands on whatever was below */
{
  // L.spawn is out on the carriageway (|z| = 20), so rail level is 0 there
  const { p, keys, step } = rig();
  p.setFly(true);
  p.pos.set(L.spawn.x, 30, L.spawn.z);
  p.setFly(false);
  set(keys);
  step(4);
  ok(
    "gravity returns when the power is dropped",
    Math.abs(p.pos.y) < 0.01,
    `y ${p.pos.y.toFixed(3)}`,
  );
  ok("lands at rail level off the platform", game.onPlatform === false);
  ok("grounded after landing", p.grounded === true);

  // and the platform itself, which is a metre up
  p.setFly(true);
  p.pos.set(0, L.platformH + 30, 0);
  p.setFly(false);
  step(4);
  ok(
    "lands on top of the platform",
    Math.abs(p.pos.y - L.platformH) < 0.01,
    `y ${p.pos.y.toFixed(3)}`,
  );
  ok("platform is reported", game.onPlatform === true);
}

/* 9. paused (esc) — the engine still runs, so it must not drift in flight */
{
  const { p, keys, step } = rig();
  p.setFly(true);
  game.playing = false;
  set(keys, "KeyW", "Space");
  const before = p.pos.clone();
  step(0.5);
  ok("no drift while paused", p.pos.distanceTo(before) < 1e-9);
  game.playing = true;
}

/* 10. the geo city's speed option: one multiplier over walk, run and fly */
console.log("speed option — geo walker");

/** A walker over a city stub offering only `wall`, a 1 m slab. */
function rigWalker(wall = null, speedMul = 3) {
  geoGame.playing = true;
  geoGame.speedMul = speedMul;
  const w = new Walker(
    new THREE.PerspectiveCamera(52, 1.6, 0.25, 900),
    /** @type {any} */ ({}),
    // forEachBuildingNear returns how many footprints it offered the callback;
    // the walker republishes that count as game.near. This stub offers the slab
    // unconditionally rather than range-testing it, which is stricter.
    /** @type {any} */ ({
      forEachBuildingNear: (_x, _z, _r, cb) => {
        if (!wall) return 0;
        cb({ r: wall });
        return 1;
      },
    }),
    METRO_BOUNDS,
  );
  const keys = w.keys; // TS `private` is erased at runtime
  const step = (secs) => {
    for (let i = 0; i < Math.round(secs / DT); i++) w.update(DT);
  };
  return { w, keys, step };
}

/** Walk forward for a second and report the speed the walker settled on. */
function walkSpeed(speedMul, extra = []) {
  const { keys, step } = rigWalker(null, speedMul);
  set(keys, "KeyW", ...extra);
  step(1);
  return geoGame.speed;
}

ok("default 3x makes a 2.2 m/s walk 6.6 m/s", Math.abs(walkSpeed(3) - 6.6) < 0.05,
  `settled at ${walkSpeed(3).toFixed(2)} m/s`);
ok("the slider reaches 1x, the real pace", Math.abs(walkSpeed(1) - 2.2) < 0.05,
  `${walkSpeed(1).toFixed(2)} m/s`);
ok("the slider reaches 10x", Math.abs(walkSpeed(10) - 22) < 0.1,
  `${walkSpeed(10).toFixed(2)} m/s`);
ok("a hand-set multiplier is clamped, not obeyed",
  Math.abs(walkSpeed(9999) - 22) < 0.1, `${walkSpeed(9999).toFixed(2)} m/s`);
ok("holding Z triples it again", Math.abs(walkSpeed(3, ["KeyZ"]) - 19.8) < 0.1,
  `${walkSpeed(3, ["KeyZ"]).toFixed(2)} m/s`);
ok("Z released is back to the slider's own speed",
  Math.abs(walkSpeed(3) - 6.6) < 0.05);

/* fly scales by the same multiplier, and by Z on top of it */
{
  const flySpeed = (mul, z) => {
    const { w, keys, step } = rigWalker(null, mul);
    w.setFly(true);
    set(keys, ...(z ? ["KeyW", "KeyZ"] : ["KeyW"]));
    const from = w.pos.clone();
    step(0.5);
    return w.pos.distanceTo(from) / 0.5;
  };
  ok("fly at the default 3x is 36 m/s", Math.abs(flySpeed(3, false) - 36) < 0.5,
    `${flySpeed(3, false).toFixed(1)} m/s`);
  ok("fly with Z held is 108 m/s", Math.abs(flySpeed(3, true) - 108) < 1,
    `${flySpeed(3, true).toFixed(1)} m/s`);
}

/* 11. the reason collision is substepped: at 30x one frame crosses a metre of
       wall, so a single resolve would put the player on the far side */
{
  // A 1 m slab across the path at z = 9.5..10.5, closed by repeating the first
  // point — the resolve tests r.length - 1 edges, so the repeat is what closes
  // the ring.
  const wall = [
    [-10, 10.5],
    [10, 10.5],
    [10, 9.5],
    [-10, 9.5],
    [-10, 10.5],
  ];
  const { w, keys, step } = rigWalker(wall, 10);
  w.placeAt(0, 30, 0); // yaw 0: W heads for -z, straight at the slab
  set(keys, "KeyW", "KeyZ");
  step(3);
  ok("the slab still stops a 66 m/s boosted walker", w.pos.z > 10.5,
    `stopped at z ${w.pos.z.toFixed(2)}, slab face at 10.5`);
  ok("and stops it clear, not merely not-inside", w.pos.z > 10.9,
    `z ${w.pos.z.toFixed(2)}, expected ~10.95`);
  ok("the slab was actually tested, not ignored", geoGame.near > 0,
    `${geoGame.near} footprints tested`);
}

console.log(failed ? `\n${failed} failing` : "\nall green");
process.exit(failed ? 1 : 0);
