// Builds one animated USDZ per assembly step for iPhone AR Quick Look.
// The pen is enlarged 4x (about 60 cm long) so it reads on a floor; Quick Look lets people pinch to resize.
// Run tools/gen-usdz.html in a browser; window.genStep(i) returns the file as base64.
import * as THREE from '../vendor/three.module.min.js';
import { buildPen, applyStepState, poseAt, stepDuration, ACCENT } from '../pen.js';
import { USDZAnimExporter } from './USDZAnimExporter.js';

const HL = new THREE.Color(ACCENT);
const SCALE = 0.004;            // metres per mm

async function genStep(i) {
  const pen = buildPen();
  const scene = new THREE.Scene();
  const holder = new THREE.Group();
  holder.scale.setScalar(SCALE);
  holder.position.x = -19 * SCALE;
  scene.add(holder);
  holder.add(pen.root, pen.layout);
  applyStepState(pen, i);
  const st = pen.steps[i];
  for (const p of st.parts) for (const m of p.mats) m.color.lerpColors(m.userData.base, HL, 0.55);
  const moving = st.parts.length > 0 || st.check;
  const dur = moving ? Math.max(3.6, stepDuration(pen, i) + 1.5) : 0;
  const options = { quickLookCompatible: true };
  if (moving) options.animation = { fps: 12, duration: dur, sample: (t) => poseAt(pen, i, t, { hideBeforeStart: false }) };
  poseAt(pen, i, st.check ? 0 : 99, { hideBeforeStart: false });
  scene.updateMatrixWorld(true);
  const data = await new USDZAnimExporter().parse(scene, options);
  let bin = '';
  for (let k = 0; k < data.length; k += 0x8000) bin += String.fromCharCode.apply(null, data.subarray(k, k + 0x8000));
  return { b64: btoa(bin), bytes: data.length, key: st.key, animated: moving, seconds: dur };
}
window.genStep = genStep;
window.stepCount = buildPen().steps.length;
