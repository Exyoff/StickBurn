// Engine definition: every part, its geometry, its bolts and what it physically depends on.
// Units: 1 = 10 cm. Crankshaft axis is the X axis (front of engine at -X), Y is up.
import * as THREE from '../vendor/three.module.min.js';

const M = (color, metalness = 0.6, roughness = 0.5, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, metalness, roughness, ...extra });

export const MAT = {
  block: M(0x3f5560, 0.35, 0.75),
  iron: M(0x565b60, 0.6, 0.65),
  alu: M(0xb4bac0, 0.75, 0.42),
  steel: M(0x9ea4aa, 0.9, 0.3),
  dark: M(0x2a2d31, 0.6, 0.55),
  black: M(0x16181b, 0.3, 0.75),
  rubber: M(0x101010, 0.0, 0.95),
  copper: M(0xb8733c, 0.85, 0.4),
  red: M(0xa3261c, 0.35, 0.45),
  rust: M(0x6f4a37, 0.55, 0.85),
  bolt: M(0xd0d3d8, 0.95, 0.28),
  ceramic: M(0xf1efe8, 0.0, 0.35),
  cap: M(0x5b2a1f, 0.1, 0.5),
  filter: M(0xd8892b, 0.3, 0.5),
  lead: M(0x1c1c22, 0.0, 0.7),
  stand: M(0xb8321f, 0.4, 0.6),
};

export const CRANK_R = 0.4;
export const ROD_L = 1.6;
const CYL_X = [-1.5, -0.5, 0.5, 1.5];
const PHASE = [0, Math.PI, Math.PI, 0];

/* ---------- geometry helpers ---------- */
function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
const box = (w, h, d, mat, x, y, z) => mesh(new THREE.BoxGeometry(w, h, d), mat, x, y, z);
function cyl(r, len, mat, axis, x, y, z, seg = 24, rTop = r) {
  const g = new THREE.CylinderGeometry(rTop, r, len, seg);
  if (axis === 'x') g.rotateZ(Math.PI / 2);
  if (axis === 'z') g.rotateX(Math.PI / 2);
  return mesh(g, mat, x, y, z);
}
function tube(pts, r, mat, seg = 28) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
  return mesh(new THREE.TubeGeometry(curve, seg, r, 10), mat);
}
// Extrude an outline given in (x, z) upward along Y.
function extrudeY(pts, holes, y0, depth, mat) {
  const s = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
  for (const h of holes) {
    const p = new THREE.Path();
    p.absarc(h.x, -h.z, h.r, 0, Math.PI * 2, true);
    s.holes.push(p);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 28 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0, 0);
  return mesh(g, mat);
}
// Extrude an outline given in (z, y) along +X.
function extrudeX(pts, holes, x0, depth, mat) {
  const v = ([z, y]) => new THREE.Vector2(-z, y);
  const s = new THREE.Shape(pts.map(v));
  for (const h of holes) s.holes.push(new THREE.Path(h.map(v)));
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
  g.rotateY(Math.PI / 2);
  g.translate(x0, 0, 0);
  return mesh(g, mat);
}
// Convex hull around circles {z, y, r} — the outline of a belt or chain run.
function hull(circles, pad = 0) {
  const pts = [];
  for (const c of circles)
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      pts.push([c.z + Math.cos(a) * (c.r + pad), c.y + Math.sin(a) * (c.r + pad)]);
    }
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of pts) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop();
    lo.push(p);
  }
  for (const p of pts.slice().reverse()) {
    while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop();
    up.push(p);
  }
  lo.pop(); up.pop();
  return lo.concat(up);
}

/* ---------- bolts ---------- */
const UP = new THREE.Vector3(0, 1, 0);
const boltGeo = {};
export const boltRadius = (size) => 0.045 + size * 0.0055;
const BOLT_TRAVEL = 0.2;

