// Shared modelling kit: materials with procedural surface textures, and geometry helpers that
// always produce closed, outward-facing solids. Units everywhere: 1 = 10 cm.
import * as THREE from '../vendor/three.module.min.js';

/* ---------- procedural textures ---------- */
function canvasTex(size, draw, repeat = 1, color = false) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
let seed = 12345;
const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff;
// Grey height field made of soft dots: `n` dots of radius up to `r` px.
const grain = (n, r, contrast) => (g, s) => {
  g.fillStyle = '#808080'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < n; i++) {
    const v = rnd() < 0.5 ? 0 : 255, a = rnd() * contrast, x = rnd() * s, y = rnd() * s, rad = 0.5 + rnd() * r;
    g.fillStyle = `rgba(${v},${v},${v},${a})`;
    for (const ox of [-s, 0, s]) for (const oy of [-s, 0, s]) {         // wrap so the tile is seamless
      if (x + ox < -rad || x + ox > s + rad || y + oy < -rad || y + oy > s + rad) continue;
      g.beginPath(); g.arc(x + ox, y + oy, rad, 0, 6.3); g.fill();
    }
  }
};
export const TEX = {
  cast: canvasTex(256, grain(5000, 3.2, 0.35), 3),           // sand-cast iron / aluminium
  fine: canvasTex(256, grain(9000, 1.3, 0.3), 5),            // crinkle paint, moulded plastic
  brushed: canvasTex(256, (g, s) => {                        // machined / turned steel
    g.fillStyle = '#808080'; g.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y++) { const v = 100 + rnd() * 70; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(0, y, s, 1); }
  }, 2),
  rust: canvasTex(256, (g, s) => {
    g.fillStyle = '#6b4a38'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 2600; i++) {
      const c = [[92, 52, 30], [58, 44, 40], [130, 78, 42], [44, 38, 36]][Math.floor(rnd() * 4)];
      g.fillStyle = `rgba(${c},${0.1 + rnd() * 0.3})`;
      g.beginPath(); g.arc(rnd() * s, rnd() * s, 1 + rnd() * 7, 0, 6.3); g.fill();
    }
  }, 2, true),
  tread: canvasTex(256, (g, s) => {                          // u runs round the tyre, v across the profile
    g.fillStyle = '#9a9a9a'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#000';
    for (const y of [0.36, 0.45, 0.55, 0.64]) g.fillRect(0, y * s - 3, s, 6);          // circumferential grooves
    g.lineWidth = 3; g.strokeStyle = '#000';
    for (let x = 0; x < s; x += 16) for (const [a, b, d] of [[0.26, 0.36, 8], [0.64, 0.74, -8]]) {
      g.beginPath(); g.moveTo(x, a * s); g.lineTo(x + d, b * s); g.stroke();           // shoulder sipes
    }
  }, 1),
};
TEX.tread.repeat.set(12, 1);

const M = (color, metalness, roughness, tex, bump = 0.02, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, metalness, roughness, ...(tex ? { bumpMap: tex, bumpScale: bump, roughnessMap: tex } : {}), ...extra });

export const MAT = {
  block: M(0x3f5560, 0.3, 1.0, TEX.cast, 2.2),               // painted cast iron
  iron: M(0x5b5f63, 0.65, 0.95, TEX.cast, 2.0),              // bare cast / forged
  alu: M(0xb8bdc2, 0.8, 0.8, TEX.fine, 0.9),                // cast aluminium
  steel: M(0xa9aeb3, 1.0, 0.55, TEX.brushed, 0.6),           // machined steel
  zinc: M(0xc9ccc4, 1.0, 0.45, TEX.fine, 0.5),               // plated fasteners
  dark: M(0x2c2f33, 0.7, 0.8, TEX.fine, 1.0),                // black oxide / phosphate
  black: M(0x15171a, 0.35, 0.9, TEX.fine, 1.2),              // stamped steel, black paint
  plastic: M(0x18191b, 0.0, 0.75, TEX.fine, 0.8),
  rubber: M(0x111112, 0.0, 1.0, TEX.fine, 1.0),
  copper: M(0xb8733c, 0.9, 0.5, TEX.brushed, 0.4),
  gasket: M(0x4f5253, 0.2, 0.95, TEX.fine, 0.8),
  red: M(0x9c2219, 0.25, 0.95, TEX.fine, 2.0),               // crinkle-finish paint
  rust: M(0xffffff, 0.4, 1.0, TEX.cast, 2.4, { map: TEX.rust }),
  ceramic: M(0xf1efe8, 0.0, 0.3),
  cap: M(0x5b2a1f, 0.0, 0.5),                                // bakelite
  filter: M(0xd8892b, 0.25, 0.55),
  lead: M(0x1c2a4a, 0.0, 0.75),
  stand: M(0xb5301e, 0.3, 0.6, TEX.fine, 0.8),
  tyre: M(0x1a1a1b, 0.0, 1.0, TEX.tread, 3.0),
};

