/**
 * Dev-only harness for the geographic Greater Mumbai world.
 *
 * Two modes:
 *  - CREATIVE (default): free-fly. WASD to move, Space/Ctrl for up/down,
 *    Shift to sprint, drag to look. This exists so the city can be diagnosed
 *    and inspected from anywhere without fighting an orbit camera.
 *  - ORBIT: locked target with drag-orbit + wheel zoom, for framing a shot.
 *
 * Double-click toggles the mode. A diagnostic readout shows loaded chunks,
 * draw calls, triangles, live lon/lat and altitude, so a bad frame can be
 * traced to a tile. `__geo` exposes teleport/look/stop for automated QA.
 *
 * No React, Convex or HUD. Not part of the product build.
 */
import * as THREE from "three";
import { GeoCity } from "./GeoCity.js";
import { toWgs84, toLocal } from "./geo-constants.js";
import { buildSky, buildDistantHills } from "../engine/sky.js";
import { PAL } from "../engine/palette.js";

/** Named teleports: real Greater Mumbai places, for fast diagnosis. */
const PLACES: Record<string, [number, number]> = {
  fort: [72.8335, 19.0245],
  csmt: [72.8318, 18.9408],
  gateway: [72.8346, 18.9220],
  marine: [72.8222, 18.9304],
  worli: [72.8166, 19.0146],
  charni: [72.821, 19.052],
  bandra: [72.836, 19.059],
  vile: [72.833, 19.079],
  juhu: [72.798, 19.096],
  andheri: [72.846, 19.119],
  goregaon: [72.800, 19.160],
  malad: [72.840, 19.190],
  kandivali: [72.845, 19.207],
  borivali: [72.843, 19.229],
  dahisar: [72.840, 19.253],
  kurla: [72.885, 19.082],
  ghatkopar: [72.906, 19.088],
  mulund: [72.940, 19.060],
  powai: [72.910, 19.130],
  bhandup: [72.950, 19.145],
  vikhroli: [72.930, 19.105],
  thane: [72.972, 19.194],
  kanjurmarg: [72.878, 19.130],
  bkc: [72.838, 19.063],
};

