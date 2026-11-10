import * as THREE from '../vendor/three.module.min.js';
import { RoomEnvironment } from '../vendor/RoomEnvironment.js';
import { buildEngine, buildStand, buildSpanner, setTight, setCrank } from './engine.js';
import { buildWorld, ROOM, ENGINE_POS, SHELF } from './world.js';
import { sfx, unlockAudio } from './audio.js';

const $ = (id) => document.getElementById(id);
const SAVE_KEY = 'bolt-by-bolt-save-v5';
const SIZES = [8, 10, 12, 13, 14, 16, 17, 19];
const DAY_SECONDS = 900;                 // one full day
const REACH = 24, BOLT_REACH = 17;       // 2.4 m to grab, 1.7 m to wrench
const EYE = 16.5, EYE_CROUCH = 4.6, RADIUS = 2.2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* ================= renderer & scene ================= */
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x86bff0);
scene.fog = new THREE.Fog(0x86bff0, 200, 760);
const camera = new THREE.PerspectiveCamera(68, 1, 0.4, 950);
camera.rotation.order = 'YXZ';

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
pmrem.dispose();
const hemi = new THREE.HemisphereLight(0xdde8ff, 0x57493a, 0.8);
scene.add(hemi);

const world = buildWorld(scene);
const engineRoot = new THREE.Group();
engineRoot.position.copy(ENGINE_POS);
const stand = buildStand(-ENGINE_POS.y);
stand.position.copy(ENGINE_POS);
const looseRoot = new THREE.Group(), heldRoot = new THREE.Group();
scene.add(engineRoot, stand, looseRoot, heldRoot);
for (const [x0, x1, z0, z1] of [[-2, 2, -0.9, 0.9], [-0.5, 0.5, -3.3, -0.9]])
  world.colliders.push({ x0: ENGINE_POS.x + x0, x1: ENGINE_POS.x + x1, z0: ENGINE_POS.z + z0, z1: ENGINE_POS.z + z1 });

const parts = buildEngine();
const byId = Object.fromEntries(parts.map((p) => [p.id, p]));
const fitted = parts.filter((p) => p.id !== 'block');
const totalBolts = parts.reduce((n, p) => n + p.bolts.length, 0);
for (const p of parts) { p.baseQuat = p.group.quaternion.clone(); p.state = 'loose'; }
byId.block.state = 'installed'; byId.block.installed = true;
engineRoot.add(byId.block.group);

const spanner = buildSpanner();
spanner.visible = false;
scene.add(spanner);
const ghostMat = new THREE.MeshBasicMaterial({ color: 0x4cff7a, transparent: true, opacity: 0.35, depthWrite: false });

/* ================= game state ================= */
const SPAWN = { x: 39, z: 80, yaw: 0.6, pitch: -0.12, crouch: false };
const player = { ...SPAWN, eye: EYE };
const time = { day: 1, t: 8 / 24 };
let tool = 13;                            // spanner size in the hand, mm
let held = null;                          // part being carried
let turning = null;                       // bolt under the spanner right now
let wrench = 0;                           // +1 tightening, -1 loosening, while the button is held
let wrenchNote = false;                   // one complaint per press
let target = null;                        // what the crosshair is on
let busy = false, done = false;
const known = {};                         // part id -> spanner size the player has found out

/* ---------- parts lying around ---------- */
const bb = new THREE.Box3();
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();
const AX = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
const quarter = (axis, n = 1) => new THREE.Quaternion().setFromAxisAngle(AX[axis], (n * Math.PI) / 2);
// The 24 ways a part can sit square to the world.
const ORI = [new THREE.Quaternion()];
for (let i = 0; i < ORI.length; i++) for (const a of ['x', 'y']) {
  const q = quarter(a).multiply(ORI[i]);
  if (!ORI.some((o) => o.angleTo(q) < 0.01)) ORI.push(q);
}
// Parts that look the same after a turn about one axis accept those turns too ("y2" = half turn about Y).
// Spark plugs, the belt and the chain go on whichever way you happen to be holding them.
const SYM = { piston: 'y2', maincap: 'y2', gasket: 'y2', head: 'y2', oilpan: 'y2', cranksprocket: 'x4', camsprocket: 'x4', pulley: 'x4', flywheel: 'x4', oilfilter: 'z4' };
const ANY_WAY = ['plug', 'belt', 'chain'];
for (const p of fitted) {
  const kind = p.id.replace(/\d+$/, '');
  p.pivot = bb.setFromObject(p.group).getCenter(new THREE.Vector3());   // centre of the part, in engine coordinates
  p.holdDist = clamp(bb.getSize(v1).length() * 0.55 + 4.5, 5.5, 9);
  p.rot = new THREE.Quaternion();        // how the part is turned relative to how it fits
  p.rotShow = new THREE.Quaternion();
  p.anyWay = ANY_WAY.includes(kind);
  p.syms = [new THREE.Quaternion()];
  const s = SYM[kind];
  if (s) for (let n = 1; n < +s[1]; n++) p.syms.push(quarter(s[0], (n * 4) / +s[1]));
}
const isOriented = (p, q = p.rot) => p.anyWay || p.syms.some((o) => o.angleTo(q) < 0.02);

