// Pen assembly: name the parts on the paper, then check each part the user picks up.
import { analyze, surfaceShareInBox } from './vision.js';
import { TEXT, PARTS, ACTIONS, COLORS, fmt } from './text.js';

const ORDER = ['body', 'black', 'red', 'blue', 'grip'];
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const now = () => performance.now();
let lang = params.get('lang') || (() => { try { return localStorage.getItem('pick:lang'); } catch (e) { return null; } })() || (/^ko/i.test(navigator.language || 'ko') ? 'ko' : 'en');
if (!TEXT[lang]) lang = 'ko';
const T = (k, v) => fmt(TEXT[lang][k], v);
const N = (id) => PARTS[lang][id].name;
const O = (id) => PARTS[lang][id].obj;

// ---------- state ----------
let phase = 'start';          // start | setup | pick | done
let step = 0;
let wrongPart = null;         // part picked by mistake, until it is put back
let toast = null;             // { kind: 'ok' | 'back', text, until }
let lastRes = null;
let setupReadySince = 0;
// surface colour, updated slowly and only by colours close to it, so a hand in the picture cannot hijack it
let bgColor = null;
function trackBackground(m) {
  if (!bgColor) { bgColor = m.slice(); return; }
  const dist = Math.abs(m[0] - bgColor[0]) + Math.abs(m[1] - bgColor[1]) + Math.abs(m[2] - bgColor[2]);
  if (dist < 36) for (let i = 0; i < 3; i++) bgColor[i] += (m[i] - bgColor[i]) * 0.08;
  else if (++bgOff > 40) { bgColor = m.slice(); bgOff = 0; }      // scene really changed (new place / lighting)
  if (dist < 36) bgOff = 0;
}
let bgOff = 0;
const track = {};             // per part: presence history, on-table flag, last box
for (const id of ORDER) track[id] = { hist: [], on: false, box: null };

// ---------- camera ----------
const video = $('cam');
const work = document.createElement('canvas');
const wctx = work.getContext('2d', { willReadFrequently: true });
async function startCamera() {
  ensureAudio();
  try {
    const vc = params.get('nocon') ? { facingMode: { ideal: 'environment' } } : { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } };
    video.srcObject = await navigator.mediaDevices.getUserMedia({ audio: false, video: vc });
    await video.play().catch(() => {});
    $('start').hidden = true; $('top').hidden = false; $('bottom').hidden = false;
    reset();
  } catch (e) {
    $('s-err').textContent = T('camErr');
    $('s-err').hidden = false;
  }
}
function reset() {
  phase = 'setup'; step = 0; wrongPart = null; toast = null; setupReadySince = 0; bgColor = null;
  for (const id of ORDER) Object.assign(track[id], { hist: [], on: false, box: null });
  render();
}

// ---------- analysis loop (about 10 times a second) ----------
let lastRun = 0;
function loop() {
  requestAnimationFrame(loop);
  const t = now();
  if (phase !== 'start' && video.readyState >= 2 && t - lastRun > 95) {
    lastRun = t;
    const vw = video.videoWidth, vh = video.videoHeight;
    const s = Math.min(1, 640 / Math.max(vw, vh));
    const w = Math.round(vw * s), h = Math.round(vh * s);
    if (work.width !== w || work.height !== h) { work.width = w; work.height = h; }
    wctx.drawImage(video, 0, 0, w, h);
    lastRes = analyze(wctx.getImageData(0, 0, w, h), w, h, bgColor);
    trackBackground(lastRes.median);
    lastRes.scale = s;
    update(lastRes, t);
  }
  draw(t);
}

