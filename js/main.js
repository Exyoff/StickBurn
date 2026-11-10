import * as THREE from '../vendor/three.module.min.js';
import { RoomEnvironment } from '../vendor/RoomEnvironment.js';
import { buildEngine, buildStand, buildSpanner, setTight, setCrank, EXHAUST_TIP } from './engine.js';
import { buildWorld, ROOM, ENGINE_POS, SHELF } from './world.js';
import { sfx, motor, unlockAudio } from './audio.js';

const $ = (id) => document.getElementById(id);
const SAVE_KEY = 'bolt-by-bolt-save-v4';
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
const looseRoot = new THREE.Group();
scene.add(engineRoot, stand, looseRoot);
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
const heldRoot = new THREE.Group();
scene.add(heldRoot);

/* ================= game state ================= */
const player = { x: 39, z: 80, yaw: 0.6, pitch: -0.12, crouch: false, eye: EYE };
const stats = { energy: 100, hunger: 100, thirst: 100 };
const time = { day: 1, t: 8 / 24 };
let tool = 'hand', dir = 1;
let held = null, selected = null, turning = null;
let playTime = 0, won = false, busy = false;
const known = {};
let run = null;

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
const SYM = { piston: 'y2', maincap: 'y2', gasket: 'y2', head: 'y2', oilpan: 'y2', cranksprocket: 'x4', camsprocket: 'x4', pulley: 'x4', flywheel: 'x4', oilfilter: 'z4' };
for (const p of fitted) {
  p.pivot = bb.setFromObject(p.group).getCenter(new THREE.Vector3());   // centre of the part, in engine coordinates
  p.holdDist = clamp(bb.getSize(v1).length() * 0.55 + 4.5, 5.5, 9);
  p.rot = new THREE.Quaternion();        // how the part is turned relative to how it fits
  p.rotShow = new THREE.Quaternion();
  p.syms = [new THREE.Quaternion()];
  const s = SYM[p.id.replace(/\d+$/, '')];
  if (s) for (let n = 1; n < +s[1]; n++) p.syms.push(quarter(s[0], (n * 4) / +s[1]));
}
const isOriented = (p, q = p.rot) => p.syms.some((o) => o.angleTo(q) < 0.02);

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
      if (s.y <= 4.5 && s.z <= 5.4 && s.x <= 9 && !isOriented(p, c)) { q = c; break; }
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
  if (held) return 'Your hands are full';
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
  held = p; selected = null; p.state = 'held'; p.installed = false;
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
  const note = !near ? 'Turn it the right way round, then hold it up to the engine'
    : why || (ok ? 'Lines up — drop it in' : 'Wrong way round — Turn or Flip it');
  if (note !== fitNote || near !== inRange) { fitNote = note; inRange = near; refresh(); }
}
const canFit = () => !!held && inRange && !reasonInstall(held) && isOriented(held);
function tryFit() {
  if (!held) return;
  if (!inRange) return toast('Hold it up to where it goes on the engine');
  const why = reasonInstall(held);
  if (why) { sfx.wrong(); return toast(why); }
  if (!isOriented(held)) { sfx.wrong(); return toast("It won't go on that way round"); }
  install(held);
}
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
  const data = { parts: {}, known, playTime, won, stats, time, player: [player.x, player.z, player.yaw] };
  for (const p of fitted) {
    data.parts[p.id] = p.installed ? { b: p.bolts.map((b) => +b.tight.toFixed(2)) }
      : { l: (p.state === 'held' ? p.loose || p.home : p.loose).map((n) => +n.toFixed(2)) };
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
  Object.assign(stats, data.stats || {});
  Object.assign(time, data.time || {});
  if (data.player) [player.x, player.z, player.yaw] = data.player;
  playTime = data.playTime || 0; won = !!data.won;
  return true;
}
function resetGame() {
  stopEngine();
  releaseHeld();
  for (const p of fitted) { p.bolts.forEach((b) => setTight(b, 0)); placeSaved(p, p.home); }
  for (const k in known) delete known[k];
  Object.assign(stats, { energy: 100, hunger: 100, thirst: 100 });
  Object.assign(time, { day: 1, t: 8 / 24 });
  Object.assign(player, { x: 39, z: 80, yaw: 0.6, pitch: -0.12, crouch: false });
  playTime = 0; won = false; selected = null; oil.scale.setScalar(0.001);
  setCrank(parts, 0);
  save(); refresh();
}
const buzz = (ms) => { try { navigator.vibrate && navigator.vibrate(ms); } catch {} };