function pose(p, q) {
  p.group.quaternion.copy(q).multiply(p.baseQuat);
  p.group.position.copy(p.base).applyQuaternion(q);
  if (p.group.parent !== looseRoot) looseRoot.add(p.group);
  return bb.setFromObject(p.group);
}
// Rest a part, turned by q, with the bottom-centre of its bounding box at (x, y, z).
function placeLoose(p, x, y, z, q) {
  const b = pose(p, q);
  b.getCenter(v1);
  p.group.position.x += x - v1.x; p.group.position.y += y - b.min.y; p.group.position.z += z - v1.z;
  p.rot.copy(q);
  p.loose = [x, y, z, q.x, q.y, q.z, q.w];
  p.state = 'loose'; p.installed = false;
}
const placeSaved = (p, a) => placeLoose(p, a[0], a[1], a[2], new THREE.Quaternion(a[3], a[4], a[5], a[6]));
// Parts start on the shelf lying any old way up (the same way every new game).
function stockShelf() {
  let row = 0, cur = SHELF.x0, seed = 7;
  const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff;
  for (const p of fitted) {
    let q = ORI[0];
    for (let k = 0; k < 16; k++) {
      const c = ORI[1 + Math.floor(rnd() * 23)], s = pose(p, c).getSize(v2);
      if (s.y <= 4.5 && s.z <= 5.4 && s.x <= 9 && (p.anyWay || !isOriented(p, c))) { q = c; break; }
    }
    const b = pose(p, q).getSize(v2).clone();
    if (cur + b.x > SHELF.x1 && row < SHELF.levels.length) { row++; cur = SHELF.x0; }
    const onFloor = row >= SHELF.levels.length;
    placeLoose(p, cur + b.x / 2, onFloor ? 0 : SHELF.levels[row], onFloor ? 11 : SHELF.z, q);
    p.home = p.loose.slice();
    cur += b.x + 0.95;
  }
}

const reasonInstall = (p) => {
  const need = p.req.filter((id) => !byId[id].installed);
  if (need.length) return `Needs the ${byId[need[0]].name.toLowerCase()} first`;
  const cover = parts.find((q) => q.installed && q.covers.includes(p.id));
  if (cover) return `The ${cover.name.toLowerCase()} is in the way`;
  return null;
};
const reasonRemove = (p) => {
  if (p.id === 'block') return 'That stays on the stand';
  if (p.bolts.some((b) => b.tight > 0)) return 'Undo all of its bolts first';
  const dep = parts.find((q) => q.installed && q.req.includes(p.id));
  if (dep) return `Take the ${dep.name.toLowerCase()} off first`;
  const cover = parts.find((q) => q.installed && q.covers.includes(p.id));
  if (cover) return `The ${cover.name.toLowerCase()} is in the way`;
  return null;
};

