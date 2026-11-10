// The engine: a 1.6 litre SOHC eight-valve inline four, modelled at true size.
// Units: 1 = 10 cm. Crankshaft axis is the X axis (front of engine at -X), Y is up, crank centre at the origin.
//
// Reference dimensions (typical of the engine type, e.g. 1970s–80s European 1.6 SOHC fours):
//   bore 81 mm · stroke 86.4 mm · bore spacing 88 mm · con-rod 144 mm centre to centre
//   main journals 54 mm (five mains) · rod journals 48 mm · deck height 225 mm · block 400 mm long
//   flywheel 270 mm with ring gear · crank pulley 130 mm · timing chain 3/8" (9.525 mm) pitch
//   spark plugs 16 mm hex · oil filter 76 x 90 mm · alternator 120 mm diameter
// Fastener heads are true size: the spanner size in mm is the distance across the flats.
import * as THREE from '../vendor/three.module.min.js';
import { MAT, mesh, box, cyl, lathe, exX, exY, exZ, rbox, tube, circ, roundRect, hullOf, gear, merge, bake } from './geo.js';

export { MAT };
export const CRANK_R = 0.432;
export const ROD_L = 1.44;
const BORE = 0.405, SPACING = 0.88, PIN_H = 0.38;                 // piston pin to crown
const DECK = CRANK_R + ROD_L + PIN_H;                             // 2.252
const CYL_X = [-1.5, -0.5, 0.5, 1.5].map((k) => k * SPACING);
const MAIN_X = [-2, -1, 0, 1, 2].map((k) => k * SPACING);
const PHASE = [0, Math.PI, Math.PI, 0];
const FRONT = -2.0, REAR = 2.0, BANK = 0.84, CASE = 1.05;         // block ends and half-widths
const HEAD_B = DECK + 0.02, HEAD_F = 3.05, HEAD_T = 3.22;         // head: bottom face, cam-tray floor, cover rail
const CAM_Y = 3.33, CHAIN_X = -2.25, BELT_X = -2.61;
const PLUG_DIR = [0, 0.5, 0.866];
export const EXHAUST_TIP = [-0.15, 0.9, 1.5];

/* ---------- fasteners ---------- */
const UP = new THREE.Vector3(0, 1, 0);
const boltGeo = {};
export const boltRadius = (size) => size * 0.00577;               // across-flats (mm) -> corner radius
const BOLT_TRAVEL = 0.2;