const el = document.getElementById("geo");
if (el) {
  const canvas = document.createElement("canvas");
  canvas.style.display = "block";
  el.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(1);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PAL.skyHaze);
  scene.fog = new THREE.Fog(PAL.fog, 600, 3600);
  buildSky(scene, 3200);
  buildDistantHills(scene);

  const sun = new THREE.DirectionalLight(PAL.sun, 2.1);
  sun.position.set(-600, 700, 400);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -420; sc.right = 420; sc.top = 420; sc.bottom = -420; sc.near = 1; sc.far = 2200;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.4;
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight(PAL.skyHaze, PAL.shadowFill, 0.75));
  scene.add(new THREE.AmbientLight(PAL.fog, 0.28));

  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 1, 9000);

  const pos = new THREE.Vector3();
  let yaw = 0;
  let pitch = -0.35;
  let mode: "creative" | "orbit" = "creative";
  const target = new THREE.Vector3();
  let dist = 500;
  const speed = { base: 90, fast: 900 };

  const start = toLocal(72.8335, 19.0245);
  pos.set(start.x, 260, start.y + 500);
  target.set(start.x, 0, start.y);
  // face the city (toward -Z is toward the sea/fort from here)
  yaw = Math.PI;
  pitch = -0.42;

  const city = new GeoCity(scene, { loadRadius: 2 });
  city.ensureAround(start.x, start.y);

  const info = document.getElementById("info");
  const modeEl = document.getElementById("mode");
  const setInfo = (t: string) => { if (info) info.textContent = t; };
  const setMode = (t: string) => { if (modeEl) modeEl.textContent = t; };
  setMode("CREATIVE · dbl-click toggles orbit");

  const keys = new Set<string>();
  let dragging = false, lx = 0, ly = 0;
  canvas.addEventListener("mousedown", (e) => { dragging = true; lx = e.clientX; ly = e.clientY; });
  window.addEventListener("mouseup", () => (dragging = false));
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - lx, dy = e.clientY - ly;
    yaw -= dx * (mode === "creative" ? 0.004 : 0.005);
    pitch = Math.max(mode === "creative" ? -1.45 : -1.4, Math.min(mode === "creative" ? 1.45 : 0.2, pitch - dy * 0.004));
    lx = e.clientX; ly = e.clientY;
  });
  canvas.addEventListener("wheel", (e) => { dist = Math.max(30, Math.min(8000, dist * (e.deltaY > 0 ? 1.12 : 0.89))); });
  canvas.addEventListener("dblclick", () => {
    mode = mode === "creative" ? "orbit" : "creative";
    setMode(`${mode.toUpperCase()} · dbl-click toggles orbit`);
  });
  window.addEventListener("keydown", (e) => keys.add(e.code));
  window.addEventListener("keyup", (e) => keys.delete(e.code));
  window.addEventListener("resize", () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  function teleport(name: string): boolean {
    const p = PLACES[name.toLowerCase()];
    if (!p) return false;
    const l = toLocal(p[0], p[1]);
    target.set(l.x, 0, l.y);
    pos.set(l.x, 220, l.y + 320);
    yaw = Math.PI;
    pitch = -0.42;
    city.ensureAround(l.x, l.y);
    return true;
  }

  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  let last = performance.now();
  let raf = 0;
  let stopped = false;

  const handle = {
    city,
    camera,
    scene,
    target,
    pos,
    stop() { stopped = true; cancelAnimationFrame(raf); renderer.render(scene, camera); },
    teleport,
    place: teleport,
    setMode(m: "creative" | "orbit") { mode = m; setMode(m.toUpperCase()); },
    look(x: number, y: number, z: number) { pos.set(x, y, z); target.set(x, y - 100, z); },
    setLook(yawDeg: number, pitchDeg: number) { yaw = (yawDeg * Math.PI) / 180; pitch = (pitchDeg * Math.PI) / 180; },
  };

  function tick(): void {
    if (stopped) return;
    raf = requestAnimationFrame(tick);
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    const fast = keys.has("ShiftLeft") || keys.has("ShiftRight");
    const sp = (fast ? speed.fast : speed.base) * dt;

    if (mode === "creative") {
      fwd.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).normalize();
      right.set(Math.cos(yaw), 0, -Math.sin(yaw));
      if (keys.has("KeyW")) pos.addScaledVector(fwd, sp);
      if (keys.has("KeyS")) pos.addScaledVector(fwd, -sp);
      if (keys.has("KeyA")) pos.addScaledVector(right, -sp);
      if (keys.has("KeyD")) pos.addScaledVector(right, sp);
      if (keys.has("Space")) pos.y += sp;
      if (keys.has("ControlLeft") || keys.has("KeyC")) pos.y -= sp;
      camera.position.copy(pos);
      const look = pos.clone().addScaledVector(fwd, 300);
      camera.lookAt(look);
      target.set(pos.x, 0, pos.z);
      city.ensureAround(pos.x, pos.z);
    } else {
      fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
      right.set(Math.cos(yaw), 0, -Math.sin(yaw));
      if (keys.has("KeyW")) target.addScaledVector(fwd, sp);
      if (keys.has("KeyS")) target.addScaledVector(fwd, -sp);
      if (keys.has("KeyA")) target.addScaledVector(right, -sp);
      if (keys.has("KeyD")) target.addScaledVector(right, sp);
      if (keys.has("KeyQ")) target.y -= sp;
      if (keys.has("KeyE")) target.y += sp;
      const cp = Math.cos(pitch);
      camera.position.set(
        target.x + Math.sin(yaw) * cp * dist,
        target.y - Math.sin(pitch) * dist + 20,
        target.z + Math.cos(yaw) * cp * dist,
      );
      camera.lookAt(target);
      city.ensureAround(target.x, target.z);
    }

    const cx = mode === "creative" ? pos.x : target.x;
    const cz = mode === "creative" ? pos.z : target.z;
    sun.position.set(cx - 500, 620, cz + 360);
    sun.target.position.set(cx, 0, cz);
    sun.target.updateMatrixWorld();

    const w = toWgs84(cx, cz);
    const ri = renderer.info.render;
    setInfo(
      `chunks ${city.loadedChunks} · calls ${ri.calls} · tris ${(ri.triangles / 1000) | 0}k · ` +
        `${w.lat.toFixed(4)}N ${w.lon.toFixed(4)}E · alt ${(mode === "creative" ? pos.y : target.y).toFixed(0)}m`,
    );
    renderer.render(scene, camera);
  }
  tick();
  (window as unknown as { __geo: unknown }).__geo = handle;
  console.log("[geo] mounted — creative mode, dbl-click toggles orbit");
}
