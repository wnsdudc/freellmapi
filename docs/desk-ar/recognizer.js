// On-device part recognition: MobileNet v1 (0.25) image features + a colour histogram, k-nearest neighbours.
// The presenter "registers" each part once by showing it to the camera; nothing leaves the phone.
const tf = window.tf;
const COLOR_W = 0.9;           // weight of the colour cue next to the image features
const DB = 'pen-ar', STORE = 'samples';

export class PartRecognizer {
  constructor() {
    this.model = null;
    this.samples = [];          // { label, v: Float32Array (unit length) }
    this.crop = document.createElement('canvas');
    this.crop.width = this.crop.height = 224;
    this.cctx = this.crop.getContext('2d', { willReadFrequently: true });
    this.small = document.createElement('canvas');
    this.small.width = this.small.height = 48;
    this.sctx = this.small.getContext('2d', { willReadFrequently: true });
  }

  async load(url = './vendor/mobilenet/model.json') {
    await tf.ready();
    try { if (tf.getBackend() !== 'webgl') await tf.setBackend('webgl'); } catch (e) { /* falls back to cpu */ }
    const full = await tf.loadLayersModel(url);
    this.model = tf.model({ inputs: full.inputs, outputs: full.getLayer('conv_pw_13_relu').output });
    tf.tidy(() => this.model.predict(tf.zeros([1, 224, 224, 3])));
    return tf.getBackend();
  }

  // Feature vector of a square region (sx, sy, size) of a video/canvas/image.
  features(source, sx, sy, size) {
    this.cctx.drawImage(source, sx, sy, size, size, 0, 0, 224, 224);
    const emb = tf.tidy(() => {
      const x = tf.browser.fromPixels(this.crop).toFloat().div(127.5).sub(1).expandDims(0);
      return this.model.predict(x).mean([1, 2]).squeeze();
    });
    const e = emb.dataSync().slice();
    emb.dispose();
    normalize(e);
    const c = this.colorHist();
    const v = new Float32Array(e.length + c.length);
    v.set(e, 0);
    for (let i = 0; i < c.length; i++) v[e.length + i] = c[i] * COLOR_W;
    return normalize(v);
  }

  // Colour cue that still works for thin parts: the hue mix of the saturated pixels (normalised on its own,
  // scaled by how many coloured pixels there are), plus the share of dark and of bright-neutral pixels.
  colorHist() {
    this.sctx.drawImage(this.crop, 0, 0, 48, 48);
    const d = this.sctx.getImageData(0, 0, 48, 48).data;
    const hue = new Float32Array(12);
    let colored = 0, dark = 0, bright = 0;
    const n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), v = mx, s = mx ? (mx - mn) / mx : 0;
      if (v < 0.22) { dark++; continue; }
      if (s < 0.18 && v > 0.7) { bright++; continue; }
      if (s > 0.4 && v > 0.25) {
        let h;
        if (mx === r) h = ((g - b) / (mx - mn) + 6) % 6; else if (mx === g) h = (b - r) / (mx - mn) + 2; else h = (r - g) / (mx - mn) + 4;
        hue[Math.min(11, Math.floor(h * 2))] += s;
        colored++;
      }
    }
    normalize(hue);
    const presence = Math.min(1, colored / 25);
    const out = new Float32Array(14);
    for (let i = 0; i < 12; i++) out[i] = hue[i] * presence;
    out[12] = Math.sqrt(dark / n);
    out[13] = Math.sqrt(bright / n) * 0.5;
    return out;
  }

  add(label, v) { this.samples.push({ label, v }); }
  count(label) { return this.samples.reduce((n, s) => n + (s.label === label), 0); }
  clear(label) { this.samples = label ? this.samples.filter((s) => s.label !== label) : []; }

  // k-nearest neighbours by cosine similarity
  classify(v, k = 7) {
    if (!this.samples.length) return null;
    const sims = this.samples.map((s) => ({ label: s.label, sim: dot(s.v, v) }));
    sims.sort((a, b) => b.sim - a.sim);
    const top = sims.slice(0, Math.min(k, sims.length));
    const votes = {};
    let total = 0;
    for (const t of top) { const w = Math.max(0, t.sim) ** 4; votes[t.label] = (votes[t.label] || 0) + w; total += w; }
    let best = null;
    for (const [l, w] of Object.entries(votes)) if (!best || w > best.w) best = { label: l, w };
    return { label: best.label, conf: total ? best.w / total : 0, sim: top[0].sim, votes };
  }

  async save() {
    const db = await openDb();
    await tx(db, 'readwrite', (st) => { st.clear(); st.put({ id: 'all', samples: this.samples.map((s) => ({ label: s.label, v: Array.from(s.v) })) }); });
  }
  async restore() {
    try {
      const db = await openDb();
      const rec = await new Promise((res, rej) => { const r = db.transaction(STORE).objectStore(STORE).get('all'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      if (rec && rec.samples) this.samples = rec.samples.map((s) => ({ label: s.label, v: Float32Array.from(s.v) }));
    } catch (e) { /* storage blocked: start empty */ }
    return this.samples.length;
  }
  async wipe() { this.samples = []; try { await this.save(); } catch (e) { /* ignore */ } }
}

function normalize(a) { let n = 0; for (let i = 0; i < a.length; i++) n += a[i] * a[i]; n = Math.sqrt(n) || 1; for (let i = 0; i < a.length; i++) a[i] /= n; return a; }
function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
function openDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function tx(db, mode, fn) {
  return new Promise((res, rej) => { const t = db.transaction(STORE, mode); fn(t.objectStore(STORE)); t.oncomplete = res; t.onerror = () => rej(t.error); });
}

// Keeps the last few results and only reports a part once it has been seen steadily (~0.5 s).
// A part that would trigger the "wrong part" alarm needs stronger agreement than the right part,
// because a false alarm during a demo is worse than a slightly slower confirmation.
export class Stabilizer {
  constructor(n = 6, need = 4, minConf = 0.55, needStrict = 5, minConfStrict = 0.65) { Object.assign(this, { n, need, minConf, needStrict, minConfStrict }); this.hist = []; }
  push(r) {
    this.hist.push(r);
    if (this.hist.length > this.n) this.hist.shift();
    return this.best(this.need, this.minConf);
  }
  best(need, minConf) {
    const counts = {};
    for (const h of this.hist) if (h && h.conf >= minConf) counts[h.label] = (counts[h.label] || 0) + 1;
    let best = null;
    for (const [l, c] of Object.entries(counts)) if (!best || c > best.c) best = { label: l, c };
    return best && best.c >= need ? best.label : null;
  }
  strict() { return this.best(this.needStrict, this.minConfStrict); }
  reset() { this.hist = []; }
}