// A part keeps its name by staying where it was: each known part first claims the blob at its last position
// (similar length, same thin/thick type). Only parts that are not found there take a blob by its colour/size name.
// This stops a half-covered part from passing its name to a neighbour while a hand is over it.
const isThin = (b) => b.L / b.W >= 8.5;
function update(res, t) {
  const seen = {};
  const used = new Set();
  const blobs = res.parts.filter((b) => b.label || b.L / b.W >= 1.6);
  for (const id of ORDER) {
    const tr = track[id];
    if (!tr.box || !tr.on) continue;
    let best = null, bd = Infinity;
    for (const b of blobs) {
      if (used.has(b) || isThin(b) !== isThin(tr.box)) continue;
      const r = b.L / tr.box.L;
      if (r < 0.72 || r > 1.35) continue;
      const dist = Math.hypot(b.cx - tr.box.cx, b.cy - tr.box.cy);
      if (dist < Math.max(14, tr.box.L * 0.35) && dist < bd) { bd = dist; best = b; }
    }
    if (best) { seen[id] = best; used.add(best); }
  }
  for (const id of ORDER) {
    if (seen[id]) continue;
    const b = blobs.find((x) => !used.has(x) && x.label === id);
    if (b) { seen[id] = b; used.add(b); }
  }
  for (const id of ORDER) {
    const tr = track[id];
    tr.hist.push(!!seen[id]);
    if (tr.hist.length > 6) tr.hist.shift();
    if (seen[id]) tr.box = seen[id];
    tr.last = seen[id] || null;
    const recent = tr.hist.slice(-5).filter(Boolean).length;
    const absent = tr.hist.length >= 4 && tr.hist.slice(-4).every((x) => !x);
    if (!tr.on && recent >= 3) { tr.on = true; onPlaced(id); }
    else if (tr.on && absent && res.surface) {
      // gone: picked up only if the bare surface shows where it lay (otherwise a hand is just covering it)
      if (!tr.box || surfaceShareInBox(res, tr.box) > 0.72) { tr.on = false; onPicked(id); }
    }
  }
  if (phase === 'setup') {
    const all = ORDER.every((id) => track[id].on);
    if (all) { if (!setupReadySince) setupReadySince = t; if (t - setupReadySince > 700) { phase = 'pick'; step = 0; } }
    else setupReadySince = 0;
  }
  render();
}

function onPlaced(id) {
  if (phase === 'pick' && wrongPart === id) {
    wrongPart = null;
    toast = { kind: 'back', text: T('back', { want: O(ORDER[step]) }), until: now() + 2200 };
    log('placed back', id);
  }
}
function onPicked(id) {
  if (phase !== 'pick') return;
  const want = ORDER[step];
  if (id === want) {
    log('picked right', id);
    wrongPart = null;
    toast = { kind: 'ok', text: T('ok', { name: N(id) }), until: now() + 1600 };
    flash('ok'); soundOk();
    step++;
    if (step >= ORDER.length) phase = 'done';
  } else {
    log('picked wrong', id, 'wanted', want);
    wrongPart = id;
    toast = null;
    flash('bad'); soundBad();
  }
}
const events = [];
function log(...a) { events.push({ t: Math.round(now()), e: a.join(' ') }); }

