// Camera AR assembly guide.
// 1) QR mode: the printed QR code that opened this page is also the AR marker. A worker (jsQR) finds the
//    code's corners in each camera frame; we filter them and compute the camera pose.
// 2) Floor mode (after the QR has been recognised): the phone's own AR tracking places the desk on any floor.
//    Android Chrome: WebXR + hit test, inside this page. iPhone Safari: AR Quick Look with one animated USDZ per step.
import * as THREE from './vendor/three.module.min.js';
import { OrbitControls } from './vendor/OrbitControls.js';
import { buildDesk, applyStepState, poseAt, ACCENT, PRODUCT } from './desk.js';
import { TEXT, STEPS, HW_NAMES, fmt } from './text.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const clock = () => (window.__clock != null ? window.__clock : performance.now());
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const HL = new THREE.Color(ACCENT);
const STABLE = params.get('filter') !== '0';          // stabilisation on (default)
const UPSCALE = parseFloat(params.get('up')) || 3;     // tracked-region magnification for the QR search
const MIN_CUTOFF = parseFloat(params.get('mc')) || 0.4; // One Euro filter: smoothing when still (Hz)
const BETA = parseFloat(params.get('beta')) || 0.01;   // One Euro filter: how fast it follows motion
let lang = params.get('lang') === 'en' || (!params.get('lang') && !/^ko/i.test(navigator.language || 'ko')) ? 'en' : 'ko';

// Assumed focal length of a phone's main camera, as a share of the longer image side; refined while tracking.
const FOCAL_LOCKED = !!params.get('focal');
let focalRatio = parseFloat(params.get('focal')) || 0.78;
const focalSamples = [];
const SIZES = [0.018, 0.026, 0.04];                   // QR mode: marker units per cm (QR side = 1)
let sizeIdx = 1;

// ---------- three.js ----------
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.xr.enabled = true;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 200);
scene.add(new THREE.HemisphereLight(0xffffff, 0x5c6470, 1.7));

const marker = new THREE.Group();      // y up from the paper/floor, x to the QR's right, z toward its bottom edge
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

const reticle = new THREE.Mesh(new THREE.RingGeometry(0.08, 0.11, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: ACCENT }));
reticle.matrixAutoUpdate = false;
reticle.visible = false;
scene.add(reticle);

// stand-in QR on the floor for the 3D viewer (no camera)
let qrPlane = null;
function makeQrPlane() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 256, 256); g.fillStyle = '#111';
  const fp = (x, y) => { g.fillRect(x, y, 56, 56); g.fillStyle = '#fff'; g.fillRect(x + 8, y + 8, 40, 40); g.fillStyle = '#111'; g.fillRect(x + 16, y + 16, 24, 24); };
  fp(8, 8); fp(192, 8); fp(8, 192);
  let seed = 4321;
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
function applyStep() { applyStepState(desk, cur); stepT0 = clock(); }
function animate(now) {
  poseAt(desk, cur, reduced ? 99 : (now - stepT0) / 1000);
  const pulse = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(now / 240);
  for (const p of steps[cur].parts) for (const m of p.mats) { m.color.lerpColors(m.userData.base, HL, 0.45 + 0.25 * pulse); m.emissive.setHex(ACCENT); m.emissiveIntensity = 0.12 + 0.3 * pulse; }
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
  $('floor-text').textContent = T('floor');
  $('xr-move').textContent = T('move');
  $('xr-left').setAttribute('aria-label', T('rotL'));
  $('xr-right').setAttribute('aria-label', T('rotR'));
  $('xr-exit').textContent = T('exit');
  updateXrBar();
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
  syncCardHeight();
}
function syncCardHeight() {
  const c = $('card');
  document.documentElement.style.setProperty('--card-h', (c.getBoundingClientRect().height + 10) + 'px');
}
$('next').addEventListener('click', () => goTo(steps[cur].final ? 0 : cur + 1));
$('prev').addEventListener('click', () => goTo(cur - 1));
$('replay').addEventListener('click', () => applyStep());
$('size').addEventListener('click', () => {
  if (mode === 'xr') return toggleXrScale();
  sizeIdx = (sizeIdx + 1) % SIZES.length; holder.scale.setScalar(SIZES[sizeIdx]);
  if (mode === 'viewer') fitViewer();
});
$('lang').addEventListener('click', () => { lang = lang === 'ko' ? 'en' : 'ko'; renderStatic(); renderStep(); });
$('msg-close').addEventListener('click', () => { $('msg').hidden = true; });
function message(text) { $('msg-text').textContent = text; $('msg').hidden = false; }

