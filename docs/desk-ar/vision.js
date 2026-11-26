// Finds pen parts lying on a sheet of white paper and names them by size and colour. No training needed.
// 1. paper = the largest bright, low-saturation region
// 2. parts = dark/coloured blobs fully enclosed by the paper (a hand reaching in from outside is connected
//    to the image border, so it is never mistaken for a part)
// 3. each blob's length/width come from its second moments; the paper (A4, 297 mm) gives the mm scale
// 4. thin blobs are refills (named by colour), thick blobs are body / grip / assembled pen (named by length)

export const PART_IDS = ['body', 'black', 'red', 'blue', 'grip'];
const A4_LONG = 297, A4_SHORT = 210;

export function analyze(img, w, h) {
  const n = w * h, d = img.data;
  const V = new Uint8Array(n), S = new Uint8Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const r = d[p], g = d[p + 1], b = d[p + 2];
    const mx = r > g ? (r > b ? r : b) : (g > b ? g : b), mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
    V[i] = mx; S[i] = mx ? ((mx - mn) * 255 / mx) | 0 : 0;
  }
  // paper brightness: 90th percentile of V among low-saturation pixels
  const hist = new Uint32Array(256); let cnt = 0;
  for (let i = 0; i < n; i++) if (S[i] < 60) { hist[V[i]]++; cnt++; }
  let acc = 0, paperV = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= cnt * 0.1) { paperV = v; break; } }
  const result = { w, h, paper: null, parts: [], paperMask: null };
  if (paperV < 110 || cnt < n * 0.05) return result;
  const vT = paperV * 0.66, sT = 64;
  const P = new Uint8Array(n);
  for (let i = 0; i < n; i++) P[i] = V[i] >= vT && S[i] < sT ? 1 : 0;
  // largest bright component = the paper
  const lab = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  let best = -1, bestSize = 0;
  const comps = [];
  for (let i = 0; i < n; i++) {
    if (!P[i] || lab[i] !== -1) continue;
    const id = comps.length; let qh = 0, qt = 0; queue[qt++] = i; lab[i] = id; let size = 0;
    while (qh < qt) {
      const j = queue[qh++]; size++;
      const x = j % w, y = (j / w) | 0;
      if (x > 0 && P[j - 1] && lab[j - 1] === -1) { lab[j - 1] = id; queue[qt++] = j - 1; }
      if (x < w - 1 && P[j + 1] && lab[j + 1] === -1) { lab[j + 1] = id; queue[qt++] = j + 1; }
      if (y > 0 && P[j - w] && lab[j - w] === -1) { lab[j - w] = id; queue[qt++] = j - w; }
      if (y < h - 1 && P[j + w] && lab[j + w] === -1) { lab[j + w] = id; queue[qt++] = j + w; }
    }
    comps.push(size);
    if (size > bestSize) { bestSize = size; best = id; }
  }
  if (bestSize < n * 0.08) return result;
  const paper = new Uint8Array(n);
  let px = 0, py = 0, pxx = 0, pyy = 0, pxy = 0, touches = false;
  for (let i = 0; i < n; i++) if (lab[i] === best) {
    paper[i] = 1; const x = i % w, y = (i / w) | 0;
    px += x; py += y; pxx += x * x; pyy += y * y; pxy += x * y;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touches = true;
  }
  const pm = moments(bestSize, px, py, pxx, pyy, pxy);
  // the paper's own holes are filled for its area estimate; scale is trusted only when the whole sheet is in view
  const ratio = pm.L / pm.W;
  const mmPerPx = !touches && ratio > 1.2 && ratio < 1.75 ? (A4_LONG / pm.L + A4_SHORT / pm.W) / 2 : null;
  result.paper = { cx: pm.cx, cy: pm.cy, L: pm.L, W: pm.W, angle: pm.angle, touches, mmPerPx, area: bestSize };
  result.paperMask = paper;

  // "outside": everything not paper that can be reached from the image border
  const out = new Uint8Array(n);
  let qh = 0, qt = 0;
  const push = (j) => { if (!paper[j] && !out[j]) { out[j] = 1; queue[qt++] = j; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (qh < qt) {
    const j = queue[qh++]; const x = j % w, y = (j / w) | 0;
    if (x > 0) push(j - 1); if (x < w - 1) push(j + 1); if (y > 0) push(j - w); if (y < h - 1) push(j + w);
  }
  // holes in the paper = parts
  const seen = new Uint8Array(n);
  const minArea = Math.max(25, bestSize * 0.0012);
  const blobs = [];
  for (let i = 0; i < n; i++) {
    if (paper[i] || out[i] || seen[i]) continue;
    qh = 0; qt = 0; queue[qt++] = i; seen[i] = 1;
    let a = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sat = 0, dark = 0, hx = 0, hy = 0, vsum = 0;
    while (qh < qt) {
      const j = queue[qh++]; a++;
      const x = j % w, y = (j / w) | 0;
      sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
      vsum += V[j];
      if (V[j] < paperV * 0.45) dark++;
      if (S[j] > 90 && V[j] > 60) {
        sat++;
        const p = j * 4, r = d[p], g = d[p + 1], b = d[p + 2];
        const hue = hueOf(r, g, b) * Math.PI / 180;
        hx += Math.cos(hue); hy += Math.sin(hue);
      }
      if (x > 0 && !paper[j - 1] && !out[j - 1] && !seen[j - 1]) { seen[j - 1] = 1; queue[qt++] = j - 1; }
      if (x < w - 1 && !paper[j + 1] && !out[j + 1] && !seen[j + 1]) { seen[j + 1] = 1; queue[qt++] = j + 1; }
      if (y > 0 && !paper[j - w] && !out[j - w] && !seen[j - w]) { seen[j - w] = 1; queue[qt++] = j - w; }
      if (y < h - 1 && !paper[j + w] && !out[j + w] && !seen[j + w]) { seen[j + w] = 1; queue[qt++] = j + w; }
    }
    if (a < minArea) continue;
    const m = moments(a, sx, sy, sxx, syy, sxy);
    let hue = null;
    if (sat > 0) { hue = Math.atan2(hy, hx) * 180 / Math.PI; if (hue < 0) hue += 360; }
    blobs.push({ ...m, area: a, satFrac: sat / a, darkFrac: dark / a, hue, meanV: vsum / a / paperV });
  }
  result.parts = classify(blobs, mmPerPx);
  return result;
}

function hueOf(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), c = mx - mn;
  if (!c) return 0;
  let h;
  if (mx === r) h = ((g - b) / c) % 6; else if (mx === g) h = (b - r) / c + 2; else h = (r - g) / c + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

// length/width of a blob as if it were a filled rectangle: L = sqrt(12 * major variance)
function moments(a, sx, sy, sxx, syy, sxy) {
  const cx = sx / a, cy = sy / a;
  const vxx = sxx / a - cx * cx, vyy = syy / a - cy * cy, vxy = sxy / a - cx * cy;
  const tr = vxx + vyy, det = vxx * vyy - vxy * vxy;
  const disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
  const l1 = tr / 2 + disc, l2 = Math.max(0, tr / 2 - disc);
  return { cx, cy, L: Math.sqrt(12 * l1), W: Math.sqrt(12 * l2) + 0.5, angle: 0.5 * Math.atan2(2 * vxy, vxx - vyy) };
}

function refillColor(b) {
  if (b.satFrac > 0.22 && b.hue != null) {
    if (b.hue < 25 || b.hue > 330) return 'red';
    if (b.hue > 185 && b.hue < 265) return 'blue';
    return null;
  }
  if (b.meanV < 0.62 || b.darkFrac > 0.3) return 'black';
  return null;
}

function classify(blobs, mmPerPx) {
  const out = [];
  if (mmPerPx) {
    for (const b of blobs) {
      const L = b.L * mmPerPx, W = b.W * mmPerPx;
      let label = null;
      if (W < 6 && L > 55 && L < 125) label = refillColor(b);
      else if (W >= 6 && W < 22) {
        if (L >= 118 && L < 175) label = 'pen';
        else if (L >= 66 && L < 118) label = 'body';
        else if (L >= 28 && L < 66) label = 'grip';
      }
      out.push({ ...b, Lmm: L, Wmm: W, label });
    }
  } else {
    // no reliable scale: thin vs thick by width relative to the widest blob, thick ones ranked by length
    const maxW = Math.max(1, ...blobs.map((b) => b.W));
    const thick = blobs.filter((b) => b.W > maxW * 0.55 && b.L / b.W < 14);
    for (const b of blobs) {
      let label = null;
      if (!thick.includes(b) && b.L / b.W > 12) label = refillColor(b);
      out.push({ ...b, label });
    }
    const refL = out.filter((b) => b.label && b.label !== 'body').map((b) => b.L);
    const ref = refL.length ? refL.sort((a, b) => a - b)[Math.floor(refL.length / 2)] : null;
    const thickSorted = out.filter((b) => thick.includes(b)).sort((a, b) => b.L - a.L);
    thickSorted.forEach((b, i) => {
      if (ref) b.label = b.L > ref * 1.25 ? 'pen' : b.L > ref * 0.72 ? 'body' : 'grip';
      else b.label = thickSorted.length >= 2 ? (i === 0 ? 'body' : 'grip') : null;
    });
  }
  // one of each: if two blobs claim a name, the bigger one keeps it
  const byLabel = {};
  for (const b of out) if (b.label) { if (!byLabel[b.label] || b.area > byLabel[b.label].area) byLabel[b.label] = b; }
  for (const b of out) if (b.label && byLabel[b.label] !== b) b.label = null;
  return out;
}

// Share of paper pixels inside an oriented box (used to tell "picked up" from "covered by a hand").
export function paperShareInBox(res, box) {
  if (!res.paperMask) return 0;
  const { w, h } = res;
  const c = Math.cos(box.angle), s = Math.sin(box.angle);
  let tot = 0, pap = 0;
  const hl = box.L / 2 * 0.8, hw = Math.max(1.5, box.W / 2);
  for (let u = -hl; u <= hl; u += 1) for (let v = -hw; v <= hw; v += 1) {
    const x = Math.round(box.cx + u * c - v * s), y = Math.round(box.cy + u * s + v * c);
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    tot++; if (res.paperMask[y * w + x]) pap++;
  }
  return tot ? pap / tot : 0;
}
