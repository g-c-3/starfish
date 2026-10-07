// pdfmath.js — pure helpers for the PDF viewer (Decision 121). No DOM, no pdf.js: testable in Node.

const ZOOM_STEPS = [1, 1.5, 2, 3];
const ZOOM_MAX = 4; // pinch may go past the last button step
const MAX_CANVAS_PIXELS = 16e6; // backing-store cap per page; above this the pixel ratio is lowered

// CSS scale that fits a page of width pageW into the container, times the zoom step.
function fitScale(containerW, pageW, zoom = 1, gutter = 16) {
  if (!(containerW > 0) || !(pageW > 0)) return 1;
  return Math.max(0.1, ((containerW - gutter) / pageW) * zoom);
}

// Pixel ratio for a canvas of cssW x cssH: device ratio, capped at 2 and by the pixel budget; never below 1.
function canvasRatio(cssW, cssH, devicePixelRatio = 1) {
  let r = Math.min(Math.max(devicePixelRatio || 1, 1), 2);
  const px = cssW * cssH * r * r;
  if (px > MAX_CANVAS_PIXELS) r = Math.max(1, Math.sqrt(MAX_CANVAS_PIXELS / (cssW * cssH)));
  return r;
}

// Index (0-based) of the page under a scroll position. tops/heights are page offsets inside the scroller.
function pageAt(tops, heights, y) {
  if (!tops.length) return 0;
  let hit = 0;
  for (let i = 0; i < tops.length; i++) {
    if (tops[i] <= y) hit = i; else break;
  }
  if (y > tops[hit] + heights[hit] && hit < tops.length - 1) hit += 1; // in the gap below: next page
  return hit;
}

// Button step from any zoom, including a pinched one: next step above or below, clamped to the list.
function nextZoom(current, dir) {
  const eps = 0.01;
  if (dir > 0) return ZOOM_STEPS.find((z) => z > current + eps) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
  const lower = ZOOM_STEPS.filter((z) => z < current - eps);
  return lower.length ? lower[lower.length - 1] : ZOOM_STEPS[0];
}

// Zoom after a pinch of `ratio`, kept between 1 and ZOOM_MAX.
function pinchZoom(current, ratio) {
  return Math.min(ZOOM_MAX, Math.max(1, current * ratio));
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Plain message for a pdf.js load failure.
function pdfErrorMessage(err) {
  const name = String(err?.name || '');
  if (name === 'PasswordException') return 'This PDF is password-protected.';
  if (name === 'InvalidPDFException' || name === 'FormatError') return 'This PDF is damaged or not readable.';
  return `Could not open this PDF: ${err?.message || err}`;
}

export { ZOOM_STEPS, ZOOM_MAX, pinchZoom, fitScale, canvasRatio, pageAt, nextZoom, base64ToBytes, pdfErrorMessage };
