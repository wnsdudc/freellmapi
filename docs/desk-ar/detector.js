// Web worker: finds the QR code in a camera frame and returns its four corners.
importScripts('vendor/jsQR.js');
self.onmessage = (e) => {
  const { id, width, height, buffer } = e.data;
  let r = null;
  try {
    r = self.jsQR(new Uint8ClampedArray(buffer), width, height, { inversionAttempts: 'dontInvert' });
  } catch (err) { r = null; }
  self.postMessage({
    id,
    found: !!r,
    text: r ? r.data : null,
    loc: r ? {
      tl: r.location.topLeftCorner, tr: r.location.topRightCorner,
      br: r.location.bottomRightCorner, bl: r.location.bottomLeftCorner,
    } : null,
  });
};
