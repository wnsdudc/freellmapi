// 3-colour pen AR assembly practice.
// Part check tab: the phone learns each part once (on-device), then every step says whether the part held in the box is the right one.
// AR view tab: the printed QR code is the marker for a 3D pen; after the QR is recognised the pen can also go on any floor
// (Android: WebXR in this page, iPhone: AR Quick Look with one animated USDZ per step).
import * as THREE from './vendor/three.module.min.js';
import { OrbitControls } from './vendor/OrbitControls.js';
import { buildPen, applyStepState, poseAt, stepDuration, ACCENT, PRODUCT, PEN_BOX } from './pen.js';
import { TEXT, STEPS, PARTS, REG, REG_ORDER, PART_COLORS, fmt } from './text.js';
import { PartRecognizer, Stabilizer } from './recognizer.js';
import { QRTracker } from './tracker.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const clock = () => (window.__clock != null ? window.__clock : performance.now());
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const HL = new THREE.Color(ACCENT);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
};
let lang = params.get('lang') || store.get('pen:lang') || (/^ko/i.test(navigator.language || 'ko') ? 'ko' : 'en');
if (!TEXT[lang]) lang = 'ko';

// ---------- three.js: main AR scene ----------
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.xr.enabled = true;
renderer.autoClear = false;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 200);
scene.add(new THREE.HemisphereLight(0xffffff, 0x5c6470, 1.8));
const marker = new THREE.Group();
marker.matrixAutoUpdate = false;
scene.add(marker);
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(1.5, 4, 2);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -2, right: 2, top: 2, bottom: -2, near: 0.1, far: 10 });
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.01;
marker.add(sun, sun.target);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.ShadowMaterial({ opacity: 0.32 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
marker.add(ground);
const holder = new THREE.Group();
marker.add(holder);
const pen = buildPen();
holder.add(pen.root, pen.layout);
pen.root.position.x = -19;          // centre the pen (x -56..94) on the marker
pen.layout.position.x = -19;

const QR_SIZES = [1 / 120, 2 / 120, 3 / 120];     // marker units per mm, QR printed 120 mm wide -> 1x is real size
let qrSize = 1;
const XR_SCALE = { big: 0.004, real: 0.001 };     // metres per mm
const VIEW_SCALE = 0.01;

const reticle = new THREE.Mesh(new THREE.RingGeometry(0.08, 0.11, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: ACCENT }));
reticle.matrixAutoUpdate = false;
reticle.visible = false;
scene.add(reticle);

// ---------- mini 3D preview of the current step (corner) ----------
const miniScene = new THREE.Scene();
miniScene.add(new THREE.HemisphereLight(0xffffff, 0x5c6470, 2.0));
const miniSun = new THREE.DirectionalLight(0xffffff, 1.6);
miniSun.position.set(60, 200, 160);
miniScene.add(miniSun);
const miniPen = buildPen();
miniScene.add(miniPen.root, miniPen.layout);
const miniCam = new THREE.PerspectiveCamera(30, 1, 1, 4000);
const MINI = 132;

// ---------- steps ----------
const steps = pen.steps;
let cur = 0;
let stepT0 = 0;
function applyStep() { applyStepState(pen, cur); applyStepState(miniPen, cur); stepT0 = clock(); }
function highlight(p, now) {
  const pulse = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(now / 240);
  for (const part of p.steps[cur].parts) for (const m of part.mats) { m.color.lerpColors(m.userData.base, HL, 0.35 + 0.25 * pulse); m.emissive.setHex(ACCENT); m.emissiveIntensity = 0.1 + 0.25 * pulse; }
}
function animate(now) {
  const t = reduced ? 99 : (now - stepT0) / 1000;
  poseAt(pen, cur, t);
  highlight(pen, now);
  // the corner preview loops the step's action
  const d = stepDuration(pen, cur) + 1.2;
  poseAt(miniPen, cur, reduced ? 99 : (d > 1.2 ? t % d : t));
  highlight(miniPen, now);
}
function goTo(i) {
  cur = Math.max(0, Math.min(steps.length - 1, i));
  applyStep();
  stab.reset();
  verdictState = null;
  renderStep();
}

// ---------- recognition ----------
const rec = new PartRecognizer();
const stab = new Stabilizer();
let modelReady = false;
let modelError = false;
const modelPromise = rec.load().then((b) => { modelReady = true; window.__backend = b; renderReg(); })
  .catch((e) => { modelError = true; console.error(e); renderReg(); });
const restorePromise = rec.restore();
let lastSeen = null;          // latest raw result
let verdictState = null;      // 'ok' | 'bad' | null
let recTimer = 0;
const capture = { label: null, phase: 'idle', until: 0, startAt: 0, n: 0 };

// ---------- audio feedback ----------
let audio = null;
function ensureAudio() {
  if (!audio) { try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { audio = null; } }
  if (audio && audio.state === 'suspended') audio.resume().catch(() => {});
}
function tone(freq, dur, type = 'sine', when = 0, gain = 0.18) {
  if (!audio) return;
  const t0 = audio.currentTime + when;
  const o = audio.createOscillator(), g = audio.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(gain, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g).connect(audio.destination); o.start(t0); o.stop(t0 + dur + 0.02);
}
function soundOk() { tone(880, 0.12); tone(1320, 0.16, 'sine', 0.11); }
function soundBad() { tone(196, 0.16, 'square', 0, 0.12); tone(164, 0.22, 'square', 0.18, 0.12); if (navigator.vibrate) navigator.vibrate([140, 80, 140]); }
document.addEventListener('pointerdown', ensureAudio, { passive: true });

// ---------- UI text ----------
const T = (k, v) => fmt(TEXT[lang][k], v);
const P = (id) => PARTS[lang][id] || { name: id, subj: id };
function renderStatic() {
  document.documentElement.lang = lang;
  document.title = lang === 'ko' ? '3색 볼펜 AR 조립' : '3-colour pen AR assembly';
  $('lang').textContent = TEXT[lang].other;
  $('tab-parts').textContent = T('tabParts');
  $('tab-ar').textContent = T('tabAr');
  $('prev').textContent = T('prev');
  $('replay').setAttribute('aria-label', T('replay'));
  $('size').setAttribute('aria-label', T('size'));
  $('tip-label').textContent = T('tip');
  $('expect-label').textContent = T('expectLabel');
  $('s-eyebrow').textContent = T('eyebrow');
  $('s-product').textContent = T('product');
  $('s-meta').textContent = T('productMeta');
  $('s-intro').textContent = T('intro');
  $('s-pick').textContent = T('pickLang');
  $('s-ko').setAttribute('aria-pressed', String(lang === 'ko'));
  $('s-en').setAttribute('aria-pressed', String(lang === 'en'));
  $('s-start').textContent = T('start');
  $('s-viewer').textContent = T('viewer');
  $('s-demo').textContent = T('demo');
  $('msg-close').textContent = T('close');
  $('floor-text').textContent = T('floor');
  $('xr-move').textContent = T('move');
  $('xr-left').setAttribute('aria-label', T('rotL'));
  $('xr-right').setAttribute('aria-label', T('rotR'));
  $('xr-exit').textContent = T('exit');
  $('box-label').textContent = T('holdHere');
  $('loading').textContent = T('loading');
  $('reg-title').textContent = T('regTitle');
  $('reg-reset').textContent = T('regReset');
  $('reg-skip').textContent = T('regSkip');
  updateXrBar();
  renderReg();
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
  $('expect').hidden = !st.expect;
  if (st.expect) { $('expect-name').textContent = P(st.expect).name; $('expect-swatch').style.background = PART_COLORS[st.expect]; }
  $('tip').hidden = !tx.tip;
  $('tip-text').textContent = tx.tip;
  $('prev').disabled = cur === 0;
  $('next').textContent = st.final ? T('again') : T('next');
  renderVerdict();
  requestAnimationFrame(layoutOverlay);
}
function setLang(l) { lang = l; store.set('pen:lang', l); renderStatic(); renderStep(); }
$('lang').addEventListener('click', () => setLang(lang === 'ko' ? 'en' : 'ko'));
$('s-ko').addEventListener('click', () => setLang('ko'));
$('s-en').addEventListener('click', () => setLang('en'));
$('next').addEventListener('click', () => goTo(steps[cur].final ? 0 : cur + 1));
$('prev').addEventListener('click', () => goTo(cur - 1));
$('replay').addEventListener('click', () => applyStep());
$('size').addEventListener('click', () => {
  if (view === 'xr') return toggleXrScale();
  if (view === 'viewer') return;
  qrSize = (qrSize + 1) % QR_SIZES.length;
  holder.scale.setScalar(QR_SIZES[qrSize]);
});
$('msg-close').addEventListener('click', () => { $('msg').hidden = true; });
function message(text) { $('msg-text').textContent = text; $('msg').hidden = false; }

// ---------- views ----------
let view = 'start';      // 'start' | 'camera' | 'viewer' | 'xr'
let tab = params.get('tab') === 'ar' ? 'ar' : 'parts';
let registering = false;
let controls = null;

function setTab(t) {
  tab = t;
  $('tab-parts').setAttribute('aria-pressed', String(t === 'parts'));
  $('tab-ar').setAttribute('aria-pressed', String(t === 'ar'));
  if (t === 'ar') { tracker.start(); holder.scale.setScalar(QR_SIZES[qrSize]); }
  stab.reset(); verdictState = null;
  updateOverlayVisibility();
  renderVerdict();
}
$('tab-parts').addEventListener('click', () => setTab('parts'));
$('tab-ar').addEventListener('click', () => setTab('ar'));

function updateOverlayVisibility() {
  const cam = view === 'camera';
  const partsOn = cam && tab === 'parts';
  $('box').hidden = !partsOn;
  $('seeing').hidden = !partsOn || !modelReady || !rec.samples.length;
  $('reg').hidden = !(partsOn && registering);
  $('card').hidden = partsOn && registering;
  $('mini-bg').hidden = !(partsOn && !registering);
  document.querySelector('.tabs').hidden = !cam;
  $('loading').hidden = !(partsOn && !modelReady && !modelError);
  if (!(cam && tab === 'ar')) { $('status').hidden = true; $('floor').hidden = true; }
  updateStatus();
  layoutOverlay();
}

function enterViewer() {
  stopCamera();
  view = 'viewer';
  document.body.classList.add('viewer');
  $('start').hidden = true;
  marker.matrix.identity();
  marker.matrixWorldNeedsUpdate = true;
  marker.visible = true;
  holder.scale.setScalar(VIEW_SCALE);
  if (!controls) { controls = new OrbitControls(camera, canvas); controls.enableDamping = true; controls.maxPolarAngle = Math.PI / 2 - 0.05; }
  onResize();
  const c = PEN_BOX.getCenter(new THREE.Vector3()).multiplyScalar(VIEW_SCALE);
  c.x -= 19 * VIEW_SCALE;
  controls.target.copy(c);
  const portrait = innerWidth < innerHeight;
  camera.position.set(c.x + 0.5, c.y + (portrait ? 1.7 : 1.0), c.z + (portrait ? 2.6 : 1.6));
  controls.update();
  updateOverlayVisibility();
}

// ---------- camera ----------
const video = $('cam');
let stream = null;
const tracker = new QRTracker({ video, camera, clock, focal: parseFloat(params.get('focal')) || null });
tracker.onFirstSeen = () => { recognizedAt = clock(); updateStatus(); setTimeout(updateStatus, 4200); };
let recognizedAt = 0;

async function startCamera() {
  ensureAudio();
  if (!window.isSecureContext) { message(T('camInsecure')); enterViewer(); return; }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { message(T('camNone')); enterViewer(); return; }
  const vc = params.get('nocon') ? { facingMode: { ideal: 'environment' } }
    : { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } };
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: vc });
    video.srcObject = stream;
    await video.play().catch(() => {});
    view = 'camera';
    document.body.classList.remove('viewer');
    $('start').hidden = true;
    if (controls) { controls.dispose(); controls = null; }
    holder.scale.setScalar(QR_SIZES[qrSize]);
    tracker.resetProjection();
    await restorePromise;
    registering = !REG_ORDER.every((l) => rec.count(l) >= 10) && params.get('skipreg') !== '1';
    if (registering) regIdx = Math.max(0, REG_ORDER.findIndex((l) => rec.count(l) < 10));
    setTab(tab);
    renderReg();
    onResize();
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
}
$('s-start').addEventListener('click', startCamera);
$('s-viewer').addEventListener('click', enterViewer);