// ---------- UI ----------
function render() {
  if (phase === 'start') return;
  const banner = $('banner');
  let cls = '', head = '', sub = '', num = '';
  if (phase === 'setup') {
    const n = ORDER.filter((id) => track[id].on).length;
    head = lastRes && !lastRes.surface ? T('noSurface') : T('setup');
    sub = T('found', { n }) + (n ? ' · ' + ORDER.filter((id) => track[id].on).map(N).join(', ') : '');
    num = `${n}/5`;
    $('go').hidden = n < 3;
  } else if (phase === 'done') {
    cls = 'ok'; head = T('done'); sub = T('doneHint'); num = '✓';
    $('go').hidden = true;
  } else {
    $('go').hidden = true;
    const want = ORDER[step];
    num = String(step + 1);
    if (wrongPart) { cls = 'bad'; head = T('wrong', { got: O(wrongPart) }); sub = T('wrongHint', { want: O(want) }); num = '!'; }
    else if (toast && toast.until > now()) { cls = toast.kind === 'ok' ? 'ok' : ''; head = toast.kind === 'ok' ? toast.text : T('pick', { name: O(want) }); sub = toast.kind === 'ok' ? T('pick', { name: O(want) }) : toast.text; }
    else { head = T('pick', { name: O(want) }); sub = T('then', { action: ACTIONS[lang][want] }); }
  }
  banner.className = 'banner ' + cls;
  syncFlash();
  $('head').textContent = head;
  $('sub').textContent = sub;
  $('num').textContent = num;
  const dots = $('dots');
  dots.innerHTML = '';
  ORDER.forEach((_, i) => { const d = document.createElement('i'); d.className = phase === 'done' || i < step ? 'done' : (phase === 'pick' && i === step ? 'now' : ''); dots.appendChild(d); });
}
function renderStatic() {
  document.documentElement.lang = lang;
  $('s-title').textContent = T('title');
  $('s-lead').textContent = T('lead');
  const ol = $('s-tips'); ol.innerHTML = '';
  for (const tip of TEXT[lang].tips) { const li = document.createElement('li'); li.textContent = tip; ol.appendChild(li); }
  $('s-start').textContent = T('start');
  $('s-lang').textContent = TEXT[lang].other;
  $('lang2').textContent = TEXT[lang].other;
  $('restart').textContent = T('restart');
  $('go').textContent = T('startAnyway');
  render();
}
function setLang(l) { lang = l; try { localStorage.setItem('pick:lang', l); } catch (e) { /* ignore */ } renderStatic(); }
$('s-lang').addEventListener('click', () => setLang(lang === 'ko' ? 'en' : 'ko'));
$('lang2').addEventListener('click', () => setLang(lang === 'ko' ? 'en' : 'ko'));
$('s-start').addEventListener('click', startCamera);
$('restart').addEventListener('click', reset);
$('go').addEventListener('click', () => { if (phase === 'setup') { phase = 'pick'; step = ORDER.findIndex((id) => track[id].on); if (step < 0) step = 0; render(); } });

// the red frame stays while a wrong part is out; a green frame shows briefly after a right pick
let flashOkUntil = 0;
function flash(kind) { if (kind === 'ok') flashOkUntil = now() + 700; syncFlash(); setTimeout(syncFlash, 720); }
function syncFlash() { $('flash').className = 'flash' + (wrongPart ? ' bad' : flashOkUntil > now() ? ' ok' : ''); }