function makeBolt(pos, dir, size) {
  const r = boltRadius(size);
  boltGeo[size] ||= merge([
    new THREE.CylinderGeometry(r, r, r * 0.9, 6).translate(0, 0.02 + r * 0.45, 0),          // hex head
    new THREE.CylinderGeometry(r * 1.3, r * 1.3, 0.02, 18).translate(0, 0.01, 0),          // flange
    new THREE.CylinderGeometry(r * 0.55, r * 0.55, 0.34, 10).translate(0, -0.17, 0),       // shank
  ]);
  const group = new THREE.Group();
  group.userData.keep = true;
  group.position.set(...pos);
  group.quaternion.setFromUnitVectors(UP, new THREE.Vector3(...dir).normalize());
  const inner = new THREE.Group();
  const head = mesh(boltGeo[size], MAT.zinc);
  head.userData.solid = true;
  inner.add(head);
  group.add(inner);
  const b = { group, inner, head, size, tight: 0 };
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
      if (extra) extra(b.inner);
      b.inner.traverse((o) => (o.userData.bolt = b));
      p.bolts.push(b);
      return b;
    };
    parts.push(p);
    return p;
  }
  const sub = (x = 0, y = 0, z = 0) => { const g = new THREE.Group(); g.position.set(x, y, z); return g; };
  const pistons = ['piston1', 'piston2', 'piston3', 'piston4'];
  const caps = ['maincap1', 'maincap2', 'maincap3', 'maincap4', 'maincap5'];
  const plugs = ['plug1', 'plug2', 'plug3', 'plug4'];
  const deckOutline = roundRect(FRONT, -BANK, REAR, BANK, 0.1);
  const disc = (x, z, r) => circ(x, z, r, 20);
  const headBolts = [];
  for (const x of MAIN_X) for (const s of [-1, 1]) headBolts.push([x * 0.97, s * 0.5]);
  const coolant = CYL_X.flatMap((x) => [disc(x + 0.44, 0.68, 0.045), disc(x - 0.3, -0.68, 0.045)]);

  /* ----- block ----- */
  const blk = part('block', 'Engine block', { req: [] });
  blk.add(exY(deckOutline, [...CYL_X.map((x) => circ(x, 0, BORE, 40)), ...headBolts.map(([x, z]) => disc(x, z, 0.055)), ...coolant], 0.5, DECK - 0.5, MAT.block));
  for (const s of [-1, 1]) {
    // crankcase skirt, flaring out from the cylinder bank down to the pan rail at the crank centreline
    blk.add(exX([[s * BANK, 0.62], [s * CASE, 0.3], [s * CASE, 0], [s * 0.93, 0], [s * 0.93, 0.26], [s * 0.72, 0.5], [s * 0.72, 0.62]], [], FRONT, 4, MAT.block));
    for (const x of CYL_X) blk.add(box(0.07, 1.25, 0.05, MAT.block, x + 0.44, 1.35, s * (BANK + 0.02)));        // stiffening ribs
  }
  // main bearing bulkheads with their saddles
  const saddle = [[-0.93, 0], [-0.93, 0.26], [-0.72, 0.52], [0.72, 0.52], [0.93, 0.26], [0.93, 0], ...circ(0, 0, 0.285, 14, 0, 180)];
  MAIN_X.forEach((x, i) => {
    const end = i === 0 || i === 4, w = end ? 0.34 : 0.2, cx = end ? Math.sign(x) * 1.83 : x;
    blk.add(exX(saddle, [], cx - w / 2, w, MAT.block));
  });
  // rear face: bellhousing flange around the crank seal
  blk.add(exX([...circ(0, 0.25, 1.22, 24, 0, 180), [-1.22, 0], [-0.5, 0], ...circ(0, 0, 0.5, 14, 180, 0).slice(1, -1), [0.5, 0], [1.22, 0]], [], REAR, 0.08, MAT.block));
  // core plugs, oil filter boss, distributor boss
  for (const x of [-0.88, 0, 0.88]) blk.add(lathe([[0, 0], [0.17, 0], [0.19, 0.03], [0.15, 0.03], [0.14, 0.012], [0, 0.012]], MAT.steel, 'z', 20, x, 1.45, BANK));
  blk.add(cyl(0.3, 0.06, MAT.block, 'z', 1.3, 1.05, BANK + 0.03, 24), cyl(0.24, 0.1, MAT.block, 'z', 1.1, 1.3, -BANK - 0.03, 20));

  /* ----- crankshaft ----- */
  const crank = part('crank', 'Crankshaft', { from: [0, -1, 0] });
  for (const x of MAIN_X) crank.add(cyl(0.27, 0.2, MAT.steel, 'x', x, 0, 0, 32));
  const web = hullOf([...circ(0, CRANK_R, 0.35, 20), ...circ(0, 0, 0.42, 20), ...circ(0, 0, 0.73, 16, 215, 325)]);
  CYL_X.forEach((x, i) => {
    const s = Math.cos(PHASE[i]);
    crank.add(cyl(0.24, 0.26, MAT.steel, 'x', x, s * CRANK_R, 0, 32));
    const shape = web.map(([z, y]) => [z, s * y]);
    crank.add(exX(shape, [], x - 0.34, 0.21, MAT.iron), exX(shape, [], x + 0.13, 0.21, MAT.iron));
  });
  crank.add(
    cyl(0.2, 0.84, MAT.steel, 'x', -2.28, 0, 0, 28),                            // snout for sprocket and pulley
    box(0.3, 0.05, 0.05, MAT.dark, -2.45, 0.2, 0),                              // Woodruff key
    cyl(0.42, 0.26, MAT.steel, 'x', 1.99, 0, 0, 36),                            // flywheel flange
  );
  for (let i = 0; i < 6; i++) crank.add(cyl(0.04, 0.012, MAT.dark, 'x', 2.121, Math.cos(i * 1.047) * 0.3, Math.sin(i * 1.047) * 0.3, 10));
  crank.spin.push({ obj: crank.group, ratio: 1 });

  /* ----- main bearing caps ----- */
  const capShape = [[-0.55, 0], [-0.55, -0.38], [0.55, -0.38], [0.55, 0], ...circ(0, 0, 0.285, 14, 0, -180)];
  MAIN_X.forEach((x, i) => {
    const c = part(caps[i], `Main bearing cap ${i + 1}`, { req: ['crank'], from: [0, -1, 0] });
    c.add(exX(capShape, [], x - 0.1, 0.2, MAT.iron));
    for (const s of [-1, 1]) c.bolt([x, -0.38, s * 0.42], [0, -1, 0], 17);
  });

  /* ----- pistons and connecting rods ----- */
  const pistonProfile = [[0, 0.2], [0.36, 0.2], [0.36, -0.24], [0.4, -0.24], [0.4, 0.165], [0.385, 0.17], [0.385, 0.2], [0.4, 0.205],
    [0.4, 0.245], [0.385, 0.25], [0.385, 0.27], [0.4, 0.275], [0.4, 0.305], [0.385, 0.31], [0.385, 0.33], [0.4, 0.335], [0.4, 0.365], [0.385, 0.38], [0, 0.38]];
  const rodShape = [...circ(0, 0, 0.17, 20, -60, 240), ...circ(0, -ROD_L, 0.3, 28, 110, 430)];
  CYL_X.forEach((x, i) => {
    const p = part(pistons[i], `Piston ${i + 1}`, { req: ['crank'] });
    p.group.position.x = x;
    const hd = sub(), rod = sub();
    hd.add(lathe(pistonProfile, MAT.alu, 'y', 40), cyl(0.1, 0.66, MAT.steel, 'x', 0, 0, 0, 18));
    for (const y of [0.185, 0.26, 0.32]) hd.add(cyl(0.402, 0.022, MAT.dark, 'y', 0, y, 0, 40));         // rings
    rod.add(exX(rodShape, [circ(0, 0, 0.105, 18), circ(0, -ROD_L, 0.245, 28)], -0.11, 0.22, MAT.iron));
    for (const s of [-1, 1]) {
      rod.add(box(0.22, 0.26, 0.12, MAT.iron, 0, -ROD_L, s * 0.33));
      p.bolt([0, -ROD_L - 0.13, s * 0.33], [0, -1, 0], 12, rod);
    }
    p.add(hd, rod);
    p.kin = { hd, rod, phase: PHASE[i] };
  });

  /* ----- oil pan ----- */
  const pan = part('oilpan', 'Oil pan', { from: [0, -1, 0], covers: ['crank', ...caps] });
  pan.add(
    exY(roundRect(FRONT, -CASE, REAR, CASE, 0.1), [], -0.03, 0.03, MAT.black),
    exY(roundRect(-1.87, -0.85, 0.4, 0.85, 0.2), [], -0.97, 0.94, MAT.black, 0.08),                 // shallow front
    exY(roundRect(0.2, -0.85, 1.87, 0.85, 0.2), [], -1.37, 1.34, MAT.black, 0.08),                  // sump
    cyl(0.1, 0.08, MAT.zinc, 'x', 1.99, -1.2, 0, 6), cyl(0.14, 0.02, MAT.copper, 'x', 1.96, -1.2, 0, 16),   // drain plug
  );
  for (const x of [-1.7, -0.85, 0, 0.85, 1.7]) for (const s of [-1, 1]) pan.bolt([x, -0.03, s * 0.99], [0, -1, 0], 8);

  /* ----- head gasket ----- */
  const gasket = part('gasket', 'Head gasket');
  gasket.add(exY(deckOutline, [...CYL_X.map((x) => circ(x, 0, BORE + 0.028, 40)), ...headBolts.map(([x, z]) => disc(x, z, 0.06)), ...coolant], DECK, 0.016, MAT.gasket));
  for (const x of CYL_X) gasket.add(exY(circ(x, 0, BORE + 0.03, 40), [circ(x, 0, BORE + 0.008, 40)], DECK - 0.002, 0.02, MAT.steel));   // fire rings

  /* ----- cylinder head ----- */
  const head = part('head', 'Cylinder head', { covers: ['gasket', ...pistons] });
  head.add(
    exY(deckOutline, CYL_X.map((x) => circ(x, 0, 0.39, 32)), HEAD_B, 0.1, MAT.alu),                                // combustion chambers
    exY(deckOutline, [], HEAD_B + 0.1, HEAD_F - HEAD_B - 0.1, MAT.alu),
    exY(deckOutline, [roundRect(FRONT + 0.12, -0.72, REAR - 0.12, 0.72, 0.08)], HEAD_F, HEAD_T - HEAD_F, MAT.alu),   // cover rail
  );
  const pedestal = [[-0.3, HEAD_F], [-0.3, CAM_Y], ...circ(0, CAM_Y, 0.135, 12, 180, 360), [0.3, CAM_Y], [0.3, HEAD_F]];
  for (const x of MAIN_X) head.add(exX(pedestal, [], x * 0.97 - 0.09, 0.18, MAT.alu));
  CYL_X.forEach((x) => {
    head.add(
      cyl(0.17, 0.02, MAT.steel, 'y', x - 0.17, HEAD_B + 0.09, 0, 20), cyl(0.145, 0.02, MAT.steel, 'y', x + 0.18, HEAD_B + 0.09, 0, 20),   // valve heads
      cyl(0.17, 0.02, MAT.plastic, 'z', x, 2.62, BANK + 0.006, 24), cyl(0.17, 0.02, MAT.plastic, 'z', x, 2.66, -BANK - 0.006, 24),         // ports
      cyl(0.13, 0.07, MAT.steel, 'y', x - 0.2, HEAD_F + 0.035, 0, 16), cyl(0.13, 0.07, MAT.steel, 'y', x + 0.2, HEAD_F + 0.035, 0, 16),    // spring retainers
    );
  });
  for (const [x, z] of headBolts) head.bolt([x, HEAD_F, z], [0, 1, 0], 14);

  /* ----- camshaft and its bearing caps ----- */
  const cam = part('camshaft', 'Camshaft', { req: ['head'] });
  const shaft = sub(0, CAM_Y, 0);
  shaft.add(cyl(0.1, 4.32, MAT.steel, 'x', -0.26, 0, 0, 20));
  for (const x of MAIN_X) shaft.add(cyl(0.132, 0.18, MAT.steel, 'x', x * 0.97, 0, 0, 24));
  const lobe = hullOf([...circ(0, 0, 0.16, 24), ...circ(0, 0.1, 0.085, 16)]);
  CYL_X.forEach((x, i) => {
    const base = [0, 4.712, 1.571, 3.142][i];                       // firing order 1-3-4-2, at half crank speed
    for (const [dx, off] of [[-0.2, 0], [0.2, 1.92]]) {
      const l = exX(lobe, [], x + dx - 0.07, 0.14, MAT.steel);
      l.rotation.x = base + off;
      shaft.add(l);
    }
  });
  cam.add(shaft);
  const camCap = [[-0.3, CAM_Y], [-0.3, CAM_Y + 0.2], [0.3, CAM_Y + 0.2], [0.3, CAM_Y], ...circ(0, CAM_Y, 0.135, 12, 0, 180)];
  for (const x of MAIN_X) {
    cam.add(exX(camCap, [], x * 0.97 - 0.09, 0.18, MAT.alu));
    for (const s of [-1, 1]) cam.bolt([x * 0.97, CAM_Y + 0.2, s * 0.22], [0, 1, 0], 10);
  }
  cam.spin.push({ obj: shaft, ratio: 0.5 });

  /* ----- timing drive ----- */
  const cs = part('cranksprocket', 'Crank sprocket', { req: ['crank'], from: [-1, 0, 0] });
  cs.add(exX(gear(0.29, 0.34, 19), [circ(0, 0, 0.2, 24)], CHAIN_X - 0.05, 0.1, MAT.dark), exX(circ(0, 0, 0.26, 24), [circ(0, 0, 0.2, 24)], CHAIN_X - 0.09, 0.18, MAT.dark));
  cs.spin.push({ obj: cs.group, ratio: 1 });

  const cams = part('camsprocket', 'Cam sprocket', { req: ['camshaft'], from: [-1, 0, 0] });
  cams.group.position.set(CHAIN_X, CAM_Y, 0);
  const lighten = [];
  for (let i = 0; i < 5; i++) lighten.push(circ(Math.cos(i * 1.2566) * 0.38, Math.sin(i * 1.2566) * 0.38, 0.12, 14));
  cams.add(exX(gear(0.61, 0.66, 38), lighten, -0.05, 0.1, MAT.dark), cyl(0.17, 0.16, MAT.dark, 'x', 0, 0, 0, 20), cyl(0.11, 0.02, MAT.zinc, 'x', -0.09, 0, 0, 16));
  cams.bolt([-0.1, 0, 0], [-1, 0, 0], 13);
  cams.spin.push({ obj: cams.group, ratio: 0.5 });

  const chain = part('chain', 'Timing chain', { req: ['cranksprocket', 'camsprocket'], from: [-1, 0, 0] });
  chain.add(mesh(chainGeometry(hullOf([...circ(0, CAM_Y, 0.635, 48), ...circ(0, 0, 0.315, 24)])), MAT.steel));

  const tc = part('timingcover', 'Timing cover', { from: [-1, 0, 0], covers: ['cranksprocket', 'camsprocket', 'chain'] });
  tc.add(
    exX(hullOf([...circ(0, CAM_Y, 0.8, 40), ...circ(0, 0, 0.54, 28)]), [], -2.46, 0.46, MAT.alu, 0.03),
    lathe([[0.2, 0], [0.34, 0], [0.34, 0.05], [0.26, 0.06], [0.2, 0.06], [0.2, 0]], MAT.alu, 'x', 28, -2.52, 0, 0),      // crank seal housing
    cyl(0.25, 0.02, MAT.rubber, 'x', -2.5, 0, 0, 28),
  );
  for (const y of [0.9, 1.3, 2.5, 2.9]) tc.add(box(0.03, 0.05, 1.0, MAT.alu, -2.495, y, 0));
  for (const [y, z] of [[-0.32, 0.32], [1.3, 0.52], [3.72, 0.56]]) for (const s of [-1, 1]) tc.bolt([-2.49, y, s * z], [-1, 0, 0], 10);

  /* ----- belt drive ----- */
  const vPulley = (r, hub) => [[0, -0.09], [hub, -0.09], [hub, -0.05], [r - 0.12, -0.05], [r, -0.06], [r, -0.035], [r - 0.07, 0], [r, 0.035], [r, 0.06], [r - 0.12, 0.05], [hub, 0.05], [hub, 0.11], [0, 0.11]];
  const pulley = part('pulley', 'Crank pulley', { req: ['crank', 'timingcover'], from: [-1, 0, 0] });
  pulley.add(lathe(vPulley(0.65, 0.26), MAT.dark, 'x', 40, BELT_X, 0, 0), box(0.03, 0.06, 0.03, MAT.ceramic, BELT_X - 0.06, 0.63, 0), cyl(0.16, 0.02, MAT.zinc, 'x', BELT_X - 0.1, 0, 0, 20));
  pulley.bolt([BELT_X - 0.11, 0, 0], [-1, 0, 0], 19);
  pulley.spin.push({ obj: pulley.group, ratio: 1 });

  const wp = part('waterpump', 'Water pump', { req: ['timingcover'], from: [-1, 0, 0] });
  const ears = [[0.4, 0.4], [-0.4, 0.4], [-0.4, -0.4], [0.4, -0.4]];
  wp.add(
    exX(hullOf([...circ(0, 1.85, 0.44, 28), ...ears.flatMap(([z, y]) => circ(z, 1.85 + y, 0.11, 12))]), [], -2.53, 0.04, MAT.alu),
    lathe([[0, 0], [0.16, 0], [0.16, 0.03], [0.3, 0.05], [0.34, 0.1], [0, 0.1]], MAT.alu, 'x', 28, -2.63, 1.85, 0),
  );
  const wpp = sub(BELT_X, 1.85, 0);
  wpp.add(lathe(vPulley(0.45, 0.14), MAT.dark, 'x', 32), box(0.02, 0.06, 0.03, MAT.ceramic, -0.06, 0.4, 0));
  wp.add(wpp);
  for (const [z, y] of ears) wp.bolt([-2.53, 1.85 + y, z], [-1, 0, 0], 10);
  wp.spin.push({ obj: wpp, ratio: 1.45 });

  const AY = 1.25, AZ = -1.9;                                        // alternator axis
  const alt = part('alternator', 'Alternator', { from: [0, 0, -1] });
  alt.add(
    lathe([[0, -1.25], [0.4, -1.25], [0.56, -1.31], [0.6, -1.45], [0.6, -1.67], [0, -1.67]], MAT.alu, 'x', 32, 0, AY, AZ),      // rear end frame
    cyl(0.61, 0.3, MAT.dark, 'x', -1.82, AY, AZ, 32),                                               // stator laminations
    lathe([[0, -1.97], [0.6, -1.97], [0.6, -2.19], [0.54, -2.33], [0.3, -2.37], [0.14, -2.37], [0.14, -2.43], [0, -2.43]], MAT.alu, 'x', 32, 0, AY, AZ),   // drive end frame
    cyl(0.05, 0.3, MAT.steel, 'x', -2.5, AY, AZ, 10),                                               // shaft
    cyl(0.13, 0.5, MAT.alu, 'x', -1.6, AY - 0.68, AZ + 0.1, 14),                                    // pivot ear
    cyl(0.1, 0.16, MAT.alu, 'x', -2.2, AY + 0.7, AZ + 0.1, 14),                                     // adjuster ear
    box(0.1, 0.8, 1.06, MAT.iron, -1.2, 1.15, -1.4),                                                // bracket behind the body
    box(0.5, 0.8, 0.06, MAT.iron, -0.9, 1.15, -BANK - 0.03),                                        // bracket foot on the block
    box(0.5, 0.14, 0.14, MAT.iron, -1.4, AY - 0.68, AZ + 0.1),
  );
  for (let i = 0; i < 12; i++) {                                     // cooling slots in both end frames
    const a = (i / 12) * Math.PI * 2, y = AY + Math.cos(a) * 0.42, z = AZ + Math.sin(a) * 0.42;
    for (const x of [-2.365, -1.275]) { const slot = box(0.03, 0.2, 0.07, MAT.plastic, x, y, z); slot.rotation.x = a; alt.add(slot); }
  }
  const altp = sub(BELT_X, AY, AZ);
  altp.add(lathe(vPulley(0.32, 0.12), MAT.dark, 'x', 28), cyl(0.5, 0.02, MAT.zinc, 'x', 0.14, 0, 0, 28));
  for (let i = 0; i < 10; i++) { const f = box(0.06, 0.12, 0.02, MAT.zinc, 0.17, Math.cos(i * 0.628) * 0.42, Math.sin(i * 0.628) * 0.42); f.rotation.x = i * 0.628; altp.add(f); }
  alt.add(altp);
  for (const y of [0.92, 1.38]) alt.bolt([-0.9, y, -BANK - 0.06], [0, 0, -1], 13);
  alt.spin.push({ obj: altp, ratio: 2 });

  const inner = hullOf([...circ(0, 0, 0.6, 40), ...circ(0, 1.85, 0.4, 32), ...circ(AZ, AY, 0.27, 24)]);
  const mid = [0, 1].map((k) => inner.reduce((s, p) => s + p[k], 0) / inner.length);
  const outer = inner.map(([z, y]) => { const l = Math.hypot(z - mid[0], y - mid[1]); return [z + ((z - mid[0]) / l) * 0.075, y + ((y - mid[1]) / l) * 0.075]; });
  const belt = part('belt', 'Fan belt', { req: ['pulley', 'waterpump', 'alternator'], from: [-1, 0, 0] });
  belt.add(exX(outer, [inner], BELT_X - 0.05, 0.1, MAT.rubber));

  /* ----- flywheel ----- */
  const fly = part('flywheel', 'Flywheel', { req: ['crank'], from: [1, 0, 0] });
  fly.add(
    lathe([[0, 0], [1.3, 0], [1.3, 0.18], [1.2, 0.26], [0.72, 0.26], [0.68, 0.18], [0, 0.18]], MAT.iron, 'x', 64, 2.12, 0, 0),
    exX(gear(1.31, 1.37, 120), [circ(0, 0, 1.24, 64)], 2.14, 0.12, MAT.dark),                       // starter ring gear
  );
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    fly.bolt([2.3, Math.cos(a) * 0.3, Math.sin(a) * 0.3], [1, 0, 0], 13);
    fly.add(cyl(0.05, 0.012, MAT.plastic, 'x', 2.381, Math.cos(a + 0.52) * 1.1, Math.sin(a + 0.52) * 1.1, 12));   // clutch cover threads
  }
  fly.spin.push({ obj: fly.group, ratio: 1 });

  /* ----- rocker cover ----- */
  const rc = part('rockercover', 'Rocker cover', { req: ['head'], covers: ['camshaft'] });
  const T = HEAD_T;
  rc.add(
    exX([[-0.84, T], [-0.84, T + 0.05], [-0.74, T + 0.05], [-0.74, 3.62], [-0.58, 3.9], [0.58, 3.9], [0.74, 3.62], [0.74, T + 0.05], [0.84, T + 0.05], [0.84, T]], [], -1.99, 3.98, MAT.red),
    lathe([[0, 0], [0.2, 0], [0.22, 0.03], [0.22, 0.12], [0.18, 0.15], [0, 0.15]], MAT.plastic, 'y', 20, -1.3, 3.9, 0),      // oil filler cap
    cyl(0.07, 0.3, MAT.red, 'z', 0.3, 3.75, -0.7, 12),                                                                 // breather stub
  );
  for (const z of [-0.3, 0.3]) rc.add(box(3.4, 0.03, 0.07, MAT.red, 0.2, 3.905, z));
  for (const x of [-1.6, 0, 1.6]) for (const s of [-1, 1]) rc.bolt([x, T + 0.05, s * 0.79], [0, 1, 0], 8);

  /* ----- spark plugs: the hex of the plug body is what you turn ----- */
  CYL_X.forEach((x, i) => {
    const sp = part(plugs[i], `Spark plug ${i + 1}`, { req: ['head'], from: PLUG_DIR });
    sp.bolt([x, 2.98, BANK], PLUG_DIR, 16, sp.group, (inner) => {
      const c = lathe([[0, 0.09], [0.07, 0.09], [0.07, 0.16], [0.058, 0.18], [0.058, 0.21], [0.05, 0.22], [0.058, 0.25], [0.05, 0.26], [0.058, 0.29], [0.05, 0.3], [0.058, 0.33], [0.045, 0.4], [0, 0.4]], MAT.ceramic, 'y', 16);
      const t = lathe([[0, 0.4], [0.03, 0.4], [0.03, 0.44], [0.04, 0.45], [0.04, 0.49], [0.025, 0.51], [0, 0.51]], MAT.steel, 'y', 12);
      for (const m of [c, t]) { m.geometry = merge([m.geometry]); m.userData.solid = true; }
      inner.add(c, t);
    });
  });

  /* ----- exhaust manifold ----- */
  const ex = part('exhaust', 'Exhaust manifold', { req: ['head'], from: [0, 0, 1] });
  const TX = EXHAUST_TIP[0];
  ex.add(exZ(roundRect(-1.86, 2.38, 1.86, 2.86, 0.12), CYL_X.map((x) => circ(x, 2.62, 0.15, 20)), BANK + 0.006, 0.1, MAT.rust));
  CYL_X.forEach((x) => ex.add(tube([[x, 2.62, 0.94], [x, 2.6, 1.25], [x * 0.75, 2.25, 1.5], [x * 0.35 - 0.1, 1.75, 1.52], [TX + x * 0.05, 1.42, 1.5]], 0.19, MAT.rust, 24, 14)));
  ex.add(
    lathe([[0, 0], [0.24, 0], [0.24, 0.1], [0.34, 0.5], [0, 0.5]], MAT.rust, 'y', 24, TX, 1.0, 1.5),                          // collector
    exY(hullOf([...circ(TX, 1.5, 0.3, 20), ...circ(TX + 0.42, 1.5, 0.09, 10), ...circ(TX - 0.42, 1.5, 0.09, 10)]), [circ(TX, 1.5, 0.2, 20)], 0.94, 0.07, MAT.rust),
    cyl(0.2, 0.01, MAT.plastic, 'y', TX, 0.975, 1.5, 20),                                                              // looking up the outlet
  );
  for (const x of MAIN_X) ex.bolt([x * 0.99, 2.62, BANK + 0.106], [0, 0, 1], 12);

  /* ----- intake manifold and carburettor ----- */
  const inl = part('intake', 'Intake manifold', { req: ['head'], from: [0, 0, -1] });
  inl.add(exZ(roundRect(-1.86, 2.42, 1.86, 2.9, 0.12), CYL_X.map((x) => circ(x, 2.66, 0.15, 20)), -BANK - 0.106, 0.1, MAT.alu));
  CYL_X.forEach((x) => inl.add(tube([[x, 2.66, -0.94], [x, 2.72, -1.3], [x * 0.92, 2.95, -1.62], [x * 0.88, 3.12, -1.82]], 0.19, MAT.alu, 16, 14)));
  inl.add(
    lathe([[0, -1.62], [0.22, -1.62], [0.3, -1.52], [0.3, 1.52], [0.22, 1.62], [0, 1.62]], MAT.alu, 'x', 24, 0, 3.15, -1.85),   // plenum
    rbox(0.9, 0.12, 0.7, 0.03, MAT.alu, 0, 3.44, -1.85),
  );
  for (const x of MAIN_X) inl.bolt([x * 0.99, 2.66, -BANK - 0.106], [0, 0, -1], 12);

  const carb = part('carb', 'Carburettor', { req: ['intake'] });
  const CZ = -1.85;
  carb.add(
    rbox(0.84, 0.06, 0.62, 0.02, MAT.zinc, 0, 3.53, CZ), rbox(0.5, 0.3, 0.5, 0.04, MAT.zinc, 0, 3.71, CZ), rbox(0.56, 0.36, 0.5, 0.05, MAT.zinc, 0, 4.04, CZ),
    rbox(0.26, 0.34, 0.4, 0.04, MAT.zinc, 0.4, 3.98, CZ),                                           // float bowl
    lathe([[0.2, 0], [0.3, 0], [0.31, 0.16], [0.28, 0.18], [0.22, 0.16], [0.2, 0]], MAT.zinc, 'y', 28, 0, 4.2, CZ),   // air horn
    cyl(0.215, 0.012, MAT.plastic, 'y', 0, 4.225, CZ, 24),                                          // throat
    cyl(0.03, 0.8, MAT.steel, 'x', -0.05, 3.71, CZ, 8), box(0.03, 0.3, 0.08, MAT.steel, -0.42, 3.8, CZ),     // throttle shaft and lever
    cyl(0.04, 0.2, MAT.copper, 'z', 0.4, 4.05, CZ + 0.28, 8),                                       // fuel inlet
  );
  for (const s of [-1, 1]) carb.bolt([s * 0.35, 3.56, CZ], [0, 1, 0], 10);

  /* ----- distributor ----- */
  const dist = part('distributor', 'Distributor', { from: [0, 0.574, -0.819] });
  dist.group.position.set(1.1, 1.3, -BANK - 0.08);
  dist.group.rotation.x = -0.96;
  dist.add(
    lathe([[0, 0], [0.16, 0], [0.16, 0.2], [0.3, 0.26], [0.3, 0.58], [0, 0.58]], MAT.alu, 'y', 28),
    lathe([[0, 0.58], [0.33, 0.58], [0.33, 0.78], [0.26, 0.9], [0, 0.92]], MAT.cap, 'y', 28),
    cyl(0.17, 0.12, MAT.dark, 'x', 0.47, 0.42, 0, 20), cyl(0.05, 0.14, MAT.dark, 'x', 0.34, 0.42, 0, 8),   // vacuum advance
    rbox(0.56, 0.26, 0.04, 0.012, MAT.iron, 0.26, 0.02, 0).rotateX(Math.PI / 2),                    // clamp plate
  );
  const towers = [[0, 0], [0.19, 0], [-0.19, 0], [0, 0.19], [0, -0.19]];
  for (const [x, z] of towers) dist.add(cyl(0.05, 0.16, MAT.cap, 'y', x, 0.97, z, 12));
  dist.bolt([0.44, 0.04, 0], [0, 1, 0], 10);

  /* ----- ignition leads ----- */
  const leads = part('leads', 'Ignition leads', { req: ['distributor', ...plugs] });
  const towerTip = (t) => {                                          // in engine coordinates
    const v = new THREE.Vector3(t[0], 1.06, t[1]).applyEuler(dist.group.rotation).add(dist.group.position);
    return [v.x, v.y, v.z];
  };
  CYL_X.forEach((x, i) => {
    const tip = [x, 2.98 + PLUG_DIR[1] * 0.5, BANK + PLUG_DIR[2] * 0.5], t = towerTip(towers[i + 1]);
    leads.add(tube([t, [t[0] + 0.3, t[1] + 0.5, t[2] - 0.45], [1.95, 3.0, -1.9], [1.95, 3.8, -1.0], [x * 0.8 + 0.55, 4.06, -0.2], [x + 0.1, 3.98, 0.45], [x, 3.6, 1.2],
      [tip[0], tip[1] + 0.12, tip[2] + 0.2], tip], 0.035, MAT.lead, 56, 8));
    const boot = cyl(0.062, 0.26, MAT.plastic, 'y', x, 2.98, BANK, 10);                              // plug boot
    boot.geometry.translate(0, 0.42, 0);
    boot.quaternion.setFromUnitVectors(UP, new THREE.Vector3(...PLUG_DIR));
    leads.add(boot);
  });

  /* ----- oil filter ----- */
  const of = part('oilfilter', 'Oil filter', { from: [0, 0, 1] });
  of.add(
    lathe([[0, 0], [0.36, 0], [0.38, 0.03], [0.38, 0.78], [0.34, 0.86], [0, 0.9]], MAT.filter, 'z', 32, 1.3, 1.05, BANK + 0.06),
    cyl(0.3, 0.1, MAT.filter, 'z', 1.3, 1.05, BANK + 0.99, 12),                                     // fluted grip
  );

  for (const p of parts) { bake(p.group); p.base = p.group.position.clone(); }
  return parts;
}