// ---------- the check box: where it is on screen and in the video ----------
const boxCss = { x: 0, y: 0, s: 0 };
function layoutOverlay() {
  const W = innerWidth, H = innerHeight;
  const top = document.querySelector('.bar').getBoundingClientRect().bottom + 30;
  const sheet = registering ? $('reg') : $('card');
  const bottom = (sheet.hidden ? H : sheet.getBoundingClientRect().top) - 64;
  const s = Math.max(120, Math.min(W * 0.74, bottom - top, 420));
  boxCss.s = s; boxCss.x = (W - s) / 2; boxCss.y = top + Math.max(0, (bottom - top - s) / 2);
  Object.assign($('box').style, { left: boxCss.x + 'px', top: boxCss.y + 'px', width: s + 'px', height: s + 'px' });
  $('seeing').style.top = (boxCss.y + s + 10) + 'px';
  $('verdict').style.top = (boxCss.y + s - 70) + 'px';
  // corner preview sits just above the card, on the right
  const cardTop = $('card').hidden ? H - 20 : $('card').getBoundingClientRect().top;
  const mb = $('mini-bg');
  mb.style.left = (W - MINI - 12) + 'px';
  mb.style.top = (cardTop - MINI - 10) + 'px';
  miniRect.x = W - MINI - 12; miniRect.y = H - (cardTop - 10);   // GL viewport origin is bottom-left
  // AR status / floor button above the card
  $('status').style.bottom = (H - cardTop + 76) + 'px';
  $('floor').style.bottom = (H - cardTop + 14) + 'px';
}
const miniRect = { x: 0, y: 0 };
function boxInVideo() {
  const vw = video.videoWidth, vh = video.videoHeight;
  const s = Math.max(innerWidth / vw, innerHeight / vh);
  const ox = (innerWidth - vw * s) / 2, oy = (innerHeight - vh * s) / 2;
  const size = boxCss.s / s;
  return { sx: Math.max(0, (boxCss.x - ox) / s), sy: Math.max(0, (boxCss.y - oy) / s), size: Math.min(size, vw, vh) };
}

