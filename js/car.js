// The project car: a late-80s/early-90s Japanese rear-drive fastback (S13-style) as a rolling shell —
// body, wheels, gearbox, one seat, steering wheel, dash and shifter. No doors, no bonnet, no engine.
// Units: 1 = 10 cm. Local axes: X across (driver on -X), Y up, Z along the car with the nose at -Z.
//
// Reference dimensions (S13 fastback): length 4.52 m · width 1.69 m · height 1.29 m · wheelbase 2.474 m
//   195/60 R15 tyres (615 mm diameter) on 15" seven-spoke alloys, four-stud hubs
// Shape taken from photographs: low wedge nose with the pop-up lamps closed, long sloping hatch glass,
// black window pillars, full-width tail-lamp band, small lip spoiler. No badges.
import * as THREE from '../vendor/three.module.min.js';
import { MAT, TEX, mesh, box, cyl, lathe, rbox, bake } from './geo.js';

const LEN = 22.6, AXLE_F = -12.6, AXLE_R = 12.14, WHEEL_R = 3.08, ARCH_R = 3.5, HALF_W = 8.45;

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
const W = keyed([[-22.6, 6.2], [-22.1, 7.6], [-20.5, 8.2], [-17, 8.4], [-12, HALF_W], [12, HALF_W], [18, 8.4], [21, 8.1], [22.2, 7.5], [22.6, 6.3]]);                       // half width
const Y0 = keyed([[-22.6, 3.6], [-22.1, 2.6], [-20.5, 2.1], [-17, 2.0], [18, 2.0], [21, 2.6], [22.2, 3.2], [22.6, 4.0]]);                                           // underside
const BELT = keyed([[-22.6, 5.2], [-22, 5.8], [-19, 6.5], [-14, 7.3], [-8, 8.3], [0, 8.8], [9, 9.0], [15, 9.2], [20, 9.1], [22, 8.7], [22.6, 7.6]]);
const EX = keyed([[-22.6, 5.2], [-22, 6.4], [-19, 7.0], [-14, 7.3], [-8, 7.3], [-2.3, 5.7], [7, 5.6], [13, 6.3], [18.5, 7.0], [22, 6.8], [22.6, 5.6]]);             // bonnet edge / roof rail
const EY = keyed([[-22.6, 5.5], [-22, 6.1], [-19, 6.75], [-14, 7.55], [-8, 8.6], [-2.3, 12.15], [2, 12.5], [7, 12.25], [13, 10.95], [18.5, 9.45], [22, 9.05], [22.6, 8.1]]);
const TOP = keyed([[-22.6, 5.6], [-22, 6.3], [-19, 6.9], [-14, 7.7], [-8, 8.75], [-2.3, 12.5], [2, 12.9], [7, 12.6], [13, 11.2], [18.5, 9.6], [22, 9.2], [22.6, 8.2]]);   // wedge nose, fastback tail

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
  if (j < NA) return z > -3.4 && z < 9.0 && j >= 1 ? null : 'body';                    // door aperture above the sill
  if (j < NA + NB) {
    const r = j - NA;
    if (z > -3.4 && z < 9.0) return r < NB - 1 ? null : 'trim';                        // side window opening; black roof rail stays
    if (z > 9.6 && z < 15.2 && r >= 1 && r < NB - 1) return 'glass';                   // rear quarter window
    return z > -8 && z < 17 ? 'trim' : 'body';                                         // black pillars around the glasshouse
  }
  if (z > -7.9 && z < -2.4) return 'glass';                                            // windscreen
  if (z > 7.2 && z < 18.3) return 'glass';                                             // hatch glass
  if (z > -20.5 && z < -8.4) return null;                                              // no bonnet
  return 'body';
}
function bodyShell(paint, glass, trim) {
  const zs = [];
  for (let z = -LEN; z < LEN - 1e-6; z += Math.abs(z) > 20.5 ? 0.25 : 0.5) zs.push(z);
  zs.push(LEN);
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
  const tris = { body: [], glass: [], trim: [] };
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
  return [build(tris.body, paint), build(tris.glass, glass), build(tris.trim, trim)];
}

