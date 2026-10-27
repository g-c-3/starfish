// gallerygrid.js — Gallery layout: items per row, set by a two-finger pinch on the grid. DOM only; the caller stores the value.
// Fingers together: more per row, up to 9. Fingers apart: fewer, down to 3.
export const MIN_COLS = 3, MAX_COLS = 9, DEFAULT_COLS = 3;
export const clampCols = (n) => Math.max(MIN_COLS, Math.min(MAX_COLS, Math.round(Number(n)) || DEFAULT_COLS));

export function applyCols(grid, n) {
  if (!grid) return;
  grid.style.setProperty('--cols', String(n));
  grid.dataset.cols = String(n);
  grid.dataset.dense = n >= 7 ? '2' : n >= 5 ? '1' : '0'; // smaller gaps and corners on small tiles
}

// A click right after a pinch is the last finger lifting, not a tap. The block is a short time window renewed by every pinch touch
// event, never a flag: a touch end that is not delivered (the touched tile was redrawn) cannot leave taps blocked.
let blockUntil = 0;
const renew = () => { blockUntil = Date.now() + 500; };
export const pinchBlocked = () => Date.now() < blockUntil;

// root: the list container (stays in the page; its grid is replaced on each draw).
// getCols(): current value. onCols(n): once, when the fingers lift.
export function attachGridPinch(root, { getCols, onCols }) {
  let base = null, cur = 0;
  const grid = () => root.querySelector('.thumb-grid');
  const d = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const finish = () => {
    const b = base;
    base = null;
    if (b && cur !== b.cols) onCols(cur);
  };
  root.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 2 || !grid()) return;
    const dist = d(e.touches);
    if (dist < 10) return;
    base = { d: dist, cols: getCols() };
    cur = base.cols;
    renew();
    e.preventDefault();
  }, { passive: false });
  root.addEventListener('touchmove', (e) => {
    if (!base || e.touches.length !== 2) return;
    e.preventDefault();
    renew();
    const next = clampCols(base.cols / (d(e.touches) / base.d));
    if (next !== cur) { cur = next; applyCols(grid(), cur); }
  }, { passive: false });
  // On the document: the touched tile may be gone from the page by the time the finger lifts.
  const end = (e) => {
    if (!base && !blockUntil) return;
    if (base) renew();
    if (base && e.touches.length < 2) finish();
  };
  document.addEventListener('touchend', end, true);
  document.addEventListener('touchcancel', end, true);
  root.addEventListener('click', (e) => {
    if (pinchBlocked()) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
}
