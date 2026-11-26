// QR-code marker tracking for the camera AR view (same method as the desk version):
// jsQR in a worker finds the code's corners; a region around the last position is searched at up to 3x,
// corners go through a One Euro filter, and the camera pose comes from the corner homography.
import * as THREE from './vendor/three.module.min.js';

class OneEuro {
  constructor(minCutoff = 0.4, beta = 0.01, dCutoff = 1.0) { Object.assign(this, { minCutoff, beta, dCutoff }); this.x = null; this.dx = 0; this.t = 0; }
  static alpha(cutoff, dt) { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); }
  reset() { this.x = null; this.dx = 0; }
  filter(x, t) {
    if (this.x === null) { this.x = x; this.t = t; return x; }
    const dt = Math.max(1e-3, (t - this.t) / 1000);
    this.t = t;
    const dx = (x - this.x) / dt;
    this.dx += OneEuro.alpha(this.dCutoff, dt) * (dx - this.dx);
    this.x += OneEuro.alpha(this.minCutoff + this.beta * Math.abs(this.dx), dt) * (x - this.x);
    return this.x;
  }
}

const MARKER_PTS = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
const FLIP = new THREE.Matrix4().makeScale(1, -1, -1);
const PLANE_TO_MODEL = new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0));

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

export class QRTracker {
  constructor({ video, camera, clock, accept = /desk-ar/i, focal = null }) {
    Object.assign(this, { video, camera, clock, accept });
    this.focalLocked = !!focal;
    this.focalRatio = focal || 0.78;
    this.focalSamples = [];
    this.worker = null;
    this.busy = false;
    this.job = null;
    this.misses = 0;
    this.cv = document.createElement('canvas');
    this.ctx = this.cv.getContext('2d', { willReadFrequently: true });
    this.filters = Array.from({ length: 8 }, () => new OneEuro());
    this.pose = { has: false, last: -1e9, pos: new THREE.Vector3(), quat: new THREE.Quaternion(), tPos: new THREE.Vector3(), tQuat: new THREE.Quaternion(), quad: null };
    this.everSeen = false;
    this.onFirstSeen = null;
    this.projKey = '';
  }
  start() {
    if (!this.worker) { this.worker = new Worker('./detector.js'); this.worker.onmessage = (e) => this.onDetect(e.data); }
  }
  // call once per animation frame; returns true while the marker pose is valid
  update(dt) {
    const now = this.clock();
    this.sendFrame(now);
    const p = this.pose;
    const on = p.has && now - p.last < 700;
    if (on) {
      const k = 1 - Math.exp(-dt / 0.06);
      p.pos.lerp(p.tPos, k);
      p.quat.slerp(p.tQuat, k);
    }
    return on;
  }
  matrix(out) { return out.compose(this.pose.pos, this.pose.quat, new THREE.Vector3(1, 1, 1)); }

  sendFrame(now) {
    const v = this.video;
    if (this.busy || !this.worker || v.readyState < 2) return;
    const vw = v.videoWidth, vh = v.videoHeight;
    if (!vw || !vh) return;
    let sx = 0, sy = 0, sw = vw, sh = vh;
    const p = this.pose;
    if (p.quad && now - p.last < 400 && this.misses < 3) {
      const xs = p.quad.map((q) => q[0]), ys = p.quad.map((q) => q[1]);
      const pad = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 0.55;
      sx = Math.max(0, Math.floor(Math.min(...xs) - pad)); sy = Math.max(0, Math.floor(Math.min(...ys) - pad));
      sw = Math.min(vw, Math.ceil(Math.max(...xs) + pad)) - sx; sh = Math.min(vh, Math.ceil(Math.max(...ys) + pad)) - sy;
    }
    const full = sw === vw && sh === vh;
    const s = full ? Math.min(1, 720 / Math.max(sw, sh)) : Math.min(3, 640 / Math.max(sw, sh));
    const w = Math.max(16, Math.round(sw * s)), h = Math.max(16, Math.round(sh * s));
    if (this.cv.width !== w || this.cv.height !== h) { this.cv.width = w; this.cv.height = h; }
    this.ctx.drawImage(v, sx, sy, sw, sh, 0, 0, w, h);
    const img = this.ctx.getImageData(0, 0, w, h);
    this.busy = true;
    this.job = { sx, sy, s, vw, vh, t: now };
    this.worker.postMessage({ width: w, height: h, buffer: img.data.buffer }, [img.data.buffer]);
  }