function recognitionTick(now) {
  if (!(view === 'camera' && tab === 'parts') || !modelReady || video.readyState < 2) return;
  if (now - recTimer < 110) return;
  recTimer = now;
  const b = boxInVideo();
  const v = rec.features(video, b.sx, b.sy, b.size);
  if (capture.phase === 'rec') {
    rec.add(capture.label, v);
    capture.n++;
    $('reg-meter').style.width = Math.min(100, ((now - capture.startAt) / 6000) * 100) + '%';
    $('reg-help').textContent = T('regRecording', { n: capture.n });
    if (now >= capture.until) finishCapture();
    return;
  }
  if (!rec.samples.length) return;
  lastSeen = rec.classify(v);
  const stable = stab.push(lastSeen);
  const st = steps[cur];
  const seeing = $('seeing');
  seeing.hidden = false;
  seeing.textContent = lastSeen.label === 'none' ? P('none').name : T('seeing', { p: P(lastSeen.label).name, c: Math.round(lastSeen.conf * 100) });
  if (registering || !st.expect) { setVerdict(null); return; }
  if (!stable || stable === 'none') setVerdict(null);
  else if (stable === st.expect) setVerdict('ok');
  else {
    const sure = stab.strict();                       // the alarm needs a steadier, more confident result
    if (sure && sure !== 'none' && sure !== st.expect) setVerdict('bad', sure);
    else if (verdictState !== 'bad') setVerdict(null);
  }
}
let wrongLabel = null;
function setVerdict(state, label = null) {
  if (state === verdictState && label === wrongLabel) return;
  const before = verdictState, beforeLabel = wrongLabel;
  verdictState = state; wrongLabel = label;
  renderVerdict();
  if (state === 'ok' && before !== 'ok') soundOk();
  if (state === 'bad' && (before !== 'bad' || label !== beforeLabel)) soundBad();
}
function renderVerdict() {
  const box = $('box'), v = $('verdict');
  box.classList.toggle('ok', verdictState === 'ok');
  box.classList.toggle('bad', verdictState === 'bad');
  const show = view === 'camera' && tab === 'parts' && !registering && verdictState;
  v.hidden = !show;
  if (!show) return;
  const st = steps[cur];
  v.className = 'verdict ' + verdictState;
  $('v-ok').style.display = verdictState === 'ok' ? '' : 'none';
  $('v-bad').style.display = verdictState === 'bad' ? '' : 'none';
  if (verdictState === 'ok') { $('v-head').textContent = T('correct'); $('v-detail').textContent = P(st.expect).name; }
  else { $('v-head').textContent = T('wrongShort'); $('v-detail').textContent = T('wrong', { p: P(wrongLabel).name, e: P(st.expect).subj }); }
}

