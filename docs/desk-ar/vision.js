// Finds the 5 parts of the 3-colour pen on a plain surface (desk or paper) and names them. No training.
// 1. surface colour = the most common colour in the picture; pixels close to it (or white) are background
// 2. parts = non-background blobs fully enclosed by the surface; a hand reaching in from the edge is
//    connected to the picture border, so it is never counted as a part
// 3. naming uses the fact that the set is fixed:
//    thin blobs (long and narrow) are refills, named by colour: the refill with red pixels is red,
//    the one with blue pixels is blue, a refill with neither is black (each refill has a coloured band
//    near its tip, which is the strongest cue);
//    thick blobs are the pen's upper part (longer) and lower part (shorter).

export const PART_IDS = ['body', 'black', 'red', 'blue', 'grip'];

export function analyze(img, w, h, bgHint = null) {
  const n = w * h, d = img.data;
  // surface colour: per-channel median over the picture
  const hr = new Uint32Array(256), hg = new Uint32Array(256), hb = new Uint32Array(256);
  for (let p = 0; p < d.length; p += 16) { hr[d[p]]++; hg[d[p + 1]]++; hb[d[p + 2]]++; }
  const med = (hh) => { const tot = hh.reduce((a, b) => a + b, 0); let acc = 0; for (let v = 0; v < 256; v++) { acc += hh[v]; if (acc >= tot / 2) return v; } return 255; };
  const median = [med(hr), med(hg), med(hb)];
  // the caller passes a slowly updated surface colour, so a hand filling the picture does not shift it
  const [br, bg, bb] = bgHint || median;
  const bgV = Math.max(br, bg, bb), bsum = br + bg + bb || 1;
  const cr = br / bsum, cg = bg / bsum;
  const res = { w, h, bg: [br, bg, bb], median, surface: null, parts: [], bgMask: null };
  if (bgV < 70) return res;                                   // too dark to tell parts from the surface
  const B = new Uint8Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const r = d[p], g = d[p + 1], b = d[p + 2];
    const v = r > g ? (r > b ? r : b) : (g > b ? g : b), mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
    const s = r + g + b || 1;
    const chroma = Math.abs(r / s - cr) + Math.abs(g / s - cg) + Math.abs(b / s - (1 - cr - cg));
    const whiteish = v >= bgV * 0.92 && (v - mn) < v * 0.18;
    B[i] = (v >= bgV * 0.64 && chroma < 0.075) || whiteish ? 1 : 0;
  }
  // largest background component = the surface
  const lab = new Int32Array(n).fill(-1), queue = new Int32Array(n);
  let best = -1, bestSize = 0, nid = 0;
  for (let i = 0; i < n; i++) {
    if (!B[i] || lab[i] !== -1) continue;
    const id = nid++; let qh = 0, qt = 0; queue[qt++] = i; lab[i] = id; let size = 0;
    while (qh < qt) {
      const j = queue[qh++]; size++;
      const x = j % w;
      if (x > 0 && B[j - 1] && lab[j - 1] === -1) { lab[j - 1] = id; queue[qt++] = j - 1; }
      if (x < w - 1 && B[j + 1] && lab[j + 1] === -1) { lab[j + 1] = id; queue[qt++] = j + 1; }
      if (j >= w && B[j - w] && lab[j - w] === -1) { lab[j - w] = id; queue[qt++] = j - w; }
      if (j < n - w && B[j + w] && lab[j + w] === -1) { lab[j + w] = id; queue[qt++] = j + w; }
    }
    if (size > bestSize) { bestSize = size; best = id; }
  }
  if (bestSize < n * 0.15) return res;
  const surf = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (lab[i] === best) surf[i] = 1;
  res.surface = { area: bestSize };
  res.bgMask = surf;
  // outside = not surface and reachable from the picture border
  const out = new Uint8Array(n);
  let qh = 0, qt = 0;
  const push = (j) => { if (!surf[j] && !out[j]) { out[j] = 1; queue[qt++] = j; } };
  for (let x = 0; x < w; x++) { push(x); push(n - w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (qh < qt) {
    const j = queue[qh++], x = j % w;
    if (x > 0) push(j - 1); if (x < w - 1) push(j + 1); if (j >= w) push(j - w); if (j < n - w) push(j + w);
  }
  // enclosed blobs
  const seen = new Uint8Array(n);
  const minArea = Math.max(30, n * 0.0006);
  const blobs = [];
  for (let i = 0; i < n; i++) {
    if (surf[i] || out[i] || seen[i]) continue;
    qh = 0; qt = 0; queue[qt++] = i; seen[i] = 1;
    let a = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, red = 0, blue = 0, vs = 0, skin = 0;
    while (qh < qt) {
      const j = queue[qh++]; a++;
      const x = j % w, y = (j / w) | 0;
      sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
      const p = j * 4, r = d[p], g = d[p + 1], b = d[p + 2];
      const v = r > g ? (r > b ? r : b) : (g > b ? g : b);
      vs += v;
      const mn = r < g ? (r < b ? r : b) : (g < b ? g : b), sat = v ? (v - mn) / v : 0;
      if (v === r && sat > 0.35 && r > 60 && g - b < 0.08 * r && b - g < 0.2 * r) red++;    // red ink / band (hue about 340-10)
      else if (v === r && g > b && sat > 0.15 && sat < 0.62 && v > 90) skin++;           // skin (orange hue)
      if (b - r > 20 && b - g > 8 && b > 50) blue++;           // blue ink / blue band
      if (x > 0 && !surf[j - 1] && !out[j - 1] && !seen[j - 1]) { seen[j - 1] = 1; queue[qt++] = j - 1; }
      if (x < w - 1 && !surf[j + 1] && !out[j + 1] && !seen[j + 1]) { seen[j + 1] = 1; queue[qt++] = j + 1; }
      if (j >= w && !surf[j - w] && !out[j - w] && !seen[j - w]) { seen[j - w] = 1; queue[qt++] = j - w; }
      if (j < n - w && !surf[j + w] && !out[j + w] && !seen[j + w]) { seen[j + w] = 1; queue[qt++] = j + w; }
    }
    if (a < minArea) continue;
    const m = moments(a, sx, sy, sxx, syy, sxy);
    if (skin / a > 0.3) continue;                            // part of a hand, not a pen part
    blobs.push({ ...m, area: a, red: red / a, blue: blue / a, redN: red, blueN: blue, dark: vs / a / bgV });
  }
  res.parts = classify(blobs);
  return res;
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

function classify(blobs) {
  if (!blobs.length) return [];
  const maxL = Math.max(...blobs.map((b) => b.L));
  const cands = blobs.filter((b) => b.L >= maxL * 0.3);
  for (const b of blobs) b.label = null;
  const thin = cands.filter((b) => b.L / b.W >= 8.5);
  const thick = cands.filter((b) => b.L / b.W < 8.5 && b.L / b.W >= 1.6 && b.dark < 0.62);   // pen halves are dark
  // refills: give each colour to the blob that shows it most; the rest is black
  const left = [...thin];
  const takeBest = (key, minFrac, minCount) => {
    let bi = -1;
    left.forEach((b, i) => { if (b[key] >= minFrac && b[key + 'N'] >= minCount && (bi < 0 || b[key] > left[bi][key])) bi = i; });
    return bi >= 0 ? left.splice(bi, 1)[0] : null;
  };
  const red = takeBest('red', 0.01, 6);
  if (red) red.label = 'red';
  const blue = takeBest('blue', 0.006, 4);
  if (blue) blue.label = 'blue';
  // black: the least colourful remaining refill
  left.sort((a, b) => (a.red + a.blue) - (b.red + b.blue));
  if (left.length && left[0].red < 0.01 && left[0].blue < 0.006) left[0].label = 'black';
  // pen parts: the longer one is the upper part (body), the shorter one the lower part (grip)
  const refL = thin.map((b) => b.L).sort((a, b) => a - b);
  const ref = refL.length ? refL[Math.floor(refL.length / 2)] : null;
  thick.sort((a, b) => b.L - a.L);
  if (thick.length >= 2) {
    // the two biggest thick blobs; anything smaller stays unnamed
    const two = [...thick].sort((a, b) => b.area - a.area).slice(0, 2).sort((a, b) => b.L - a.L);
    two[0].label = 'body'; two[1].label = 'grip';
  } else if (thick.length === 1) {
    const t = thick[0];
    t.label = ref ? (t.L > ref * 0.95 ? 'body' : 'grip') : (t.L / t.W > 4.6 ? 'body' : 'grip');
  }
  return blobs;
}

// Share of surface pixels inside an oriented box (tells "picked up" from "covered by a hand").
export function surfaceShareInBox(res, box) {
  if (!res.bgMask) return 0;
  const { w, h } = res;
  const c = Math.cos(box.angle), s = Math.sin(box.angle);
  let tot = 0, bgc = 0;
  const hl = box.L / 2 * 0.8, hw = Math.max(1.5, box.W / 2);
  for (let u = -hl; u <= hl; u += 1) for (let v = -hw; v <= hw; v += 1) {
    const x = Math.round(box.cx + u * c - v * s), y = Math.round(box.cy + u * s + v * c);
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    tot++; if (res.bgMask[y * w + x]) bgc++;
  }
  return tot ? bgc / tot : 0;
}
