// Camera AR assembly guide: the printed QR code that opened this page is also the AR marker.
// Each camera frame goes to a worker (jsQR) that returns the code's four corners; from those
// we compute the camera pose and draw the desk on top of the code.
import * as THREE from './vendor/three.module.min.js';
import { OrbitControls } from './vendor/OrbitControls.js';
import { buildDesk, ACCENT, PRODUCT } from './desk.js';
import { TEXT, STEPS, HW_NAMES, fmt } from './text.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const clock = () => (window.__clock != null ? window.__clock : performance.now());
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const HL = new THREE.Color(ACCENT);
let lang = params.get('lang') === 'en' || (!params.get('lang') && !/^ko/i.test(navigator.language || 'ko')) ? 'en' : 'ko';

// Assumed focal length of a phone's main camera, as a share of the longer image side.
const FOCAL = parseFloat(params.get('focal')) || 0.78;
const FOCAL_LOCKED = !!params.get('focal');
let focalRatio = FOCAL;            // refined from the QR's perspective while tracking
const focalSamples = [];
const SIZES = [0.018, 0.026, 0.04];      // marker units per cm (QR side = 1 unit)
let sizeIdx = 1;

// ---------- three.js ----------
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 200);
scene.add(new THREE.HemisphereLight(0xffffff, 0x5c6470, 1.7));