function makeBolt(pos, dir, size) {
  const r = boltRadius(size);
  const geo = (boltGeo[size] ||= {
    head: new THREE.CylinderGeometry(r, r, r * 0.9, 6),
    washer: new THREE.CylinderGeometry(r * 1.3, r * 1.3, 0.025, 16),
    shank: new THREE.CylinderGeometry(r * 0.5, r * 0.5, 0.34, 8),
  });
  const group = new THREE.Group();
  group.position.set(...pos);
  group.quaternion.setFromUnitVectors(UP, new THREE.Vector3(...dir).normalize());
  const inner = new THREE.Group();
  const head = mesh(geo.head, MAT.bolt, 0, 0.025 + r * 0.45, 0);
  inner.add(head, mesh(geo.washer, MAT.bolt, 0, 0.0125, 0), mesh(geo.shank, MAT.bolt, 0, -0.17, 0));
  group.add(inner);
  const b = { group, inner, head, size, tight: 0, headTop: 0.025 + r * 0.9 };
  inner.traverse((o) => (o.userData.bolt = b));
  setTight(b, 0);
  return b;
}
export function setTight(b, t) {
  b.tight = t;
  b.inner.position.y = (1 - t) * BOLT_TRAVEL;
  b.inner.rotation.y = -t * Math.PI * 6;
}