// ---------- modes ----------
let mode = 'start';      // 'camera' | 'viewer' | 'xr'
let controls = null;
let everSeen = false;    // the QR code has been recognised at least once
let recognizedAt = 0;

function enterViewer() {
  stopCamera();
  mode = 'viewer';
  document.body.classList.add('viewer');
  $('start').hidden = true;
  marker.matrix.identity();
  marker.matrixWorldNeedsUpdate = true;
  marker.visible = true;
  if (!qrPlane) { qrPlane = makeQrPlane(); marker.add(qrPlane); }
  qrPlane.visible = true;
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

// ---------- camera + QR tracking ----------
const video = $('cam');
let stream = null;
const det = { worker: null, busy: false, cv: document.createElement('canvas'), ctx: null, job: null, sent: 0, misses: 0 };
det.ctx = det.cv.getContext('2d', { willReadFrequently: true });
const pose = { has: false, last: -1e9, pos: new THREE.Vector3(), quat: new THREE.Quaternion(), tPos: new THREE.Vector3(), tQuat: new THREE.Quaternion(), corners: null, quad: null };

async function startCamera() {
  if (!window.isSecureContext) { message(T('camInsecure')); enterViewer(); return; }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { message(T('camNone')); enterViewer(); return; }
  const vc = params.get('nocon') ? { facingMode: { ideal: 'environment' } }
    : { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } };
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: vc });
    video.srcObject = stream;
    await video.play().catch(() => {});
    mode = 'camera';
    document.body.classList.remove('viewer');
    $('start').hidden = true;
    if (controls) { controls.dispose(); controls = null; }
    if (qrPlane) qrPlane.visible = false;
    holder.scale.setScalar(SIZES[sizeIdx]);
    pose.has = false;
    if (!det.worker) { det.worker = new Worker('./detector.js'); det.worker.onmessage = onDetect; }
    onResize();
    updateStatus();
  } catch (e) {
    const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
    if (denied) { message(T('camDenied')); enterViewer(); }
    else if (e && e.name === 'NotFoundError') { message(T('camNone')); enterViewer(); }
    else { $('start').hidden = false; }
  }
}
function stopCamera() {
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  video.srcObject = null;
  det.busy = false;
}

// Send a frame to the worker. While the code is tracked, only a region around it is sent, at full
// resolution: more pixels per QR module gives steadier corners and a faster search.
function sendFrame() {
  if (det.busy || !det.worker || video.readyState < 2) return;
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return;
  let sx = 0, sy = 0, sw = vw, sh = vh;
  if (STABLE && pose.quad && clock() - pose.last < 400 && det.misses < 3) {
    const xs = pose.quad.map((p) => p[0]), ys = pose.quad.map((p) => p[1]);
    const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
    const pad = Math.max(w, h) * 0.55;
    sx = Math.max(0, Math.floor(Math.min(...xs) - pad)); sy = Math.max(0, Math.floor(Math.min(...ys) - pad));
    sw = Math.min(vw, Math.ceil(Math.max(...xs) + pad)) - sx; sh = Math.min(vh, Math.ceil(Math.max(...ys) + pad)) - sy;
  }
  const full = sw === vw && sh === vh;
  // full frame: shrink to 720 px; tracked region: enlarge up to UPSCALE x so corners come out finer than a pixel
  const s = full ? Math.min(1, 720 / Math.max(sw, sh)) : Math.min(UPSCALE, 640 / Math.max(sw, sh));
  const w = Math.max(16, Math.round(sw * s)), h = Math.max(16, Math.round(sh * s));
  if (det.cv.width !== w || det.cv.height !== h) { det.cv.width = w; det.cv.height = h; }
  det.ctx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h);
  const img = det.ctx.getImageData(0, 0, w, h);
  det.busy = true;
  det.job = { sx, sy, s, vw, vh, t: clock() };
  det.worker.postMessage({ id: ++det.sent, width: w, height: h, buffer: img.data.buffer }, [img.data.buffer]);
}

