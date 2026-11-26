// Synthetic "camera" pictures of each part held over a desk, for testing the recognizer without the real pen.
// Random desk colour/texture, lighting, distance, angle, and sometimes a hand-coloured blob holding the part.
import * as THREE from '../vendor/three.module.min.js';
import { buildPen, applyStepState } from '../pen.js';

let R = null;
function rng(seed) { let s = seed * 9301 + 49297; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; }

function setup() {
  if (R) return R;
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const hemi = new THREE.HemisphereLight(0xffffff, 0x666666, 1.5);
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  scene.add(hemi, sun);
  const pen = buildPen();
  applyStepState(pen, pen.steps.length - 1);          // assembled
  pen.root.position.set(-19, -8, 0);
  const holder = new THREE.Group();
  holder.add(pen.root);
  scene.add(holder);
  const bgCanvas = document.createElement('canvas');
  bgCanvas.width = bgCanvas.height = 256;
  const bgTex = new THREE.CanvasTexture(bgCanvas);
  bgTex.colorSpace = THREE.SRGBColorSpace;
  scene.background = bgTex;
  const hand = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshStandardMaterial({ color: 0xd9a07c, roughness: 0.7 }));
  scene.add(hand);
  const camera = new THREE.PerspectiveCamera(45, 1, 1, 3000);
  R = { renderer, scene, pen, holder, camera, hemi, sun, bgCanvas, bgTex, hand };
  return R;
}

function paintBackground(ctx, r) {
  const tones = [[200, 170, 130], [225, 225, 222], [120, 90, 60], [180, 186, 190], [240, 238, 230], [90, 96, 104]];
  const t = tones[Math.floor(r() * tones.length)];
  ctx.fillStyle = `rgb(${t[0]},${t[1]},${t[2]})`;
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 60; i++) {           // grain / clutter
    const a = 0.03 + r() * 0.06;
    ctx.fillStyle = `rgba(${r() > 0.5 ? 0 : 255},${r() > 0.5 ? 0 : 255},${r() > 0.5 ? 0 : 255},${a})`;
    ctx.fillRect(r() * 256, r() * 256, 4 + r() * 60, 2 + r() * 14);
  }
}

// cls: none | pen | body | grip | black | red | blue
export function renderSample(cls, seed, w = 224, h = 224, frame = 0, cy = 0.5) {
  const S = setup();
  const r = rng(seed + 1);
  const j = rng(seed * 31 + frame * 977 + 5);   // small frame-to-frame wobble, like a hand-held video
  S.renderer.setSize(w, h, false);
  S.camera.aspect = w / h;
  S.camera.updateProjectionMatrix();
  paintBackground(S.bgCanvas.getContext('2d'), r);
  S.bgTex.needsUpdate = true;
  const show = { pen: ['body', 'grip', 'black', 'red', 'blue'], body: ['body'], grip: ['grip'], black: ['black'], red: ['red'], blue: ['blue'], none: [] }[cls];
  for (const p of S.pen.parts) {
    p.obj.visible = show.includes(p.id);
    p.obj.position.copy(p.movers[0].final);
  }
  // single parts are centred on their own length
  const centre = { pen: 19, body: 46, grip: -25, black: 4, red: 4, blue: 4, none: 0 }[cls];
  S.pen.root.position.set(-centre, -8, 0);
  if (['black', 'red', 'blue'].includes(cls)) { const f = S.pen.byId[cls].movers[0].final; S.pen.root.position.y -= f.y; S.pen.root.position.z = -f.z; }
  S.holder.rotation.set((r() - 0.5) * 1.2, (r() - 0.5) * 0.8, (r() - 0.5) * 1.6 + (r() > 0.5 ? Math.PI : 0));
  S.holder.rotation.x += r() * Math.PI * 2 * 0.3;
  if (frame) { S.holder.rotation.x += (j() - 0.5) * 0.12; S.holder.rotation.z += (j() - 0.5) * 0.08; }
  const dist = 170 + r() * 110;
  S.camera.position.set((r() - 0.5) * 30 + (frame ? (j() - 0.5) * 8 : 0), (r() - 0.5) * 30 + (frame ? (j() - 0.5) * 8 : 0), dist);
  S.camera.lookAt(0, 0, 0);
  S.hemi.intensity = 0.9 + r() * 1.2;
  S.sun.intensity = 1 + r() * 2;
  S.sun.color.setHSL(0.1 + r() * 0.05, 0.3 * r(), 0.9);
  S.sun.position.set((r() - 0.5) * 400, 300, 200);
  const handOn = cls !== 'none' ? r() > 0.4 : r() > 0.5;
  S.hand.visible = handOn;
  S.hand.scale.set(22 + r() * 10, 14 + r() * 6, 12);
  S.hand.position.set((r() > 0.5 ? 1 : -1) * (40 + r() * 30), -20 + r() * 20, -10);
  if (cy !== 0.5) S.camera.setViewOffset(w, h, 0, (0.5 - cy) * h, w, h); else S.camera.clearViewOffset();
  S.renderer.render(S.scene, S.camera);
  // sensor noise
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const ctx = out.getContext('2d');
  ctx.drawImage(S.renderer.domElement, 0, 0);
  const img = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) { const n = ((frame ? j() : r()) - 0.5) * 18; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n; }
  ctx.putImageData(img, 0, 0);
  return out;
}
window.renderSample = renderSample;
