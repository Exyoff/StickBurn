// The project car: a 2010-era two-door sport coupe as a rolling shell — body, wheels, gearbox,
// one seat, steering wheel, dash and shifter. No doors, no bonnet, no engine.
// Units: 1 = 10 cm. Local axes: X across (driver on -X), Y up, Z along the car with the nose at -Z.
//
// Reference dimensions (typical of the class, e.g. 370Z / Genesis Coupe / BRZ):
//   length 4.40 m · width 1.82 m · height 1.32 m · wheelbase 2.65 m · 245/40 R18 tyres (653 mm diameter)
import * as THREE from '../vendor/three.module.min.js';
import { MAT, TEX, mesh, box, cyl, lathe, rbox, bake } from './geo.js';

const LEN = 22, AXLE_F = -13.3, AXLE_R = 13.2, WHEEL_R = 3.27, ARCH_R = 3.75;

// Smooth curve through [z, value] keys (cubic Hermite with finite-difference tangents).
function keyed(keys) {
  const m = keys.map((k, i) => {
    const a = keys[Math.max(i - 1, 0)], b = keys[Math.min(i + 1, keys.length - 1)];
    return (b[1] - a[1]) / (b[0] - a[0]);
  });
  return (z) => {
    let i = 0;
    while (i < keys.length - 2 && z > keys[i + 1][0]) i++;
    const [z0, v0] = keys[i], [z1, v1] = keys[i + 1], d = z1 - z0, t = Math.min(1, Math.max(0, (z - z0) / d));
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * v0 + (t3 - 2 * t2 + t) * d * m[i] + (-2 * t3 + 3 * t2) * v1 + (t3 - t2) * d * m[i + 1];
  };
}
// Body lines, nose to tail.
const W = keyed([[-22, 5.2], [-21.6, 7.4], [-20.6, 8.5], [-18.5, 8.95], [-13, 9.1], [0, 9.1], [13, 9.1], [18.5, 8.95], [20.6, 8.5], [21.6, 7.5], [22, 5.4]]);   // half width
const Y0 = keyed([[-22, 3.9], [-21.6, 2.9], [-20.6, 2.2], [-18.5, 1.9], [18.5, 1.9], [20.6, 2.3], [21.6, 3.0], [22, 4.2]]);                                    // underside
const BELT = keyed([[-22, 4.9], [-21.6, 5.6], [-20.6, 6.3], [-16, 7.3], [-9.5, 8.3], [0, 8.7], [8, 9.1], [14, 9.4], [19, 9.3], [20.6, 9.0], [21.6, 8.3], [22, 6.9]]);
const EX = keyed([[-22, 4.0], [-21.6, 5.8], [-20.6, 6.7], [-16, 7.3], [-9.5, 7.7], [-2.5, 5.9], [5, 5.8], [13.5, 7.0], [19, 7.3], [20.6, 7.0], [21.6, 6.2], [22, 4.2]]);   // bonnet edge / roof rail
const EY = keyed([[-22, 5.1], [-21.6, 5.9], [-20.6, 6.65], [-16, 7.75], [-9.5, 8.6], [-2.5, 12.55], [1, 12.8], [5, 12.65], [13.5, 10.45], [19, 9.95], [20.6, 9.6], [21.6, 8.8], [22, 7.1]]);
const TOP = keyed([[-22, 5.2], [-21.6, 6.1], [-20.6, 6.85], [-16, 7.95], [-9.5, 8.75], [-2.5, 12.9], [1, 13.2], [5, 13.0], [13.5, 10.65], [19, 10.1], [20.6, 9.75], [21.6, 8.95], [22, 7.2]]);

