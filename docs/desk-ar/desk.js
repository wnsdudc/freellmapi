// Classroom desk (demo product) as 3D parts + assembly steps.
// Model units: centimetres, y up, desk front (student side) = +z.
import * as THREE from './vendor/three.module.min.js';

export const ACCENT = 0x2f80ff;

export const PRODUCT = { code: 'DEMO-DESK-01', w: 65, d: 45, h: 72 };

const MAT = {
  wood: new THREE.MeshStandardMaterial({ color: 0xe2c597, roughness: 0.65 }),
  frame: new THREE.MeshStandardMaterial({ color: 0x56606c, roughness: 0.45, metalness: 0.35 }),
  tray: new THREE.MeshStandardMaterial({ color: 0x8e99a5, roughness: 0.55, metalness: 0.25 }),
  bar: new THREE.MeshStandardMaterial({ color: 0x56606c, roughness: 0.45, metalness: 0.35 }),
  steel: new THREE.MeshStandardMaterial({ color: 0xc3c8ce, roughness: 0.3, metalness: 0.6 }),
  rubber: new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 0.9 }),
};
const EDGE = new THREE.LineBasicMaterial({ color: 0x1d232a, transparent: true, opacity: 0.45 });

const W = PRODUCT.w, D = PRODUCT.d, TOP_T = 2, TOP_Y = 70;     // underside of the top at 70 cm
const A = 2.5;                                                  // steel tube 25 mm
const LX = W / 2 - 4, LZ = D / 2 - 4;                           // leg centres (28.5, 18.5)
const CAP = 1.5;

function box(w, h, d, mat, edges = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = true; m.receiveShadow = true;
  if (edges) m.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), EDGE));
  return m;
}
function cyl(r, len, axis, mat, seg = 16) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat);
  if (axis === 'x') m.rotation.z = Math.PI / 2;
  if (axis === 'z') m.rotation.x = Math.PI / 2;
  m.castShadow = true;
  return m;
}
function at(obj, x, y, z) { obj.position.set(x, y, z); return obj; }

// ---- part builders (each returns a Group in desk coordinates) ----
function makeTop() {
  const g = new THREE.Group();
  g.add(at(box(W, TOP_T, D, MAT.wood), 0, TOP_Y + TOP_T / 2, 0));
  return g;
}
function makeFrame(sx) {
  const g = new THREE.Group();
  const x = sx * LX;
  const legH = TOP_Y - CAP;
  for (const z of [-LZ, LZ]) g.add(at(box(A, legH, A, MAT.frame), x, CAP + legH / 2, z));
  const railL = 2 * LZ + A;
  g.add(at(box(A, A, railL, MAT.frame), x, TOP_Y - A / 2, 0));     // top rail (screwed to the desktop)
  g.add(at(box(A, A, railL, MAT.frame), x, 56, 0));                 // tray rail
  g.add(at(box(A, A, railL, MAT.frame), x, 10, 0));                 // bottom rail
  return g;
}
function makeTray() {
  const g = new THREE.Group();
  const y0 = 56 + A / 2;           // top of the tray rails
  const w = 2 * LX + 0.5, d = 30, zc = -2;
  g.add(at(box(w, 0.8, d, MAT.tray), 0, y0 + 0.4, zc));
  g.add(at(box(w, 9, 0.8, MAT.tray), 0, y0 + 4.5, zc - d / 2 + 0.4));            // closed back
  for (const s of [-1, 1]) g.add(at(box(0.8, 9, d, MAT.tray), s * (LX - 1.6), y0 + 4.5, zc));
  return g;
}
function makeFootrest() {
  const g = new THREE.Group();
  g.add(at(cyl(1.2, 2 * LX - A, 'x', MAT.bar), 0, 12, LZ));
  return g;
}
function makeHook() {
  const g = new THREE.Group();
  g.add(at(box(4, 0.7, 0.7, MAT.steel, false), LX + A / 2 + 2, 64, 0));
  g.add(at(box(0.7, 2.6, 0.7, MAT.steel, false), LX + A / 2 + 4, 65.3, 0));
  return g;
}

// Hardware sets: items with their own fly-in offsets.
function screwHead() { return cyl(0.55, 0.3, 'y', MAT.steel, 12); }
function boltHead(axis) { return cyl(0.65, 0.4, axis, MAT.steel, 6); }
function capObj() { return box(3, CAP, 3, MAT.rubber, false); }