const marker = new THREE.Group();          // marker space: y up from the paper, x to the QR's right, z toward its bottom edge
marker.matrixAutoUpdate = false;
scene.add(marker);
const sun = new THREE.DirectionalLight(0xffffff, 2.1);
sun.position.set(2.5, 7, 3.5);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 0.5, far: 20 });
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.02;
marker.add(sun, sun.target);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.ShadowMaterial({ opacity: 0.32 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
marker.add(ground);

const holder = new THREE.Group();
holder.scale.setScalar(SIZES[sizeIdx]);
marker.add(holder);
const desk = buildDesk();
holder.add(desk.pivot);
desk.layout.scale.setScalar(0.7);
holder.add(desk.layout);
const steps = desk.steps;

// QR drawn on the floor in the 3D viewer, so the viewer looks like the AR scene
let qrPlane = null;
function makeQrPlane() {
  const url = location.href.split('?')[0].split('#')[0];
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#111';
  // simple stand-in pattern: finder squares + noise (the real code is on paper)
  const fp = (x, y) => { g.fillRect(x, y, 56, 56); g.fillStyle = '#fff'; g.fillRect(x + 8, y + 8, 40, 40); g.fillStyle = '#111'; g.fillRect(x + 16, y + 16, 24, 24); };
  fp(8, 8); fp(192, 8); fp(8, 192);
  let seed = url.length * 97;
  for (let y = 0; y < 23; y++) for (let x = 0; x < 23; x++) {
    if ((x < 8 && y < 8) || (x > 14 && y < 8) || (x < 8 && y > 14)) continue;
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    if (seed % 2) g.fillRect(8 + x * 10.4, 8 + y * 10.4, 10.4, 10.4);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 1.25), new THREE.MeshBasicMaterial({ map: tex }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.002;
  return m;
}

// ---------- steps ----------
let cur = 0;
let stepT0 = 0;
function applyStep() {
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
      m.emissive.setHex(isCur ? ACCENT : 0);
      m.emissiveIntensity = isCur ? 0.25 : 0;
    }
    for (const mv of p.movers) { mv.obj.position.copy(mv.final); if (mv.obj !== p.obj) mv.obj.visible = true; }
  }
  const before = steps.findIndex((s) => s.flip);
  desk.pivot.rotation.z = cur < before ? Math.PI : 0;
  desk.pivot.position.y = PRODUCT.h / 2;
  stepT0 = clock();
}
function animate(now) {
  const t = (now - stepT0) / 1000;
  const st = steps[cur];
  const pulse = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(now / 240);
  for (const p of st.parts) {
    for (const mv of p.movers) {
      const k = reduced ? 1 : Math.min(1, Math.max(0, (t - mv.delay) / 0.9));
      const e = 1 - Math.pow(1 - k, 3);
      mv.obj.position.copy(mv.final).addScaledVector(mv.from, 1 - e);
      mv.obj.visible = k > 0 || reduced;
    }
    for (const m of p.mats) { m.color.lerpColors(m.userData.base, HL, 0.45 + 0.25 * pulse); m.emissiveIntensity = 0.12 + 0.3 * pulse; }
  }
  if (st.flip) {
    const k = reduced ? 1 : Math.min(1, Math.max(0, (t - 0.4) / 1.8));
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    const ang = Math.PI * (1 - e);
    desk.pivot.rotation.z = ang;
    desk.pivot.position.y = PRODUCT.h / 2 + 15 * Math.sin(ang);
  }
}
function goTo(i) {
  cur = Math.max(0, Math.min(steps.length - 1, i));
  applyStep();
  renderStep();
}

// ---------- UI ----------
const T = (k, v) => fmt(TEXT[lang][k], v);
function renderStatic() {
  document.documentElement.lang = lang;
  $('lang').textContent = TEXT[lang].lang;
  $('prev').textContent = T('prev');
  $('replay').setAttribute('aria-label', T('replay'));
  $('size').setAttribute('aria-label', T('size'));
  $('tip-label').textContent = T('tip');
  $('s-product').textContent = T('product');
  $('s-meta').textContent = `${PRODUCT.code} · ${T('productMeta')}`;
  $('s-intro').textContent = T('intro');
  $('s-start').textContent = T('start');
  $('s-viewer').textContent = T('viewer');
  $('s-demo').textContent = T('demo');
  $('msg-close').textContent = T('close');
  updateStatus();
}
function renderStep() {
  const st = steps[cur];
  const tx = STEPS[lang][st.key];
  $('count').textContent = T('stepOf', { i: cur + 1, n: steps.length });
  $('title').textContent = tx.title;
  $('body').textContent = tx.body;
  const prog = $('progress');
  prog.innerHTML = '';
  steps.forEach((_, i) => { const li = document.createElement('li'); li.className = i < cur ? 'done' : i === cur ? 'now' : ''; prog.appendChild(li); });
  const need = $('need');
  need.innerHTML = '';
  for (const n of tx.need) {
    const s = document.createElement('span');
    if (Array.isArray(n)) {
      const b = document.createElement('b'); b.textContent = n[0];
      const em = document.createElement('em'); em.textContent = '×' + n[1];
      s.append(b, document.createTextNode(HW_NAMES[lang][n[0]]), em);
    } else { s.className = 'tool'; s.textContent = HW_NAMES[lang][n]; }
    need.appendChild(s);
  }
  need.hidden = !tx.need.length;
  $('tip').hidden = !tx.tip;
  $('tip-text').textContent = tx.tip;
  $('prev').disabled = cur === 0;
  $('next').textContent = st.final ? T('again') : T('next');
}
$('next').addEventListener('click', () => goTo(steps[cur].final ? 0 : cur + 1));
$('prev').addEventListener('click', () => goTo(cur - 1));
$('replay').addEventListener('click', () => applyStep());
$('size').addEventListener('click', () => { sizeIdx = (sizeIdx + 1) % SIZES.length; holder.scale.setScalar(SIZES[sizeIdx]); if (mode === 'viewer') fitViewer(); });
$('lang').addEventListener('click', () => { lang = lang === 'ko' ? 'en' : 'ko'; renderStatic(); renderStep(); });
$('msg-close').addEventListener('click', () => { $('msg').hidden = true; });
function message(text) { $('msg-text').textContent = text; $('msg').hidden = false; }

// ---------- modes ----------
let mode = 'start';      // 'camera' | 'viewer'
let controls = null;

function enterViewer() {
  mode = 'viewer';
  document.body.classList.add('viewer');
  $('start').hidden = true;
  marker.matrix.identity();
  marker.matrixWorldNeedsUpdate = true;
  marker.visible = true;
  if (!qrPlane) { qrPlane = makeQrPlane(); marker.add(qrPlane); }
  if (!controls) {
    controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI / 2 - 0.05;
  }
  onResize();
  fitViewer();
  updateStatus();
}
function fitViewer() {
  const s = SIZES[sizeIdx];
  const h = PRODUCT.h * s;
  controls.target.set(0, h * 0.4, 0);
  const dist = Math.max(PRODUCT.w * s * 2.2, h * 2.4) * (camera.aspect < 0.8 ? 1.5 : 1);
  camera.position.set(dist * 0.55, h * 0.4 + dist * 0.45, dist * 0.85);
  controls.update();
}

// ---------- camera + tracking ----------
const video = $('cam');
const det = { worker: null, busy: false, cv: document.createElement('canvas'), ctx: null, s: 1, vw: 0, vh: 0, sent: 0 };
det.ctx = det.cv.getContext('2d', { willReadFrequently: true });
const pose = { has: false, last: -1e9, pos: new THREE.Vector3(), quat: new THREE.Quaternion(), tPos: new THREE.Vector3(), tQuat: new THREE.Quaternion(), corners: null };

async function startCamera() {
  if (!window.isSecureContext) { message(T('camInsecure')); enterViewer(); return; }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { message(T('camNone')); enterViewer(); return; }
  const video_c = params.get('nocon') ? { facingMode: { ideal: 'environment' } }
    : { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } };
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: video_c });
    video.srcObject = stream;
    await video.play().catch(() => {});
    mode = 'camera';
    document.body.classList.remove('viewer');
    $('start').hidden = true;
    if (controls) { controls.dispose(); controls = null; }
    if (qrPlane) qrPlane.visible = false;
    if (!det.worker) {
      det.worker = new Worker('./detector.js');
      det.worker.onmessage = onDetect;
    }
    onResize();
    updateStatus();
  } catch (e) {
    const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
    if (denied) { message(T('camDenied')); enterViewer(); }
    else if (e && e.name === 'NotFoundError') { message(T('camNone')); enterViewer(); }
    else { $('start').hidden = false; }
  }
}