function toEngine(p) {
  engineRoot.add(p.group);
  p.group.position.copy(p.base);
  p.group.quaternion.copy(p.baseQuat);
}
/* ---------- carrying a part ---------- */
// A see-through copy of a part's shape (not Object3D.clone: bolts carry back-references in userData).
function outlineOf(o) {
  const c = o.isMesh ? new THREE.Mesh(o.geometry, ghostMat) : new THREE.Group();
  c.position.copy(o.position); c.quaternion.copy(o.quaternion); c.scale.copy(o.scale);
  c.raycast = () => {};
  for (const k of o.children) c.add(outlineOf(k));
  return c;
}
let ghost = null, inRange = false, fitNote = '';
// Pick a part up: it hangs in front of you, turned however it was lying.
function hold(p) {
  held = p; p.state = 'held'; p.installed = false;
  heldRoot.add(p.group);
  p.rotShow.copy(p.rot);
  ghost = outlineOf(p.group);                      // faint outline of where it goes, shown only up close
  ghost.position.copy(p.base); ghost.quaternion.copy(p.baseQuat);
  ghost.visible = false;
  engineRoot.add(ghost);
  inRange = false; fitNote = '';
  updateHeld(1);
  refresh();
}
function releaseHeld() {
  if (ghost) { engineRoot.remove(ghost); ghost = null; }
  held = null; inRange = false;
}
// Quarter turns: "turn" spins it about the vertical, "flip" tips it over away from you.
function rotateHeld(kind) {
  if (!held) return;
  let axis = AX.y;
  if (kind === 'flip') {
    const rx = Math.cos(player.yaw), rz = -Math.sin(player.yaw);
    axis = Math.abs(rx) > Math.abs(rz) ? v1.set(Math.sign(rx), 0, 0) : v1.set(0, 0, Math.sign(rz));
  }
  held.rot.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, -Math.PI / 2)).normalize();
  sfx.ui();
}
function updateHeld(dt) {
  const p = held;
  p.rotShow.slerp(p.rot, Math.min(1, dt * 14));
  const cp = Math.cos(player.pitch);
  v3.set(-Math.sin(player.yaw) * cp, Math.sin(player.pitch), -Math.cos(player.yaw) * cp).multiplyScalar(p.holdDist);
  v3.x += player.x; v3.z += player.z; v3.y = Math.max(0.8, v3.y + player.eye - 1.2);
  p.group.quaternion.copy(p.rotShow).multiply(p.baseQuat);
  p.group.position.copy(p.base).sub(p.pivot).applyQuaternion(p.rotShow).add(v3);
  const near = v3.distanceTo(v2.copy(p.pivot).add(ENGINE_POS)) < 5.5;
  const why = near ? reasonInstall(p) : null, ok = isOriented(p);
  ghost.visible = near;
  ghostMat.color.set(why ? 0xff5a45 : ok ? 0x4cff7a : 0xffc040);
  ghostMat.opacity = 0.3 + 0.14 * Math.sin(performance.now() * 0.006);
  const note = !near ? (ok ? 'Hold it up to where it goes on the engine' : 'Turn it the right way round, then hold it up to the engine')
    : why || (ok ? 'Lines up' : 'Wrong way round — Turn or Flip it');
  if (note !== fitNote || near !== inRange) { fitNote = note; inRange = near; refresh(); }
}
const canFit = () => !!held && inRange && !reasonInstall(held) && isOriented(held);
function dropSpot() {
  ray.setFromCamera(new THREE.Vector2(0, -0.15), camera);
  const h = ray.intersectObjects(world.surfaces, false)[0];
  if (h && h.distance < REACH && v1.copy(h.face.normal).transformDirection(h.object.matrixWorld).y > 0.5) return [h.point.x, h.point.y, h.point.z];
  let x = clamp(player.x - Math.sin(player.yaw) * 7, 2.5, ROOM.w - 2.5), z = clamp(player.z - Math.cos(player.yaw) * 7, 9.5, ROOM.d - 2.5);
  if (world.colliders.some((c) => x > c.x0 && x < c.x1 && z > c.z0 && z < c.z1)) { x = player.x; z = player.z; }
  return [x, 0, z];
}
function drop() {
  if (!held) return;
  const p = held;
  releaseHeld();
  const [x, y, z] = dropSpot();
  placeLoose(p, x, y, z, p.rot.clone());
  sfx.place(); save(); refresh();
}
function install(p, silent) {
  if (held === p) releaseHeld();
  toEngine(p);
  p.rot.identity();
  p.state = 'installed'; p.installed = true;
  if (!silent) { p.anim = 0; sfx.place(); buzz(12); save(); refresh(); }
}
function uninstall(p) {
  p.bolts.forEach((b) => setTight(b, 0));
  p.rot.identity();
  sfx.remove();
  hold(p);
  save();
}

