// 3-colour retractable ballpoint (modelled on uni JETSTREAM 3-colour SXE3-400-05) as 3D parts + assembly steps.
// Units: millimetres. The pen lies along x: tip toward -x, rear toward +x, y up. Shapes and sizes are
// approximations made for the demo, not measured from the product.
import * as THREE from './vendor/three.module.min.js';

export const ACCENT = 0x2f80ff;
export const PRODUCT = { code: 'SXE3-400-05', name: 'uni JETSTREAM 3-colour 0.5', length: 144 };

const R = 5.6;                      // barrel radius
const AXIS_Y = R + 2.4;             // pen rests on its clip, so the axis sits a little higher
const LEVER_ANG = { black: 0, red: (2 * Math.PI) / 3, blue: (4 * Math.PI) / 3 };   // angle round the axis, 0 = up
const INK = { black: 0x1d1f22, red: 0xd2232a, blue: 0x1f4fd6 };

const MAT = {
  body: new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.55, metalness: 0.1 }),
  rubber: new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.9 }),
  clear: new THREE.MeshStandardMaterial({ color: 0xdfe6ee, roughness: 0.15, transparent: true, opacity: 0.55 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xd5d9de, roughness: 0.25, metalness: 0.8 }),
  tube: new THREE.MeshStandardMaterial({ color: 0xe9edf1, roughness: 0.4, transparent: true, opacity: 0.85 }),
};

// cylinder along x: radius rLeft at the -x end, rRight at the +x end
function cylX(rLeft, rRight, len, mat, seg = 28) {
  const g = new THREE.CylinderGeometry(rLeft, rRight, len, seg);
  g.rotateZ(Math.PI / 2);            // +y (top radius) turns to -x
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
}
function at(o, x, y = 0, z = 0) { o.position.set(x, y, z); return o; }
function polar(ang, r) { return [Math.cos(ang) * r, Math.sin(ang) * r]; }   // (y, z) offsets round the axis