// A roller chain following a closed path of (z, y) points: alternating inner and outer links at 3/8" pitch.
function chainGeometry(path) {
  const pitch = 0.09525, geos = [];
  const seg = path.map((p, i) => { const q = path[(i + 1) % path.length]; return { p, q, len: Math.hypot(q[0] - p[0], q[1] - p[1]) }; });
  const total = seg.reduce((s, e) => s + e.len, 0), n = Math.round(total / pitch / 2) * 2, step = total / n;
  const at = (d) => { for (const e of seg) { if (d <= e.len) { const t = d / e.len; return [e.p[0] + (e.q[0] - e.p[0]) * t, e.p[1] + (e.q[1] - e.p[1]) * t]; } d -= e.len; } return seg[0].p; };
  const m = new THREE.Matrix4();
  for (let i = 0; i < n; i++) {
    const a = at(i * step), b = at(((i + 1) % n) * step), ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    m.makeRotationX(-ang).setPosition(CHAIN_X, (a[1] + b[1]) / 2, (a[0] + b[0]) / 2);
    for (const s of [-1, 1]) geos.push(new THREE.BoxGeometry(0.012, 0.075, step + 0.06).translate(s * (i % 2 ? 0.05 : 0.036), 0, 0).applyMatrix4(m));
    geos.push(new THREE.CylinderGeometry(0.03, 0.03, 0.09, 8).rotateZ(Math.PI / 2).translate(CHAIN_X, a[1], a[0]));
  }
  return merge(geos);
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

// Engine stand: head plate on a rotating tube, upright post, T-shaped base on castors.
export function buildStand(floorY) {
  const g = new THREE.Group();
  const Z = -BANK;
  g.add(
    rbox(1.2, 1.0, 0.08, 0.02, MAT.stand, 0, 1.2, Z - 0.05),                                         // head plate
    cyl(0.3, 1.7, MAT.stand, 'z', 0, 1.2, Z - 0.95, 20), cyl(0.36, 0.5, MAT.stand, 'z', 0, 1.2, Z - 1.75, 20),   // tube in its sleeve
    cyl(0.05, 1.5, MAT.steel, 'y', 0, 1.2, Z - 1.75, 10),                                            // turning handle
    box(0.6, 1.45 - floorY, 0.6, MAT.stand, 0, (1.45 + floorY) / 2, Z - 2.15),                       // post
    box(5.2, 0.5, 0.6, MAT.stand, 0, floorY + 0.75, Z - 2.15),                                       // rear cross-member
    box(0.6, 0.5, 6.6, MAT.stand, 0, floorY + 0.75, Z + 0.9),                                        // front leg
  );
  const brace = box(0.4, 3.2, 0.3, MAT.stand, 0, floorY + 2.1, Z - 1.3); brace.rotation.x = -0.55; g.add(brace);
  for (const [x, y] of [[-0.45, 0.85], [0.45, 0.85], [-0.45, 1.55], [0.45, 1.55]]) g.add(cyl(0.08, 0.06, MAT.zinc, 'z', x, y, Z - 0.11, 6));
  for (const [x, z] of [[-2.4, Z - 2.15], [2.4, Z - 2.15], [0, Z + 3.9]]) {
    g.add(cyl(0.38, 0.3, MAT.rubber, 'x', x, floorY + 0.38, z, 20), cyl(0.12, 0.34, MAT.zinc, 'x', x, floorY + 0.38, z, 10));
  }
  return bake(g);
}

// A ratchet spanner shown on the bolt being turned.
export function buildSpanner() {
  const g = new THREE.Group();
  g.add(cyl(0.13, 0.1, MAT.steel, 'y', 0, 0.02, 0, 18), rbox(1.5, 0.12, 0.05, 0.02, MAT.steel, 0.82, 0.02, 0).rotateX(Math.PI / 2), rbox(0.6, 0.16, 0.09, 0.03, MAT.stand, 1.4, 0.02, 0).rotateX(Math.PI / 2));
  g.traverse((o) => { o.castShadow = false; o.raycast = () => {}; });
  return g;
}
