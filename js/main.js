import * as THREE from '../vendor/three.module.min.js';
import { RoomEnvironment } from '../vendor/RoomEnvironment.js';
import { buildEngine, buildStand, buildSpanner, setTight, setCrank, MAT } from './engine.js';
import { sfx, motor, unlockAudio } from './audio.js';

const $ = (id) => document.getElementById(id);
const SAVE_KEY = 'bolt-by-bolt-save-v1';
const SIZES = [8, 10, 12, 13, 14, 16, 17, 19];
const FLOOR_Y = -4.5;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* ================= renderer & scene ================= */
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1c1d20);
scene.fog = new THREE.Fog(0x1c1d20, 22, 46);
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);

const envOf = (r) => { const g = new THREE.PMREMGenerator(r); const t = g.fromScene(new RoomEnvironment(), 0.04).texture; g.dispose(); return t; };
scene.environment = envOf(renderer);
scene.environmentIntensity = 0.75;
scene.add(new THREE.HemisphereLight(0xdde6ff, 0x4a3d30, 0.45));
const sun = new THREE.DirectionalLight(0xfff0d8, 2.2);
sun.position.set(6, 12, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 8, bottom: -7, near: 1, far: 40 });
sun.shadow.bias = -0.0015;
scene.add(sun);
const fill = new THREE.DirectionalLight(0x9fb8ff, 0.7);
fill.position.set(-7, -3, -6);
scene.add(fill);

buildGarage();

const engineRoot = new THREE.Group();
scene.add(engineRoot, buildStand(FLOOR_Y));
const parts = buildEngine();
const byId = Object.fromEntries(parts.map((p) => [p.id, p]));
const fitted = parts.filter((p) => p.id !== 'block');
const totalBolts = parts.reduce((n, p) => n + p.bolts.length, 0);
makeThumbs();
byId.block.installed = true;
engineRoot.add(byId.block.group);

const spanner = buildSpanner();
spanner.visible = false;
scene.add(spanner);

const ghostOk = new THREE.MeshBasicMaterial({ color: 0x4cff7a, transparent: true, opacity: 0.4, depthWrite: false });
const ghostNo = new THREE.MeshBasicMaterial({ color: 0xff5a45, transparent: true, opacity: 0.4, depthWrite: false });

