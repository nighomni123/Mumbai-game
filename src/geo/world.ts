/**
 * The geographic world: a walkable, streamed, real Greater Mumbai, with the
 * whole of it on a map you can pull up over the top (P).
 *
 * This is the product mount for src/geo/. It owns the scene, the render loop
 * and the two modes; preview.ts is a thin dev wrapper over the same code, so
 * what the harness inspects and what ships cannot drift.
 *
 * The load order matters and is deliberate: landmask.json, water and citymap.json
 * are all small and all always wanted, so they load immediately and in parallel
 * with the first chunk stream. Everything else is chunk geometry, which arrives
 * only near the camera.
 *
 * Nothing here re-renders React. The HUD polls `game` (bridge.ts) on
 * requestAnimationFrame, which is the rule the authored world established.
 */

import * as THREE from "three";
import { buildSky, buildDistantHills } from "../engine/sky.js";
import { PAL } from "../engine/palette.js";
import { METRO_BOUNDS, toLocal } from "./geo-constants.js";
import { PLACES, PLACE_BY_NAME } from "./places.js";
import { GeoCity } from "./GeoCity.js";
import { Walker } from "./walker.js";
import {
  buildWater,
  loadWater,
  LandMask,
  LAND_MASK_PATH,
  type WaterData,
} from "./water.js";
import { loadCityMap, type CityMapData } from "./citymap.js";
import { MapOverlay } from "./map-overlay.js";
import { game, toast, type WorldMode } from "./bridge.js";

export interface CityHandle {
  teardown(): void;
  /** QA surface: drop the walker at a local-metre point, bypassing the walker. */
  teleport(x: number, z: number, heading?: number): void;
  /** QA surface: open the map view without synthesising a keypress. */
  openMap(): void;
  /**
   * QA surface: what is actually in the scene right now, with vertex counts.
   * This is the only way to tell "the land mesh is missing" from "the land mesh
   * is losing the depth test" — both look identical in a screenshot, and the
   * mirrored-Z bug that shipped once already was invisible to tsc and build.
   */
  inspect(): unknown;
}