function wheel(x, z, outer) {
  const g = new THREE.Group();
  g.position.set(x, WHEEL_R, z);
  if (outer < 0) g.rotation.y = Math.PI;
  g.add(
    lathe([[1.93, -0.85], [2.1, -0.97], [2.75, -0.98], [3.0, -0.88], [3.08, -0.7], [3.08, -0.42], [3.08, -0.14], [3.08, 0.14], [3.08, 0.42], [3.08, 0.7],
      [3.0, 0.88], [2.75, 0.98], [2.1, 0.97], [1.93, 0.85], [1.93, -0.85]], MAT.tyre, 'x', 48),
    lathe([[1.93, -0.9], [2.0, -0.92], [2.0, -0.82], [1.82, -0.74], [1.82, 0.74], [2.0, 0.82], [2.0, 0.92], [1.93, 0.9], [1.72, 0.82], [1.72, -0.82], [1.93, -0.9]], MAT.alu, 'x', 40),
    lathe([[0, 0.45], [0.62, 0.45], [0.62, 0.76], [0.34, 0.83], [0, 0.83]], MAT.alu, 'x', 24),                // hub
    lathe([[0.5, 0.1], [1.32, 0.1], [1.32, 0.3], [0.5, 0.3], [0.5, 0.1]], MAT.steel, 'x', 36),               // brake disc
    rbox(0.4, 1.0, 0.8, 0.1, MAT.dark, 0.2, 0.95, -0.5),                                                      // caliper
  );
  for (let i = 0; i < 7; i++) {                                                                                // seven-spoke alloy
    const a = (i / 7) * Math.PI * 2;
    const s = box(0.2, 1.4, 0.42, MAT.alu, 0.68, Math.cos(a) * 1.15, Math.sin(a) * 1.15);
    s.rotation.x = a;
    g.add(s);
  }
  for (let i = 0; i < 4; i++) g.add(cyl(0.09, 0.1, MAT.zinc, 'x', 0.82, Math.cos(i * 1.571 + 0.4) * 0.38, Math.sin(i * 1.571 + 0.4) * 0.38, 6));   // four studs
  return g;
}