function buildGarage() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#6d6c68'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2500; i++) {
    g.fillStyle = `rgba(${Math.random() < 0.5 ? '20,20,20' : '200,200,195'},${Math.random() * 0.08})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 3, 1 + Math.random() * 3);
  }
  g.strokeStyle = 'rgba(0,0,0,.28)'; g.lineWidth = 2; g.strokeRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(9, 9); tex.colorSpace = THREE.SRGBColorSpace;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(36, 36), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = FLOOR_Y; floor.receiveShadow = true;
  scene.add(floor);
  const room = new THREE.Mesh(new THREE.BoxGeometry(36, 16, 36), new THREE.MeshStandardMaterial({ color: 0x5d615f, roughness: 1, side: THREE.BackSide }));
  room.position.y = FLOOR_Y + 8;
  scene.add(room);

  const wood = new THREE.MeshStandardMaterial({ color: 0x7a5b3a, roughness: 0.85 });
  const B = (w, h, d, m, x, y, z) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; scene.add(o); return o; };
  B(9, 0.3, 2.4, wood, 0, FLOOR_Y + 3.2, -16.4);
  for (const x of [-4, 4]) B(0.3, 3.2, 2.2, wood, x, FLOOR_Y + 1.6, -16.4);
  B(2.2, 1.1, 1.2, MAT.stand, -2.4, FLOOR_Y + 3.9, -16.5);
  B(1.4, 0.7, 0.9, MAT.dark, 1.8, FLOOR_Y + 3.7, -16.4);
  B(10, 4, 0.1, new THREE.MeshStandardMaterial({ color: 0x8a7a5c, roughness: 0.9 }), 0, FLOOR_Y + 7, -17.9);
  for (let i = 0; i < 3; i++) {
    const t = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.55, 12, 28), MAT.rubber);
    t.rotation.x = Math.PI / 2; t.position.set(13, FLOOR_Y + 0.55 + i * 1.1, -13); t.castShadow = true;
    scene.add(t);
  }
  B(1.6, 2.6, 1.6, new THREE.MeshStandardMaterial({ color: 0x2f5d8a, roughness: 0.6, metalness: 0.4 }), -14, FLOOR_Y + 1.3, 6);
}

// Render each part once to a small image for the parts shelf.
function makeThumbs() {
  const r = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  r.setSize(160, 160);
  r.toneMapping = THREE.ACESFilmicToneMapping;
  const s = new THREE.Scene();
  s.environment = envOf(r);
  s.add(new THREE.HemisphereLight(0xffffff, 0x555555, 0.6));
  const d = new THREE.DirectionalLight(0xffffff, 2.5); d.position.set(3, 6, 4); d.intensity = 1.5; s.add(d);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  const bb = new THREE.Box3(), c = new THREE.Vector3(), sz = new THREE.Vector3();
  for (const p of fitted) {
    s.add(p.group);
    bb.setFromObject(p.group); bb.getCenter(c); bb.getSize(sz);
    const dir = new THREE.Vector3(p.from[0] + 0.55, p.from[1] * 0.6 + 0.5, p.from[2] + 0.65).normalize();
    cam.position.copy(c).addScaledVector(dir, Math.max(sz.length(), 0.5) * 2.1);
    cam.lookAt(c);
    r.render(s, cam);
    p.thumb = r.domElement.toDataURL('image/png');
    s.remove(p.group);
  }
  r.dispose();
  r.forceContextLoss();
}

/* ================= game state ================= */
let tool = 'hand';        // 'hand' or a spanner size in mm
let dir = 1;              // 1 tighten, -1 loosen
let held = null;          // part picked from the shelf, shown as a ghost
let selected = null;      // installed part shown in the info strip
let turning = null;       // bolt under the spanner
let playTime = 0, won = false;
const known = {};         // part id -> spanner size the player has found out
let run = null;           // engine start/run state

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

function setGhost(p, on) {
  const mat = reasonInstall(p) ? ghostNo : ghostOk;
  p.group.traverse((o) => {
    if (!o.isMesh) return;
    if (on) { o.userData.mat ??= o.material; o.material = mat; o.castShadow = false; }
    else if (o.userData.mat) { o.material = o.userData.mat; delete o.userData.mat; o.castShadow = true; }
  });
}
function hold(p) {
  drop();
  held = p; selected = null;
  p.group.position.copy(p.base);
  engineRoot.add(p.group);
  setGhost(p, true);
  refresh();
}
function drop() {
  if (!held) return;
  setGhost(held, false);
  engineRoot.remove(held.group);
  held = null;
  refresh();
}
function install(p, silent) {
  if (held === p) { setGhost(p, false); held = null; }
  p.installed = true;
  engineRoot.add(p.group);
  if (!silent) { p.anim = 0; sfx.place(); buzz(12); save(); refresh(); }
}
function uninstall(p) {
  p.installed = false;
  engineRoot.remove(p.group);
  p.bolts.forEach((b) => setTight(b, 0));
  if (selected === p) selected = null;
  sfx.remove(); save(); refresh();
}

function save() {
  const data = { parts: {}, known, playTime, won };
  for (const p of fitted) if (p.installed) data.parts[p.id] = p.bolts.map((b) => +b.tight.toFixed(2));
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch {}
}
function load() {
  let data = null;
  try { data = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch {}
  if (!data || !data.parts) return false;
  for (const p of fitted) {
    const t = data.parts[p.id];
    if (!t) continue;
    install(p, true);
    p.bolts.forEach((b, i) => setTight(b, clamp(+t[i] || 0, 0, 1)));
  }
  Object.assign(known, data.known || {});
  playTime = data.playTime || 0; won = !!data.won;
  return true;
}
function resetBuild() {
  stopEngine();
  drop();
  for (const p of fitted) { if (p.installed) engineRoot.remove(p.group); p.installed = false; p.bolts.forEach((b) => setTight(b, 0)); }
  for (const k in known) delete known[k];
  playTime = 0; won = false; selected = null; oil.scale.setScalar(0.001);
  setCrank(parts, 0);
  save(); refresh();
}

const buzz = (ms) => { try { navigator.vibrate && navigator.vibrate(ms); } catch {} };

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
    b.onclick = () => { $('modal').hidden = true; fn && fn(); };
    box.appendChild(b);
  }
  $('modal').hidden = false;
}
const HELP = `
<ul>
<li><b>Parts</b> opens the shelf. Pick a part, then tap its <b>green outline</b> on the engine to fit it. Red means something is missing or in the way.</li>
<li>Every bolt comes loose. Pick a <b>spanner size</b>, then <b>press and hold</b> on a bolt to turn it. Nobody tells you the size — try one.</li>
<li><b>↻ / ↺</b> flips the ratchet between tighten and loosen.</li>
<li>With the <b>hand</b>, tap a fitted part to inspect or remove it (all its bolts must be undone).</li>
<li>Drag to look around, pinch to zoom, two fingers to pan, double-tap to focus.</li>
<li>When you think it's done, hit <b>Start</b>. The engine will let you know what you forgot.</li>
</ul>`;

function buildTools() {
  const box = $('tools');
  const mk = (label, sub, val) => {
    const b = document.createElement('button');
    b.innerHTML = sub ? `${label}<small>${sub}</small>` : label;
    b.dataset.tool = val;
    b.onclick = () => { unlockAudio(); sfx.ui(); tool = val; if (val !== 'hand') { drop(); selected = null; } refresh(); };
    box.appendChild(b);
  };
  mk('✋', 'hand', 'hand');
  for (const s of SIZES) mk(String(s), 'mm', s);
}

function refresh() {
  const tight = parts.reduce((n, p) => n + (p.installed ? p.bolts.filter((b) => b.tight >= 1).length : 0), 0);
  const inst = fitted.filter((p) => p.installed).length;
  $('sBolts').textContent = `${tight}/${totalBolts}`;
  $('sParts').textContent = `${inst}/${fitted.length}`;
  $('bar').firstElementChild.style.width = `${((tight + inst) / (totalBolts + fitted.length)) * 100}%`;
  $('partsN').textContent = `(${fitted.length - inst})`;
  $('dirBtn').textContent = dir > 0 ? '↻ Tighten' : '↺ Loosen';
  $('dirBtn').classList.toggle('danger', dir < 0);
  for (const b of $('tools').children) b.classList.toggle('on', String(tool) === b.dataset.tool);
  $('startBtn').textContent = run ? 'Stop' : 'Start';
  $('startBtn').classList.toggle('danger', !!run);
  $('startBtn').classList.toggle('primary', !run);
  $('throttle').hidden = !(run && run.phase === 'run');
  $('bottom').hidden = !!run;

  const strip = $('strip');
  if (held) {
    const why = reasonInstall(held);
    $('stripName').textContent = held.name;
    $('stripSub').textContent = why || 'Tap the green outline to fit it';
    $('stripAct').textContent = 'Put back'; $('stripAct').className = '';
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
  if (!held) $('stripAct').hidden = !!(selected && selected.id === 'block');

  if (!$('drawer').hidden) fillDrawer();
}
function fillDrawer() {
  const grid = $('grid');
  grid.innerHTML = '';
  const left = fitted.filter((p) => !p.installed);
  if (!left.length) { grid.innerHTML = '<p>The shelf is empty. Everything is on the engine.</p>'; return; }
  for (const p of left) {
    const b = document.createElement('button');
    b.className = 'card';
    b.innerHTML = `<img alt="" src="${p.thumb}">${p.name}`;
    b.onclick = () => { sfx.ui(); $('drawer').hidden = true; tool = 'hand'; hold(p); if (reasonInstall(p)) toast(reasonInstall(p)); };
    grid.appendChild(b);
  }
}

$('partsBtn').onclick = () => { unlockAudio(); sfx.ui(); $('drawer').hidden = false; fillDrawer(); };
$('drawerClose').onclick = () => { $('drawer').hidden = true; };
$('dirBtn').onclick = () => { unlockAudio(); sfx.ui(); dir = -dir; refresh(); };
$('stripClose').onclick = () => { if (held) drop(); selected = null; refresh(); };
$('stripAct').onclick = () => {
  if (held) return drop();
  if (!selected) return;
  const why = reasonRemove(selected);
  if (why) { sfx.wrong(); toast(why); } else uninstall(selected);
};
$('menuBtn').onclick = () => modal('Bolt by Bolt', HELP, [
  ['Reset build', () => modal('Strip it all down?', '<p>Every part goes back on the shelf and every bolt comes undone.</p>', [['Cancel'], ['Reset', resetBuild, 'danger']]), 'danger'],
  ['Back to work', null, 'primary'],
]);
$('startBtn').onclick = () => { unlockAudio(); run ? stopEngine() : startEngine(); };
$('thr').oninput = (e) => { if (run) run.target = +e.target.value; };

/* ================= camera ================= */
const cam = { target: new THREE.Vector3(0, 1.3, 0), goal: new THREE.Vector3(0, 1.3, 0), r: 12, rGoal: 12, th: 0.75, ph: 1.15 };
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
function placeCamera() {
  const sp = Math.sin(cam.ph);
  camera.position.set(
    cam.target.x + cam.r * sp * Math.sin(cam.th),
    Math.max(FLOOR_Y + 0.4, cam.target.y + cam.r * Math.cos(cam.ph)),
    cam.target.z + cam.r * sp * Math.cos(cam.th),
  );
  camera.lookAt(cam.target);
}
window.addEventListener('resize', resize);
resize();
cam.r = cam.rGoal = camera.aspect < 1 ? 17 : 11;

/* ================= picking ================= */
const ray = new THREE.Raycaster();
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), ndc = new THREE.Vector2();
const partOf = (o) => { while (o && !o.userData.partId) o = o.parent; return o ? byId[o.userData.partId] : null; };
function hits(x, y) {
  ndc.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  return ray.intersectObject(engineRoot, true);
}
// Nearest visible bolt to a screen point, with a finger-sized tolerance.
function findBolt(x, y) {
  const cands = [];
  for (const p of parts) {
    if (!p.installed) continue;
    for (const b of p.bolts) {
      b.head.getWorldPosition(v1);
      v2.copy(v1).project(camera);
      if (v2.z > 1) continue;
      const d = Math.hypot((v2.x + 1) / 2 * window.innerWidth - x, (1 - v2.y) / 2 * window.innerHeight - y);
      if (d < 34) cands.push({ b, d, pos: v1.clone() });
    }
  }
  cands.sort((a, b) => a.d - b.d);
  for (const c of cands) {
    const dist = c.pos.distanceTo(camera.position);
    ray.set(camera.position, v2.copy(c.pos).sub(camera.position).normalize());
    const h = ray.intersectObject(engineRoot, true).find((i) => partOf(i.object) !== held);
    if (!h || h.distance > dist - 0.2 || h.object.userData.bolt === c.b) return c.b;
  }
  return null;
}

function beginTurn(b) {
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
  if (run) return;
  const list = hits(x, y);
  if (held) {
    const onGhost = list.some((h) => partOf(h.object) === held);
    let near = false;
    if (!onGhost) {
      new THREE.Box3().setFromObject(held.group).getCenter(v1).project(camera);
      near = Math.hypot((v1.x + 1) / 2 * window.innerWidth - x, (1 - v1.y) / 2 * window.innerHeight - y) < 48;
    }
    if (onGhost || near) {
      const why = reasonInstall(held);
      if (why) { sfx.wrong(); toast(why); } else install(held);
    }
    return;
  }
  const h = list[0];
  selected = h ? partOf(h.object) : null;
  refresh();
}
function focusAt(x, y) {
  const h = hits(x, y).find((i) => partOf(i.object) !== held);
  if (!h) { cam.goal.set(0, 1.3, 0); cam.rGoal = camera.aspect < 1 ? 17 : 11; return; }
  cam.goal.copy(h.point);
  cam.rGoal = Math.min(cam.rGoal, 5.5);
}

/* ================= input ================= */
const ptrs = new Map();
let gesture = null, lastTap = { t: 0, x: 0, y: 0 }, pinch = null;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  unlockAudio();
  canvas.setPointerCapture(e.pointerId);
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (ptrs.size === 1) {
    gesture = { mode: e.button === 2 || e.shiftKey ? 'pan' : 'orbit', moved: 0, t: performance.now(), x: e.clientX, y: e.clientY };
    if (typeof tool === 'number' && !run && gesture.mode === 'orbit') {
      const b = findBolt(e.clientX, e.clientY);
      if (b) { gesture.mode = 'bolt'; beginTurn(b); }
    }
  } else if (ptrs.size === 2) {
    endTurn();
    gesture = { mode: 'pinch', moved: 99 };
    pinch = pinchState();
  }
});
function pinchState() {
  const [a, b] = [...ptrs.values()];
  return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
function pan(dx, dy) {
  const k = (2 * cam.r * Math.tan((camera.fov * Math.PI) / 360)) / window.innerHeight;
  v1.setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(-dx * k);
  v2.setFromMatrixColumn(camera.matrixWorld, 1).multiplyScalar(dy * k);
  cam.goal.add(v1).add(v2);
  cam.goal.set(clamp(cam.goal.x, -3.5, 3.5), clamp(cam.goal.y, -2, 4.5), clamp(cam.goal.z, -2.5, 2.5));
  cam.target.copy(cam.goal);
}
canvas.addEventListener('pointermove', (e) => {
  const p = ptrs.get(e.pointerId);
  if (!p || !gesture) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  gesture.moved += Math.abs(dx) + Math.abs(dy);
  if (gesture.mode === 'orbit') {
    cam.th -= dx * 0.006;
    cam.ph = clamp(cam.ph - dy * 0.006, 0.08, Math.PI - 0.08);
  } else if (gesture.mode === 'pan') pan(dx, dy);
  else if (gesture.mode === 'pinch' && ptrs.size === 2) {
    const n = pinchState();
    cam.rGoal = cam.r = clamp((cam.r * pinch.d) / Math.max(n.d, 1), 2.5, 22);
    pan(n.x - pinch.x, n.y - pinch.y);
    pinch = n;
  }
});
function pointerEnd(e) {
  if (!ptrs.has(e.pointerId)) return;
  ptrs.delete(e.pointerId);
  if (!gesture) return;
  if (gesture.mode === 'bolt') endTurn();
  else if (gesture.mode === 'orbit' && gesture.moved < 10 && performance.now() - gesture.t < 400 && e.type === 'pointerup') {
    const now = performance.now();
    if (now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) focusAt(e.clientX, e.clientY);
    else handleTap(e.clientX, e.clientY);
    lastTap = { t: now, x: e.clientX, y: e.clientY };
  }
  if (ptrs.size === 0) gesture = null;
  else if (ptrs.size === 1) gesture = { mode: 'orbit', moved: 99, t: 0 };
}
canvas.addEventListener('pointerup', pointerEnd);
canvas.addEventListener('pointercancel', pointerEnd);
canvas.addEventListener('wheel', (e) => { e.preventDefault(); cam.rGoal = clamp(cam.rGoal * Math.exp(e.deltaY * 0.001), 2.5, 22); }, { passive: false });

/* ================= starting the engine ================= */
function diagnose() {
  const I = (id) => byId[id].installed;
  const T = (id) => I(id) && byId[id].bolts.every((b) => b.tight >= 1);
  const group = (n, k) => Array.from({ length: k }, (_, i) => `${n}${i + 1}`);
  const caps = group('maincap', 3), pist = group('piston', 4), plugs = group('plug', 4);

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
  if (run) return;
  drop(); endTurn(); selected = null;
  $('drawer').hidden = true;
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
  engineRoot.position.set(0, 0, 0);
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
      if (f.leak) oil.scale.setScalar(Math.min(3.2, oil.scale.x + dt * 0.5));
      if (run.t > f.t) { if (f.bang) { sfx.bang(); buzz(200); } return stopEngine(f.msg); }
    } else if (!d.loud && !won && run.t > 6) {
      won = true; save(); sfx.win();
      const m = Math.floor(playTime / 60), s = Math.floor(playTime % 60);
      modal('It runs.', `<p>${totalBolts} bolts, ${fitted.length} parts, and it idles like it left the factory.</p><p>Build time: <b>${m}m ${String(s).padStart(2, '0')}s</b></p><p>Use the throttle on the right. Reset the build from the menu to do it all again, faster.</p>`, [['Rev it', null, 'primary']]);
    }
    // exhaust smoke
    run.emit += dt * (4 + run.rpm / 300);
    while (run.emit > 1) { run.emit -= 1; puff(f && f.steam && run.t > f.t * 0.5); }
    const k = 0.006 + run.rpm / 600000;
    engineRoot.position.set((Math.random() - 0.5) * k, (Math.random() - 0.5) * k, (Math.random() - 0.5) * k);
  }
  run.theta += (run.rpm / 60) * Math.PI * 2 * dt * 0.35;
  setCrank(parts, run.theta);
}

/* smoke + oil */
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
  scene.add(s);
  puffs.push({ s, life: 0, v: new THREE.Vector3() });
}
function puff(steam) {
  const p = puffs.find((q) => q.life <= 0);
  if (!p) return;
  const ex = byId.exhaust.installed;
  if (ex) p.s.position.set(0.9, -1.55, 1.72); else p.s.position.set(-1.5 + Math.floor(Math.random() * 4), 2.75, 1.0);
  if (steam) p.s.position.set((Math.random() - 0.5) * 4, 2.45, (Math.random() < 0.5 ? -1 : 1) * 0.95);
  p.v.set(ex && !steam ? 0.9 : (Math.random() - 0.5) * 0.4, steam ? 1.4 : 0.5, steam ? 0 : 0.7);
  p.s.material.color.set(steam ? 0xffffff : 0x8a8a8a);
  p.life = p.max = 1.6; p.s.visible = true; p.s.scale.setScalar(0.3);
}
function tickPuffs(dt) {
  for (const p of puffs) {
    if (p.life <= 0) continue;
    p.life -= dt;
    p.s.position.addScaledVector(p.v, dt);
    p.v.y += dt * 0.5;
    p.s.scale.addScalar(dt * 1.1);
    p.s.material.opacity = Math.max(0, p.life / p.max) * 0.5;
    if (p.life <= 0) p.s.visible = false;
  }
}
const oil = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshStandardMaterial({ color: 0x0b0906, roughness: 0.15, metalness: 0.4 }));
oil.rotation.x = -Math.PI / 2; oil.position.set(0.2, FLOOR_Y + 0.02, 0.2); oil.scale.setScalar(0.001); oil.receiveShadow = true;
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
  if (quality === 2) { renderer.shadowMap.enabled = false; sun.castShadow = false; }
  resize();
}
function frame(now) {
  watchFps((now - last) / 1000);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!won && !document.hidden) playTime += dt;

  if (turning) {
    const b = turning;
    const t = clamp(b.tight + (dir * dt) / 1.1, 0, 1);
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
  if (held) {
    const pulse = 0.3 + 0.15 * Math.sin(now * 0.006);
    ghostOk.opacity = ghostNo.opacity = pulse;
  }
  if (run) tickEngine(dt);
  tickPuffs(dt);

  cam.target.lerp(cam.goal, Math.min(1, dt * 8));
  cam.r += (cam.rGoal - cam.r) * Math.min(1, dt * 8);
  placeCamera();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

/* ================= boot ================= */
buildTools();
const hadSave = load();
setCrank(parts, 0);
refresh();
if (!hadSave) modal('Bolt by Bolt', `<p>One bare engine block on a stand. ${fitted.length} parts on the shelf. ${totalBolts} bolts between you and a running engine.</p>${HELP}`, [['Get to work', null, 'primary']]);
setInterval(() => { if (!run) save(); }, 15000);
requestAnimationFrame(frame);

// Hooks for tests and for the curious.
window.__game = {
  parts, byId, diagnose, install, uninstall, hold, findBolt, camera, cam,
  get state() { return { tool, dir, held: held && held.id, selected: selected && selected.id, run: run && run.phase, won }; },
  buildAll(tight = true) {
    for (const p of fitted) { if (!p.installed) install(p, true); p.bolts.forEach((b) => setTight(b, tight ? 1 : 0)); }
    save(); refresh();
  },
  boltScreen(b) {
    b.head.getWorldPosition(v1).project(camera);
    return { x: (v1.x + 1) / 2 * window.innerWidth, y: (1 - v1.y) / 2 * window.innerHeight };
  },
};
