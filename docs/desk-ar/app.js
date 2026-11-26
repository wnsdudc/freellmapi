// Pen assembly on a plain light desk:
// 1. point the camera at the 5 parts: names come from a vote over the last frames; when all 5 are stable it starts
// by itself -> 2. pick the parts in order; a wrong part gives a red signal.
// A part counts as picked only when a hand came to its spot, the hand has left again and the bare desk shows
// where the part lay, with the spot inside the picture. A hand passing over, or a part leaving the picture, is
// not a pick.
import { analyze, classify, surfaceShareInBox, handShareNearBox, boxInFrame, dilate } from './vision.js';
import { TEXT, PARTS, ACTIONS, COLORS, fmt } from './text.js';

const ORDER = ['body', 'black', 'red', 'blue', 'grip'];
const WIN = 8;                // frames voted on while the parts are being recognised
const LONG_SIDE = 800;         // analysis size (px, long side): thin refills stay a few pixels wide
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
let outView = false;          // a part's spot is outside the picture: nothing is judged for it
let outViewAt = -1e9;         // last time that was so: judging waits a moment after the parts are back in view
let fixedEdge = null;         // what was at the picture edge at the start (not a hand), moved with the camera
let recentRuns = [];          // last analyses, voted on during setup
let found = [];               // setup result: [{ name, blob }] (latest position, voted name)
let stableN = 0;              // consecutive frames with all 5 names in the same places
// surface colour, updated slowly and only by colours close to it, so a hand in the picture cannot hijack it
let bgColor = null, bgOff = 0;
function trackBackground(m) {
  if (!bgColor) { bgColor = m.slice(); return; }
  const dist = Math.abs(m[0] - bgColor[0]) + Math.abs(m[1] - bgColor[1]) + Math.abs(m[2] - bgColor[2]);
  if (dist < 36) { for (let i = 0; i < 3; i++) bgColor[i] += (m[i] - bgColor[i]) * 0.08; bgOff = 0; }
  else if (++bgOff > 40) { bgColor = m.slice(); bgOff = 0; }      // scene really changed (new place / lighting)
}
const track = {};             // per part: on the desk?, spot (box), presence history, times seen / hand at the spot
for (const id of ORDER) track[id] = {};
function resetTrack() { for (const id of ORDER) Object.assign(track[id], { on: false, box: null, hist: [], seenAt: 0, handAt: -1e9, clearN: 0, last: null }); }
resetTrack();

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
  phase = 'setup'; step = 0; wrongPart = null; toast = null; outView = false; outViewAt = -1e9; fixedEdge = null; recentRuns = []; found = []; stableN = 0; bgColor = null;
  resetTrack();
  render();
}
// ---------- analysis loop (about 10 times a second) ----------
let lastRun = 0;
function loop() {
  requestAnimationFrame(loop);
  const t = now();
  if (phase !== 'start' && video.readyState >= 2 && video.videoWidth && t - lastRun > 95) {
    lastRun = t;
    const vw = video.videoWidth, vh = video.videoHeight;
    const s = Math.min(1, LONG_SIDE / Math.max(vw, vh));
    const w = Math.round(vw * s), h = Math.round(vh * s);
    if (work.width !== w || work.height !== h) { work.width = w; work.height = h; }
    wctx.drawImage(video, 0, 0, w, h);
    lastRes = analyze(wctx.getImageData(0, 0, w, h), w, h, bgColor);
    trackBackground(lastRes.median);
    lastRes.scale = s;
    if (phase === 'setup') setup(lastRes);
    else update(lastRes, t);
  }
  draw(t);
}