/* ---------- save ---------- */
function save() {
  const data = { parts: {}, known, time, tool, player: [player.x, player.z, player.yaw] };
  for (const p of fitted) {
    data.parts[p.id] = p.installed ? { b: p.bolts.map((b) => +b.tight.toFixed(2)) }
      : { l: (p.state === 'held' ? p.loose || p.home : p.loose).map((n) => +n.toFixed(3)) };
  }
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch {}
}
function load() {
  let data = null;
  try { data = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch {}
  if (!data || !data.parts) return false;
  for (const p of fitted) {
    const s = data.parts[p.id];
    if (!s) continue;
    if (s.b) { install(p, true); p.bolts.forEach((b, i) => setTight(b, clamp(+s.b[i] || 0, 0, 1))); }
    else if (s.l && s.l.length === 7) placeSaved(p, s.l);
  }
  Object.assign(known, data.known || {});
  Object.assign(time, data.time || {});
  if (SIZES.includes(data.tool)) tool = data.tool;
  if (data.player) [player.x, player.z, player.yaw] = data.player;
  return true;
}
function resetGame() {
  releaseHeld();
  for (const p of fitted) { p.bolts.forEach((b) => setTight(b, 0)); placeSaved(p, p.home); }
  for (const k in known) delete known[k];
  Object.assign(time, { day: 1, t: 8 / 24 });
  Object.assign(player, SPAWN);
  done = false;
  save(); refresh();
}
const buzz = (ms) => { try { navigator.vibrate && navigator.vibrate(ms); } catch {} };

/* ================= time of day ================= */
function advance(hours) {
  time.t += hours / 24;
  while (time.t >= 1) { time.t -= 1; time.day++; }
}
function sleep() {
  const h = time.t * 24;
  if (h > 6 && h < 20) return toast("It's broad daylight. Come back when it's dark.");
  if (held) drop();
  busy = true;
  $('fade').classList.add('on');
  setTimeout(() => {
    advance((31 - h) % 24 || 24);                       // until 07:00
    Object.assign(player, { x: 44, z: 18, yaw: -1.2, pitch: -0.1, crouch: false });
    save(); applyTime(); refresh();
    toast('Morning.', 2500);
    setTimeout(() => { $('fade').classList.remove('on'); busy = false; }, 500);
  }, 950);
}
const USE = {
  bed: { name: 'Bed', verb: 'Sleep', run: sleep },
  car: { name: 'The car', verb: 'Look', run: () => toast('Rolling shell, gearbox in. No engine — that part is on you.', 2600) },
  sidedoor: { name: 'Side door', verb: 'Open', run: () => toast('Locked. The key is somewhere.') },
};
const SKY_DAY = new THREE.Color(0x86bff0), SKY_NIGHT = new THREE.Color(0x05070d), SKY_DUSK = new THREE.Color(0xf0a268), sky = new THREE.Color();
function applyTime() {
  const h = time.t * 24;
  const e = Math.sin((Math.PI * (h - 5)) / 17);                       // long northern summer day: 05:00–22:00
  const sunUp = h > 5 && h < 22 ? e : -0.3;
  const day = clamp((sunUp + 0.1) / 0.35, 0, 1);
  sky.copy(SKY_NIGHT).lerp(SKY_DAY, day).lerp(SKY_DUSK, clamp(1 - Math.abs(sunUp - 0.08) / 0.22, 0, 1) * 0.55);
  scene.background.copy(sky); scene.fog.color.copy(sky);
  hemi.intensity = 0.08 + 0.5 * day;
  scene.environmentIntensity = 0.3 + 0.3 * day;
  const az = (Math.PI * (h - 5)) / 17;
  world.sun.position.set(30 - Math.cos(az) * 620, sunUp * 520, 87 + 560);
  world.sun.visible = sunUp > -0.05;
  world.patch.material.opacity = Math.max(0, sunUp) * 0.22;
  world.patch.position.x = 16.5 + Math.cos(az) * 6;
  const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
  $('cTime').textContent = `Day ${time.day} · ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/* ================= HUD ================= */
let toastTimer = 0;
function toast(msg, ms = 1800) {
  const t = $('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}
function modal(title, html, acts = [['OK']]) {
  $('mTitle').textContent = title; $('mBody').innerHTML = html;
  const box = $('mActs'); box.innerHTML = '';
  for (const [label, fn, cls] of acts) {
    const b = document.createElement('button');
    b.textContent = label; if (cls) b.className = cls;
    b.onclick = () => { unlockAudio(); $('modal').hidden = true; fn && fn(); };
    box.appendChild(b);
  }
  $('modal').hidden = false;
}
const HELP = `
<ul>
<li><b>Left stick</b> walks, <b>right stick</b> looks. Whatever the <b>dot</b> in the middle of the screen is on is what you act on.</li>
<li>The engine parts are on the <b>shelf at the back</b>. Point at one and press <b>Grab</b>.</li>
<li>Parts lie any way up. <b>Turn</b> and <b>Flip</b> the one you're carrying until it faces the way it fits, hold it up to its place on the engine, and press <b>Drop in</b>. Up close an outline shows <b>green</b> when it lines up, <b>amber</b> when it's the wrong way round, <b>red</b> when something is missing or in the way.</li>
<li>Every bolt goes in loose. Pick a <b>spanner size</b> along the bottom, point at a bolt and hold <b>Tighten</b>. Nobody tells you the size. <b>Loosen</b> undoes it.</li>
<li><b>Crouch</b> to get at the underside. Point at a fitted part with all its bolts undone and press <b>Take off</b>.</li>
<li>A day lasts 15 minutes. The bed skips the night.</li>
<li>Keyboard: WASD walk, arrows or mouse-drag look, E act, R turn, F flip, Z tighten, X loosen, C crouch, 1–8 spanner.</li>
</ul>`;

function buildTools() {
  for (const s of SIZES) {
    const b = document.createElement('button');
    b.innerHTML = `${s}<small>mm</small>`;
    b.dataset.tool = s;
    b.onclick = () => setTool(s);
    $('tools').appendChild(b);
  }
}
function setTool(s) { unlockAudio(); sfx.ui(); tool = s; refresh(); }

// What the main button would do right now.
function action() {
  if (held) return canFit() ? { label: 'Drop in', run: () => install(held) } : { label: 'Put down', run: drop, plain: true };
  if (!target) return null;
  if (target.kind === 'loose') return { label: 'Grab', run: () => { sfx.pick(); hold(target.part); } };
  if (target.kind === 'use') return { label: USE[target.what].verb, run: USE[target.what].run };
  const p = target.part;
  if (p.id === 'block') return null;
  return { label: 'Take off', plain: !!reasonRemove(p), run: () => { const why = reasonRemove(p); if (why) { sfx.wrong(); toast(why); } else uninstall(p); } };
}
function refresh() {
  const tight = parts.reduce((n, p) => n + (p.installed ? p.bolts.filter((b) => b.tight >= 1).length : 0), 0);
  const inst = fitted.filter((p) => p.installed).length;
  $('sBolts').textContent = `${tight}/${totalBolts}`;
  $('sParts').textContent = `${inst}/${fitted.length}`;
  $('crouchBtn').classList.toggle('on', player.crouch);
  for (const b of $('tools').children) b.classList.toggle('on', String(tool) === b.dataset.tool);
  $('turnBtn').hidden = $('flipBtn').hidden = !held;
  $('tightBtn').hidden = $('looseBtn').hidden = !!held;

  const act = action();
  $('actBtn').textContent = act ? act.label : 'Use';
  $('actBtn').disabled = !act;
  $('actBtn').className = act && !act.plain ? 'primary' : '';

  // crosshair caption
  let title = '', sub = '';
  if (held) { title = held.name; sub = fitNote; }
  else if (target && target.kind === 'loose') title = target.part.name;
  else if (target && target.kind === 'use') title = USE[target.what].name;
  else if (target) {
    const p = target.part, n = p.bolts.length, t = p.bolts.filter((b) => b.tight >= 1).length;
    title = p.name;
    sub = p.id === 'block' ? '' : n ? `${t}/${n} tight${known[p.id] ? ` · ${known[p.id]} mm` : ''}` : 'no bolts';
    if (target.kind === 'bolt') sub = `bolt ${target.bolt.tight >= 1 ? 'tight' : target.bolt.tight <= 0 ? 'loose' : 'part-way'} · ${sub}`;
  }
  $('aim').innerHTML = title ? `<b>${title}</b><span>${sub}</span>` : '';
  $('cross').classList.toggle('hot', !!(held ? inRange : target));

  if (!done && inst === fitted.length && tight === totalBolts) {
    done = true; sfx.win();
    modal('Every bolt is in.', `<p>${fitted.length} parts, ${totalBolts} bolts, all tight. Finished on day ${time.day}.</p><p>Getting it into the car and running comes next.</p>`, [['Nice', null, 'primary']]);
  }
  if (inst < fitted.length || tight < totalBolts) done = false;
}

/* ================= aiming ================= */
const ray = new THREE.Raycaster();
const CENTRE = new THREE.Vector2(0, 0);
const partOf = (o) => { while (o && !o.userData.partId) o = o.parent; return o ? byId[o.userData.partId] : null; };
const useOf = (o) => { while (o && !o.userData.use) o = o.parent; return o ? o.userData.use : null; };
const toScreen = (v) => { v.project(camera); return v.z > 1 ? null : { x: ((v.x + 1) / 2) * window.innerWidth, y: ((1 - v.y) / 2) * window.innerHeight }; };
const pickRoots = [engineRoot, looseRoot, world.group];
// Nearest visible bolt to a screen point, with a generous tolerance.
function findBolt(x, y, tol = 34) {
  const cands = [];
  for (const p of parts) {
    if (!p.installed) continue;
    for (const b of p.bolts) {
      b.head.getWorldPosition(v1);
      const dist = v1.distanceTo(camera.position);
      if (dist > REACH + 4) continue;
      const pos = v1.clone(), s = toScreen(v1);
      if (!s) continue;
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < tol) cands.push({ b, d, pos, dist });
    }
  }
  cands.sort((a, b) => a.d - b.d);
  for (const c of cands) {
    ray.set(camera.position, v2.copy(c.pos).sub(camera.position).normalize());
    const h = ray.intersectObjects(pickRoots, true)[0];
    if (!h || h.distance > c.dist - 0.2 || h.object.userData.bolt === c.b) return c;
  }
  return null;
}
// Work out what the crosshair is on.
function aim() {
  const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
  let t = null;
  if (!held) {
    const c = findBolt(cx, cy, 40);
    if (c) t = { kind: 'bolt', bolt: c.b, part: c.b.part, dist: c.dist };
  }
  if (!t) {
    ray.setFromCamera(CENTRE, camera);
    const h = ray.intersectObjects(pickRoots, true)[0];
    const near = h && h.distance < REACH;
    const p = near ? partOf(h.object) : null;
    if (p && !held) t = p.installed ? { kind: 'part', part: p } : { kind: 'loose', part: p };
    if (!t && !held) {                                    // small parts: nearest loose one close to the dot
      let best = 46;
      for (const q of fitted) {
        if (q.state !== 'loose') continue;
        bb.setFromObject(q.group).getCenter(v1);
        if (v1.distanceTo(camera.position) > REACH) continue;
        const s = toScreen(v1), d = s ? Math.hypot(s.x - cx, s.y - cy) : 99;
        if (d < best) { best = d; t = { kind: 'loose', part: q }; }
      }
    }
    const what = near ? useOf(h.object) : null;
    if (!t && what && USE[what] && !(held && what !== 'bed')) t = { kind: 'use', what };
  }
  const key = (x) => (x ? `${x.kind}:${x.part ? x.part.id : x.what}:${x.bolt ? x.part.bolts.indexOf(x.bolt) : ''}` : '');
  if (key(t) !== key(target)) { target = t; refresh(); } else target = t;
}

/* ---------- spanner work ---------- */
function tickWrench(dt) {
  if (!wrench || held || busy) return stopTurn();
  const t = target && target.kind === 'bolt' ? target : null;
  const complain = (msg, bad) => { if (!wrenchNote) { wrenchNote = true; if (bad) { sfx.wrong(); buzz(30); } toast(msg); } stopTurn(); };
  if (!t) return complain('Point at a bolt');
  const b = t.bolt;
  if (t.dist > BOLT_REACH) return complain('Get closer');
  if (b.size !== tool) return complain(`The ${tool} mm doesn't fit`, true);
  if (wrench > 0 && b.tight >= 1) return complain("That one's tight");
  if (wrench < 0 && b.tight <= 0) return complain("That one's already undone");
  if (turning !== b) { turning = b; b.click = b.tight; known[b.part.id] = b.size; }
  const next = clamp(b.tight + (wrench * dt) / 1.1, 0, 1);
  setTight(b, next);
  if (Math.abs(next - b.click) > 0.06) { b.click = next; sfx.ratchet(); }
  b.head.getWorldPosition(spanner.position);
  b.group.getWorldQuaternion(spanner.quaternion);
  spanner.rotateY(1.0 + Math.sin(performance.now() * 0.012) * 0.45);
  spanner.visible = true;
  if (next >= 1) { sfx.tight(); buzz(25); wrenchNote = true; stopTurn(); }
  else if (next <= 0) { sfx.loose(); buzz(10); wrenchNote = true; stopTurn(); }
}
function stopTurn() {
  if (turning) { turning = null; save(); refresh(); }
  spanner.visible = false;
}
function setWrench(d) { unlockAudio(); wrench = d; wrenchNote = false; if (!d) stopTurn(); }

/* ================= input ================= */
const stick = { x: 0, y: 0 }, lookStick = { x: 0, y: 0 };
const keys = {};
// A fixed on-screen joystick: reports -1..1 on each axis while a finger is on it.
function joystick(el, out) {
  const knob = el.firstElementChild;
  let id = null;
  const set = (e) => {
    const r = el.getBoundingClientRect(), half = r.width / 2;
    let x = (e.clientX - r.left - half) / (half * 0.72), y = (e.clientY - r.top - half) / (half * 0.72);
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    out.x = x; out.y = y;
    knob.style.transform = `translate(${x * half * 0.55}px, ${y * half * 0.55}px)`;
  };
  const end = (e) => { if (e.pointerId !== id) return; id = null; out.x = out.y = 0; knob.style.transform = ''; };
  el.addEventListener('pointerdown', (e) => { unlockAudio(); if (id !== null) return; id = e.pointerId; el.setPointerCapture(id); set(e); e.preventDefault(); });
  el.addEventListener('pointermove', (e) => { if (e.pointerId === id) set(e); });
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}
joystick($('move'), stick);
joystick($('look'), lookStick);
// A button that acts for as long as it is held.
function holdButton(el, d) {
  const up = () => { el.classList.remove('down'); if (wrench === d) setWrench(0); };
  el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); el.classList.add('down'); setWrench(d); e.preventDefault(); });
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}
holdButton($('tightBtn'), 1);
holdButton($('looseBtn'), -1);
const doAction = () => { unlockAudio(); if (busy) return; const a = action(); if (a) a.run(); };
$('actBtn').onclick = doAction;
$('turnBtn').onclick = () => rotateHeld('turn');
$('flipBtn').onclick = () => rotateHeld('flip');
$('crouchBtn').onclick = () => { player.crouch = !player.crouch; refresh(); };
$('menuBtn').onclick = () => modal('Bolt by Bolt', HELP, [
  ['Start over', () => modal('Start over?', '<p>Every part goes back on the shelf, every bolt comes undone, and it is day one again.</p>', [['Cancel'], ['Start over', resetGame, 'danger']]), 'danger'],
  ['Back to work', null, 'primary'],
]);