function sendFrame() {
  if (det.busy || !det.worker || video.readyState < 2) return;
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return;
  const s = Math.min(1, 640 / Math.max(vw, vh));
  const w = Math.round(vw * s), h = Math.round(vh * s);
  if (det.cv.width !== w || det.cv.height !== h) { det.cv.width = w; det.cv.height = h; }
  det.ctx.drawImage(video, 0, 0, w, h);
  const img = det.ctx.getImageData(0, 0, w, h);
  det.busy = true;
  det.s = s; det.vw = vw; det.vh = vh;
  det.worker.postMessage({ id: ++det.sent, width: w, height: h, buffer: img.data.buffer }, [img.data.buffer]);
}

function onDetect(e) {
  det.busy = false;
  const r = e.data;
  if (!r.found) return;
  if (r.text && !/desk-ar/i.test(r.text) && !params.get('anyqr')) return;   // ignore other QR codes
  const k = 1 / det.s;
  const pts = [r.loc.tl, r.loc.tr, r.loc.br, r.loc.bl].map((p) => [p.x * k, p.y * k]);
  const M = solvePose(pts, det.vw, det.vh);
  if (!M) return;
  refineFocal(pts, det.vw, det.vh, M);
  const sc = new THREE.Vector3();
  M.decompose(pose.tPos, pose.tQuat, sc);
  const now = clock();
  if (!pose.has || now - pose.last > 600) { pose.pos.copy(pose.tPos); pose.quat.copy(pose.tQuat); }
  pose.has = true;
  pose.last = now;
  pose.corners = pts;
  setProjection(det.vw, det.vh);
}

// Homography from marker plane (X, Y) to image (u, v), 4 points, h33 = 1.
function homography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [X, Y] = src[i], [u, v] = dst[i];
    A.push([X, Y, 1, 0, 0, 0, -u * X, -u * Y]); b.push(u);
    A.push([0, 0, 0, X, Y, 1, -v * X, -v * Y]); b.push(v);
  }
  const n = 8;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-12) return null;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const h = b.map((v, i) => v / A[i][i]);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

const MARKER_PTS = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
const FLIP = new THREE.Matrix4().makeScale(1, -1, -1);                 // OpenCV camera -> three.js camera
const PLANE_TO_MODEL = new THREE.Matrix4().makeBasis(
  new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0));

function solvePose(pts, vw, vh) {
  const H = homography(MARKER_PTS, pts);
  if (!H) return null;
  const f = focalRatio * Math.max(vw, vh), cx = vw / 2, cy = vh / 2;
  const n = [
    (H[0] - cx * H[6]) / f, (H[1] - cx * H[7]) / f, (H[2] - cx * H[8]) / f,
    (H[3] - cy * H[6]) / f, (H[4] - cy * H[7]) / f, (H[5] - cy * H[8]) / f,
    H[6], H[7], H[8],
  ];
  const h1 = new THREE.Vector3(n[0], n[3], n[6]);
  const h2 = new THREE.Vector3(n[1], n[4], n[7]);
  const h3 = new THREE.Vector3(n[2], n[5], n[8]);
  let lam = 2 / (h1.length() + h2.length());
  if (h3.z * lam < 0) lam = -lam;
  h1.multiplyScalar(lam); h2.multiplyScalar(lam); h3.multiplyScalar(lam);
  const a = h1.clone().add(h2).normalize(), bb = h1.clone().sub(h2).normalize();
  const r1 = a.clone().add(bb).normalize(), r2 = a.clone().sub(bb).normalize();
  const r3 = r1.clone().cross(r2);
  const Mcv = new THREE.Matrix4().makeBasis(r1, r2, r3).setPosition(h3);
  return FLIP.clone().multiply(Mcv).multiply(PLANE_TO_MODEL);
}