// ---------- registration ----------
let regIdx = 0;
function renderReg() {
  if (!$('reg')) return;
  const list = $('reg-list');
  list.innerHTML = '';
  REG_ORDER.forEach((l, i) => {
    const li = document.createElement('li');
    const n = rec.count(l);
    li.className = (i === regIdx && regIdx < REG_ORDER.length ? 'now ' : '') + (n >= 10 ? 'done' : '');
    const sw = document.createElement('i'); sw.className = 'swatch'; sw.style.background = PART_COLORS[l];
    li.append(sw, document.createTextNode(P(l).name));
    list.appendChild(li);
  });
  const doneAll = regIdx >= REG_ORDER.length;
  const label = REG_ORDER[Math.min(regIdx, REG_ORDER.length - 1)];
  $('reg-now').textContent = doneAll ? T('regTest') : `${regIdx + 1}/${REG_ORDER.length} · ${P(label).name}`;
  if (capture.phase === 'idle') $('reg-help').textContent = doneAll ? '' : (modelError ? T('modelFail') : !modelReady ? T('loading') : (regIdx === 0 && !rec.samples.length ? T('regIntro') + ' ' : '') + REG[lang][label]);
  const startBtn = $('reg-start'), nextBtn = $('reg-next');
  if (doneAll) {
    startBtn.textContent = T('regDone');
    startBtn.disabled = false;
    nextBtn.hidden = true;
  } else {
    startBtn.textContent = rec.count(label) ? T('regAgain') : T('regStart');
    startBtn.disabled = !modelReady || capture.phase !== 'idle';
    nextBtn.hidden = false;
    nextBtn.textContent = T('regNext');
    nextBtn.disabled = rec.count(label) < 10 || capture.phase !== 'idle';
  }
  if (capture.phase === 'idle') $('reg-meter').style.width = doneAll ? '100%' : Math.min(100, (rec.count(label) / 45) * 100) + '%';
}
$('reg-start').addEventListener('click', () => {
  ensureAudio();
  if (regIdx >= REG_ORDER.length) { registering = false; rec.save().catch(() => {}); goTo(0); updateOverlayVisibility(); return; }
  const label = REG_ORDER[regIdx];
  rec.clear(label);
  capture.label = label; capture.phase = 'count'; capture.n = 0;
  let s = 3;
  const countdown = () => {
    if (capture.phase !== 'count') return;
    if (s > 0) { $('reg-help').textContent = T('regCountdown', { s }); tone(660, 0.08); s--; setTimeout(countdown, 1000); return; }
    tone(990, 0.12);
    capture.phase = 'rec'; capture.startAt = clock(); capture.until = capture.startAt + 6000;
  };
  renderReg();
  countdown();
});
function finishCapture() {
  capture.phase = 'idle';
  tone(1320, 0.15);
  rec.save().catch(() => {});
  if (rec.count(capture.label) >= 10 && regIdx < REG_ORDER.length) regIdx++;
  renderReg();
}
$('reg-next').addEventListener('click', () => { if (regIdx < REG_ORDER.length) regIdx++; renderReg(); });
$('reg-reset').addEventListener('click', async () => { await rec.wipe(); regIdx = 0; capture.phase = 'idle'; renderReg(); });
$('reg-skip').addEventListener('click', () => { registering = false; goTo(0); updateOverlayVisibility(); });

