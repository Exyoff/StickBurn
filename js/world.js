// The garage: a two-car space, half of it lived in. Units: 1 = 10 cm.
// Floor plan origin is the back-left inside corner; +X is right, +Z is toward the garage door (front).
import * as THREE from '../vendor/three.module.min.js';
import { MAT, TEX, box, cyl } from './geo.js';
import { buildCar } from './car.js';

const M = (color, metalness, roughness, bump = 0) =>
  new THREE.MeshStandardMaterial({ color, metalness, roughness, ...(bump ? { bumpMap: TEX.fine, bumpScale: bump } : {}) });

export const ROOM = { w: 60, d: 87, h: 28 };
export const ENGINE_POS = new THREE.Vector3(10, 8.5, 21.5);
export const SHELF = { x0: 1.6, x1: 30.6, z: 4, levels: [4.2, 9.7, 15.2] };

function canvasTex(draw, rx, ry) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  draw(c.getContext('2d'));
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const speckle = (g, base, n) => {
  g.fillStyle = base; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < n; i++) {
    g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${Math.random() * 0.07})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 3, 1 + Math.random() * 3);
  }
};

export function buildWorld(scene) {
  const g = new THREE.Group();
  scene.add(g);
  const colliders = [], surfaces = [];
  const W = {
    wall: M(0x9f9b8f, 0, 0.95, 1.2), trim: M(0x6f6a60, 0, 0.9), wood: M(0x80603c, 0, 0.8, 0.8), board: M(0x9a7a50, 0, 0.85, 0.8),
    white: M(0xe9e6df, 0, 0.6), tile: M(0xcfd8dc, 0.1, 0.35), fabric: M(0x3d5a80, 0, 0.95), pillow: M(0xf2efe6, 0, 0.9),
    lamp: new THREE.MeshBasicMaterial({ color: 0xfff3d0 }), door: M(0x5b4632, 0, 0.7), garageDoor: M(0xd9d6cf, 0.3, 0.6),
  };
  const add = (m, cast = false) => { m.castShadow = cast; g.add(m); return m; };
  // Solid box from floor-plan extents; registers a collider when it reaches the floor.
  const solid = (x0, z0, x1, z1, y0, y1, mat, { collide = y0 < 12, surface = false, use } = {}) => {
    const m = add(box(x1 - x0, y1 - y0, z1 - z0, mat, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2));
    if (collide) colliders.push({ x0, x1, z0, z1 });
    if (surface) surfaces.push(m);
    if (use) m.userData.use = use;
    return m;
  };
  const { w, d, h } = ROOM;

  /* floors and ceiling */
  const concrete = canvasTex((c) => { speckle(c, '#77756f', 2600); c.strokeStyle = 'rgba(0,0,0,.25)'; c.lineWidth = 2; c.strokeRect(0, 0, 256, 256); }, 6, 9);
  const floor = add(new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ map: concrete, roughness: 0.95 })));
  floor.rotation.x = -Math.PI / 2; floor.position.set(w / 2, 0, d / 2); floor.receiveShadow = true;
  surfaces.push(floor);
  // laminate and tiles are thin slabs laid on the concrete, so no two floor surfaces share a plane
  const planks = canvasTex((c) => { speckle(c, '#8a6a46', 1200); c.fillStyle = 'rgba(0,0,0,.3)'; for (let i = 0; i < 8; i++) c.fillRect(i * 32, 0, 1.5, 256); }, 3, 6);
  const tiles = canvasTex((c) => { c.fillStyle = '#dfe6e8'; c.fillRect(0, 0, 256, 256); c.strokeStyle = '#9fb0b6'; c.lineWidth = 4; for (let i = 0; i <= 4; i++) { c.strokeRect(i * 64, 0, 0, 256); c.strokeRect(0, i * 64, 256, 0); } }, 3, 6);
  const lam = new THREE.MeshStandardMaterial({ map: planks, roughness: 0.8 }), til = new THREE.MeshStandardMaterial({ map: tiles, roughness: 0.4 });
  for (const [x0, z0, x1, z1, m] of [[33, 0, w, 40.5, lam], [33, 40.5, 47, 64.5, lam], [48, 41.5, w, 64.5, til]]) {
    const slab = add(box(x1 - x0, 0.15, z1 - z0, m, (x0 + x1) / 2, 0.075, (z0 + z1) / 2));
    slab.receiveShadow = true; surfaces.push(slab);
  }
  const ceil = add(new THREE.Mesh(new THREE.PlaneGeometry(w + 3, d + 3), M(0x8f8c84, 0, 1)));
  ceil.rotation.x = Math.PI / 2; ceil.position.set(w / 2, h, d / 2);

  /* outer walls */
  solid(-1.5, -1.5, w + 1.5, 0, 0, h, W.wall);
  solid(-1.5, 0, 0, d, 0, h, W.wall);
  solid(w, 0, w + 1.5, d, 0, h, W.wall);
  solid(-1.5, d, 3.5, d + 1.5, 0, h, W.wall);
  solid(56, d, w + 1.5, d + 1.5, 0, h, W.wall);
  solid(3.5, d, 56, d + 1.5, 22, h, W.wall, { collide: false });
  solid(3.5, d - 1.2, 56, d - 0.2, 22.2, 25.5, W.garageDoor, { collide: false });   // door rolled up
  colliders.push({ x0: 3.5, x1: 56, z0: d + 0.5, z1: d + 3 });                         // you stay in
  solid(w - 0.25, 71, w, 80, 0, 21, W.door, { collide: false, use: 'sidedoor' });
  add(cyl(0.35, 0.5, MAT.steel, 'x', w - 0.5, 10.5, 72.2, 10));

  /* interior walls */
  solid(32, 0, 33, 65.5, 0, h, W.wall);
  solid(33, 64.5, 36, 65.5, 0, h, W.wall);
  solid(45, 64.5, w, 65.5, 0, h, W.wall);
  solid(36, 64.5, 45, 65.5, 21, h, W.wall, { collide: false });
  solid(47, 40.5, w, 41.5, 0, h, W.wall);
  solid(47, 41.5, 48, 50, 0, h, W.wall);
  solid(47, 58, 48, 64.5, 0, h, W.wall);
  solid(47, 50, 48, 58, 21, h, W.wall, { collide: false });
  const leaf = add(box(0.4, 20.5, 8.6, W.door, 33.5, 10.25, 60.1));                    // door standing open
  leaf.userData.use = 'door';

  /* parts shelf along the back wall */
  for (const y of SHELF.levels) solid(1, 1, 31.2, 7, y - 0.25, y, W.board, { collide: false, surface: true });
  for (const x of [1.25, 11, 21, 30.95]) for (const z of [1.25, 6.75]) add(box(0.5, 19, 0.5, MAT.dark, x, 9.5, z));
  for (const y of SHELF.levels) for (const z of [1.25, 6.75]) add(box(30.2, 0.4, 0.3, MAT.dark, 16.1, y - 0.45, z));
  colliders.push({ x0: 0, x1: 32, z0: 0, z1: 7.4 });

  /* bed */
  solid(39, 3, 59.8, 13.5, 0, 3.6, W.wood, { use: 'bed' });
  solid(39.3, 3.3, 59.5, 13.2, 3.6, 5.4, W.white, { collide: false, use: 'bed' });
  solid(39.3, 3.3, 53.5, 13.2, 5.4, 5.9, W.fabric, { collide: false, use: 'bed' });
  solid(54.8, 4.6, 58.8, 11.9, 5.4, 6.6, W.pillow, { collide: false, use: 'bed' });

  /* kitchen */
  solid(53.4, 14.0, 59.8, 19.4, 0, 18, W.white, { use: 'food' });                          // fridge
  add(box(0.3, 5, 0.4, MAT.steel, 53.2, 11, 14.8));
  solid(54, 19.6, 59.8, 40.2, 0, 8.6, W.wood, {});
  solid(53.7, 19.5, 59.8, 40.3, 8.6, 9.0, MAT.dark, { collide: false, surface: true });
  solid(54.6, 23, 58.6, 28.5, 9.0, 9.12, MAT.steel, { collide: false, use: 'sink' });
  const tap = add(cyl(0.15, 2.6, MAT.steel, 'y', 59.2, 10.3, 25.7, 8)); tap.userData.use = 'sink';
  const spout = add(cyl(0.13, 2.0, MAT.steel, 'x', 58.2, 11.5, 25.7, 8)); spout.userData.use = 'sink';
  solid(54.4, 31.5, 59.2, 37.5, 9.0, 9.1, MAT.black, { collide: false, use: 'food' });   // hob
  const pot = add(cyl(1.2, 1.4, MAT.steel, 'y', 56.8, 9.8, 34.5, 18)); pot.userData.use = 'food';

  /* bathroom */
  solid(55.2, 59.5, 58.8, 63.8, 0, 3.8, W.white, { use: 'toilet' });
  solid(55.2, 63, 58.8, 64.4, 3.8, 8.5, W.white, { collide: false, use: 'toilet' });
  solid(56.8, 43, 59.9, 47.5, 7.5, 8.8, W.white, { collide: false, use: 'sink' });
  const btap = add(cyl(0.18, 1.6, MAT.steel, 'y', 59.4, 9.6, 45.2, 8)); btap.userData.use = 'sink';
  solid(48.2, 41.6, 54.5, 47.5, 0, 0.6, W.tile, { collide: false });                     // shower tray
  add(cyl(0.12, 20, MAT.steel, 'y', 48.6, 10, 42, 6));
  add(cyl(0.9, 0.3, MAT.steel, 'y', 49.6, 20, 42.8, 12));

  /* garage clutter */
  solid(27.5, 30, 31.9, 37, 0, 9, MAT.stand, { surface: true });
  solid(27.7, 30.2, 31.9, 36.8, 9, 11.5, MAT.stand, { collide: false });
  for (let i = 0; i < 3; i++) {
    const t = add(new THREE.Mesh(new THREE.TorusGeometry(2.2, 1.0, 10, 24), MAT.rubber));
    t.rotation.x = Math.PI / 2; t.position.set(55.5, 1 + i * 2, 83);
  }
  colliders.push({ x0: 52.3, x1: 58.7, z0: 79.8, z1: 86.2 });

  /* lamps */
  const lamps = [];
  const lampAt = (x, z, intensity, dist) => {
    add(box(6, 0.4, 1.2, W.lamp, x, h - 0.3, z));
    const l = new THREE.PointLight(0xfff0d0, intensity, dist, 1);
    l.position.set(x, h - 3, z);
    g.add(l); lamps.push(l);
  };
  lampAt(17, 60, 15, 75); lampAt(44, 78, 8, 50); lampAt(44, 26, 12, 55); lampAt(54, 53, 6, 30); lampAt(16, 10, 8, 40);
  add(box(5, 0.5, 5, W.lamp, ENGINE_POS.x, h - 0.3, ENGINE_POS.z + 2));
  const spot = new THREE.SpotLight(0xfff1d6, 42, 70, 0.95, 0.6, 1);
  spot.position.set(ENGINE_POS.x, h - 1, ENGINE_POS.z + 3);
  spot.target.position.set(ENGINE_POS.x, 6, ENGINE_POS.z);
  spot.castShadow = true;
  spot.shadow.mapSize.set(1024, 1024);
  spot.shadow.camera.near = 4; spot.shadow.camera.far = 45; spot.shadow.bias = -0.002;
  g.add(spot, spot.target);

  /* outside */
  const out = new THREE.Group();
  scene.add(out);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), new THREE.MeshLambertMaterial({ color: 0x4f7a3a }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(30, -0.3, 87);
  const drive = new THREE.Mesh(new THREE.PlaneGeometry(56, 260), new THREE.MeshLambertMaterial({ color: 0x8a867d, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
  drive.rotation.x = -Math.PI / 2; drive.position.set(30, -0.2, 218);
  out.add(ground, drive);
  const leafMat = new THREE.MeshLambertMaterial({ color: 0x2f5a2c }), trunkMat = new THREE.MeshLambertMaterial({ color: 0x4a3524 });
  for (let i = 0; i < 26; i++) {
    const x = -220 + Math.random() * 500, z = 190 + Math.random() * 300;
    if (Math.abs(x - 30) < 45) continue;
    const s = 0.8 + Math.random() * 0.9;
    const tr = new THREE.Mesh(new THREE.CylinderGeometry(2 * s, 2.6 * s, 30 * s, 6), trunkMat);
    tr.position.set(x, 15 * s, z);
    const top = new THREE.Mesh(new THREE.ConeGeometry(16 * s, 70 * s, 7), leafMat);
    top.position.set(x, 60 * s, z);
    out.add(tr, top);
  }
  const sun = new THREE.Mesh(new THREE.SphereGeometry(26, 16, 12), new THREE.MeshBasicMaterial({ color: 0xfff2c0, fog: false }));
  out.add(sun);
  const patch = add(new THREE.Mesh(new THREE.PlaneGeometry(31, 24), new THREE.MeshBasicMaterial({ color: 0xffe2a8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })));
  patch.rotation.x = -Math.PI / 2; patch.position.set(16.5, 0.05, 74);
  patch.raycast = () => {};

  const car = buildCar();
  car.position.set(17.3, 0, 59.5);
  g.add(car);
  colliders.push({ x0: 17.3 - 9.4, x1: 17.3 + 9.4, z0: 59.5 - 22.6, z1: 59.5 + 22.7 });

  return { group: g, colliders, surfaces, sun, patch, lamps, spot };
}