// Focal length from one view of a square (principal point at the image centre):
// the homography's first two columns must be orthogonal and equally long after removing K.
function refineFocal(pts, vw, vh, M) {
  if (FOCAL_LOCKED) return;
  const normalZ = Math.abs(new THREE.Vector3().setFromMatrixColumn(M, 1).z);   // marker 'up' axis in camera space
  if (normalZ > 0.94) return;                                                    // too face-on to say anything
  const H = homography(MARKER_PTS, pts);
  if (!H) return;
  const cx = vw / 2, cy = vh / 2;
  const h1 = [H[0] - cx * H[6], H[3] - cy * H[6], H[6]];
  const h2 = [H[1] - cx * H[7], H[4] - cy * H[7], H[7]];
  const a1 = h1[0] * h2[0] + h1[1] * h2[1], b1 = h1[2] * h2[2];
  const a2 = h1[0] * h1[0] + h1[1] * h1[1] - h2[0] * h2[0] - h2[1] * h2[1], b2 = h1[2] * h1[2] - h2[2] * h2[2];
  const w = -(a1 * b1 + a2 * b2) / (a1 * a1 + a2 * a2);       // w = 1 / f^2
  if (!(w > 0)) return;
  const ratio = 1 / Math.sqrt(w) / Math.max(vw, vh);
  if (ratio < 0.5 || ratio > 1.3) return;
  focalSamples.push(ratio);
  if (focalSamples.length > 40) focalSamples.shift();
  if (focalSamples.length >= 8) {
    const sorted = [...focalSamples].sort((x, y) => x - y);
    focalRatio = sorted[Math.floor(sorted.length / 2)];
  }
}

let projKey = '';
function setProjection(vw, vh) {
  const cw = window.innerWidth, ch = window.innerHeight;
  const key = `${vw}x${vh}@${cw}x${ch}@${focalRatio.toFixed(4)}`;
  if (key === projKey) return;
  projKey = key;
  const s = Math.max(cw / vw, ch / vh);                 // video is shown with object-fit: cover
  const f = focalRatio * Math.max(vw, vh) * s;
  const cxp = (vw / 2) * s + (cw - vw * s) / 2, cyp = (vh / 2) * s + (ch - vh * s) / 2;
  const near = 0.05, far = 200;
  camera.projectionMatrix.set(
    2 * f / cw, 0, 1 - 2 * cxp / cw, 0,
    0, 2 * f / ch, 2 * cyp / ch - 1, 0,
    0, 0, -(far + near) / (far - near), -2 * far * near / (far - near),
    0, 0, -1, 0,
  );
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  camera.position.set(0, 0, 0);
  camera.quaternion.identity();
  camera.updateMatrixWorld(true);
}

function updateStatus() {
  const st = $('status'), g = $('guide');
  if (mode !== 'camera') { st.hidden = true; g.hidden = true; return; }
  const on = pose.has && clock() - pose.last < 700;
  st.hidden = false;
  st.classList.toggle('on', on);
  $('status-text').textContent = on ? T('tracking') : T('searching');
  g.hidden = on;
}

function onResize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (mode === 'viewer') {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  } else {
    projKey = '';
    if (video.videoWidth) setProjection(video.videoWidth, video.videoHeight);
  }
}
window.addEventListener('resize', onResize);

// ---------- loop ----------
let lastOn = null;
renderer.setAnimationLoop(() => {
  const now = clock();
  if (mode === 'camera') {
    sendFrame();
    const on = pose.has && now - pose.last < 700;
    if (on) {
      pose.pos.lerp(pose.tPos, 0.45);
      pose.quat.slerp(pose.tQuat, 0.45);
      marker.matrix.compose(pose.pos, pose.quat, new THREE.Vector3(1, 1, 1));
      marker.matrixWorldNeedsUpdate = true;
    }
    marker.visible = on;
    if (on !== lastOn) { lastOn = on; updateStatus(); }
  } else if (mode === 'viewer' && controls) {
    controls.update();
  }
  animate(now);
  renderer.render(scene, camera);
});

// ---------- start ----------
$('s-start').addEventListener('click', startCamera);
$('s-viewer').addEventListener('click', enterViewer);
renderStatic();
const startStep = parseInt(params.get('step'), 10);
goTo(Number.isFinite(startStep) ? startStep - 1 : 0);
onResize();
if (params.get('mode') === 'viewer') enterViewer();
else if (params.get('autostart') !== '0') startCamera();     // ask for the camera right away; the start screen stays if the browser needs a tap

// hooks for automated checks
window.__ar = {
  goTo, steps, pose, marker, camera, solvePose, setProjection, get focalRatio() { return focalRatio; },
  project(x, y, z) {
    const v = new THREE.Vector3(x, y, z).applyMatrix4(marker.matrixWorld).project(camera);
    return [(v.x + 1) / 2 * window.innerWidth, (1 - v.y) / 2 * window.innerHeight];
  },
  get mode() { return mode; },
};