const NA = 9, NB = 5, NC = 5, NJ = NA + NB + NC + 1;      // cells up the side, over the shoulder, across the top
function section(z) {
  const w = W(z), y0 = Y0(z), b = BELT(z), ex = EX(z), ey = EY(z), t = TOP(z), pts = [];
  for (let j = 0; j <= NA; j++) { const s = j / NA; pts.push([w - 0.45 * (1 - s) ** 3 - 0.3 * s ** 3, y0 + (b - y0) * s]); }
  for (let j = 1; j <= NB; j++) { const s = j / NB; pts.push([w - 0.3 + (ex - w + 0.3) * s + 0.25 * Math.sin(Math.PI * s), b + (ey - b) * s]); }
  for (let j = 1; j <= NC; j++) { const s = j / NC; pts.push([ex * (1 - s), ey + (t - ey) * Math.sin((s * Math.PI) / 2)]); }
  return pts;
}
// What a body cell is: painted metal, glass, or an opening.
function cellKind(j, z) {
  if (j < NA) return z > -7.6 && z < 5.6 && j >= 1 ? null : 'body';                    // door aperture above the sill
  if (j < NA + NB) {
    const r = j - NA;
    if (z > -7.6 && z < 5.6) return r < NB - 1 ? null : 'body';                        // side window opening; roof rail and A-pillar stay
    if (z > 6.6 && z < 11.6 && r >= 1 && r < NB - 1) return 'glass';                   // rear quarter window
    return 'body';
  }
  if (z > -9.4 && z < -2.9) return 'glass';                                            // windscreen
  if (z > 5.6 && z < 13.2) return 'glass';                                             // rear screen
  if (z > -19.6 && z < -9.9) return null;                                              // no bonnet
  return 'body';
}
function bodyShell(paint, glass) {
  const zs = [];
  for (let z = -LEN; z <= LEN + 1e-6; z += Math.abs(z) >= 20 - 1e-6 && z < LEN ? 0.25 : 0.5) zs.push(Math.min(z, LEN));
  const P = zs.map((z) => section(z).map(([x, y]) => ({ x, y, z })));
  // wheel arches: pull the cells' corners onto the arch circle, then drop the cells inside it
  const inside = zs.map(() => new Array(NJ).fill(false));
  for (const zc of [AXLE_F, AXLE_R]) {
    P.forEach((row, k) => row.forEach((p, j) => { if (j <= NA && Math.hypot(p.z - zc, p.y - WHEEL_R) < ARCH_R) inside[k][j] = zc; }));
  }
  P.forEach((row, k) => row.forEach((p, j) => {
    const zc = inside[k][j];
    if (zc === false) return;
    const edge = [[k - 1, j], [k + 1, j], [k, j - 1], [k, j + 1], [k - 1, j - 1], [k - 1, j + 1], [k + 1, j - 1], [k + 1, j + 1]].some(([a, b]) => a >= 0 && a < zs.length && b >= 0 && b <= NA + 1 && inside[a][b] === false);
    if (!edge) return;
    const d = Math.hypot(p.z - zc, p.y - WHEEL_R) || 1;
    p.z = zc + ((p.z - zc) / d) * ARCH_R; p.y = WHEEL_R + ((p.y - WHEEL_R) / d) * ARCH_R;
  }));
  const tris = { body: [], glass: [] };
  const push = (kind, a, b, c, flip) => { for (const p of flip ? [a, c, b] : [a, b, c]) tris[kind].push(p); };
  for (let k = 0; k < zs.length - 1; k++) for (let j = 0; j < NJ - 1; j++) {
    if (j < NA && inside[k][j] !== false && inside[k][j + 1] !== false && inside[k + 1][j] !== false && inside[k + 1][j + 1] !== false) continue;
    const kind = cellKind(j, (zs[k] + zs[k + 1]) / 2);
    if (!kind) continue;
    for (const s of [1, -1]) {
      const v = (kk, jj) => ({ x: s * P[kk][jj].x, y: P[kk][jj].y, z: P[kk][jj].z, u: (P[kk][jj].z + LEN) / (2 * LEN), v: jj / (NJ - 1) });
      const a = v(k, j), b = v(k, j + 1), c = v(k + 1, j), d = v(k + 1, j + 1);
      push(kind, a, b, c, s < 0); push(kind, b, d, c, s < 0);
    }
  }
  // close the nose and tail with flat faces (kept unwelded from the skin so the edge stays crisp)
  for (const k of [0, zs.length - 1]) {
    const row = P[k].map((p) => ({ ...p, u: 0, v: 0, cap: k }));
    for (let j = 0; j < NJ - 1; j++) {
      const a = row[j], b = row[j + 1], am = { ...a, x: -a.x }, bm = { ...b, x: -b.x };
      push('body', a, b, am, k > 0); push('body', b, bm, am, k > 0);
    }
  }
  const build = (list, mat) => {
    // weld by position so normals come out smooth, then unweld for the baker
    const index = new Map(), pos = [], uv = [], idx = [];
    for (const p of list) {
      const key = `${p.x.toFixed(4)},${p.y.toFixed(4)},${p.z.toFixed(4)},${p.cap ?? ''}`;
      if (!index.has(key)) { index.set(key, pos.length / 3); pos.push(p.x, p.y, p.z); uv.push(p.u, p.v); }
      idx.push(index.get(key));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return mesh(g, mat);
  };
  return [build(tris.body, paint), build(tris.glass, glass)];
}

function wheel(x, z, outer) {
  const g = new THREE.Group();
  g.position.set(x, WHEEL_R, z);
  if (outer < 0) g.rotation.y = Math.PI;
  g.add(
    lathe([[2.33, -1.05], [2.5, -1.2], [2.95, -1.22], [3.2, -1.1], [3.27, -0.85], [3.27, -0.5], [3.27, -0.17], [3.27, 0.17], [3.27, 0.5], [3.27, 0.85],
      [3.2, 1.1], [2.95, 1.22], [2.5, 1.2], [2.33, 1.05], [2.33, -1.05]], MAT.tyre, 'x', 48),
    lathe([[2.33, -1.1], [2.4, -1.12], [2.4, -1.0], [2.2, -0.9], [2.2, 0.9], [2.4, 1.0], [2.4, 1.12], [2.33, 1.1], [2.1, 1.0], [2.1, -1.0], [2.33, -1.1]], MAT.alu, 'x', 40),
    lathe([[0, 0.55], [0.75, 0.55], [0.75, 0.9], [0.4, 0.98], [0, 0.98]], MAT.alu, 'x', 24),                  // hub
    lathe([[0.7, 0.1], [1.75, 0.1], [1.75, 0.32], [0.7, 0.32], [0.7, 0.1]], MAT.steel, 'x', 40),             // brake disc
    rbox(0.5, 1.5, 1.0, 0.12, MAT.stand, 0.22, 1.25, -0.6),                                                   // caliper
  );
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    for (const off of [-0.22, 0.22]) {                                                                         // twin spokes
      const s = box(0.26, 1.7, 0.2, MAT.alu, 0.82, Math.cos(a + off * 0.3) * 1.4, Math.sin(a + off * 0.3) * 1.4);
      s.rotation.x = a + off * 0.3;
      g.add(s);
    }
    g.add(cyl(0.1, 0.12, MAT.zinc, 'x', 0.96, Math.cos(a + 0.63) * 0.48, Math.sin(a + 0.63) * 0.48, 6));       // wheel nuts
  }
  return g;
}