/* ---------- the engine ---------- */
export function buildEngine() {
  const parts = [];
  function part(id, name, o = {}) {
    const g = new THREE.Group();
    g.userData.partId = id;
    const p = {
      id, name, group: g, bolts: [], spin: [], installed: false,
      req: o.req || ['block'], covers: o.covers || [], from: o.from || [0, 1, 0],
    };
    p.add = (...m) => { g.add(...m); return p; };
    p.bolt = (pos, dir, size, parent = g, extra) => {
      const b = makeBolt(pos, dir, size);
      b.part = p;
      parent.add(b.group);
      if (extra) { extra(b.inner); b.inner.traverse((o) => (o.userData.bolt = b)); }
      p.bolts.push(b);
      return b;
    };
    parts.push(p);
    return p;
  }
  const pistons = ['piston1', 'piston2', 'piston3', 'piston4'];
  const caps = ['maincap1', 'maincap2', 'maincap3'];
  const plugs = ['plug1', 'plug2', 'plug3', 'plug4'];

  /* block */
  const blk = part('block', 'Engine block', { req: [] });
  const deck = [[-2.3, -0.9], [2.3, -0.9], [2.3, 0.9], [-2.3, 0.9]];
  blk.add(extrudeY(deck, CYL_X.map((x) => ({ x, z: 0, r: 0.42 })), 0.35, 2.05, MAT.block));
  for (const s of [-1, 1]) {
    blk.add(box(4.6, 0.85, 0.1, MAT.block, 0, -0.075, s * 0.85));
    for (const e of [-1, 1]) blk.add(box(0.1, 0.5, 0.35, MAT.block, e * 2.25, -0.25, s * 0.675));
  }
  const SADDLE_X = [-2.15, 0, 2.15];
  for (const x of SADDLE_X) blk.add(box(0.3, 0.35, 1.6, MAT.block, x, 0.175, 0));

  /* crankshaft */
  const crank = part('crank', 'Crankshaft', { from: [0, -1, 0] });
  crank.add(
    cyl(0.2, 1.14, MAT.steel, 'x', -2.33, 0, 0),
    cyl(0.2, 0.48, MAT.steel, 'x', -1, 0, 0),
    cyl(0.2, 0.48, MAT.steel, 'x', 0, 0, 0),
    cyl(0.2, 0.48, MAT.steel, 'x', 1, 0, 0),
    cyl(0.2, 0.6, MAT.steel, 'x', 2.06, 0, 0),
    cyl(0.38, 0.15, MAT.steel, 'x', 2.425, 0, 0),
  );
  CYL_X.forEach((x, i) => {
    const s = Math.cos(PHASE[i]);
    crank.add(cyl(0.17, 0.4, MAT.steel, 'x', x, s * CRANK_R, 0));
    for (const e of [-1, 1]) crank.add(box(0.14, CRANK_R + 0.52, 0.44, MAT.iron, x + e * 0.26, (s * CRANK_R) / 2, 0));
  });
  crank.spin.push({ obj: crank.group, ratio: 1 });

  /* main bearing caps */
  SADDLE_X.forEach((x, i) => {
    const c = part(caps[i], `Main bearing cap ${i + 1}`, { req: ['crank'], from: [0, -1, 0] });
    c.add(box(0.3, 0.3, 0.9, MAT.iron, x, -0.15, 0));
    for (const s of [-1, 1]) c.bolt([x, -0.3, s * 0.31], [0, -1, 0], 17);
  });

  /* pistons with connecting rods */
  CYL_X.forEach((x, i) => {
    const p = part(pistons[i], `Piston ${i + 1}`, { req: ['crank'] });
    p.group.position.x = x;
    const hd = new THREE.Group(), rod = new THREE.Group();
    hd.add(cyl(0.4, 0.5, MAT.alu, 'y', 0, 0.05, 0, 32));
    for (const y of [0.2, 0.12, 0.02]) hd.add(cyl(0.405, 0.025, MAT.dark, 'y', 0, y, 0, 32));
    rod.add(
      box(0.16, ROD_L, 0.1, MAT.iron, 0, -ROD_L / 2, 0),
      cyl(0.27, 0.3, MAT.iron, 'x', 0, -ROD_L, 0),
      box(0.3, 0.16, 0.72, MAT.iron, 0, -ROD_L - 0.02, 0),
    );
    p.add(hd, rod);
    for (const s of [-1, 1]) p.bolt([0, -ROD_L - 0.1, s * 0.3], [0, -1, 0], 12, rod);
    p.kin = { hd, rod, phase: PHASE[i] };
  });

  /* oil pan */
  const pan = part('oilpan', 'Oil pan', { from: [0, -1, 0], covers: ['crank', ...caps] });
  pan.add(
    box(4.6, 0.06, 1.8, MAT.black, 0, -0.53, 0),
    box(4.4, 0.85, 1.5, MAT.black, 0, -0.985, 0),
    cyl(0.09, 0.08, MAT.bolt, 'z', 1.6, -1.25, 0.78, 6),
  );
  for (const x of [-2, -1, 0, 1, 2]) for (const s of [-1, 1]) pan.bolt([x, -0.56, s * 0.83], [0, -1, 0], 8);

  /* head gasket */
  const gasket = part('gasket', 'Head gasket', { covers: [] });
  gasket.add(extrudeY(deck, CYL_X.map((x) => ({ x, z: 0, r: 0.44 })), 2.4, 0.04, MAT.copper));

  /* cylinder head */
  const head = part('head', 'Cylinder head', { covers: ['gasket', ...pistons] });
  head.add(box(4.6, 0.86, 1.8, MAT.alu, 0, 2.87, 0));
  for (const x of [-2, -1, 0, 1, 2]) for (const s of [-1, 1]) head.bolt([x, 3.3, s * 0.55], [0, 1, 0], 14);

  /* camshaft */
  const cam = part('camshaft', 'Camshaft', { req: ['head'] });
  const shaft = new THREE.Group();
  shaft.position.set(0, 3.5, 0);
  shaft.add(cyl(0.1, 4.75, MAT.steel, 'x', -0.175, 0, 0, 16));
  CYL_X.forEach((x, i) => {
    for (const e of [-1, 1]) {
      const lobe = cyl(0.15, 0.14, MAT.steel, 'x', x + e * 0.2, 0, 0, 20);
      lobe.scale.set(1, 1.35, 1);
      lobe.rotation.x = PHASE[i] / 2 + (e > 0 ? 1.9 : 0) + i * 0.8;
      shaft.add(lobe);
    }
  });
  cam.add(shaft);
  for (const x of [-2, 0, 2]) {
    cam.add(box(0.2, 0.38, 0.7, MAT.alu, x, 3.49, 0));
    for (const s of [-1, 1]) cam.bolt([x, 3.68, s * 0.25], [0, 1, 0], 10);
  }
  cam.spin.push({ obj: shaft, ratio: 0.5 });

  /* timing drive */
  const cs = part('cranksprocket', 'Crank sprocket', { req: ['crank'], from: [-1, 0, 0] });
  cs.add(cyl(0.25, 0.08, MAT.dark, 'x', -2.52, 0, 0, 14));
  cs.spin.push({ obj: cs.group, ratio: 1 });

  const cams = part('camsprocket', 'Cam sprocket', { req: ['camshaft'], from: [-1, 0, 0] });
  cams.group.position.set(-2.52, 3.5, 0);
  cams.add(cyl(0.5, 0.08, MAT.dark, 'x', 0, 0, 0, 22));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.6;
    cams.add(cyl(0.11, 0.1, MAT.black, 'x', 0, Math.cos(a) * 0.3, Math.sin(a) * 0.3, 12));
  }
  cams.bolt([-0.04, 0, 0], [-1, 0, 0], 13);
  cams.spin.push({ obj: cams.group, ratio: 0.5 });

  const runC = [{ y: 3.5, z: 0, r: 0.5 }, { y: 0, z: 0, r: 0.25 }];
  const chain = part('chain', 'Timing chain', { req: ['cranksprocket', 'camsprocket'], from: [-1, 0, 0] });
  chain.add(extrudeX(hull(runC, 0.07), [hull(runC, 0.01)], -2.555, 0.07, MAT.steel));

  const tc = part('timingcover', 'Timing cover', { from: [-1, 0, 0], covers: ['cranksprocket', 'camsprocket', 'chain'] });
  const coverC = [{ y: 3.5, z: 0, r: 0.68 }, { y: 0, z: 0, r: 0.68 }];
  tc.add(extrudeX(hull(coverC), [], -2.72, 0.42, MAT.alu));
  for (const [y, z] of [[-0.38, 0.52], [1.2, 0.56], [3.88, 0.52]])
    for (const s of [-1, 1]) tc.bolt([-2.72, y, s * z], [-1, 0, 0], 10);

  const pulley = part('pulley', 'Crank pulley', { req: ['crank', 'timingcover'], from: [-1, 0, 0] });
  pulley.add(
    cyl(0.45, 0.05, MAT.dark, 'x', -2.785, 0, 0, 28),
    cyl(0.36, 0.1, MAT.dark, 'x', -2.86, 0, 0, 28),
    cyl(0.45, 0.05, MAT.dark, 'x', -2.935, 0, 0, 28),
    box(0.02, 0.12, 0.05, MAT.ceramic, -2.955, 0.36, 0),
  );
  pulley.bolt([-2.96, 0, 0], [-1, 0, 0], 19);
  pulley.spin.push({ obj: pulley.group, ratio: 1 });

  const wp = part('waterpump', 'Water pump', { req: ['timingcover'], from: [-1, 0, 0] });
  wp.add(box(0.08, 0.9, 0.9, MAT.iron, -2.76, 1.9, 0), cyl(0.1, 0.12, MAT.steel, 'x', -2.82, 1.9, 0));
  const wpp = new THREE.Group();
  wpp.position.set(-2.89, 1.9, 0);
  wpp.add(cyl(0.3, 0.12, MAT.dark, 'x', 0, 0, 0, 24), box(0.02, 0.1, 0.05, MAT.ceramic, -0.065, 0.22, 0));
  wp.add(wpp);
  for (const a of [-1, 1]) for (const s of [-1, 1]) wp.bolt([-2.8, 1.9 + a * 0.35, s * 0.35], [-1, 0, 0], 10);
  wp.spin.push({ obj: wpp, ratio: 1.5 });

  const alt = part('alternator', 'Alternator', { from: [0, 0, -1] });
  alt.add(
    cyl(0.4, 0.7, MAT.alu, 'x', -2.3, 1.2, -1.55, 24),
    cyl(0.41, 0.2, MAT.dark, 'x', -2.3, 1.2, -1.55, 24),
    cyl(0.06, 0.2, MAT.steel, 'x', -2.75, 1.2, -1.55, 10),
    box(0.5, 1.0, 0.08, MAT.iron, -1.95, 1.2, -0.94),
    box(0.3, 0.25, 0.3, MAT.iron, -2.05, 1.2, -1.1),
  );
  const altp = new THREE.Group();
  altp.position.set(-2.89, 1.2, -1.55);
  altp.add(cyl(0.22, 0.12, MAT.dark, 'x', 0, 0, 0, 20), box(0.02, 0.08, 0.04, MAT.ceramic, -0.065, 0.15, 0));
  alt.add(altp);
  for (const y of [0.82, 1.58]) alt.bolt([-1.82, y, -0.98], [0, 0, -1], 13);
  alt.spin.push({ obj: altp, ratio: 2 });

  const beltC = [{ y: 0, z: 0, r: 0.38 }, { y: 1.9, z: 0, r: 0.3 }, { y: 1.2, z: -1.55, r: 0.22 }];
  const belt = part('belt', 'Fan belt', { req: ['pulley', 'waterpump', 'alternator'], from: [-1, 0, 0] });
  belt.add(extrudeX(hull(beltC, 0.05), [hull(beltC, 0.0)], -2.9, 0.08, MAT.rubber));

  /* flywheel */
  const fly = part('flywheel', 'Flywheel', { req: ['crank'], from: [1, 0, 0] });
  fly.add(cyl(1.45, 0.18, MAT.iron, 'x', 2.59, 0, 0, 48), cyl(1.52, 0.1, MAT.dark, 'x', 2.56, 0, 0, 72));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    fly.bolt([2.68, Math.cos(a) * 0.3, Math.sin(a) * 0.3], [1, 0, 0], 13);
    fly.add(cyl(0.12, 0.2, MAT.black, 'x', 2.6, Math.cos(a + 0.5) * 0.95, Math.sin(a + 0.5) * 0.95, 12));
  }
  fly.spin.push({ obj: fly.group, ratio: 1 });

  /* rocker cover */
  const rc = part('rockercover', 'Rocker cover', { req: ['head'], covers: ['camshaft'] });
  rc.add(
    box(4.5, 0.06, 1.76, MAT.red, 0, 3.33, 0),
    box(4.4, 0.52, 1.4, MAT.red, 0, 3.6, 0),
    box(4.2, 0.14, 1.1, MAT.red, 0, 3.92, 0),
    cyl(0.17, 0.12, MAT.black, 'y', 1.75, 4.04, 0.2, 16),
  );
  for (const x of [-1.8, 0, 1.8]) for (const s of [-1, 1]) rc.bolt([x, 3.36, s * 0.79], [0, 1, 0], 8);

  /* spark plugs: the hex of the plug itself is what you turn */
  const PD = [0, Math.sin(0.61), Math.cos(0.61)];
  CYL_X.forEach((x, i) => {
    const sp = part(plugs[i], `Spark plug ${i + 1}`, { req: ['head'], from: PD });
    sp.bolt([x, 3.1, 0.9], PD, 16, sp.group, (inner) => {
      inner.add(cyl(0.07, 0.32, MAT.ceramic, 'y', 0, 0.3, 0, 12), cyl(0.035, 0.1, MAT.steel, 'y', 0, 0.5, 0, 8));
    });
  });

  /* exhaust */
  const ex = part('exhaust', 'Exhaust header', { req: ['head'], from: [0, 0, 1] });
  ex.add(box(4.2, 0.5, 0.08, MAT.rust, 0, 2.72, 0.94));
  CYL_X.forEach((x) => {
    ex.add(tube([[x, 2.78, 0.96], [x, 2.72, 1.35], [x * 0.6 - 0.1, 2.0, 1.6], [-0.3 + x * 0.08, 1.3, 1.55]], 0.15, MAT.rust));
  });
  ex.add(cyl(0.25, 0.5, MAT.rust, 'y', -0.3, 1.1, 1.55, 16));
  ex.add(tube([[-0.3, 0.95, 1.55], [-0.3, 0, 1.55], [-0.2, -0.9, 1.6], [0.8, -1.5, 1.7]], 0.2, MAT.rust));
  for (const x of [-2, -1, 0, 1, 2]) ex.bolt([x, 2.72, 0.98], [0, 0, 1], 12);

  /* intake + carburettor */
  const inl = part('intake', 'Intake manifold', { req: ['head'], from: [0, 0, -1] });
  inl.add(box(4.2, 0.5, 0.08, MAT.alu, 0, 2.72, -0.94), cyl(0.25, 3.4, MAT.alu, 'x', 0, 3.05, -1.7, 20));
  CYL_X.forEach((x) => inl.add(tube([[x, 2.8, -0.96], [x, 2.85, -1.3], [x * 0.92, 3.02, -1.65]], 0.15, MAT.alu, 12)));
  for (const x of [-2, -1, 0, 1, 2]) inl.bolt([x, 2.58, -0.98], [0, 0, -1], 12);

  const carb = part('carb', 'Carburettor', { req: ['intake'] });
  carb.add(
    box(0.95, 0.06, 0.5, MAT.steel, 0, 3.33, -1.7),
    box(0.5, 0.5, 0.45, MAT.steel, 0, 3.61, -1.7),
    cyl(0.07, 0.3, MAT.copper, 'x', 0.35, 3.6, -1.7, 10),
    cyl(0.27, 0.26, MAT.black, 'y', 0, 3.99, -1.7, 20),
  );
  for (const s of [-1, 1]) carb.bolt([s * 0.37, 3.36, -1.7], [0, 1, 0], 10);

  /* distributor */
  const dist = part('distributor', 'Distributor', { from: [0, 0.64, -0.77] });
  dist.group.position.set(1.3, 1.45, -0.9);
  dist.group.rotation.x = -0.873;
  dist.add(
    cyl(0.2, 0.5, MAT.steel, 'y', 0, 0.25, 0, 18),
    cyl(0.25, 0.3, MAT.cap, 'y', 0, 0.65, 0, 18),
    box(0.75, 0.05, 0.3, MAT.iron, 0.2, 0.03, 0),
  );
  for (let i = 0; i < 4; i++) dist.add(cyl(0.04, 0.1, MAT.cap, 'y', (i - 1.5) * 0.1, 0.84, 0, 8));
  dist.bolt([0.44, 0.055, 0], [0, 1, 0], 10);

  /* ignition leads */
  const leads = part('leads', 'Ignition leads', { req: ['distributor', ...plugs] });
  CYL_X.forEach((x, i) => {
    leads.add(tube([
      [1.3 + (i - 1.5) * 0.1, 2.02, -1.57], [1.35 + (i - 1.5) * 0.08, 2.9, -2.2], [1.2, 3.95, -1.35],
      [x * 0.9, 4.25, -0.1], [x, 3.95, 0.98], [x, 3.1 + PD[1] * 0.55, 0.9 + PD[2] * 0.55],
    ], 0.035, MAT.lead, 40));
  });

  /* oil filter */
  const of = part('oilfilter', 'Oil filter', { from: [0, 0, 1] });
  of.add(cyl(0.3, 0.6, MAT.filter, 'z', 1.5, 0.6, 1.2, 20), cyl(0.2, 0.06, MAT.black, 'z', 1.5, 0.6, 1.52, 6));

  for (const p of parts) p.base = p.group.position.clone();
  return parts;
}