export function makeLabel(text, heightCm = 7.5) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const font = '700 64px "Pretendard", "Apple SD Gothic Neo", "Noto Sans KR", system-ui, sans-serif';
  g.font = font;
  c.width = Math.max(96, Math.ceil(g.measureText(text).width) + 52);
  c.height = 96;
  g.font = font;
  const r = 44;
  g.fillStyle = '#2f80ff';
  g.beginPath();
  g.moveTo(r, 2); g.arcTo(c.width - 2, 2, c.width - 2, c.height - 2, r); g.arcTo(c.width - 2, c.height - 2, 2, c.height - 2, r);
  g.arcTo(2, c.height - 2, 2, 2, r); g.arcTo(2, 2, c.width - 2, 2, r); g.closePath();
  g.fill();
  g.lineWidth = 5; g.strokeStyle = '#ffffff'; g.stroke();
  g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, c.width / 2, c.height / 2 + 3);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(heightCm * c.width / c.height, heightCm, 1);
  s.renderOrder = 30;
  return s;
}

function ownMaterials(obj) {
  const map = new Map(); const mats = [];
  obj.traverse((o) => {
    if (o.isMesh) {
      if (!map.has(o.material.uuid)) { const m = o.material.clone(); map.set(o.material.uuid, m); mats.push(m); }
      o.material = map.get(o.material.uuid);
    }
  });
  return mats;
}

export function buildDesk() {
  // pivot at the desk's centre so it can be turned over
  const pivot = new THREE.Group();
  pivot.position.y = PRODUCT.h / 2;
  const inner = new THREE.Group();
  inner.position.y = -PRODUCT.h / 2;
  pivot.add(inner);

  const parts = [];
  const byId = {};
  const v = (x, y, z) => new THREE.Vector3(x, y, z);

  // whole object flies in
  function addPart(id, obj, from, { delay = 0, label = null, labelPos = null } = {}) {
    const part = { id, obj, step: -1, movers: [{ obj, final: obj.position.clone(), from, delay }], mats: ownMaterials(obj), label: null };
    if (label) {
      const s = makeLabel(label);
      s.position.copy(labelPos);
      s.visible = false;
      obj.add(s);
      part.label = s;
    }
    inner.add(obj);
    parts.push(part); byId[id] = part;
    return part;
  }
  // set of small items, each flying in on its own
  function addSet(id, items, delay = 0, stagger = 0.06) {
    const g = new THREE.Group();
    const movers = items.map(([obj, pos, from], i) => { obj.position.copy(pos); g.add(obj); return { obj, final: pos.clone(), from, delay: delay + i * stagger }; });
    const part = { id, obj: g, step: -1, movers, mats: ownMaterials(g), label: null };
    inner.add(g);
    parts.push(part); byId[id] = part;
    return part;
  }

  // While the desk is upside down, "from" offsets with negative y come from above on screen.
  addPart('A', makeTop(), v(0, -45, 0), { label: 'A', labelPos: v(0, TOP_Y - 4, D / 2 + 2) });
  const sides = [['B', -1], ['C', 1]];
  for (const [id, sx] of sides) {
    addPart(id, makeFrame(sx), v(sx * 30, -35, 0), { label: id, labelPos: v(sx * LX, 30, LZ + 4) });
    const items = [];
    for (const z of [-14, -4, 4, 14]) items.push([screwHead(), v(sx * LX, TOP_Y - A - 0.15, z), v(0, -10, 0)]);
    addSet('s' + id, items, 0.8);
  }
  addPart('D', makeTray(), v(0, -30, 10), { label: 'D', labelPos: v(0, 50, 8) });
  const trayBolts = [];
  for (const sx of [-1, 1]) for (const z of [-10, 6]) trayBolts.push([boltHead('y'), v(sx * LX, 56 - A / 2 - 0.2, z), v(0, -10, 0)]);
  addSet('bD', trayBolts, 0.8);
  addPart('E', makeFootrest(), v(0, -25, 20), { label: 'E', labelPos: v(0, 18, LZ + 4) });
  const footBolts = [];
  for (const sx of [-1, 1]) footBolts.push([boltHead('x'), v(sx * (LX + A / 2 + 0.2), 12, LZ), v(sx * 10, 0, 0)]);
  addSet('bE', footBolts, 0.8);
  const caps = [];
  for (const sx of [-1, 1]) for (const z of [-LZ, LZ]) caps.push([capObj(), v(sx * LX, CAP / 2, z), v(0, -14, 0)]);
  addSet('caps', caps, 0, 0.12);
  addPart('hook', makeHook(), v(18, 0, 0), { label: '#4', labelPos: v(LX + 6, 70, 0) });

  // ---- steps ----
  const steps = [];
  const S = (key, ids, extra = {}) => {
    const i = steps.length;
    ids.forEach((id) => { byId[id].step = i; });
    steps.push({ key, parts: ids.map((id) => byId[id]), ...extra });
  };
  S('parts', [], { layout: true, upside: true });
  S('top', ['A'], { upside: true });
  S('frameB', ['B', 'sB'], { upside: true });
  S('frameC', ['C', 'sC'], { upside: true });
  S('tray', ['D', 'bD'], { upside: true });
  S('foot', ['E', 'bE'], { upside: true });
  S('caps', ['caps'], { upside: true });
  S('flip', [], { flip: true });
  S('hook', ['hook'], {});
  S('done', [], { final: true });

  return { pivot, inner, parts, steps, layout: buildLayout() };
}