export function buildCar() {
  const car = new THREE.Group();
  car.userData.use = 'car';
  const paint = new THREE.MeshPhysicalMaterial({ color: 0xc0161a, metalness: 0.25, roughness: 0.4, clearcoat: 1, clearcoatRoughness: 0.08, side: THREE.DoubleSide });
  const glass = new THREE.MeshStandardMaterial({ color: 0x9fc4d8, metalness: 0.2, roughness: 0.06, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide });
  const primer = new THREE.MeshStandardMaterial({ color: 0x84888b, metalness: 0.1, roughness: 0.85, bumpMap: TEX.fine, bumpScale: 0.6 });
  const liner = new THREE.MeshStandardMaterial({ color: 0x141516, roughness: 1, side: THREE.DoubleSide });
  const cloth = new THREE.MeshStandardMaterial({ color: 0x1d1f23, roughness: 1, bumpMap: TEX.fine, bumpScale: 1.5 });
  const lamp = new THREE.MeshStandardMaterial({ color: 0xe9eef2, metalness: 0.3, roughness: 0.15 });
  const tail = new THREE.MeshStandardMaterial({ color: 0xd01818, emissive: 0x5a0606, roughness: 0.25 });
  const amber = new THREE.MeshStandardMaterial({ color: 0xe08a1a, emissive: 0x3a2000, roughness: 0.35 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x101113, metalness: 0.2, roughness: 0.55, side: THREE.DoubleSide });

  const [shell, glazing, pillars] = bodyShell(paint, glass, trim);
  glazing.castShadow = false;
  glazing.userData.keep = true;
  car.add(shell, glazing, pillars);

  // structure you can see through the door openings and the open bonnet
  car.add(
    box(15.6, 0.4, 27.5, primer, 0, 2.25, 4.4),                                    // floor pan
    box(15.8, 6.2, 0.4, primer, 0, 5.4, -9.0),                                // firewall
    box(15.8, 6.4, 0.4, primer, 0, 5.5, 9.2),                                 // rear bulkhead
    box(14.6, 0.3, 8.4, MAT.plastic, 0, 8.6, 13.5),                                // parcel shelf
    rbox(2.8, 1.9, 17, 0.4, primer, 0, 3.2, -0.6),                            // transmission tunnel
    box(13.6, 0.5, 0.5, MAT.black, 0, 6.2, -20.6),                              // radiator support
    box(8.6, 3.4, 0.45, MAT.dark, 0, 4.3, -21.0),                               // radiator
    box(9.4, 0.6, 1.2, MAT.black, 0, 2.3, AXLE_F),                            // front crossmember
    rbox(2.6, 1.9, 1.7, 0.15, MAT.plastic, 4.2, 4.2, -11.0), box(3.0, 0.2, 2.1, MAT.black, 4.2, 3.15, -11.0),   // battery on its tray
    lathe([[0, 0], [0.45, 0], [0.45, 1.5], [0.6, 1.6], [0.6, 2.0], [0, 2.0]], MAT.alu, 'z', 16, -4.3, 7.4, -11.5),   // brake master cylinder
  );
  for (const s of [-1, 1]) {
    car.add(
      box(0.4, 4.6, 11.4, primer, s * 5.6, 4.6, -14.9),                       // inner wing
      box(0.9, 0.9, 10, MAT.black, s * 4.6, 2.75, -14.9),                      // chassis rail
      lathe([[0, 0], [1.0, 0], [0.9, 0.45], [0.35, 0.5], [0, 0.5]], primer, 'y', 24, s * 6.5, 6.55, AXLE_F),   // strut tower
      rbox(1.5, 0.5, 0.3, 0.1, amber, s * 4.8, 4.75, -LEN), rbox(4.2, 1.5, 0.3, 0.1, tail, s * 3.9, 7.0, LEN), rbox(1.6, 0.6, 0.32, 0.1, amber, s * 5.1, 6.55, LEN),
      box(0.5, 0.5, 1.2, paint, s * 5.6, 9.45, 20.9),                          // spoiler stanchion
    );
    for (const zc of [AXLE_F, AXLE_R]) {
      // wheel-arch liner: an open half-drum over the tyre, closed on the inboard side
      const tub = new THREE.Mesh(new THREE.CylinderGeometry(ARCH_R + 0.04, ARCH_R + 0.04, 2.5, 28, 1, true, Math.PI - 0.3, Math.PI + 0.6).rotateZ(-Math.PI / 2), liner);
      tub.position.set(s * 6.85, WHEEL_R, zc);
      const end = new THREE.Mesh(new THREE.CircleGeometry(ARCH_R + 0.04, 28, -0.3, Math.PI + 0.6).rotateY(Math.PI / 2), liner);
      end.position.set(s * 5.6, WHEEL_R, zc);
      car.add(tub, end, wheel(s * (HALF_W - 1.0), zc, s));
    }
  }
  car.add(
    box(5.6, 0.5, 0.1, MAT.plastic, 0, 4.2, -LEN - 0.03),                    // intake slot under the nose
    box(12.6, 1.9, 0.16, MAT.plastic, 0, 6.95, LEN),                          // black band the tail lamps sit in
    rbox(3.6, 1.5, 0.3, 0.1, MAT.plastic, 0, 7.0, LEN),                      // centre garnish between the tail lamps
    box(3.2, 1.0, 0.1, MAT.ceramic, 0, 4.9, LEN + 0.03),                     // number plate
    box(12.4, 0.25, 1.7, paint, 0, 9.8, 20.9),                               // lip spoiler
  );     // grille, number plate

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
    rbox(15.4, 2.6, 3.0, 0.5, MAT.plastic, 0, 7.4, -7.3), rbox(4.2, 1.4, 1.6, 0.4, MAT.plastic, X, 9.0, -7.4),
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