/* ---------- mesh helpers ---------- */
export function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  return m;
}
export const box = (w, h, d, mat, x, y, z) => mesh(new THREE.BoxGeometry(w, h, d), mat, x, y, z);
export function cyl(r, len, mat, axis, x, y, z, seg = 24, rTop = r) {
  const g = new THREE.CylinderGeometry(rTop, r, len, seg);
  if (axis === 'x') g.rotateZ(-Math.PI / 2);          // +Y end goes to +X
  if (axis === 'z') g.rotateX(Math.PI / 2);           // +Y end goes to +Z
  return mesh(g, mat, x, y, z);
}
// Solid of revolution from a profile of [radius, height] points. Start and end on the axis (radius 0)
// for a closed solid. `axis` is the direction the profile's height runs along.
export function lathe(profile, mat, axis = 'y', seg = 32, x = 0, y = 0, z = 0) {
  let area = 0;
  for (let i = 0; i < profile.length; i++) { const a = profile[i], b = profile[(i + 1) % profile.length]; area += a[0] * b[1] - b[0] * a[1]; }
  const pts = (area < 0 ? profile.slice().reverse() : profile).map(([r, h]) => new THREE.Vector2(Math.max(r, 0), h));
  const g = new THREE.LatheGeometry(pts, seg);
  if (axis === 'x') g.rotateZ(-Math.PI / 2);
  if (axis === 'z') g.rotateX(Math.PI / 2);
  return mesh(g, mat, x, y, z);
}
const shapeOf = (pts, holes, v) => {
  // ExtrudeGeometry only fixes hole winding when it has to reverse the outline, so always hand it a
  // counter-clockwise outline — otherwise the walls of cut-outs come out facing inwards.
  const outline = pts.map(v);
  if (THREE.ShapeUtils.isClockWise(outline)) outline.reverse();
  const s = new THREE.Shape(outline);
  for (const h of holes) s.holes.push(new THREE.Path(h.map(v)));
  return s;
};
const EX = (depth, bevel) => ({ depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 24 });
// Outline in (x, z), extruded up along Y from y0.
export function exY(pts, holes, y0, depth, mat, bevel = 0) {
  const g = new THREE.ExtrudeGeometry(shapeOf(pts, holes, ([x, z]) => new THREE.Vector2(x, -z)), EX(depth, bevel));
  g.rotateX(-Math.PI / 2); g.translate(0, y0, 0);
  return mesh(g, mat);
}
// Outline in (z, y), extruded along +X from x0.
export function exX(pts, holes, x0, depth, mat, bevel = 0) {
  const g = new THREE.ExtrudeGeometry(shapeOf(pts, holes, ([z, y]) => new THREE.Vector2(-z, y)), EX(depth, bevel));
  g.rotateY(Math.PI / 2); g.translate(x0, 0, 0);
  return mesh(g, mat);
}
// Outline in (x, y), extruded along +Z from z0.
export function exZ(pts, holes, z0, depth, mat, bevel = 0) {
  const g = new THREE.ExtrudeGeometry(shapeOf(pts, holes, ([x, y]) => new THREE.Vector2(x, y)), EX(depth, bevel));
  g.translate(0, 0, z0);
  return mesh(g, mat);
}
// Box with rounded edges, centred on (x, y, z).
export function rbox(w, h, d, r, mat, x = 0, y = 0, z = 0) {
  const g = new THREE.ExtrudeGeometry(shapeOf(roundRect(-w / 2 + r, -h / 2 + r, w / 2 - r, h / 2 - r, r * 0.5), [], ([a, b]) => new THREE.Vector2(a, b)), EX(d - 2 * r, r));
  g.translate(0, 0, -(d - 2 * r) / 2);
  return mesh(g, mat, x, y, z);
}
// Tube along a smooth path, with flat end caps so it is a closed solid.
export function tube(pts, r, mat, seg = 28, radial = 12) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
  const g = new THREE.TubeGeometry(curve, seg, r, radial).toNonIndexed();
  const src = new THREE.TubeGeometry(curve, seg, r, radial).attributes.position;
  const pos = Array.from(g.attributes.position.array), nor = Array.from(g.attributes.normal.array), uv = Array.from(g.attributes.uv.array);
  const P = (i) => new THREE.Vector3().fromBufferAttribute(src, i);
  for (const [ring, flip] of [[0, true], [seg, false]]) {
    const base = ring * (radial + 1), c = new THREE.Vector3();
    for (let j = 0; j < radial; j++) c.add(P(base + j));
    c.multiplyScalar(1 / radial);
    const n = curve.getTangent(ring ? 1 : 0).multiplyScalar(flip ? -1 : 1);
    for (let j = 0; j < radial; j++) {
      const a = P(base + j), b = P(base + j + 1);
      for (const v of flip ? [c, a, b] : [c, b, a]) { pos.push(v.x, v.y, v.z); nor.push(n.x, n.y, n.z); uv.push(0.5, 0.5); }
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return mesh(out, mat);
}

/* ---------- outlines ---------- */
// Points on a circle (or arc, in degrees) centred (a, b).
export function circ(a, b, r, n = 28, d0 = 0, d1 = 360) {
  const pts = [], full = d1 - d0 >= 360;
  for (let i = 0; i < (full ? n : n + 1); i++) {
    const t = ((d0 + ((d1 - d0) * i) / n) * Math.PI) / 180;
    pts.push([a + r * Math.cos(t), b + r * Math.sin(t)]);
  }
  return pts;
}
export function roundRect(x0, y0, x1, y1, r) {
  return [...circ(x1 - r, y1 - r, r, 5, 0, 90), ...circ(x0 + r, y1 - r, r, 5, 90, 180), ...circ(x0 + r, y0 + r, r, 5, 180, 270), ...circ(x1 - r, y0 + r, r, 5, 270, 360)];
}
// Convex hull of points, counter-clockwise.
export function hullOf(points) {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (const p of pts.reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  lo.pop(); up.pop();
  return lo.concat(up);
}
// Toothed wheel outline: n teeth between root and tip radius.
export function gear(root, tip, n) {
  const pts = [];
  for (let i = 0; i < n; i++) for (const [f, r] of [[0.0, root], [0.25, tip], [0.6, tip], [0.85, root]]) {
    const t = ((i + f) / n) * Math.PI * 2;
    pts.push([r * Math.cos(t), r * Math.sin(t)]);
  }
  return pts;
}

/* ---------- baking ---------- */
// Merge geometries (already in a common space) into one non-indexed geometry, dropping zero-area triangles.
export function merge(geos) {
  const pos = [], nor = [], uv = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (const src of geos) {
    const g = src.index ? src.toNonIndexed() : src;
    const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
    for (let i = 0; i < p.count; i += 3) {
      a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
      if (b.clone().sub(a).cross(c.clone().sub(a)).lengthSq() < 1e-16) continue;
      for (let k = i; k < i + 3; k++) {
        pos.push(p.getX(k), p.getY(k), p.getZ(k));
        nor.push(n.getX(k), n.getY(k), n.getZ(k));
        uv.push(u ? u.getX(k) : 0, u ? u.getY(k) : 0);
      }
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return out;
}
// Collapse a group's plain child meshes into one mesh per material (fewer draw calls, clean geometry).
// Child groups are baked recursively; anything flagged userData.keep is left alone.
export function bake(group, solid = true) {
  const byMat = new Map();
  for (const ch of group.children.slice()) {
    if (ch.userData.keep) continue;
    if (!ch.isMesh) { bake(ch, solid); continue; }
    ch.updateMatrix();
    const g = ch.geometry.clone().applyMatrix4(ch.matrix);
    if (!byMat.has(ch.material)) byMat.set(ch.material, []);
    byMat.get(ch.material).push(g);
    group.remove(ch);
  }
  for (const [mat, geos] of byMat) {
    const m = mesh(merge(geos), mat);
    m.userData.solid = solid;
    group.add(m);
  }
  return group;
}