// Drive every moving part from one crank angle.
export function setCrank(parts, theta) {
  for (const p of parts) {
    for (const s of p.spin) s.obj.rotation.x = theta * s.ratio;
    if (p.kin) {
      const a = theta + p.kin.phase;
      const pz = CRANK_R * Math.sin(a);
      const wy = CRANK_R * Math.cos(a) + Math.sqrt(ROD_L * ROD_L - pz * pz);
      p.kin.hd.position.y = wy;
      p.kin.rod.position.y = wy;
      p.kin.rod.rotation.x = -Math.asin(pz / ROD_L);
    }
  }
}

export function buildStand(floorY) {
  const g = new THREE.Group();
  g.add(
    box(1.2, 1.0, 0.06, MAT.stand, 0, 1.0, -0.95),
    box(0.5, 0.45, 2.0, MAT.stand, 0, 1.0, -1.95),
    box(0.45, 1.25 - floorY, 0.45, MAT.stand, 0, (1.25 + floorY) / 2, -2.95),
    box(3.4, 0.25, 0.4, MAT.stand, 0, floorY + 0.125, -2.95),
    box(0.4, 0.25, 5.2, MAT.stand, 0, floorY + 0.125, -0.6),
  );
  for (const [x, z] of [[-1.6, -2.95], [1.6, -2.95], [0, 1.9]]) g.add(cyl(0.2, 0.16, MAT.rubber, 'x', x, floorY + 0.2, z, 16));
  return g;
}

// A ratchet spanner shown on the bolt being turned.
export function buildSpanner() {
  const g = new THREE.Group();
  const head = cyl(0.19, 0.12, MAT.steel, 'y', 0, 0, 0, 16);
  const handle = box(1.3, 0.06, 0.12, MAT.steel, 0.75, 0, 0);
  const grip = box(0.5, 0.09, 0.15, MAT.stand, 1.2, 0, 0);
  g.add(head, handle, grip);
  g.traverse((o) => { o.castShadow = false; o.raycast = () => {}; });
  return g;
}