// ---------- AR view: status + floor ----------
function updateStatus() {
  const st = $('status'), fl = $('floor');
  if (!(view === 'camera' && tab === 'ar')) { st.hidden = true; fl.hidden = true; return; }
  const on = tracker.pose.has && clock() - tracker.pose.last < 700;
  st.hidden = tracker.everSeen && clock() - recognizedAt > 4000;
  st.classList.toggle('on', on || tracker.everSeen);
  $('status-text').textContent = tracker.everSeen ? T('recognized') : on ? T('tracking') : T('searching');
  fl.hidden = !tracker.everSeen;
}
const cap = { xr: false, ql: false };
(async () => {
  try { cap.xr = !!(navigator.xr && await navigator.xr.isSessionSupported('immersive-ar')); } catch (e) { cap.xr = false; }
  const a = document.createElement('a');
  cap.ql = !!(a.relList && a.relList.supports && a.relList.supports('ar'));
})();
$('floor').addEventListener('click', () => {
  if (cap.xr) startXR();
  else if (cap.ql) openQuickLook();
  else message(T('noFloor'));
});
const qlLink = document.createElement('a');
qlLink.setAttribute('rel', 'ar');
qlLink.appendChild(document.createElement('img'));
qlLink.addEventListener('message', (e) => {
  if (e.data === '_apple_ar_quicklook_button_tapped') { goTo(steps[cur].final ? 0 : cur + 1); setTimeout(openQuickLook, 300); }
});
function quickLookHref() {
  const tx = STEPS[lang][steps[cur].key];
  const enc = encodeURIComponent;
  const cta = steps[cur].final ? '' : `&callToAction=${enc(T('qlCta'))}`;
  return `usdz/pen-step-${String(cur + 1).padStart(2, '0')}.usdz#checkoutTitle=${enc(`${cur + 1}/${steps.length} ${tx.title}`)}&checkoutSubtitle=${enc(tx.body)}${cta}`;
}
function openQuickLook() { qlLink.setAttribute('href', quickLookHref()); qlLink.click(); }
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && view === 'camera') {
    const live = stream && stream.getVideoTracks().some((t) => t.readyState === 'live');
    if (!live) startCamera(); else video.play().catch(() => {});
  }
});

