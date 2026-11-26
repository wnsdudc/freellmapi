// Builds one animated USDZ per assembly step for iPhone AR Quick Look (real size, metres).
// Run tools/gen-usdz.html in a browser; window.genStep(i) returns the file as base64.
import * as THREE from '../vendor/three.module.min.js';
import { buildDesk, applyStepState, poseAt, stepDuration, ACCENT } from '../desk.js';
import { USDZAnimExporter } from './USDZAnimExporter.js';

const HL = new THREE.Color(ACCENT);

async function genStep(i) {
  const desk = buildDesk();
  const scene = new THREE.Scene();
  const holder = new THREE.Group();
  holder.scale.setScalar(0.01);                  // cm -> m
  scene.add(holder);
  holder.add(desk.pivot);
  holder.add(desk.layout);
  applyStepState(desk, i);
  const st = desk.steps[i];
  for (const p of st.parts) for (const m of p.mats) m.color.lerpColors(m.userData.base, HL, 0.6);
  for (const p of desk.parts) if (p.label) p.label.visible = false;
  desk.layout.traverse((o) => { if (o.isSprite) o.visible = false; });
  const moving = st.parts.length > 0 || st.flip;
  const dur = moving ? Math.max(3.5, stepDuration(desk, i) + 1.5) : 0;
  const options = { quickLookCompatible: true };
  if (moving) options.animation = { fps: 12, duration: dur, sample: (t) => poseAt(desk, i, t, { hideBeforeStart: false }) };
  poseAt(desk, i, 99, { hideBeforeStart: false });
  scene.updateMatrixWorld(true);
  const data = await new USDZAnimExporter().parse(scene, options);
  let bin = '';
  for (let k = 0; k < data.length; k += 0x8000) bin += String.fromCharCode.apply(null, data.subarray(k, k + 0x8000));
  return { b64: btoa(bin), bytes: data.length, key: st.key, animated: moving, seconds: dur };
}
window.genStep = genStep;
window.stepCount = buildDesk().steps.length;