// One Euro filter (Casiez et al. 2012): heavy smoothing when still, little lag when moving.
class OneEuro {
  constructor(minCutoff = 0.9, beta = 0.012, dCutoff = 1.0) { Object.assign(this, { minCutoff, beta, dCutoff }); this.x = null; this.dx = 0; this.t = 0; }
  static alpha(cutoff, dt) { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); }
  reset() { this.x = null; this.dx = 0; }
  filter(x, t) {
    if (this.x === null) { this.x = x; this.t = t; return x; }
    const dt = Math.max(1e-3, (t - this.t) / 1000);
    this.t = t;
    const dx = (x - this.x) / dt;
    this.dx += OneEuro.alpha(this.dCutoff, dt) * (dx - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += OneEuro.alpha(cutoff, dt) * (x - this.x);
    return this.x;
  }
}
const cornerFilters = Array.from({ length: 8 }, () => new OneEuro(MIN_CUTOFF, BETA));

function onDetect(e) {
  det.busy = false;
  const r = e.data, job = det.job;
  if (!job || !r.found || (r.text && !/desk-ar/i.test(r.text) && !params.get('anyqr'))) { det.misses++; return; }
  det.misses = 0;
  const raw = [r.loc.tl, r.loc.tr, r.loc.br, r.loc.bl].map((p) => [job.sx + p.x / job.s, job.sy + p.y / job.s]);
  const now = clock();
  const fresh = !pose.has || now - pose.last > 600;
  if (fresh) cornerFilters.forEach((f) => f.reset());
  const pts = STABLE ? raw.map((p, i) => [cornerFilters[2 * i].filter(p[0], job.t), cornerFilters[2 * i + 1].filter(p[1], job.t)]) : raw;
  pose.quad = raw;
  const M = solvePose(pts, job.vw, job.vh);
  if (!M) return;
  refineFocal(pts, job.vw, job.vh, M);
  M.decompose(pose.tPos, pose.tQuat, new THREE.Vector3());
  if (fresh) { pose.pos.copy(pose.tPos); pose.quat.copy(pose.tQuat); }
  pose.has = true;
  pose.last = now;
  pose.corners = pts;
  if (!everSeen) { everSeen = true; recognizedAt = now; updateStatus(); setTimeout(updateStatus, 4200); }
  setProjection(job.vw, job.vh);
}

// Homography from marker plane (X, Y) to image (u, v), 4 points, h33 = 1.
function homography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [X, Y] = src[i], [u, v] = dst[i];
    A.push([X, Y, 1, 0, 0, 0, -u * X, -u * Y]); b.push(u);
    A.push([0, 0, 0, X, Y, 1, -v * X, -v * Y]); b.push(v);
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-12) return null;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const h = b.map((v, i) => v / A[i][i]);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

const MARKER_PTS = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
const FLIP = new THREE.Matrix4().makeScale(1, -1, -1);                 // OpenCV camera -> three.js camera
const PLANE_TO_MODEL = new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0));

