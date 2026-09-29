/**
 * Mounts the Mumbai district into a container element.
 *
 * This is the imperative seam. React owns the page; this owns the canvas and
 * the render loop. Nothing here re-renders React — state crosses the boundary
 * through `bridge.ts`, which the HUD polls on requestAnimationFrame.
 */
import * as THREE from 'three';
import { PAL } from '../engine/palette.js';
import { Pipeline } from '../engine/post.js';
import { buildSky, buildDistantHills } from '../engine/sky.js';
import { setOutlineResolution } from '../engine/outline.js';
import { buildStation } from './station.js';
import { buildCity } from './city.js';
import { buildProps } from './props.js';
import { buildStationBuilding } from './building.js';
import { buildLife } from './life.js';
import { Player } from './player.js';
import { game } from './bridge.js';
import { L } from './layout.js';
import { stationAt, HOME_STATION } from './stations.js';

export function mount(container: HTMLElement): () => void {
  const canvas = document.createElement('canvas');
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.touchAction = 'none';
  container.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false, // FXAA in the pipeline handles this
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setClearColor(new THREE.Color(PAL.fog), 1);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(PAL.fog, 60, 340);

  const camera = new THREE.PerspectiveCamera(52, 1, 0.25, 900);
  camera.rotation.order = 'YXZ';
  camera.position.set(L.spawn.x + 8, L.platformH + 1.6, L.spawn.z + 8);

  /* ---- two-light anime setup: one warm key, one cool bounce, hemisphere */
  const sun = new THREE.DirectionalLight(PAL.sun, 2.3);
  sun.position.set(-60, 48, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -40;
  sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 40;
  sun.shadow.camera.bottom = -40;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 220;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.035;
  scene.add(sun, sun.target);

  const bounce = new THREE.DirectionalLight(PAL.bounce, 0.62);
  bounce.position.set(50, 20, -46);
  scene.add(bounce);
  // The ambient fill must be COOL. A warm fill (as this originally was)
  // lands warm grey in the shadows and the whole warm/cool split that makes
  // cel shading read collapses — forms flatten into smudges.
  scene.add(new THREE.HemisphereLight(PAL.skyHaze, PAL.ambient, 0.62));
  scene.add(new THREE.AmbientLight(PAL.shadowFill, 0.34));

  /* ---- world ---- */
  buildSky(scene, 700);
  buildDistantHills(scene);
  scene.add(buildStation());
  scene.add(buildCity());
  scene.add(buildProps());
  scene.add(buildStationBuilding());
  const life = buildLife();
  scene.add(life.group);

  const player = new Player(camera, canvas);
  const detach = player.attach();
  game.start = player.start;
  game.setFly = player.setFly;

  /* ---- post pipeline ---- */
  const pipeline = new Pipeline(renderer, scene, camera, { pixelBudget: 3.2e6 });

  const resize = () => {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    pipeline.setSize(w, h);
    setOutlineResolution(w, h);
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(container);

  /* ---- loop ---- */
  let raf = 0;
  let last = performance.now();
  let frames = 0;
  let fpsT = last;
  const clock = new THREE.Clock();

  const tick = () => {
    raf = requestAnimationFrame(tick);
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;

    life.update(clock.getElapsedTime(), dt);
    // The local is solid: feed its live AABB to the player so walking never
    // carries the camera inside a coach, and the default spawn view never
    // renders from inside the train.
    player.setMoving(life.trainBox());
    player.update(dt);

    // shadow camera follows the player so the map stays tight and crisp
    sun.position.set(game.x - 48, 44, game.z + 34);
    sun.target.position.set(game.x, 0, game.z);
    sun.target.updateMatrixWorld();

    // nearest station, for the HUD
    const near = stationAt(0);
    if (game.nearest !== near.code) {
      game.nearest = near.code;
      game.seq += 1;
      game.toast = {
        id: game.seq,
        title: `${near.latin}`,
        text: `${near.deva} · ${near.code} · ${
          near.terminus ? 'terminus' : 'Western line'
        }`,
      };
    }

    frames += 1;
    if (now - fpsT > 500) {
      game.fps = Math.round((frames * 1000) / (now - fpsT));
      frames = 0;
      fpsT = now;
    }

    pipeline.render();
  };
  game.ready = true;
  tick();

  /* ---- teardown ---- */
  return () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
    detach();
    pipeline.dispose();
    renderer.dispose();
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    canvas.remove();
  };
}

/** The station the district is built around, for the HUD and the assert script. */
export { HOME_STATION };