// ---------- overlay: outline + name on every part ----------
const ov = $('ov');
const octx = ov.getContext('2d');
function draw(t) {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const W = innerWidth, H = innerHeight;
  if (ov.width !== Math.round(W * dpr) || ov.height !== Math.round(H * dpr)) { ov.width = Math.round(W * dpr); ov.height = Math.round(H * dpr); }
  octx.setTransform(dpr, 0, 0, dpr, 0, 0);
  octx.clearRect(0, 0, W, H);
  if (!lastRes || phase === 'start' || !video.videoWidth) return;
  const vw = video.videoWidth, vh = video.videoHeight;
  const cs = Math.max(W / vw, H / vh), ox = (W - vw * cs) / 2, oy = (H - vh * cs) / 2;
  const k = cs / lastRes.scale;                       // analysis px -> CSS px
  const want = phase === 'pick' ? ORDER[step] : null;
  const pulse = 0.5 + 0.5 * Math.sin(t / 220);
  const names = new Map();
  for (const id of ORDER) if (track[id].on && track[id].last) names.set(track[id].last, id);
  for (const p0 of lastRes.parts) {
    const name = names.get(p0) || null;
    if (!name) continue;                            // only name what is recognised; no question marks
    const p = { ...p0, label: name };
    const target = p.label && p.label === want;
    const color = !p.label ? 'rgba(255,255,255,.55)' : target ? '#2f80ff' : 'rgba(255,255,255,.92)';
    octx.save();
    octx.translate(ox + p.cx * k, oy + p.cy * k);
    octx.rotate(p.angle);
    const L = p.L * k + 14, Wd = Math.max(p.W * k, 6) + 14;
    octx.lineWidth = target ? 4 + 2 * pulse : 2.5;
    octx.strokeStyle = color;
    if (!p.label) octx.setLineDash([6, 6]);
    if (target) { octx.shadowColor = '#2f80ff'; octx.shadowBlur = 12 + 10 * pulse; }
    roundRect(octx, -L / 2, -Wd / 2, L, Wd, Math.min(10, Wd / 2));
    octx.stroke();
    octx.restore();
    // name tag above the part
    const label = p.label ? N(p.label) : '?';
    const x = ox + p.cx * k, y = oy + p.cy * k - (Math.abs(Math.sin(p.angle)) * p.L * k / 2 + Math.max(p.W * k, 6) / 2) - 16;
    tag(label, x, y, target ? '#2f80ff' : p.label ? 'rgba(11,15,21,.85)' : 'rgba(11,15,21,.6)', p.label ? COLORS[p.label] : '#ffffff', target);
  }
}
function tag(text, x, y, bg, dot, big) {
  octx.font = `${big ? 800 : 700} ${big ? 16 : 14}px system-ui, -apple-system, "Apple SD Gothic Neo", sans-serif`;
  const tw = octx.measureText(text).width, padX = 10, hgt = big ? 30 : 26, wdt = tw + padX * 2 + 14;
  const x0 = Math.max(6, Math.min(innerWidth - wdt - 6, x - wdt / 2)), y0 = Math.max(6, y - hgt / 2);
  octx.fillStyle = bg;
  roundRect(octx, x0, y0, wdt, hgt, hgt / 2); octx.fill();
  octx.fillStyle = dot;
  octx.beginPath(); octx.arc(x0 + padX + 4, y0 + hgt / 2, 5, 0, Math.PI * 2); octx.fill();
  octx.fillStyle = '#fff';
  octx.textBaseline = 'middle';
  octx.fillText(text, x0 + padX + 14, y0 + hgt / 2 + 1);
}
function roundRect(c, x, y, w, h, r) {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}

// ---------- sound ----------
let audio = null;
function ensureAudio() { if (!audio) { try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { audio = null; } } if (audio && audio.state === 'suspended') audio.resume().catch(() => {}); }
function tone(f, d, type = 'sine', when = 0, g = 0.2) {
  if (!audio) return;
  const t0 = audio.currentTime + when, o = audio.createOscillator(), gn = audio.createGain();
  o.type = type; o.frequency.value = f;
  gn.gain.setValueAtTime(0, t0); gn.gain.linearRampToValueAtTime(g, t0 + 0.01); gn.gain.exponentialRampToValueAtTime(0.001, t0 + d);
  o.connect(gn).connect(audio.destination); o.start(t0); o.stop(t0 + d + 0.02);
}
function soundOk() { tone(880, 0.12); tone(1320, 0.18, 'sine', 0.11); }
function soundBad() { tone(196, 0.18, 'square', 0, 0.13); tone(150, 0.26, 'square', 0.2, 0.13); if (navigator.vibrate) navigator.vibrate([160, 80, 160]); }

renderStatic();
requestAnimationFrame(loop);
if (params.get('autostart') === '1') startCamera();

window.__pick = {
  debug(id) { const tr = track[id]; return { box: tr.box && [Math.round(tr.box.cx), Math.round(tr.box.cy), Math.round(tr.box.L), +tr.box.W.toFixed(1), +tr.box.dark.toFixed(2)], on: tr.on, hist: tr.hist.map(Number).join(''), share: lastRes && tr.box ? +surfaceShareInBox(lastRes, tr.box).toFixed(2) : null, bg: bgColor && bgColor.map(Math.round), labels: lastRes ? lastRes.parts.map((p) => p.label || '?').join(',') : '' }; }, get state() { return { phase, step, want: ORDER[step], wrongPart, on: ORDER.filter((id) => track[id].on), parts: lastRes ? lastRes.parts.map((p) => p.label || '?') : [], surface: !!(lastRes && lastRes.surface) }; }, events, analyze };