function solvePose(pts, vw, vh) {
  const H = homography(MARKER_PTS, pts);
  if (!H) return null;
  const f = focalRatio * Math.max(vw, vh), cx = vw / 2, cy = vh / 2;
  const n = [
    (H[0] - cx * H[6]) / f, (H[1] - cx * H[7]) / f, (H[2] - cx * H[8]) / f,
    (H[3] - cy * H[6]) / f, (H[4] - cy * H[7]) / f, (H[5] - cy * H[8]) / f,
    H[6], H[7], H[8],
  ];
  const h1 = new THREE.Vector3(n[0], n[3], n[6]), h2 = new THREE.Vector3(n[1], n[4], n[7]), h3 = new THREE.Vector3(n[2], n[5], n[8]);
  let lam = 2 / (h1.length() + h2.length());
  if (h3.z * lam < 0) lam = -lam;
  h1.multiplyScalar(lam); h2.multiplyScalar(lam); h3.multiplyScalar(lam);
  const a = h1.clone().add(h2).normalize(), bb = h1.clone().sub(h2).normalize();
  const r1 = a.clone().add(bb).normalize(), r2 = a.clone().sub(bb).normalize();
  const r3 = r1.clone().cross(r2);
  const Mcv = new THREE.Matrix4().makeBasis(r1, r2, r3).setPosition(h3);
  return FLIP.clone().multiply(Mcv).multiply(PLANE_TO_MODEL);
}

// Focal length from one view of a square (principal point at the image centre).
function refineFocal(pts, vw, vh, M) {
  if (FOCAL_LOCKED) return;
  const normalZ = Math.abs(new THREE.Vector3().setFromMatrixColumn(M, 1).z);
  if (normalZ > 0.94) return;
  const H = homography(MARKER_PTS, pts);
  if (!H) return;
  const cx = vw / 2, cy = vh / 2;
  const h1 = [H[0] - cx * H[6], H[3] - cy * H[6], H[6]];
  const h2 = [H[1] - cx * H[7], H[4] - cy * H[7], H[7]];
  const a1 = h1[0] * h2[0] + h1[1] * h2[1], b1 = h1[2] * h2[2];
  const a2 = h1[0] * h1[0] + h1[1] * h1[1] - h2[0] * h2[0] - h2[1] * h2[1], b2 = h1[2] * h1[2] - h2[2] * h2[2];
  const w = -(a1 * b1 + a2 * b2) / (a1 * a1 + a2 * a2);
  if (!(w > 0)) return;
  const ratio = 1 / Math.sqrt(w) / Math.max(vw, vh);
  if (ratio < 0.5 || ratio > 1.3) return;
  focalSamples.push(ratio);
  if (focalSamples.length > 40) focalSamples.shift();
  if (focalSamples.length >= 8) focalRatio = [...focalSamples].sort((x, y) => x - y)[Math.floor(focalSamples.length / 2)];
}