const xr = { session: null, hit: null, hasHit: false, moving: true, placed: false, big: true, yaw: 0, pos: null };
async function startXR() {
  try {
    const session = await navigator.xr.requestSession('immersive-ar', { requiredFeatures: ['hit-test'], optionalFeatures: ['dom-overlay'], domOverlay: { root: $('ui') } });
    stopCamera();
    xr.session = session;
    xr.overlay = !!session.domOverlayState;
    renderer.xr.setReferenceSpaceType('local');
    await renderer.xr.setSession(session);
    xr.hit = await session.requestHitTestSource({ space: await session.requestReferenceSpace('viewer') });
    session.addEventListener('select', onXRSelect);
    session.addEventListener('end', onXREnd);
    view = 'xr';
    Object.assign(xr, { moving: true, placed: false, big: true, hasHit: false });
    holder.scale.setScalar(XR_SCALE.big);
    marker.visible = false;
    document.body.classList.add('xr');
    $('box').hidden = true; $('verdict').hidden = true; $('seeing').hidden = true; $('mini-bg').hidden = true;
    $('status').hidden = true; $('floor').hidden = true; document.querySelector('.tabs').hidden = true;
    updateXrBar();
  } catch (e) {
    message(T('xrFail', { e: (e && e.message) || String(e) }));
    if (view !== 'camera') startCamera();
  }
}
function onXRSelect() {
  if (xr.moving && xr.hasHit) {
    const pos = new THREE.Vector3().setFromMatrixPosition(reticle.matrix);
    const cp = new THREE.Vector3().setFromMatrixPosition(renderer.xr.getCamera().matrixWorld);
    xr.yaw = Math.atan2(cp.x - pos.x, cp.z - pos.z);
    xr.pos = pos;
    placeXr();
    marker.visible = true;
    xr.placed = true; xr.moving = false;
    reticle.visible = false;
    applyStep();
    updateXrBar();
  } else if (xr.placed && !xr.overlay) goTo(steps[cur].final ? 0 : cur + 1);
}
function placeXr() {
  marker.matrix.compose(xr.pos, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), xr.yaw), new THREE.Vector3(1, 1, 1));
  marker.matrixWorldNeedsUpdate = true;
}
function toggleXrScale() { xr.big = !xr.big; holder.scale.setScalar(xr.big ? XR_SCALE.big : XR_SCALE.real); updateXrBar(); }
function onXREnd() {
  xr.session = null; xr.hit = null;
  reticle.visible = false;
  document.body.classList.remove('xr');
  view = 'camera';
  updateXrBar();
  startCamera();
}
function updateXrBar() {
  $('xrbar').hidden = view !== 'xr';
  $('xr-hint').textContent = !xr.placed || xr.moving ? T('xrFind') : T('xrPlaced');
  $('xr-scale').textContent = xr.big ? T('real') : T('big');
  $('xr-move').disabled = !xr.placed;
}
$('xr-move').addEventListener('click', () => { xr.moving = true; updateXrBar(); });
$('xr-left').addEventListener('click', () => { if (xr.placed) { xr.yaw += Math.PI / 12; placeXr(); } });
$('xr-right').addEventListener('click', () => { if (xr.placed) { xr.yaw -= Math.PI / 12; placeXr(); } });
$('xr-scale').addEventListener('click', toggleXrScale);
$('xr-exit').addEventListener('click', () => { if (xr.session) xr.session.end(); });
document.querySelectorAll('[data-noxr]').forEach((n) => n.addEventListener('beforexrselect', (e) => e.preventDefault()));