  onDetect(r) {
    this.busy = false;
    const job = this.job;
    if (!job || !r.found || (r.text && !this.accept.test(r.text))) { this.misses++; return; }
    this.misses = 0;
    const raw = [r.loc.tl, r.loc.tr, r.loc.br, r.loc.bl].map((q) => [job.sx + q.x / job.s, job.sy + q.y / job.s]);
    const now = this.clock();
    const p = this.pose;
    const fresh = !p.has || now - p.last > 600;
    if (fresh) this.filters.forEach((f) => f.reset());
    const pts = raw.map((q, i) => [this.filters[2 * i].filter(q[0], job.t), this.filters[2 * i + 1].filter(q[1], job.t)]);
    p.quad = raw;
    const M = this.solve(pts, job.vw, job.vh);
    if (!M) return;
    this.refineFocal(pts, job.vw, job.vh, M);
    M.decompose(p.tPos, p.tQuat, new THREE.Vector3());
    if (fresh) { p.pos.copy(p.tPos); p.quat.copy(p.tQuat); }
    p.has = true;
    p.last = now;
    if (!this.everSeen) { this.everSeen = true; if (this.onFirstSeen) this.onFirstSeen(); }
    this.setProjection(job.vw, job.vh);
  }

  solve(pts, vw, vh) {
    const H = homography(MARKER_PTS, pts);
    if (!H) return null;
    const f = this.focalRatio * Math.max(vw, vh), cx = vw / 2, cy = vh / 2;
    const n = [(H[0] - cx * H[6]) / f, (H[1] - cx * H[7]) / f, (H[2] - cx * H[8]) / f, (H[3] - cy * H[6]) / f, (H[4] - cy * H[7]) / f, (H[5] - cy * H[8]) / f, H[6], H[7], H[8]];
    const h1 = new THREE.Vector3(n[0], n[3], n[6]), h2 = new THREE.Vector3(n[1], n[4], n[7]), h3 = new THREE.Vector3(n[2], n[5], n[8]);
    let lam = 2 / (h1.length() + h2.length());
    if (h3.z * lam < 0) lam = -lam;
    h1.multiplyScalar(lam); h2.multiplyScalar(lam); h3.multiplyScalar(lam);
    const a = h1.clone().add(h2).normalize(), bb = h1.clone().sub(h2).normalize();
    const r1 = a.clone().add(bb).normalize(), r2 = a.clone().sub(bb).normalize(), r3 = r1.clone().cross(r2);
    return FLIP.clone().multiply(new THREE.Matrix4().makeBasis(r1, r2, r3).setPosition(h3)).multiply(PLANE_TO_MODEL);
  }

  refineFocal(pts, vw, vh, M) {
    if (this.focalLocked) return;
    if (Math.abs(new THREE.Vector3().setFromMatrixColumn(M, 1).z) > 0.94) return;
    const H = homography(MARKER_PTS, pts);
    if (!H) return;
    const cx = vw / 2, cy = vh / 2;
    const h1 = [H[0] - cx * H[6], H[3] - cy * H[6], H[6]], h2 = [H[1] - cx * H[7], H[4] - cy * H[7], H[7]];
    const a1 = h1[0] * h2[0] + h1[1] * h2[1], b1 = h1[2] * h2[2];
    const a2 = h1[0] ** 2 + h1[1] ** 2 - h2[0] ** 2 - h2[1] ** 2, b2 = h1[2] ** 2 - h2[2] ** 2;
    const w = -(a1 * b1 + a2 * b2) / (a1 * a1 + a2 * a2);
    if (!(w > 0)) return;
    const ratio = 1 / Math.sqrt(w) / Math.max(vw, vh);
    if (ratio < 0.5 || ratio > 1.3) return;
    this.focalSamples.push(ratio);
    if (this.focalSamples.length > 40) this.focalSamples.shift();
    if (this.focalSamples.length >= 8) this.focalRatio = [...this.focalSamples].sort((x, y) => x - y)[Math.floor(this.focalSamples.length / 2)];
  }

  setProjection(vw, vh, force = false) {
    const cw = window.innerWidth, ch = window.innerHeight;
    const key = `${vw}x${vh}@${cw}x${ch}@${this.focalRatio.toFixed(4)}`;
    if (key === this.projKey && !force) return;
    this.projKey = key;
    const s = Math.max(cw / vw, ch / vh);
    const f = this.focalRatio * Math.max(vw, vh) * s;
    const cxp = (vw / 2) * s + (cw - vw * s) / 2, cyp = (vh / 2) * s + (ch - vh * s) / 2;
    const near = 0.05, far = 200, cam = this.camera;
    cam.projectionMatrix.set(2 * f / cw, 0, 1 - 2 * cxp / cw, 0, 0, 2 * f / ch, 2 * cyp / ch - 1, 0, 0, 0, -(far + near) / (far - near), -2 * far * near / (far - near), 0, 0, -1, 0);
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    cam.position.set(0, 0, 0);
    cam.quaternion.identity();
    cam.updateMatrixWorld(true);
  }
  resetProjection() { this.projKey = ''; }
}