let projKey = '';
function setProjection(vw, vh) {
  const cw = window.innerWidth, ch = window.innerHeight;
  const key = `${vw}x${vh}@${cw}x${ch}@${focalRatio.toFixed(4)}`;
  if (key === projKey) return;
  projKey = key;
  const s = Math.max(cw / vw, ch / vh);                 // video shown with object-fit: cover
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

// ---------- floor mode ----------
const cap = { xr: false, ql: false };
(async () => {
  try { cap.xr = !!(navigator.xr && await navigator.xr.isSessionSupported('immersive-ar')); } catch (e) { cap.xr = false; }
  const a = document.createElement('a');
  cap.ql = !!(a.relList && a.relList.supports && a.relList.supports('ar'));
  updateStatus();
})();

$('floor').addEventListener('click', () => {
  if (cap.xr) startXR();
  else if (cap.ql) openQuickLook();
  else message(T('noFloor'));
});

// iPhone: AR Quick Look (ARKit) with the step's animated USDZ at real size.
const qlLink = document.createElement('a');
qlLink.setAttribute('rel', 'ar');
qlLink.appendChild(document.createElement('img'));
qlLink.addEventListener('message', (e) => {
  if (e.data === '_apple_ar_quicklook_button_tapped') { goTo(steps[cur].final ? 0 : cur + 1); setTimeout(openQuickLook, 300); }
});
function quickLookHref() {
  const tx = STEPS[lang][steps[cur].key];
  const enc = encodeURIComponent;
  const file = `usdz/desk-step-${String(cur + 1).padStart(2, '0')}.usdz`;
  const title = `${cur + 1}/${steps.length} ${tx.title}`;
  const cta = steps[cur].final ? '' : `&callToAction=${enc(T('qlCta'))}`;
  return `${file}#checkoutTitle=${enc(title)}&checkoutSubtitle=${enc(tx.body)}${cta}`;
}
function openQuickLook() {
  qlLink.setAttribute('href', quickLookHref());
  qlLink.click();
}
document.addEventListener('visibilitychange', () => {
  // coming back from Quick Look: make sure the camera picture is running again
  if (document.visibilityState === 'visible' && mode === 'camera') {
    const live = stream && stream.getVideoTracks().some((t) => t.readyState === 'live');
    if (!live) startCamera(); else video.play().catch(() => {});
  }
});

// Android: WebXR AR with hit test; the step card stays on screen as a DOM overlay.
const xr = { session: null, hit: null, hasHit: false, moving: true, placed: false, small: false };
const XR_SCALE = { real: 0.01, small: 0.0035 };      // metres per cm
async function startXR() {
  try {
    const session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'], optionalFeatures: ['dom-overlay'], domOverlay: { root: $('ui') },
    });
    stopCamera();
    xr.session = session;
    xr.overlay = !!session.domOverlayState;
    renderer.xr.setReferenceSpaceType('local');
    await renderer.xr.setSession(session);
    xr.hit = await session.requestHitTestSource({ space: await session.requestReferenceSpace('viewer') });
    session.addEventListener('select', onXRSelect);
    session.addEventListener('end', onXREnd);
    mode = 'xr';
    Object.assign(xr, { moving: true, placed: false, small: false, hasHit: false });
    holder.scale.setScalar(XR_SCALE.real);
    marker.visible = false;
    document.body.classList.add('xr');
    updateXrBar();
    updateStatus();
  } catch (e) {
    message(T('xrFail', { e: (e && e.message) || String(e) }));
    if (mode !== 'camera') startCamera();
  }
}
function onXRSelect() {
  if (xr.moving && xr.hasHit) {
    const pos = new THREE.Vector3().setFromMatrixPosition(reticle.matrix);
    const cp = new THREE.Vector3().setFromMatrixPosition(renderer.xr.getCamera().matrixWorld);
    const yaw = Math.atan2(cp.x - pos.x, cp.z - pos.z);
    xr.yaw = yaw;
    marker.matrix.compose(pos, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1));
    marker.matrixWorldNeedsUpdate = true;
    marker.visible = true;
    xr.placed = true; xr.moving = false; xr.pos = pos;
    reticle.visible = false;
    applyStep();
    updateXrBar();
  } else if (xr.placed && !xr.overlay) {
    goTo(steps[cur].final ? 0 : cur + 1);     // no on-screen buttons: a tap moves to the next step
  }
}
function rotateXr(d) {
  if (!xr.placed) return;
  xr.yaw += d;
  marker.matrix.compose(xr.pos, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), xr.yaw), new THREE.Vector3(1, 1, 1));
  marker.matrixWorldNeedsUpdate = true;
}
function toggleXrScale() { xr.small = !xr.small; holder.scale.setScalar(xr.small ? XR_SCALE.small : XR_SCALE.real); updateXrBar(); }
function onXREnd() {
  xr.session = null; xr.hit = null;
  reticle.visible = false;
  document.body.classList.remove('xr');
  holder.scale.setScalar(SIZES[sizeIdx]);
  mode = 'camera';
  updateXrBar();
  startCamera();
}
function updateXrBar() {
  $('xrbar').hidden = mode !== 'xr';
  $('xr-hint').textContent = !xr.placed || xr.moving ? T('xrFind') : T('xrPlaced');
  $('xr-scale').textContent = xr.small ? T('real') : T('small');
  $('xr-move').disabled = !xr.placed;
}
$('xr-move').addEventListener('click', () => { xr.moving = true; updateXrBar(); });
$('xr-left').addEventListener('click', () => rotateXr(Math.PI / 12));
$('xr-right').addEventListener('click', () => rotateXr(-Math.PI / 12));
$('xr-scale').addEventListener('click', toggleXrScale);
$('xr-exit').addEventListener('click', () => { if (xr.session) xr.session.end(); });
document.querySelectorAll('[data-noxr]').forEach((n) => n.addEventListener('beforexrselect', (e) => e.preventDefault()));