// ---------- resize ----------
function onResize() {
  renderer.setSize(innerWidth, innerHeight);
  if (view === 'viewer') { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
  else if (view === 'camera') { tracker.resetProjection(); if (video.videoWidth) tracker.setProjection(video.videoWidth, video.videoHeight, true); }
  layoutOverlay();
}
addEventListener('resize', onResize);

// ---------- loop ----------
let lastT = clock();
let lastOn = null;
const tmpM = new THREE.Matrix4();
renderer.setAnimationLoop((time, frame) => {
  const now = clock();
  const dt = Math.min(0.1, Math.max(0, (now - lastT) / 1000));
  lastT = now;
  if (view === 'camera') {
    if (tab === 'ar') {
      const on = tracker.update(dt);
      if (on) { tracker.matrix(marker.matrix); marker.matrixWorldNeedsUpdate = true; }
      marker.visible = on;
      if (on !== lastOn) { lastOn = on; updateStatus(); }
    } else {
      marker.visible = false;
      recognitionTick(now);
    }
  } else if (view === 'viewer' && controls) controls.update();
  else if (view === 'xr' && frame && xr.hit) {
    const hits = frame.getHitTestResults(xr.hit);
    if (hits.length) { reticle.matrix.fromArray(hits[0].getPose(renderer.xr.getReferenceSpace()).transform.matrix); xr.hasHit = true; reticle.visible = xr.moving; }
    else { xr.hasHit = false; reticle.visible = false; }
  }
  animate(now);
  renderer.setViewport(0, 0, innerWidth, innerHeight);
  renderer.clear();
  renderer.render(scene, camera);
  // corner preview (part check tab only)
  if (view === 'camera' && tab === 'parts' && !registering && !renderer.xr.isPresenting) {
    const st = steps[cur];
    const c = st.layout ? new THREE.Vector3(15, 0, -13) : new THREE.Vector3(18, 6, 0);
    miniCam.position.set(c.x + 30, c.y + (st.layout ? 250 : 130), c.z + (st.layout ? 170 : 270));
    miniCam.lookAt(c);
    renderer.setScissorTest(true);
    renderer.setScissor(miniRect.x, miniRect.y, MINI, MINI);
    renderer.setViewport(miniRect.x, miniRect.y, MINI, MINI);
    renderer.clearDepth();
    renderer.render(miniScene, miniCam);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, innerWidth, innerHeight);
  }
});

// ---------- start ----------
renderStatic();
const startStep = parseInt(params.get('step'), 10);
goTo(Number.isFinite(startStep) ? startStep - 1 : 0);
holder.scale.setScalar(QR_SIZES[qrSize]);
onResize();
if (params.get('mode') === 'viewer') enterViewer();
else if (params.get('autostart') === '1') startCamera();

// hooks for automated checks
window.__pen = {
  rec, goTo, steps, tracker, setTab, quickLookHref, modelPromise, restorePromise, renderReg,
  get state() { return { view, tab, registering, cur, regIdx, verdict: verdictState, wrong: wrongLabel, seen: lastSeen && { label: lastSeen.label, conf: +lastSeen.conf.toFixed(2) }, modelReady, samples: rec.samples.length }; },
  featuresOf(img) { return rec.features(img, 0, 0, Math.min(img.naturalWidth || img.width, img.naturalHeight || img.height)); },
  boxInVideo,
};