/* ================= survival & time ================= */
function advance(hours) {
  time.t += hours / 24;
  while (time.t >= 1) { time.t -= 1; time.day++; }
}
function fadeThen(fn) {
  busy = true;
  $('fade').classList.add('on');
  setTimeout(() => { fn(); setTimeout(() => { $('fade').classList.remove('on'); busy = false; }, 500); }, 950);
}
function sleep(forced) {
  if (run) return toast('Not with the engine running');
  if (!forced && stats.energy > 85) return toast("You're not tired");
  if (held) drop();
  const hours = forced ? 9 : clamp(Math.ceil((100 - stats.energy) / 12.5), 1, 8);
  fadeThen(() => {
    advance(hours);
    stats.energy = forced ? 65 : Math.min(100, stats.energy + hours * 12.5);
    stats.hunger = Math.max(forced ? 20 : 5, stats.hunger - hours * 3);
    stats.thirst = Math.max(forced ? 20 : 5, stats.thirst - hours * 4);
    Object.assign(player, { x: 44, z: 18, yaw: -1.2, pitch: -0.1, crouch: false });
    save(); refresh();
    toast(forced ? 'You collapsed. You wake up in bed, hours later.' : `You slept ${hours} hour${hours > 1 ? 's' : ''}.`, 3000);
  });
}
let lastUse = 0;
function use(what) {
  const now = performance.now();
  if (now - lastUse < 500) return;
  lastUse = now;
  if (what === 'bed') return sleep(false);
  if (what === 'sink') {
    if (stats.thirst > 97) return toast("You can't drink any more");
    stats.thirst = Math.min(100, stats.thirst + 30); sfx.drink(); toast('Tap water. Cold.');
  } else if (what === 'food') {
    if (stats.hunger > 95) return toast("You're full");
    stats.hunger = Math.min(100, stats.hunger + 35); stats.thirst = Math.max(0, stats.thirst - 4); sfx.eat(); toast('Sausage and macaroni.');
  } else if (what === 'toilet') toast('Not now.');
  else if (what === 'car') toast('Rolling shell, gearbox in. No engine — that part is on you.');
  else if (what === 'sidedoor') toast('Locked. The key is somewhere.');
  refresh();
}
const warned = {};
function tickStats(dt) {
  const starving = stats.hunger <= 0 || stats.thirst <= 0;
  stats.hunger = Math.max(0, stats.hunger - dt * (100 / 720));
  stats.thirst = Math.max(0, stats.thirst - dt * (100 / 540));
  stats.energy = Math.max(0, stats.energy - dt * (100 / 900) * (starving ? 3 : 1) - (turning ? dt * 0.25 : 0) - (held ? dt * 0.04 : 0));
  for (const [k, msg] of [['hunger', "You're getting hungry"], ['thirst', "You're thirsty"], ['energy', "You're exhausted — get to bed"]]) {
    if (stats[k] < 20 && !warned[k]) { warned[k] = true; toast(msg, 2600); }
    if (stats[k] > 30) warned[k] = false;
  }
  if (stats.energy <= 0 && !busy) { stopEngine(); sleep(true); }
}
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
<li><b>Move</b> with your left thumb, <b>look</b> by dragging anywhere else. <b>Tap</b> things to use them. (Keyboard: WASD, drag to look, C to crouch.)</li>
<li>The engine parts are on the <b>shelf at the back</b>, lying any way up. Tap one to grab it. <b>Turn</b> and <b>Flip</b> it until it faces the way it fits, hold it up to its place on the engine, and <b>drop it in</b>.</li>
<li>An outline shows up close: <b>green</b> lines up, <b>amber</b> is the wrong way round, <b>red</b> means something is missing or in the way.</li>
<li>Every bolt goes in loose. Pick a <b>spanner size</b>, then <b>press and hold</b> a bolt. Nobody tells you the size. <b>↻ / ↺</b> flips the ratchet.</li>
<li><b>Crouch</b> to get at the underside of the engine.</li>
<li>Tap a fitted part to take it off again once its bolts are undone.</li>
<li>Watch <b>energy, hunger and thirst</b>: eat at the fridge or stove, drink from a tap, sleep in the bed. Run out of energy and you collapse.</li>
<li>A day lasts 15 minutes. When the engine is done, hit <b>Start</b>.</li>
</ul>`;

function buildTools() {
  const box = $('tools');
  const mk = (label, sub, val) => {
    const b = document.createElement('button');
    b.innerHTML = `${label}<small>${sub}</small>`;
    b.dataset.tool = val;
    b.onclick = () => { unlockAudio(); sfx.ui(); tool = val; refresh(); };
    box.appendChild(b);
  };
  mk('✋', 'hand', 'hand');
  for (const s of SIZES) mk(String(s), 'mm', s);
}
function refresh() {
  const tight = parts.reduce((n, p) => n + (p.installed ? p.bolts.filter((b) => b.tight >= 1).length : 0), 0);
  $('sBolts').textContent = `${tight}/${totalBolts}`;
  $('sParts').textContent = `${fitted.filter((p) => p.installed).length}/${fitted.length}`;
  $('dirBtn').textContent = dir > 0 ? '↻ Tighten' : '↺ Loosen';
  $('dirBtn').classList.toggle('danger', dir < 0);
  $('crouchBtn').classList.toggle('on', player.crouch);
  for (const b of $('tools').children) b.classList.toggle('on', String(tool) === b.dataset.tool);
  $('startBtn').textContent = run ? 'Stop' : 'Start';
  $('startBtn').classList.toggle('danger', !!run);
  $('startBtn').classList.toggle('primary', !run);
  $('throttle').hidden = !(run && run.phase === 'run');
  $('bottom').hidden = !!run; $('dirBtn').hidden = !!run || !!held;
  $('turnBtn').hidden = $('flipBtn').hidden = !held;

  const strip = $('strip');
  if (held) {
    const fit = canFit();
    $('stripName').textContent = held.name;
    $('stripSub').textContent = fitNote;
    $('stripAct').textContent = fit ? 'Drop in' : 'Put down'; $('stripAct').className = fit ? 'primary' : ''; $('stripAct').hidden = false;
    strip.hidden = false;
  } else if (selected && !run) {
    const n = selected.bolts.length, t = selected.bolts.filter((b) => b.tight >= 1).length;
    $('stripName').textContent = selected.name;
    $('stripSub').textContent = selected.id === 'block' ? 'Bolted to the stand'
      : n ? `${t}/${n} tight${known[selected.id] ? ` · ${known[selected.id]} mm` : ''}` : 'No bolts — just sits in place';
    $('stripAct').textContent = 'Remove'; $('stripAct').className = 'danger';
    $('stripAct').hidden = selected.id === 'block';
    strip.hidden = false;
  } else strip.hidden = true;
}
function refreshStats() {
  for (const [k, id, row] of [['energy', 'sEnergy', 'rEnergy'], ['hunger', 'sHunger', 'rHunger'], ['thirst', 'sThirst', 'rThirst']]) {
    $(id).style.width = `${stats[k]}%`;
    $(row).classList.toggle('low', stats[k] < 20);
  }
  $('vignette').style.opacity = clamp(1 - Math.min(stats.energy, stats.hunger + 12, stats.thirst + 12) / 18, 0, 1);
}

$('dirBtn').onclick = () => { unlockAudio(); sfx.ui(); dir = -dir; refresh(); };
$('crouchBtn').onclick = () => { player.crouch = !player.crouch; refresh(); };
$('stripClose').onclick = () => { if (held) drop(); selected = null; refresh(); };
$('turnBtn').onclick = () => rotateHeld('turn');
$('flipBtn').onclick = () => rotateHeld('flip');
$('stripAct').onclick = () => {
  if (held) return canFit() ? install(held) : drop();
  if (!selected) return;
  const why = reasonRemove(selected);
  if (why) { sfx.wrong(); toast(why); } else uninstall(selected);
};
$('menuBtn').onclick = () => modal('Bolt by Bolt', HELP, [
  ['Start over', () => modal('Start over?', '<p>Every part goes back on the shelf, every bolt comes undone, and it is day one again.</p>', [['Cancel'], ['Start over', resetGame, 'danger']]), 'danger'],
  ['Back to work', null, 'primary'],
]);
$('startBtn').onclick = () => { unlockAudio(); run ? stopEngine() : startEngine(); };
$('thr').oninput = (e) => { if (run) run.target = +e.target.value; };

/* ================= picking ================= */
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const partOf = (o) => { while (o && !o.userData.partId) o = o.parent; return o ? byId[o.userData.partId] : null; };
const useOf = (o) => { while (o && !o.userData.use) o = o.parent; return o ? o.userData.use : null; };
const toScreen = (v) => { v.project(camera); return v.z > 1 ? null : { x: ((v.x + 1) / 2) * window.innerWidth, y: ((1 - v.y) / 2) * window.innerHeight }; };
const pickRoots = [engineRoot, looseRoot, world.group];
function hitsAt(x, y) {
  ndc.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  return ray.intersectObjects(pickRoots, true);
}
// Nearest visible bolt to a screen point, with a finger-sized tolerance.
function findBolt(x, y) {
  const cands = [];
  for (const p of parts) {
    if (!p.installed) continue;
    for (const b of p.bolts) {
      b.head.getWorldPosition(v1);
      const dist = v1.distanceTo(camera.position);
      const pos = v1.clone(), s = toScreen(v1);
      if (!s) continue;
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < 34) cands.push({ b, d, pos, dist });
    }
  }
  cands.sort((a, b) => a.d - b.d);
  for (const c of cands) {
    ray.set(camera.position, v2.copy(c.pos).sub(camera.position).normalize());
    const h = ray.intersectObjects(pickRoots, true).find((i) => partOf(i.object) !== held);
    if (!h || h.distance > c.dist - 0.2 || h.object.userData.bolt === c.b) return c;
  }
  return null;
}
function beginTurn(c) {
  const b = c.b;
  if (held) { toast('Your hands are full'); return; }
  if (c.dist > BOLT_REACH) { toast('Get closer'); return; }
  if (b.size !== tool) { sfx.wrong(); buzz(30); toast(`The ${tool} mm doesn't fit`); return; }
  if (dir > 0 && b.tight >= 1) { toast("That one's tight"); return; }
  if (dir < 0 && b.tight <= 0) { toast("That one's already undone"); return; }
  turning = b; b.click = b.tight;
  known[b.part.id] = b.size;
}
function endTurn() {
  if (turning) { save(); refresh(); }
  turning = null;
  spanner.visible = false;
}
function handleTap(x, y) {
  if (busy) return;
  const list = hitsAt(x, y);
  if (held && !run && inRange && list.some((h) => h.distance < REACH + 8 && h.object.parent && engineRoot.getObjectById(h.object.id))) return tryFit();
  const h = list.find((i) => partOf(i.object) !== held);
  let part = h && h.distance < REACH ? partOf(h.object) : null;
  if (!part && !run) {                                    // small parts are hard to hit with a thumb
    let best = 40;
    for (const p of fitted) {
      if (p.state !== 'loose') continue;
      bb.setFromObject(p.group).getCenter(v1);
      if (v1.distanceTo(camera.position) > REACH) continue;
      const s = toScreen(v1);
      const d = s ? Math.hypot(s.x - x, s.y - y) : 99;
      if (d < best) { best = d; part = p; }
    }
  }
  if (part && !run) {
    if (part.installed) { selected = part; refresh(); }
    else if (held) toast('Your hands are full');
    else { sfx.pick(); hold(part); const why = reasonInstall(part); if (why) toast(why); }
    return;
  }
  const what = h && h.distance < REACH ? useOf(h.object) : null;
  if (what) return use(what);
  if (selected) { selected = null; refresh(); }
}