// ---------- status ----------
function updateStatus() {
  const st = $('status'), g = $('guide'), fl = $('floor');
  if (mode !== 'camera') { st.hidden = true; g.hidden = true; fl.hidden = true; return; }
  const on = pose.has && clock() - pose.last < 700;
  st.hidden = everSeen && clock() - recognizedAt > 4000;   // the 'recognised' note fades after a few seconds
  fl.hidden = !everSeen;
  st.classList.toggle('on', on && !everSeen);
  st.classList.toggle('ready', everSeen);
  $('status-text').textContent = everSeen ? T('recognized') : on ? T('tracking') : T('searching');
  g.hidden = on || everSeen;
}

function onResize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (mode === 'viewer') {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  } else if (mode !== 'xr') {
    projKey = '';
    if (video.videoWidth) setProjection(video.videoWidth, video.videoHeight);
  }
}
window.addEventListener('resize', () => { onResize(); syncCardHeight(); });

// ---------- loop ----------
let lastOn = null;
let lastT = clock();
renderer.setAnimationLoop((time, frame) => {
  const now = clock();
  const dt = Math.min(0.1, Math.max(0, (now - lastT) / 1000));
  lastT = now;
  if (mode === 'camera') {
    sendFrame();
    const on = pose.has && now - pose.last < 700;
    if (on) {
      // time-based smoothing between detections (about 60 ms time constant)
      const k = STABLE ? 1 - Math.exp(-dt / 0.06) : 0.45;
      pose.pos.lerp(pose.tPos, k);
      pose.quat.slerp(pose.tQuat, k);
      marker.matrix.compose(pose.pos, pose.quat, new THREE.Vector3(1, 1, 1));
      marker.matrixWorldNeedsUpdate = true;
    }
    marker.visible = on;
    if (on !== lastOn) { lastOn = on; updateStatus(); }
  } else if (mode === 'viewer' && controls) {
    controls.update();
  } else if (mode === 'xr' && frame && xr.hit) {
    const hits = frame.getHitTestResults(xr.hit);
    if (hits.length) {
      const p = hits[0].getPose(renderer.xr.getReferenceSpace());
      reticle.matrix.fromArray(p.transform.matrix);
      xr.hasHit = true;
      reticle.visible = xr.moving;
    } else { xr.hasHit = false; reticle.visible = false; }
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
else if (params.get('autostart') !== '0') startCamera();

// hooks for automated checks
window.__ar = {
  goTo, steps, pose, marker, camera, cap, quickLookHref,
  project(x, y, z) {
    const v = new THREE.Vector3(x, y, z).applyMatrix4(marker.matrixWorld).project(camera);
    return [(v.x + 1) / 2 * window.innerWidth, (1 - v.y) / 2 * window.innerHeight];
  },
  get mode() { return mode; },
  get focalRatio() { return focalRatio; },
  get everSeen() { return everSeen; },
};