// Parts laid out flat for step 1.
function buildLayout() {
  const g = new THREE.Group();
  const put = (obj, x, z, rot = null) => {
    const h = new THREE.Group();
    if (rot) obj.rotation.set(...rot);
    h.add(obj);
    const bb = new THREE.Box3().setFromObject(h);
    const c = bb.getCenter(new THREE.Vector3());
    obj.position.x -= c.x; obj.position.z -= c.z; obj.position.y -= bb.min.y;
    h.position.set(x, 0, z);
    g.add(h);
    return { h, size: bb.getSize(new THREE.Vector3()) };
  };
  const label = (text, x, y, z) => { const s = makeLabel(text, 6); s.position.set(x, y, z); g.add(s); };
  put(makeTop(), 0, -8);                          label('A', 0, 10, -8);
  put(makeFrame(-1), -62, -8, [0, 0, Math.PI / 2]); label('B', -62, 10, -8);
  put(makeFrame(1), 62, -8, [0, 0, -Math.PI / 2]);  label('C', 62, 10, -8);
  put(makeTray(), -22, 36);                       label('D', -22, 18, 36);
  put(makeFootrest(), 30, 36);                    label('E', 30, 10, 36);
  // hardware row
  const hw = [
    ['#1', () => screwHead(), 8, 2.2], ['#2', () => boltHead('y'), 6, 2.6], ['#3', () => capObj(), 4, 4.5], ['#4', () => makeHook(), 1, 0],
  ];
  let x = -50;
  for (const [code, make, n, pitch] of hw) {
    const grp = new THREE.Group();
    for (let i = 0; i < n; i++) {
      const o = make();
      if (code === '#4') { o.rotation.z = Math.PI / 2; o.position.set(-62, 1, 0); }
      else o.position.set(i * pitch, 0.4, 0);
      grp.add(o);
    }
    const bb = new THREE.Box3().setFromObject(grp);
    grp.position.set(x - bb.min.x, -bb.min.y, 62);
    g.add(grp);
    label(code, x + (bb.max.x - bb.min.x) / 2, 8, 62);
    x += (bb.max.x - bb.min.x) + 14;
  }
  return g;
}

export const HW = ['#1', '#2', '#3', '#4'];

// ---- step state, shared by the live view and the USDZ generator ----
export function applyStepState(desk, cur) {
  const steps = desk.steps;
  const st = steps[cur];
  desk.layout.visible = !!st.layout;
  desk.pivot.visible = !st.layout;
  for (const p of desk.parts) {
    const isCur = p.step === cur;
    p.obj.visible = p.step >= 0 && p.step <= cur;
    if (p.label) p.label.visible = isCur;
    for (const m of p.mats) {
      if (!m.userData.base) m.userData.base = m.color.clone();
      m.color.copy(m.userData.base);
      m.emissive.setHex(0);
      m.emissiveIntensity = 0;
    }
    for (const mv of p.movers) { mv.obj.position.copy(mv.final); if (mv.obj !== p.obj) mv.obj.visible = true; }
  }
  const flipAt = steps.findIndex((s) => s.flip);
  desk.pivot.rotation.z = cur < flipAt ? Math.PI : 0;
  desk.pivot.position.y = PRODUCT.h / 2;
}

const easeOut = (k) => 1 - Math.pow(1 - k, 3);
const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

// Positions of the current step's parts at t seconds after the step started.
export function poseAt(desk, cur, t, { hideBeforeStart = true } = {}) {
  const st = desk.steps[cur];
  for (const p of st.parts) {
    for (const mv of p.movers) {
      const k = Math.min(1, Math.max(0, (t - mv.delay) / 0.9));
      mv.obj.position.copy(mv.final).addScaledVector(mv.from, 1 - easeOut(k));
      if (hideBeforeStart) mv.obj.visible = k > 0;
    }
  }
  if (st.flip) {
    const k = Math.min(1, Math.max(0, (t - 0.4) / 1.8));
    const ang = Math.PI * (1 - easeInOut(k));
    desk.pivot.rotation.z = ang;
    desk.pivot.position.y = PRODUCT.h / 2 + 15 * Math.sin(ang);
  }
}
export function stepDuration(desk, cur) {
  const st = desk.steps[cur];
  let d = st.flip ? 2.2 : 0;
  for (const p of st.parts) for (const mv of p.movers) d = Math.max(d, mv.delay + 0.9);
  return d;
}