// Desktop: keys, and drag with the mouse to look.
window.addEventListener('keydown', (e) => {
  if (e.repeat || !$('modal').hidden) return;
  keys[e.code] = true;
  if (e.code === 'KeyE') doAction();
  else if (e.code === 'KeyR') rotateHeld('turn');
  else if (e.code === 'KeyF') rotateHeld('flip');
  else if (e.code === 'KeyC') { player.crouch = !player.crouch; refresh(); }
  else if (e.code === 'KeyZ') setWrench(1);
  else if (e.code === 'KeyX') setWrench(-1);
  else if (/^Digit[1-8]$/.test(e.code)) setTool(SIZES[+e.code.slice(5) - 1]);
});
window.addEventListener('keyup', (e) => {
  keys[e.code] = false;
  if ((e.code === 'KeyZ' && wrench === 1) || (e.code === 'KeyX' && wrench === -1)) setWrench(0);
});
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; setWrench(0); });
let drag = null;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => { unlockAudio(); if (e.pointerType === 'mouse') { drag = e.pointerId; canvas.setPointerCapture(drag); } });
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId !== drag) return;
  player.yaw -= e.movementX * 0.0045;
  player.pitch = clamp(player.pitch - e.movementY * 0.0045, -1.45, 1.45);
});
canvas.addEventListener('pointerup', (e) => { if (e.pointerId === drag) drag = null; });