/* ================= input ================= */
const ptrs = new Map();
let stickId = null, stick = { x: 0, y: 0 };
const keys = {};
const inStickZone = (x, y) => x < window.innerWidth * 0.45 && y > window.innerHeight * 0.5;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  unlockAudio();
  if (busy) return;
  canvas.setPointerCapture(e.pointerId);
  const p = { x: e.clientX, y: e.clientY, ox: e.clientX, oy: e.clientY, t: performance.now(), moved: 0, mode: 'look' };
  ptrs.set(e.pointerId, p);
  if (typeof tool === 'number' && !run && !turning) {
    const c = findBolt(e.clientX, e.clientY);
    if (c) { p.mode = 'bolt'; beginTurn(c); return; }
  }
  if (e.pointerType !== 'mouse' && stickId === null && inStickZone(e.clientX, e.clientY)) {
    p.mode = 'stick'; stickId = e.pointerId;
    const el = $('stick');
    el.style.left = `${p.ox}px`; el.style.top = `${p.oy}px`; el.firstElementChild.style.transform = '';
    el.hidden = false;
  }
});
canvas.addEventListener('pointermove', (e) => {
  const p = ptrs.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  p.moved += Math.abs(dx) + Math.abs(dy);
  if (p.mode === 'look') {
    player.yaw -= dx * 0.0052;
    player.pitch = clamp(player.pitch - dy * 0.0052, -1.45, 1.45);
  } else if (p.mode === 'stick') {
    let sx = (p.x - p.ox) / 50, sy = (p.y - p.oy) / 50;
    const m = Math.hypot(sx, sy);
    if (m > 1) { sx /= m; sy /= m; }
    stick.x = sx; stick.y = sy;
    $('stick').firstElementChild.style.transform = `translate(${sx * 34}px, ${sy * 34}px)`;
  }
});
function pointerEnd(e) {
  const p = ptrs.get(e.pointerId);
  if (!p) return;
  ptrs.delete(e.pointerId);
  if (p.mode === 'bolt') endTurn();
  if (p.mode === 'stick') { stickId = null; stick.x = stick.y = 0; $('stick').hidden = true; }
  if (p.mode !== 'bolt' && e.type === 'pointerup' && p.moved < 12 && performance.now() - p.t < 400) handleTap(e.clientX, e.clientY);
}
canvas.addEventListener('pointerup', pointerEnd);
canvas.addEventListener('pointercancel', pointerEnd);
window.addEventListener('keydown', (e) => { keys[e.code] = true; if (e.code === 'KeyC') { player.crouch = !player.crouch; refresh(); } });
window.addEventListener('keyup', (e) => { keys[e.code] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

function movePlayer(dt) {
  let mx = stick.x + (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  let my = stick.y + (keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0);
  const m = Math.hypot(mx, my);
  if (m > 1) { mx /= m; my /= m; }
  if (m > 0.05 && !busy) {
    const weak = stats.hunger <= 0 || stats.thirst <= 0 || stats.energy < 8;
    const sp = (player.crouch ? 13 : 30) * (weak ? 0.55 : 1) * dt;
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
}
function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.fov = camera.aspect < 1 ? 78 : 62;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

/* ================= starting the engine ================= */
function diagnose() {
  const I = (id) => byId[id].installed;
  const T = (id) => I(id) && byId[id].bolts.every((b) => b.tight >= 1);
  const group = (n, k) => Array.from({ length: k }, (_, i) => `${n}${i + 1}`);
  const caps = group('maincap', 5), pist = group('piston', 4), plugs = group('plug', 4);

  if (!I('crank')) return { dead: 'The starter whirrs against nothing. There is no crankshaft in there.' };
  if (!caps.every(T)) return { dead: 'CLUNK. The crankshaft shifted in the block. The main bearing caps have to be on, and tight.' };
  if (!T('flywheel')) return { dead: 'The starter spins freely. It needs a flywheel, bolted up tight, to grab.' };

  let no = null;
  if (!pist.every(I)) no = 'It spins over far too easily. No compression — count your pistons.';
  else if (!I('head')) no = 'The pistons pump air at the ceiling. A cylinder head would help.';
  else if (!T('head')) no = 'Hissing between head and block. No compression — those head bolts are not all tight.';
  else if (!['camshaft', 'camsprocket', 'cranksprocket', 'chain'].every(I)) no = 'It cranks, but the valves never move. Something is missing in the timing drive.';
  else if (!T('camshaft') || !T('camsprocket')) no = 'Clattering from the top end. The valve gear is loose.';
  else if (!plugs.every(T)) no = 'Cranks and cranks. Not every cylinder has a spark plug screwed in tight.';
  else if (!T('distributor') || !I('leads')) no = 'Cranks and cranks. No spark at all — look at the ignition.';
  else if (!T('intake') || !T('carb')) no = "Cranks and cranks. It isn't getting any fuel and air.";
  if (no) return { noStart: no };

  const fails = [];
  if (!pist.every(T)) fails.push({ t: 3.5, bang: true, msg: 'BANG. A connecting rod let go. The rod cap nuts were not tight.' });
  if (!T('oilpan')) fails.push({ t: 6, leak: true, msg: 'Oil all over the floor, then the engine seized. The oil pan has to be on with every bolt tight.' });
  if (!I('oilfilter')) fails.push({ t: 5, leak: true, msg: 'Oil pumped straight out of the filter mount. The engine seized.' });
  if (!T('timingcover')) fails.push({ t: 5, leak: true, msg: 'Oil sprays off the timing chain across the garage. The timing cover is not sealed.' });
  if (!T('rockercover')) fails.push({ t: 6, msg: 'Oil mist pours from the top end. The rocker cover is not sealed.' });
  if (!I('gasket')) fails.push({ t: 7, steam: true, msg: 'White smoke, then silence. There is no head gasket between block and head.' });
  if (!T('waterpump') || !T('pulley') || !I('belt') || !T('alternator'))
    fails.push({ t: 9, steam: true, msg: 'The temperature climbed until it boiled over. Check the belt drive: crank pulley, water pump, alternator, fan belt.' });
  fails.sort((a, b) => a.t - b.t);
  return { fail: fails[0] || null, loud: !T('exhaust') };
}
function startEngine() {
  if (run || busy) return;
  if (Math.hypot(player.x - ENGINE_POS.x, player.z - ENGINE_POS.z) > 45) return toast('Go over to the engine first');
  if (held) drop();
  endTurn(); selected = null;
  const d = diagnose();
  motor.start();
  motor.set(0, { starter: true });
  run = { phase: 'crank', t: 0, rpm: 0, target: 900, theta: 0, d, emit: 0 };
  $('thr').value = 900;
  refresh();
}
function stopEngine(msg, title) {
  if (!run) return;
  motor.stop();
  run = null;
  engineRoot.position.copy(ENGINE_POS);
  refresh();
  if (msg) modal(title || 'It died', `<p>${msg}</p>`, [['Back to the spanners', null, 'primary']]);
}
function tickEngine(dt) {
  const d = run.d;
  run.t += dt;
  if (run.phase === 'crank') {
    if (d.dead) { if (run.t > 1.2) { sfx.bang(); stopEngine(d.dead, "It won't turn over"); } return; }
    run.rpm = 220;
    if (run.t > 2.4) {
      if (d.noStart) return stopEngine(d.noStart, "It won't start");
      run.phase = 'run'; run.t = 0;
      refresh();
      if (d.loud) toast('It runs — deafeningly. The exhaust is not on properly.', 3500);
    }
  } else {
    run.rpm += (run.target - run.rpm) * Math.min(1, dt * 3);
    motor.set(run.rpm, { loud: d.loud });
    $('rpm').textContent = Math.round(run.rpm / 10) * 10;
    const f = d.fail;
    if (f) {
      if (f.leak) oil.scale.setScalar(Math.min(9, oil.scale.x + dt * 1.4));
      if (run.t > f.t) { if (f.bang) { sfx.bang(); buzz(200); } return stopEngine(f.msg); }
    } else if (!d.loud && !won && run.t > 6) {
      won = true; save(); sfx.win();
      const m = Math.floor(playTime / 60), s = Math.floor(playTime % 60);
      modal('It runs.', `<p>${totalBolts} bolts, ${fitted.length} parts, and it idles like it left the factory.</p><p>Built in <b>${time.day} day${time.day > 1 ? 's' : ''}</b> (${m}m ${String(s).padStart(2, '0')}s of your life).</p><p>The throttle is on the right. Next job: getting it into the car.</p>`, [['Rev it', null, 'primary']]);
    }
    run.emit += dt * (4 + run.rpm / 300);
    while (run.emit > 1) { run.emit -= 1; puff(f && f.steam && run.t > f.t * 0.5); }
    const k = 0.006 + run.rpm / 600000;
    engineRoot.position.set(ENGINE_POS.x + (Math.random() - 0.5) * k, ENGINE_POS.y + (Math.random() - 0.5) * k, ENGINE_POS.z + (Math.random() - 0.5) * k);
  }
  run.theta += (run.rpm / 60) * Math.PI * 2 * dt * 0.35;
  setCrank(parts, run.theta);
}

/* smoke + oil */
const fx = new THREE.Group();
fx.position.copy(ENGINE_POS);
scene.add(fx);
const smokeTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  gr.addColorStop(0, 'rgba(255,255,255,.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
const puffs = [];
for (let i = 0; i < 40; i++) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false, opacity: 0 }));
  s.visible = false; s.raycast = () => {};
  fx.add(s);
  puffs.push({ s, life: 0, v: new THREE.Vector3() });
}
function puff(steam) {
  const p = puffs.find((q) => q.life <= 0);
  if (!p) return;
  const ex = byId.exhaust.installed;
  if (ex) p.s.position.set(...EXHAUST_TIP); else p.s.position.set(-1.5 + Math.floor(Math.random() * 4), 2.75, 1.0);
  if (steam) p.s.position.set((Math.random() - 0.5) * 4, 2.45, (Math.random() < 0.5 ? -1 : 1) * 0.95);
  p.v.set((Math.random() - 0.5) * 0.4, steam ? 1.4 : ex ? -0.6 : 0.5, steam ? 0 : ex ? 0.5 : 0.7);
  p.s.material.color.set(steam ? 0xffffff : 0x8a8a8a);
  p.life = p.max = 1.8; p.s.visible = true; p.s.scale.setScalar(0.3);
}
function tickPuffs(dt) {
  for (const p of puffs) {
    if (p.life <= 0) continue;
    p.life -= dt;
    p.s.position.addScaledVector(p.v, dt);
    p.v.y += dt * 0.5;
    p.s.scale.addScalar(dt * 1.3);
    p.s.material.opacity = Math.max(0, p.life / p.max) * 0.5;
    if (p.life <= 0) p.s.visible = false;
  }
}
const oil = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshStandardMaterial({ color: 0x0b0906, roughness: 0.15, metalness: 0.4, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
oil.rotation.x = -Math.PI / 2; oil.position.set(ENGINE_POS.x + 0.2, 0.03, ENGINE_POS.z + 0.2); oil.scale.setScalar(0.001);
oil.raycast = () => {};
scene.add(oil);

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
let hudT = 0;
function frame(now) {
  watchFps((now - last) / 1000);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const paused = !$('modal').hidden || document.hidden;

  if (!paused && !busy) {
    if (!won) playTime += dt;
    advance((dt / DAY_SECONDS) * 24);
    tickStats(dt);
  }
  movePlayer(paused ? 0 : dt);

  if (turning) {
    const b = turning;
    const slow = stats.energy < 8 ? 0.5 : 1;
    const t = clamp(b.tight + (dir * dt * slow) / 1.1, 0, 1);
    setTight(b, t);
    if (Math.abs(t - b.click) > 0.06) { b.click = t; sfx.ratchet(); }
    b.head.getWorldPosition(spanner.position);
    b.group.getWorldQuaternion(spanner.quaternion);
    spanner.rotateY(1.0 + Math.sin(now * 0.012) * 0.45);
    spanner.visible = true;
    if (t >= 1) { sfx.tight(); buzz(25); endTurn(); }
    else if (t <= 0) { sfx.loose(); buzz(10); endTurn(); }
  }
  for (const p of parts) {
    if (p.anim === undefined) continue;
    p.anim = Math.min(1, p.anim + dt * 4);
    const k = (1 - p.anim) ** 2 * 0.9;
    p.group.position.set(p.base.x + p.from[0] * k, p.base.y + p.from[1] * k, p.base.z + p.from[2] * k);
    if (p.anim >= 1) delete p.anim;
  }
  if (held) updateHeld(dt);
  if (run) tickEngine(dt);
  tickPuffs(dt);
  if ((hudT += dt) > 0.25) { hudT = 0; applyTime(); refreshStats(); }

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

/* ================= boot ================= */
buildTools();
stockShelf();
const hadSave = load();
setCrank(parts, 0);
applyTime(); refreshStats(); refresh();
if (!hadSave) modal('Bolt by Bolt', `<p>Your garage. A coupe with no engine, an engine block on a stand, and ${fitted.length} parts on the shelf at the back. ${totalBolts} bolts to go.</p>${HELP}`, [['Get to work', null, 'primary']]);
setInterval(() => { if (!run && !busy) save(); }, 15000);
requestAnimationFrame(frame);

// Hooks for tests and for the curious.
window.__game = {
  parts, byId, player, stats, time, world, diagnose, install, uninstall, hold, drop, use, findBolt, camera, handleTap, tryFit, ORI, isOriented,
  get state() { return { tool, dir, held: held && held.id, selected: selected && selected.id, run: run && run.phase, won, busy }; },
  buildAll(tight = true) {
    releaseHeld();
    for (const p of fitted) { if (!p.installed) install(p, true); p.bolts.forEach((b) => setTight(b, tight ? 1 : 0)); }
    save(); refresh();
  },
  lookAt(x, y, z) {
    const dx = x - player.x, dy = y - (player.crouch ? EYE_CROUCH : EYE), dz = z - player.z;
    player.yaw = Math.atan2(-dx, -dz); player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  },
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
  screenOf(obj) { bb.setFromObject(obj).getCenter(v3); return toScreen(v3); },
  boltScreen(b) { b.head.getWorldPosition(v3); return toScreen(v3); },
};