// ---------- recognising the parts: vote over the last frames ----------
const isThin = (b) => b.L / b.W >= 8.5;
function vote(runs) {
  // group the blobs of all frames by position; keep what is there in most frames and in the latest one
  const groups = [];
  runs.forEach((res, f) => {
    for (const b of res.parts) {
      if (b.L / b.W < 1.6) continue;
      let g = groups.find((q) => isThin(q.items[0]) === isThin(b) && Math.hypot(q.cx - b.cx, q.cy - b.cy) < Math.max(10, 0.3 * b.L));
      if (!g) { g = { items: [], cx: b.cx, cy: b.cy, lastF: -1 }; groups.push(g); }
      g.items.push(b); g.latest = b; g.lastF = f;
      g.cx = b.cx; g.cy = b.cy;               // follow the newest position (the phone may move a little)
    }
  });
  const keep = groups.filter((g) => g.items.length >= Math.ceil(runs.length * 0.6) && g.lastF === runs.length - 1);
  const avg = keep.map((g) => {
    const it = g.items, n = it.length, m = (k) => it.reduce((a, q) => a + q[k], 0) / n;
    return { latest: g.latest, L: m('L'), W: m('W'), area: m('area'), red: m('red'), blue: m('blue'), redN: m('redN'), blueN: m('blueN'), dark: m('dark') };
  });
  classify(avg);                               // names from colour/size averaged over the frames: steadier
  return avg.filter((b) => b.label).map((b) => ({ name: b.label, blob: b.latest }));
}
function setup(res) {
  recentRuns.push(res);
  if (recentRuns.length > WIN) recentRuns.shift();
  const prev = found;
  found = recentRuns.length >= 4 ? vote(recentRuns) : [];
  const all = ORDER.every((id) => found.some((c) => c.name === id));
  const same = all && found.every((c) => { const q = prev.find((x) => x.name === c.name); return q && Math.hypot(q.blob.cx - c.blob.cx, q.blob.cy - c.blob.cy) < 10; });
  stableN = same ? stableN + 1 : 0;
  // all 5 named in the same places for 5 frames in a row, and no hand at work: nothing hand-like near a part and
  // nothing moving in from the edge (a table or desk edge that is just there does not count)
  if (stableN >= 5 && recentRuns.length >= 6 && handsAway(res)) startPicking();
  else render();
}
function handsAway(res) {
  if (!res.handN) return true;
  const hs = recentRuns.slice(-5).map((r) => r.handN);
  const still = Math.max(...hs) - Math.min(...hs) < 0.05 * Math.max(...hs) + 300;
  return still && found.every((c) => handShareNearBox(res, c.blob) < 0.02);
}
function startPicking() {
  resetTrack();
  const t = now();
  const ref = recentRuns[recentRuns.length - 1];
  const edge = new Uint8Array(ref.w * ref.h);
  for (const r of recentRuns) if (r.hand && r.w === ref.w) for (let i = 0; i < edge.length; i++) if (r.hand[i]) edge[i] = 1;
  fixedEdge = { mask: dilate(edge, ref.w, ref.h, 10), w: ref.w, h: ref.h, dx: 0, dy: 0 };
  for (const c of found) {
    // how the spot looks with the part on it: a faint part (clear refill) leaves much of its box "desk-like",
    // so "bare" must mean clearly more desk than that
    const base = surfaceShareInBox(ref, c.blob, 4);
    Object.assign(track[c.name], { on: true, box: c.blob, hist: [1, 1, 1, 1, 1, 1].map(Boolean), seenAt: t, bare: Math.max(0.8, Math.min(0.97, base + 0.6 * (1 - base))) });
  }
  phase = 'pick'; step = 0; wrongPart = null; toast = null;
  log('start', ORDER.map((id) => `${id}@${Math.round(track[id].box.cx)},${Math.round(track[id].box.cy)}`).join(' '));
  render();
}

// ---------- following the parts ----------
// The camera may move (hand-held phone): all parts move together. The shift that puts the most known spots onto
// blobs of the same kind is taken as the camera movement; every spot (also of covered parts) follows it.
const done = (id) => (phase === 'pick' || phase === 'done') && ORDER.indexOf(id) < step;
const fits = (box, b, dx, dy) => isThin(b) === isThin(box) && b.L / box.L > 0.72 && b.L / box.L < 1.35 &&
  Math.hypot(b.cx - box.cx - dx, b.cy - box.cy - dy) < Math.max(14, box.L * 0.35);