function movePlayer(dt) {
  // look
  const lx = lookStick.x + (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0), ly = lookStick.y + (keys.ArrowDown ? 1 : 0) - (keys.ArrowUp ? 1 : 0);
  player.yaw -= lx * Math.abs(lx) * 2.6 * dt;
  player.pitch = clamp(player.pitch - ly * Math.abs(ly) * 1.8 * dt, -1.45, 1.45);
  // walk
  let mx = stick.x + (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0), my = stick.y + (keys.KeyS ? 1 : 0) - (keys.KeyW ? 1 : 0);
  const m = Math.hypot(mx, my);
  if (m > 1) { mx /= m; my /= m; }
  if (m > 0.08 && !busy) {
    const sp = (player.crouch ? 13 : 30) * dt;
    const s = Math.sin(player.yaw), c = Math.cos(player.yaw);
    player.x += (mx * c + my * s) * sp;
    player.z += (-mx * s + my * c) * sp;
    for (let pass = 0; pass < 2; pass++) {
      for (const b of world.colliders) {
        const cx = clamp(player.x, b.x0, b.x1), cz = clamp(player.z, b.z0, b.z1);
        const dx = player.x - cx, dz = player.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= RADIUS * RADIUS) continue;
        if (d2 > 1e-6) { const d = Math.sqrt(d2); player.x = cx + (dx / d) * RADIUS; player.z = cz + (dz / d) * RADIUS; }
        else {                                            // centre is inside the box: leave by the nearest face
          const l = player.x - b.x0, r = b.x1 - player.x, t = player.z - b.z0, u = b.z1 - player.z, k = Math.min(l, r, t, u);
          if (k === l) player.x = b.x0 - RADIUS; else if (k === r) player.x = b.x1 + RADIUS; else if (k === t) player.z = b.z0 - RADIUS; else player.z = b.z1 + RADIUS;
        }
      }
    }
  }
  player.eye += ((player.crouch ? EYE_CROUCH : EYE) - player.eye) * Math.min(1, dt * 10);
  camera.position.set(player.x, player.eye, player.z);
  camera.rotation.set(player.pitch, player.yaw, 0);
  camera.updateMatrixWorld();
}
function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.fov = camera.aspect < 1 ? 78 : 62;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

