// gallerygrid.js — Gallery layout: items per row, set by a two-finger pinch on the grid. DOM only; the caller stores the value.
// Fingers apart: more per row. Fingers together: fewer, down to one.
export const MIN_COLS = 1, MAX_COLS = 10, DEFAULT_COLS = 3;
export const BIG_THUMB_COLS = 2; // at this many per row or fewer a tile is wide, so it gets a larger thumbnail
export const clampCols = (n) => Math.max(MIN_COLS, Math.min(MAX_COLS, Math.round(Number(n)) || DEFAULT_COLS));
export const colsLabel = (n) => (n === 1 ? '1 per row' : `${n} per row`);

export function applyCols(grid, n) {
  if (!grid) return;
  grid.style.setProperty('--cols', String(n));
  grid.dataset.cols = String(n);
  grid.dataset.dense = n >= 7 ? '2' : n >= 5 ? '1' : '0'; // smaller gaps and corners on small tiles
}

// root: the list container (stays in the page; its grid is replaced on each draw).
// getCols(): current value. onLive(n): during the pinch. onCols(n): once, when the fingers lift.
let pinched = false, blockUntil = 0;
// True while a pinch is on or just ended: a click then is the last finger lifting, not a tap.
export const pinchBlocked = () => pinched || Date.now() < blockUntil;
export function attachGridPinch(root, { getCols, onLive, onCols }) {
  let base = null, cur = 0;
  const grid = () => root.querySelector('.thumb-grid');
  const d = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const finish = () => {
    if (base && cur !== base.cols) onCols(cur);
    base = null;
  };
  root.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2 && grid()) {
      const dist = d(e.touches);
      if (dist < 10) return;
      base = { d: dist, cols: getCols() };
      cur = base.cols;
      pinched = true;
      e.preventDefault();
    }
  }, { passive: false });
  root.addEventListener('touchmove', (e) => {
    if (!base || e.touches.length !== 2) return;
    e.preventDefault();
    const next = clampCols(base.cols * (d(e.touches) / base.d));
    if (next !== cur) { cur = next; applyCols(grid(), cur); onLive(cur); }
  }, { passive: false });
  const end = (e) => {
    if (base && e.touches.length < 2) finish();
    if (!e.touches.length) { blockUntil = Date.now() + 400; pinched = false; }
  };
  root.addEventListener('touchend', end);
  root.addEventListener('touchcancel', end);
  // The finger that lifts last after a pinch must not open or select a tile.
  root.addEventListener('click', (e) => {
    if (pinchBlocked()) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
}