function cameraShift(blobs, ids) {
  const shifts = [[0, 0]];
  for (const id of ids) for (const b of blobs) if (fits(track[id].box, b, b.cx - track[id].box.cx, b.cy - track[id].box.cy)) shifts.push([b.cx - track[id].box.cx, b.cy - track[id].box.cy]);
  let best = [0, 0], bn = -1, bd = 0;
  for (const [dx, dy] of shifts) {
    const used = new Set(); let n = 0;
    for (const id of ids) { const b = blobs.find((q) => !used.has(q) && fits(track[id].box, q, dx, dy)); if (b) { used.add(b); n++; } }
    const d = Math.hypot(dx, dy);
    if (n > bn || (n === bn && d < bd)) { bn = n; best = [dx, dy]; bd = d; }
  }
  return bn > 0 ? best : [0, 0];
}
function update(res, t) {
  const blobs = res.parts.filter((b) => b.L / b.W >= 1.6);
  const ids = ORDER.filter((id) => !done(id) && track[id].box);
  const [dx, dy] = cameraShift(blobs, ids);
  for (const id of ids) { const b = track[id].box; track[id].box = { ...b, cx: b.cx + dx, cy: b.cy + dy }; }
  if (fixedEdge) { fixedEdge.dx += dx; fixedEdge.dy += dy; }
  const seen = {}, used = new Set();
  // 1. at their spot (parts on the desk first, then parts put back where they were)
  for (const pass of [true, false]) for (const id of ids) {
    if (track[id].on !== pass) continue;
    let best = null, bd = Infinity;
    for (const b of blobs) {
      if (used.has(b) || !fits(track[id].box, b, 0, 0)) continue;
      const d = Math.hypot(b.cx - track[id].box.cx, b.cy - track[id].box.cy);
      if (d < bd) { bd = d; best = b; }
    }
    if (best) { seen[id] = best; used.add(best); }
  }
  // 2. a part put back somewhere else: by its colour/size name (only parts that are off the desk)
  for (const id of ids) {
    if (seen[id] || track[id].on) continue;
    const b = blobs.find((x) => !used.has(x) && x.label === id);
    if (b) { seen[id] = b; used.add(b); }
  }
  outView = false;
  for (const id of ORDER) {
    const tr = track[id];
    if (done(id)) { tr.on = false; tr.last = null; continue; }
    if (!tr.box) continue;
    tr.hist.push(!!seen[id]);
    if (tr.hist.length > 6) tr.hist.shift();
    tr.last = seen[id] || null;
    if (seen[id]) { tr.box = seen[id]; tr.seenAt = t; }
    const inFrame = boxInFrame(res, tr.box);
    const handNear = handShareNearBox(res, tr.box, 14, fixedEdge) > 0.02;
    if (handNear) { tr.handAt = t; tr.clearN = 0; } else tr.clearN++;
    if (tr.on && !inFrame) { outView = true; outViewAt = t; }
    const recent = tr.hist.slice(-5).filter(Boolean).length;
    const absent = tr.hist.length >= 4 && tr.hist.slice(-4).every((x) => !x);
    if (!tr.on && recent >= 3) { tr.on = true; onPlaced(id); }
    else if (tr.on && absent && res.surface && inFrame && t - outViewAt > 1000) {
      // picked up = a hand came to the spot when (or after) the part vanished, the hand has left the spot again,
      // the bare desk shows there (box widened for a moving phone), and other parts are still in view
      // (if a hand cannot be told from the desk, e.g. skin-coloured desk, a part gone for 1.5 s also counts, but
      // only if it vanished while all parts were in the picture, not while the camera was moved away)
      const handCame = tr.handAt >= tr.seenAt - 200 || (t - tr.seenAt > 1500 && tr.seenAt > outViewAt + 1000);
      const handGone = tr.clearN >= 2;
      const bare = surfaceShareInBox(res, tr.box, 4) > (tr.bare || 0.8);
      const others = ORDER.filter((o) => o !== id && track[o].on && !done(o));
      const sane = !others.length || others.some((o) => seen[o]);
      if (handCame && handGone && bare && sane) { tr.on = false; onPicked(id); }
    }
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
  let cls = '', head = '', sub = '', num = '';
  if (phase === 'setup') {
    const have = ORDER.filter((id) => found.some((c) => c.name === id));
    num = `${have.length}/5`;
    head = lastRes && !lastRes.surface ? T('noSurface') : T('setup');
    if (have.length === 5) sub = lastRes && !handsAway(lastRes) ? T('allHand') : T('all');
    else sub = T('found', { n: have.length }) + (have.length ? ' · ' + have.map(N).join(', ') : '');
  } else if (phase === 'done') {
    cls = 'ok'; head = T('done'); sub = T('doneHint'); num = '✓';
  } else {
    const want = ORDER[step];
    num = String(step + 1);
    if (wrongPart) { cls = 'bad'; head = T('wrong', { got: O(wrongPart) }); sub = T('wrongHint', { want: O(want) }); num = '!'; }
    else if (outView) { cls = 'warn'; head = T('outView'); sub = T('outViewSub'); num = '!'; }
    else if (toast && toast.until > now()) { cls = toast.kind === 'ok' ? 'ok' : ''; head = toast.kind === 'ok' ? toast.text : T('pick', { name: O(want) }); sub = toast.kind === 'ok' ? T('pick', { name: O(want) }) : toast.text; }
    else { head = T('pick', { name: O(want) }); sub = T('then', { action: ACTIONS[lang][want] }); }
  }
  $('banner').className = 'banner ' + cls;
  syncFlash();
  $('head').textContent = head;
  $('sub').textContent = sub;
  $('num').textContent = num;
  const dots = $('dots');
  dots.innerHTML = '';
  ORDER.forEach((_, i) => { const d = document.createElement('i'); d.className = phase === 'done' || ((phase === 'pick') && i < step) ? 'done' : (phase === 'pick' && i === step ? 'now' : ''); dots.appendChild(d); });
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
  render();
}
function setLang(l) { lang = l; try { localStorage.setItem('pick:lang', l); } catch (e) { /* ignore */ } renderStatic(); }
$('s-lang').addEventListener('click', () => setLang(lang === 'ko' ? 'en' : 'ko'));
$('lang2').addEventListener('click', () => setLang(lang === 'ko' ? 'en' : 'ko'));
$('s-start').addEventListener('click', startCamera);
$('restart').addEventListener('click', reset);

// the red frame stays while a wrong part is out; a green frame shows briefly after a right pick
let flashOkUntil = 0;
function flash(kind) { if (kind === 'ok') flashOkUntil = now() + 700; syncFlash(); setTimeout(syncFlash, 720); }
function syncFlash() { $('flash').className = 'flash' + (wrongPart ? ' bad' : flashOkUntil > now() ? ' ok' : ''); }

// ---------- overlay ----------
const ov = $('ov');
const octx = ov.getContext('2d');
function fitCanvas(c, ctx) {
  const dpr = Math.min(devicePixelRatio || 1, 2), W = innerWidth, H = innerHeight;
  if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
function draw(t) {
  fitCanvas(ov, octx);
  const W = innerWidth, H = innerHeight;
  octx.clearRect(0, 0, W, H);
  if (phase === 'start' || !video.videoWidth || !lastRes) return;
  const vw = video.videoWidth, vh = video.videoHeight;
  const cs = Math.max(W / vw, H / vh), ox = (W - vw * cs) / 2, oy = (H - vh * cs) / 2;
  const k = cs / lastRes.scale;                       // analysis px -> CSS px
  placed = [];
  if (phase === 'setup') {                            // names found so far
    for (const c of found) outline(c.blob, ox, oy, k, 'rgba(255,255,255,.92)', false, 0, false);
    for (const c of found) tag(N(c.name), c.blob, ox, oy, k, 'rgba(11,15,21,.85)', COLORS[c.name], false, false);
    return;
  }
  const want = phase === 'pick' ? ORDER[step] : null;
  const pulse = 0.5 + 0.5 * Math.sin(t / 220);
  // every part still on the desk: where it is seen now, else at its last known spot (e.g. under a hand)
  const shown = ORDER.filter((id) => track[id].on && !done(id) && track[id].box);
  const at = (id) => track[id].last || track[id].box;
  for (const id of shown) outline(at(id), ox, oy, k, id === want ? '#2f80ff' : track[id].last ? 'rgba(255,255,255,.92)' : 'rgba(255,255,255,.5)', id === want, pulse, !track[id].last && id !== want);
  // the target's name first, so it gets the best place
  for (const id of [...shown].sort((a, b) => (b === want) - (a === want))) tag(N(id), at(id), ox, oy, k, id === want ? '#2f80ff' : 'rgba(11,15,21,.85)', COLORS[id], id === want, false);
}
function outline(p, ox, oy, k, color, target, pulse, dashed) {
  octx.save();
  octx.translate(ox + p.cx * k, oy + p.cy * k);
  octx.rotate(p.angle);
  const L = p.L * k + 14, Wd = Math.max(p.W * k, 6) + 14;
  octx.lineWidth = target ? 4 + 2 * pulse : 2.5;
  octx.strokeStyle = color;
  if (dashed) octx.setLineDash([6, 6]);
  if (target) { octx.shadowColor = '#2f80ff'; octx.shadowBlur = 12 + 10 * pulse; }
  roundRect(octx, -L / 2, -Wd / 2, L, Wd, Math.min(10, Wd / 2));
  octx.stroke();
  octx.restore();
}
// name tags: above the part, else below it, else on it, else nudged down; never on top of another tag
let placed = [];
function tag(text, p, ox, oy, k, bg, dot, big, editable) {
  octx.font = `${big ? 800 : 700} ${big ? 16 : 14}px system-ui, -apple-system, "Apple SD Gothic Neo", sans-serif`;
  const tw = octx.measureText(text).width, padX = 10, hgt = editable ? 34 : big ? 30 : 26, wdt = tw + padX * 2 + 14 + (editable ? 16 : 0);
  const cx = ox + p.cx * k, cy = oy + p.cy * k, half = Math.abs(Math.sin(p.angle)) * p.L * k / 2 + Math.max(p.W * k, 6) / 2;
  const hits = (x, y) => placed.some((r) => x < r.x + r.w + 4 && x + wdt + 4 > r.x && y < r.y + r.h + 4 && y + hgt + 4 > r.y);
  const at = (yc) => [Math.max(6, Math.min(innerWidth - wdt - 6, cx - wdt / 2)), Math.max(6, yc - hgt / 2)];
  let x0, y0;
  for (const yc of [cy - half - 18, cy + half + 18, cy, cy - half - 18 - hgt - 6, cy + half + 18 + hgt + 6]) { [x0, y0] = at(yc); if (!hits(x0, y0)) break; }
  placed.push({ x: x0, y: y0, w: wdt, h: hgt });
  octx.fillStyle = bg;
  roundRect(octx, x0, y0, wdt, hgt, hgt / 2); octx.fill();
  if (editable) { octx.strokeStyle = 'rgba(255,255,255,.7)'; octx.lineWidth = 1.5; octx.stroke(); }
  octx.fillStyle = dot;
  octx.beginPath(); octx.arc(x0 + padX + 4, y0 + hgt / 2, 5, 0, Math.PI * 2); octx.fill();
  octx.fillStyle = '#fff';
  octx.textBaseline = 'middle';
  octx.fillText(text, x0 + padX + 14, y0 + hgt / 2 + 1);
  if (editable) octx.fillText('▾', x0 + wdt - padX - 10, y0 + hgt / 2 + 1);
  return { x: x0, y: y0, w: wdt, h: hgt };
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
  get state() { return { phase, step, want: ORDER[step], wrongPart, outView, on: ORDER.filter((id) => track[id].on), found: found.map((c) => c.name) }; },
  debug(id) { const tr = track[id]; return { hand: lastRes && tr.box ? +handShareNearBox(lastRes, tr.box, 14, fixedEdge).toFixed(3) : null, bare: lastRes && tr.box ? +surfaceShareInBox(lastRes, tr.box, 4).toFixed(2) : null, need: tr.bare, inFrame: lastRes && tr.box ? boxInFrame(lastRes, tr.box) : null, clearN: tr.clearN, box: tr.box && [Math.round(tr.box.cx), Math.round(tr.box.cy), Math.round(tr.box.L)], on: tr.on, hist: tr.hist.map(Number).join(''), handAt: Math.round(tr.handAt), seenAt: Math.round(tr.seenAt) }; },
  events,
};