// ---------- part builders (local origin on the pen axis) ----------
function makeBody() {
  const g = new THREE.Group();
  g.add(at(cylX(R, R, 8, MAT.clear), 4));                 // clear band at the front of the body
  g.add(at(cylX(R, R, 80, MAT.body), 48));
  g.add(at(cylX(R, R * 0.92, 4, MAT.body), 90));          // rear end
  // three sliding levers
  for (const [name, ang] of Object.entries(LEVER_ANG)) {
    const [y, z] = polar(ang, R + 0.6);
    const lever = new THREE.Mesh(new THREE.BoxGeometry(11, 1.6, 3.2), new THREE.MeshStandardMaterial({ color: INK[name], roughness: 0.5 }));
    lever.position.set(80, y, z);
    lever.rotation.x = -ang;
    lever.castShadow = true;
    lever.userData.lever = name;
    g.add(lever);
  }
  // clear clip on the underside
  const clip = new THREE.Mesh(new THREE.BoxGeometry(38, 1.6, 4.2), MAT.clear);
  clip.position.set(68, -(R + 1.4), 0);
  clip.castShadow = true;
  g.add(clip);
  return g;
}
function makeGrip() {
  const g = new THREE.Group();
  g.add(at(cylX(R + 0.25, R + 0.25, 36, MAT.rubber), -20));
  for (let i = 0; i < 7; i++) g.add(at(cylX(R + 0.45, R + 0.45, 1.2, MAT.rubber, 20), -34 + i * 4.6));   // grip rings
  g.add(at(cylX(1.7, R + 0.1, 12, MAT.body), -44));       // nose cone (narrow end toward -x)
  g.add(at(cylX(1.1, 1.3, 2.4, MAT.chrome), -51.2));      // metal tip
  return g;
}
function makeRefill(color) {
  const g = new THREE.Group();
  g.add(at(cylX(1.15, 1.15, 88, new THREE.MeshStandardMaterial({ color: INK[color], roughness: 0.45 })), 4));   // ink tube, x -40..48
  g.add(at(cylX(0.55, 1.1, 6, MAT.chrome), -43));        // writing tip
  g.add(at(cylX(1.25, 1.25, 4, MAT.tube), 50));           // end plug
  return g;
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

export function buildPen() {
  const root = new THREE.Group();          // whole pen, resting on the surface
  const inner = new THREE.Group();
  inner.position.y = AXIS_Y;
  root.add(inner);
  const parts = [];
  const byId = {};
  function add(id, obj, finalPos, from, { delay = 0, spin = 0, rot = null } = {}) {
    obj.position.copy(finalPos);
    if (rot) obj.rotation.x = rot;
    const p = { id, obj, step: -1, movers: [{ obj, final: finalPos.clone(), from, delay, spin, rot0: obj.rotation.x }], mats: ownMaterials(obj) };
    inner.add(obj);
    parts.push(p); byId[id] = p;
    return p;
  }
  const v = (x, y, z) => new THREE.Vector3(x, y, z);
  add('body', makeBody(), v(0, 0, 0), v(0, 60, 0));
  for (const c of ['black', 'red', 'blue']) {
    const [y, z] = polar(LEVER_ANG[c], 2.0);
    add(c, makeRefill(c), v(6, y, z), v(-140, 0, 0));
  }
  add('grip', makeGrip(), v(0, 0, 0), v(-90, 0, 0), { spin: 2 });

  const steps = [];
  const S = (key, ids, extra = {}) => { const i = steps.length; ids.forEach((id) => { byId[id].step = i; }); steps.push({ key, parts: ids.map((id) => byId[id]), ...extra }); };
  S('parts', [], { layout: true });
  S('body', ['body'], { expect: 'body' });
  S('black', ['black'], { expect: 'black', xray: true });
  S('red', ['red'], { expect: 'red', xray: true });
  S('blue', ['blue'], { expect: 'blue', xray: true });
  S('grip', ['grip'], { expect: 'grip' });
  S('check', [], { expect: 'pen', check: true });
  S('done', [], { final: true });

  return { root, inner, parts, byId, steps, layout: buildLayout() };
}

// Parts laid out side by side for step 1.
function buildLayout() {
  const g = new THREE.Group();
  const place = (obj, x, z) => { const h = new THREE.Group(); h.add(obj); h.position.set(x, R + 0.4, z); g.add(h); return h; };
  place(makeBody(), 0, -10).position.y = AXIS_Y;
  place(makeGrip(), -10, 22);
  place(makeRefill('black'), 10, -32).position.y = 1.3;
  place(makeRefill('red'), 10, -40).position.y = 1.3;
  place(makeRefill('blue'), 10, -48).position.y = 1.3;
  return g;
}

// ---- step state, shared by the live views and the USDZ generator ----
export function applyStepState(pen, cur) {
  const st = pen.steps[cur];
  pen.layout.visible = !!st.layout;
  pen.root.visible = !st.layout;
  for (const p of pen.parts) {
    p.obj.visible = p.step >= 0 && p.step <= cur;
    for (const m of p.mats) {
      if (!m.userData.base) { m.userData.base = m.color.clone(); m.userData.op = m.opacity; m.userData.tr = m.transparent; }
      m.color.copy(m.userData.base);
      m.emissive.setHex(0);
      m.emissiveIntensity = 0;
      m.opacity = m.userData.op;
      m.transparent = m.userData.tr;
    }
    for (const mv of p.movers) { mv.obj.position.copy(mv.final); mv.obj.rotation.x = mv.rot0; }
  }
  // x-ray body while refills go in
  if (st.xray) for (const m of pen.byId.body.mats) { m.transparent = true; m.opacity = Math.min(m.userData.op, 0.32); }
  for (const m of pen.byId.body.mats) m.needsUpdate = true;
  resetLevers(pen);
}

function resetLevers(pen) {
  pen.byId.body.obj.traverse((o) => { if (o.userData.lever) o.position.x = 80; });
}

const easeOut = (k) => 1 - Math.pow(1 - k, 3);

// Positions of the current step's parts t seconds after the step started.
export function poseAt(pen, cur, t, { hideBeforeStart = true } = {}) {
  const st = pen.steps[cur];
  for (const p of st.parts) {
    for (const mv of p.movers) {
      const k = Math.min(1, Math.max(0, (t - mv.delay) / 1.2));
      const e = easeOut(k);
      mv.obj.position.copy(mv.final).addScaledVector(mv.from, 1 - e);
      if (mv.spin) mv.obj.rotation.x = mv.rot0 - mv.spin * 2 * Math.PI * (1 - e);
      if (hideBeforeStart) mv.obj.visible = k > 0;
    }
  }
  if (st.check) {
    // press each lever in turn: the lever slides forward and that refill's tip comes out of the nose
    const cyc = 1.2, idx = Math.floor((t % (3 * cyc)) / cyc), ph = (t % cyc) / cyc;
    const push = ph < 0.15 ? ph / 0.15 : ph > 0.85 ? (1 - ph) / 0.15 : 1;
    ['black', 'red', 'blue'].forEach((c, i) => {
      const a = i === idx ? push : 0;
      const f = pen.byId[c].movers[0].final;
      pen.byId[c].obj.position.set(f.x - 13.5 * a, f.y * (1 - a), f.z * (1 - a));   // extended refill moves to the centre
      pen.byId.body.obj.traverse((o) => { if (o.userData.lever === c) o.position.x = 80 - 6 * a; });
    });
  }
}
export function stepDuration(pen, cur) {
  const st = pen.steps[cur];
  if (st.check) return 3.6;
  let d = 0;
  for (const p of st.parts) for (const mv of p.movers) d = Math.max(d, mv.delay + 1.2);
  return d;
}
export const PEN_BOX = new THREE.Box3(new THREE.Vector3(-56, 0, -10), new THREE.Vector3(94, 2 * AXIS_Y, 10));