export function buildCar() {
  const car = new THREE.Group();
  car.userData.use = 'car';
  const paint = new THREE.MeshPhysicalMaterial({ color: 0x1f4e79, metalness: 0.6, roughness: 0.42, clearcoat: 1, clearcoatRoughness: 0.08, side: THREE.DoubleSide });
  const glass = new THREE.MeshStandardMaterial({ color: 0x9fc4d8, metalness: 0.2, roughness: 0.06, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide });
  const primer = new THREE.MeshStandardMaterial({ color: 0x84888b, metalness: 0.1, roughness: 0.85, bumpMap: TEX.fine, bumpScale: 0.6 });
  const liner = new THREE.MeshStandardMaterial({ color: 0x141516, roughness: 1, side: THREE.DoubleSide });
  const cloth = new THREE.MeshStandardMaterial({ color: 0x1d1f23, roughness: 1, bumpMap: TEX.fine, bumpScale: 1.5 });
  const lamp = new THREE.MeshStandardMaterial({ color: 0xe9eef2, metalness: 0.3, roughness: 0.15 });
  const tail = new THREE.MeshStandardMaterial({ color: 0x8a1010, emissive: 0x300404, roughness: 0.3 });

  const [shell, glazing] = bodyShell(paint, glass);
  glazing.castShadow = false;
  glazing.userData.keep = true;
  car.add(shell, glazing);

  // structure you can see through the door openings and the open bonnet
  car.add(
    box(17, 0.4, 30, primer, 0, 2.1, 5.6),                                    // floor pan
    box(16.6, 6.2, 0.4, primer, 0, 5.4, -9.5),                                // firewall
    box(16.6, 6.6, 0.4, primer, 0, 5.6, 8.4),                                 // rear bulkhead
    box(15.4, 0.3, 5.0, primer, 0, 8.9, 10.8),                                // parcel shelf
    rbox(2.8, 1.9, 17, 0.4, primer, 0, 3.2, -0.6),                            // transmission tunnel
    box(14, 0.6, 0.5, MAT.black, 0, 6.3, -19.8),                              // radiator support
    box(9, 3.6, 0.45, MAT.dark, 0, 4.4, -20.3),                               // radiator
    box(9.4, 0.6, 1.2, MAT.black, 0, 2.3, AXLE_F),                            // front crossmember
    rbox(2.6, 1.9, 1.7, 0.15, MAT.plastic, 4.2, 4.2, -11.0), box(3.0, 0.2, 2.1, MAT.black, 4.2, 3.15, -11.0),   // battery on its tray
    lathe([[0, 0], [0.45, 0], [0.45, 1.5], [0.6, 1.6], [0.6, 2.0], [0, 2.0]], MAT.alu, 'z', 16, -4.3, 7.4, -11.5),   // brake master cylinder
  );
  for (const s of [-1, 1]) {
    car.add(
      box(0.4, 4.9, 10.2, primer, s * 5.8, 4.75, -14.7),                       // inner wing
      box(0.9, 0.9, 10, MAT.black, s * 4.6, 2.75, -14.9),                      // chassis rail
      lathe([[0, 0], [1.0, 0], [0.9, 0.45], [0.35, 0.5], [0, 0.5]], primer, 'y', 24, s * 6.9, 6.95, AXLE_F),   // strut tower
      rbox(2.2, 0.6, 0.3, 0.1, lamp, s * 3.7, 4.75, -22.0), rbox(2.6, 0.8, 0.3, 0.1, tail, s * 3.6, 6.35, 22.0),
    );
    for (const zc of [AXLE_F, AXLE_R]) {
      // wheel-arch liner: an open half-drum over the tyre, closed on the inboard side
      const tub = new THREE.Mesh(new THREE.CylinderGeometry(ARCH_R + 0.04, ARCH_R + 0.04, 2.7, 28, 1, true, Math.PI - 0.3, Math.PI + 0.6).rotateZ(-Math.PI / 2), liner);
      tub.position.set(s * 7.15, WHEEL_R, zc);
      const end = new THREE.Mesh(new THREE.CircleGeometry(ARCH_R + 0.04, 28, -0.3, Math.PI + 0.6).rotateY(Math.PI / 2), liner);
      end.position.set(s * 5.8, WHEEL_R, zc);
      car.add(tub, end, wheel(s * 7.75, zc, s));
    }
  }
  car.add(box(4.6, 0.5, 0.1, MAT.plastic, 0, 4.4, -22.03), box(4.4, 1.1, 0.1, MAT.ceramic, 0, 5.1, 22.03));     // grille, number plate

  // gearbox bellhousing poking through the firewall, waiting for an engine
  car.add(
    lathe([[0, 0], [2.1, 0], [2.1, 0.25], [1.9, 0.5], [1.3, 2.1], [0, 2.1]], MAT.alu, 'z', 28, 0, 4.3, -11.6),
    cyl(1.85, 0.02, MAT.plastic, 'z', 0, 4.3, -11.61, 28), cyl(0.2, 0.9, MAT.steel, 'z', 0, 4.3, -11.9, 12),
  );

  // cabin: one seat, wheel, dash, pedals, shifter
  const X = -4.3;
  const back = rbox(4.8, 6.4, 1.4, 0.4, cloth, X, 6.9, 4.7); back.rotation.x = 0.22;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1.85, 0.2, 12, 40), MAT.plastic);
  rim.position.set(X, 8.7, -4.4); rim.rotation.x = -0.38; rim.castShadow = true;
  const column = cyl(0.3, 3.4, MAT.plastic, 'z', X, 8.15, -5.9, 12); column.rotation.x = -0.38;
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), MAT.ceramic); knob.position.set(0, 6.5, -1.5);
  car.add(
    rbox(16.4, 2.6, 3.0, 0.5, MAT.plastic, 0, 7.5, -7.8), rbox(4.2, 1.4, 1.6, 0.4, MAT.plastic, X, 9.0, -7.4),
    cyl(0.62, 0.06, MAT.ceramic, 'z', X - 0.8, 9.0, -6.58, 20), cyl(0.62, 0.06, MAT.ceramic, 'z', X + 0.8, 9.0, -6.58, 20),
    rim, column, cyl(0.5, 0.4, MAT.plastic, 'z', X, 8.7, -4.4, 16),
    rbox(4.8, 1.3, 5.0, 0.35, cloth, X, 3.2, 1.6), back, rbox(2.6, 1.9, 1.0, 0.35, cloth, X, 10.9, 5.75),
    lathe([[0, 0], [0.75, 0], [0.2, 0.9], [0, 0.9]], MAT.plastic, 'y', 16, 0, 4.15, -1.5), cyl(0.11, 1.6, MAT.steel, 'y', 0, 5.6, -1.5, 8), knob,
    box(0.6, 0.3, 3.2, MAT.plastic, 1.0, 4.4, 2.6),                                                              // handbrake
  );
  for (const [dx, w] of [[-1.4, 0.7], [-0.2, 0.7], [1.0, 0.5]]) { const p = box(w, 1.1, 0.15, MAT.steel, X + dx, 3.3, -8.6); p.rotation.x = -0.4; car.add(p); }
  for (let i = 0; i < 3; i++) { const sp = box(0.3, 1.7, 0.12, MAT.plastic, X + Math.sin(i * 2.094 + 3.14) * 0.9, 8.7 + Math.cos(i * 2.094 + 3.14) * 0.85, -4.4); sp.rotation.set(-0.38, 0, -(i * 2.094 + 3.14)); car.add(sp); }
  return bake(car, false);
}