/* ================= main loop ================= */
let last = performance.now();
// Step rendering quality down on devices that can't hold a playable frame rate.
let quality = 0, slowFrames = 0, frames = 0;
function watchFps(rawDt) {
  if (++frames < 30 || quality >= 2) return;
  slowFrames = rawDt > 1 / 26 ? slowFrames + 1 : Math.max(0, slowFrames - 2);
  if (slowFrames < 45) return;
  slowFrames = 0; quality++;
  renderer.setPixelRatio(quality === 1 ? Math.min(window.devicePixelRatio || 1, 1.25) : 1);
  if (quality === 2) { renderer.shadowMap.enabled = false; world.spot.castShadow = false; }
  resize();
}
let hudT = 0, aimT = 0;
function frame(now) {
  watchFps((now - last) / 1000);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const paused = !$('modal').hidden || document.hidden;

  if (!paused && !busy) advance((dt / DAY_SECONDS) * 24);
  movePlayer(paused ? 0 : dt);
  if ((aimT += dt) > 0.08 || wrench) { aimT = 0; aim(); }
  tickWrench(dt);

  for (const p of parts) {
    if (p.anim === undefined) continue;
    p.anim = Math.min(1, p.anim + dt * 4);
    const k = (1 - p.anim) ** 2 * 0.9;
    p.group.position.set(p.base.x + p.from[0] * k, p.base.y + p.from[1] * k, p.base.z + p.from[2] * k);
    if (p.anim >= 1) delete p.anim;
  }
  if (held) updateHeld(dt);
  if ((hudT += dt) > 0.5) { hudT = 0; applyTime(); }

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

/* ================= boot ================= */
buildTools();
stockShelf();
const hadSave = load();
setCrank(parts, 0);
applyTime(); movePlayer(0); aim(); refresh();
if (!hadSave) modal('Bolt by Bolt', `<p>Your garage. A fastback with no engine, an engine block on a stand, and ${fitted.length} parts on the shelf at the back. ${totalBolts} bolts to go.</p>${HELP}`, [['Get to work', null, 'primary']]);
setInterval(() => { if (!busy) save(); }, 15000);
requestAnimationFrame(frame);

// Hooks for tests and for the curious.
window.__game = {
  parts, byId, player, time, world, install, uninstall, hold, drop, findBolt, camera, ORI, isOriented, aim,
  get state() { return { tool, held: held && held.id, target: target && { kind: target.kind, id: target.part ? target.part.id : target.what }, busy, done }; },
  buildAll(tight = true) {
    releaseHeld();
    for (const p of fitted) { if (!p.installed) install(p, true); p.bolts.forEach((b) => setTight(b, tight ? 1 : 0)); }
    save(); refresh();
  },
  lookAt(x, y, z) {
    const dx = x - player.x, dy = y - (player.crouch ? EYE_CROUCH : EYE), dz = z - player.z;
    player.yaw = Math.atan2(-dx, -dz); player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  },
  centreOf(obj) { return bb.setFromObject(obj).getCenter(new THREE.Vector3()).toArray(); },
  // Check every model: finite coordinates, no zero-area triangles, and — for solids — a closed,
  // outward-facing surface (every edge shared by an even number of triangles, positive volume).
  audit() {
    const bad = [], a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    let meshes = 0, tris = 0;
    const nameOf = (o) => { for (let q = o; q; q = q.parent) { if (q.userData.partId) return q.userData.partId; if (q.userData.use) return q.userData.use; } return 'world'; };
    const roots = [scene, ...parts.map((p) => p.group)];
    const seen = new Set();
    for (const root of roots) root.traverse((o) => {
      if (!o.isMesh || seen.has(o.geometry)) return;
      seen.add(o.geometry); meshes++;
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry, p = g.attributes.position, edges = new Map();
      let vol = 0, degenerate = 0, nan = 0;
      const key = (v) => `${Math.round(v.x * 2e3)},${Math.round(v.y * 2e3)},${Math.round(v.z * 2e3)}`;
      for (let i = 0; i < p.count; i += 3) {
        a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
        if (![a, b, c].every((v) => Number.isFinite(v.x + v.y + v.z))) { nan++; continue; }
        tris++;
        if (v1.subVectors(b, a).cross(v2.subVectors(c, a)).lengthSq() < 1e-16) degenerate++;
        vol += a.dot(v1.crossVectors(b, c)) / 6;
        if (o.userData.solid) {
          const k = [key(a), key(b), key(c)];
          for (let e = 0; e < 3; e++) {                       // per edge: how often it runs each way
            const p0 = k[e], p1 = k[(e + 1) % 3], fwd = p0 < p1, rec = edges.get(fwd ? p0 + '|' + p1 : p1 + '|' + p0) || [0, 0];
            rec[fwd ? 0 : 1]++;
            edges.set(fwd ? p0 + '|' + p1 : p1 + '|' + p0, rec);
          }
        }
      }
      let open = 0, flipped = 0;
      for (const [f, r] of edges.values()) { if ((f + r) % 2) open++; else if (f !== r) flipped++; }
      const why = [];
      if (nan) why.push(`${nan} non-finite triangles`);
      if (degenerate) why.push(`${degenerate} zero-area triangles`);
      if (!g.attributes.normal) why.push('no normals');
      if (o.userData.solid && open) why.push(`${open} open edges`);
      if (o.userData.solid && flipped) why.push(`${flipped} edges with faces wound the wrong way`);
      if (o.userData.solid && vol <= 0) why.push('inside out');
      if (why.length) bad.push(`${nameOf(o)}: ${why.join(', ')}`);
    });
    return { meshes, tris, bad };
  },
};