export function mountCity(container: HTMLElement): CityHandle {
  container.style.position = "relative";
  container.style.overflow = "hidden";

  const canvas = document.createElement("canvas");
  canvas.style.display = "block";
  container.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(
    container.clientWidth || window.innerWidth,
    container.clientHeight || window.innerHeight,
  );
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

  // One shadow map that follows the camera. Not four cascades: this is a
  // cel-shaded city on a laptop GPU, and a single tight map around the player
  // is worth far more than distant detail nobody can see.
  const sun = new THREE.DirectionalLight(PAL.sun, 2.1);
  sun.position.set(-600, 700, 400);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -420;
  sc.right = 420;
  sc.top = 420;
  sc.bottom = -420;
  sc.near = 1;
  sc.far = 2200;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.4;
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight(PAL.skyHaze, PAL.shadowFill, 0.75));
  scene.add(new THREE.AmbientLight(PAL.fog, 0.28));

  const camera = new THREE.PerspectiveCamera(55, 1, 1, 9000);
  camera.position.set(0, EYE_HINT, 0);

  // Render distance is a function of altitude, not a setting. On foot the city
  // is tight; climbing opens it out; neither is more than 9 km. Measured before
  // the cap: 43 draw calls at Fort but a 224-deep build queue, because the
  // frustum alone reaches 9 km on a footpath and every chunk in it got built.
  const city = new GeoCity(scene, camera, {
    loadRadius: 2,
    maxDistance: WALK_DISTANCE,
  });
  const walker = new Walker(camera, canvas, city, METRO_BOUNDS);

  let water: WaterData | null = null;
  let mapData: CityMapData | null = null;
  let waterGroup: THREE.Group | null = null;
  let mapOverlay: MapOverlay | null = null;

  // --- land and water ------------------------------------------------------
  void loadWater(LAND_MASK_PATH).then((w) => {
    if (!w) return;
    water = w;
    waterGroup = buildWater(w);
    scene.add(waterGroup);
    walker.setSea(new LandMask(w));
    game.landKm2 = w.areaKm2;
    shareMap();
  });

  // --- map (for the HUD minimap and the /map page) -------------------------
  // Loaded in parallel with the water, because a map without the land mask is
  // just a grid of roads over blue, which is a lie about the harbour.
  void loadCityMap("citymap.json").then((m) => {
    mapData = m;
    shareMap();
  });
  const shareMap = () => {
    if (water) {
      game.map = { data: mapData, water };
      mapOverlay?.setMap(game.map);
    }
  };

  /**
   * Travel to a named place. The destination is a real coordinate and the
   * chunks around it stream in — the map is a way to choose a destination, not
   * to skip the journey, which is the whole premise of a 1:1 world that is not
   * also a 1:1 journey.
   */
  game.goTo = (name: string) => {
    const place = PLACE_BY_NAME.get(name.toLowerCase());
    if (!place) return;
    const l = toLocal(place.lon, place.lat);
    handle.teleport(l.x, l.y, faceNearestOther(place.name, l.x, l.y));
    setMapOverlay(null);
    toast(place.name, place.region);
  };

  // --- input --------------------------------------------------------------
  const detachWalker = walker.attach();
  game.start = () => {
    canvas.requestPointerLock();
  };

  /** P: the whole city, flat, on top of the world. */
  function setMapOverlay(next: MapOverlay | null): void {
    mapOverlay?.dispose();
    mapOverlay = next;
    game.mode = next ? "planet" : "world";
    if (document.pointerLockElement) document.exitPointerLock();
  }

  function onPickPlace(name: string): void {
    game.goTo?.(name);
  }

  /** Face the nearest OTHER place, so arriving never means nose-first into a wall. */
  function faceNearestOther(self: string, x: number, z: number): number {
    let best = PLACES[0];
    let bd = Infinity;
    for (const p of PLACES) {
      if (p.name === self) continue;
      const l = toLocal(p.lon, p.lat);
      const d = Math.hypot(l.x - x, l.y - z);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    const bl = toLocal(best.lon, best.lat);
    return Math.atan2(bl.x - x, bl.y - z);
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.code === "Escape" && game.mode === "planet") {
      setMapOverlay(null);
      return;
    }
    if (e.code !== "KeyP") return;
    if (game.mode === "planet") {
      setMapOverlay(null);
      return;
    }
    const overlay = new MapOverlay(container, onPickPlace);
    overlay.setMap(game.map);
    setMapOverlay(overlay);
  };
  window.addEventListener("keydown", onKey);

  // --- loop ---------------------------------------------------------------
  let raf = 0;
  let last = performance.now();
  let frames = 0;
  let fpsAcc = 0;
  let stopped = false;

  const resize = () => {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    renderer.setSize(w, h, true);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener("resize", resize);
  resize();

  /**
   * The adaptive guard. Invisible by construction: it only ever spends pixels,
   * never detail the player asked for, and it recovers on its own.
   *
   * Resolution first, because it is the cheapest thing to give and the least
   * noticeable. Stepped rather than continuous so it cannot oscillate: at a
   * 0.1 step a moving camera hunts forever and never settles.
   */
  let ratio = Math.min(window.devicePixelRatio || 1, 1.5);
  let settleFor = 0;
  function guard(): void {
    if (game.fps < 40 && ratio > 0.75) {
      ratio = Math.max(0.75, ratio - 0.25);
      renderer.setPixelRatio(ratio);
      settleFor = 0;
    } else if (game.fps > 58) {
      if (
        ++settleFor >= 4 &&
        ratio < Math.min(window.devicePixelRatio || 1, 1.5)
      ) {
        ratio = Math.min(
          Math.min(window.devicePixelRatio || 1, 1.5),
          ratio + 0.25,
        );
        renderer.setPixelRatio(ratio);
        settleFor = 0;
      }
    } else {
      settleFor = 0;
    }
  }

  function tick(): void {
    if (stopped) return;
    raf = requestAnimationFrame(tick);
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    if (game.mode === "planet") {
      // The map is a flat overlay, so the world behind it is frozen: no chunk
      // streaming, no sun chase, no build queue. Pressing P costs nothing.
      mapOverlay?.tick();
    } else {
      scene.fog = new THREE.Fog(PAL.fog, 600, 3600);
      sun.castShadow = true;
      walker.update(dt);
      const cx = game.x;
      const cz = game.z;

      // Render distance follows altitude. Hysteresis on the way back down
      // matters: without it, every frame at the threshold re-evaluates the
      // whole ring and the resident set chatters.
      const alt = Math.max(0, game.y - EYE_HINT);
      const want =
        alt < 30
          ? WALK_DISTANCE
          : Math.min(CLIMB_HEADROOM, WALK_DISTANCE + alt * 2.2);
      const drift = want > city.renderDistance ? 0 : -250;
      city.setMaxDistance(
        city.renderDistance + drift + (want > city.renderDistance ? 250 : 0),
      );

      sun.position.set(cx - 500, 620, cz + 360);
      sun.target.position.set(cx, 0, cz);
      sun.target.updateMatrixWorld();
      // Only the near ring casts. A shadow map that re-renders every resident
      // chunk every frame is a second full geometry pass for shadows nobody at
      // this distance can resolve.
      city.setShadowDistance(WALK_DISTANCE);
      city.ensureAround(cx, cz);
      // A bigger slice when there is a backlog: 4 ms/frame can never catch up
      // after a teleport, and the player is looking at holes.
      city.drain(city.pendingBuilds > 6 ? 10 : 4);
    }

    frames++;
    fpsAcc += dt;
    if (fpsAcc >= 0.5) {
      game.fps = Math.round(frames / fpsAcc);
      frames = 0;
      fpsAcc = 0;
      guard();
    }

    const ri = renderer.info.render;
    game.chunks = city.loadedChunks;
    game.renderDistance = city.renderDistance;
    game.pending = city.pendingBuilds;
    game.calls = ri.calls;
    game.triangles = ri.triangles;
    game.ready = true;

    renderer.render(scene, camera);
  }
  tick();

  const handle: CityHandle = {
    teleport(x, z, heading = Math.PI) {
      walker.placeAt(x, z, heading);
      city.ensureAround(x, z);
    },
    openMap: () => {
      const overlay = new MapOverlay(container, onPickPlace);
      overlay.setMap(game.map);
      setMapOverlay(overlay);
    },
    inspect() {
      const mesh = (o: THREE.Object3D) => {
        const m = o as THREE.Mesh;
        return {
          name: o.name,
          visible: o.visible,
          verts: m.geometry?.attributes?.position?.count ?? 0,
          instances: (o as THREE.InstancedMesh).count ?? 0,
        };
      };
      return {
        cityVisible: city.group.visible,
        waterVisible: waterGroup?.visible ?? null,
        cityChunks: city.loadedChunks,
        waterChildren: waterGroup ? waterGroup.children.map(mesh) : null,
        renderDistance: Math.round(city.renderDistance),
        queued: city.pendingBuilds,
        pixelRatio: renderer.getPixelRatio(),
      };
    },
    teardown() {
      stopped = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", onKey);
      detachWalker();
      city.dispose();
      mapOverlay?.dispose();
      waterGroup?.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry?.dispose();
          const mat = m.material;
          if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
          else mat?.dispose();
        }
      });
      renderer.dispose();
      canvas.remove();
    },
  };

  // Dev-only: the live harness reads the same bridge the HUD reads, and this
  // handle for anything that has to poke the world itself. Stripped from the build.
  if (import.meta.env.DEV) {
    (window as unknown as { __geo: CityHandle }).__geo = handle;
  }
  return handle;
}

const EYE_HINT = 1.7;

/**
 * Render distance by altitude. On foot you can see a street, not a suburb; at
 * 2 km up you can see most of one. The point is that the cost of the world
 * tracks what the frame can actually show.
 */
const WALK_DISTANCE = 2600;
const CLIMB_HEADROOM = 6000;

export type { WaterData, WorldMode };
