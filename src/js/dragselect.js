// dragselect.js — drag-to-select on a tile grid (Decision 323). DOM only; the caller owns the selection.
// begin() is called by the caller's long press, with the pressed tile already selected. While the finger stays down, every tile
// between that tile and the finger, in reading order, is selected on top of what was selected before the press; moving back
// shrinks the range. Near the top or bottom edge the scroller moves. A second finger or a lift ends the drag.
const EDGE = 80, MAX_STEP = 18, BLOCK_MS = 400;

let blockUntil = 0;
// A click right after a drag is the finger lifting, not a tap. A short window renewed by the drag, never a flag.
export const dragBlocked = () => Date.now() < blockUntil;

function scrollParent(el) {
  for (let p = el; p && p !== document.body; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return document.scrollingElement || document.documentElement;
}

// root: element holding the tiles. tileSel: CSS selector of one tile.
// getSel(): Set of ids selected now. idOf(tile): id of a tile.
// apply(nextSet, changedTiles): the new selection and the tiles whose state changed.
// Returns { begin(tile, x, y), active() }.
export function attachDragSelect(root, { tileSel, getSel, idOf, apply, onTouch }) {
  let d = null; // { list, index, base, anchor, lo, hi, x, y, raf }

  const rebuild = () => { d.list = [...root.querySelectorAll(tileSel)]; d.index = new Map(d.list.map((t, i) => [t, i])); };

  function update(i) {
    const lo = Math.min(d.anchor, i), hi = Math.max(d.anchor, i);
    if (lo === d.lo && hi === d.hi) return;
    const changed = [];
    for (let k = Math.min(lo, d.lo); k <= Math.max(hi, d.hi); k++) {
      const was = k >= d.lo && k <= d.hi, now = k >= lo && k <= hi;
      if (was !== now && d.list[k]) changed.push(d.list[k]);
    }
    d.lo = lo; d.hi = hi;
    const next = new Set(d.base);
    for (let k = lo; k <= hi; k++) if (d.list[k]) next.add(idOf(d.list[k]));
    apply(next, changed);
    if (onTouch) onTouch();
  }

  function hit() {
    if (!d) return;
    const under = document.elementFromPoint(d.x, d.y);
    const tile = under && under.closest(tileSel);
    if (!tile || !root.contains(tile)) return; // a gap or a header keeps the last range
    let i = d.index.get(tile);
    if (i === undefined) { rebuild(); i = d.index.get(tile); } // tiles added while dragging (more loaded)
    if (i !== undefined) update(i);
  }

  function loop() {
    if (!d) return;
    const sc = d.scroller;
    const vp = sc === document.scrollingElement || sc === document.documentElement;
    const top = vp ? 0 : Math.max(0, sc.getBoundingClientRect().top);
    const bottom = vp ? window.innerHeight : Math.min(window.innerHeight, sc.getBoundingClientRect().bottom);
    let step = 0;
    if (d.y < top + EDGE) step = -MAX_STEP * Math.min(1, (top + EDGE - d.y) / EDGE);
    else if (d.y > bottom - EDGE) step = MAX_STEP * Math.min(1, (d.y - (bottom - EDGE)) / EDGE);
    if (step) { sc.scrollTop += step; hit(); }
    d.raf = requestAnimationFrame(loop);
  }

  function stop() {
    if (!d) return;
    cancelAnimationFrame(d.raf);
    d = null;
    blockUntil = Date.now() + BLOCK_MS;
  }

  // Non-passive and permanent, so the page does not take the gesture over as a scroll once the drag has begun.
  root.addEventListener('touchmove', (e) => {
    if (!d) return;
    if (e.touches.length !== 1) { stop(); return; }
    e.preventDefault();
    blockUntil = Date.now() + BLOCK_MS;
    d.x = e.touches[0].clientX; d.y = e.touches[0].clientY;
    hit();
  }, { passive: false });
  const end = () => { if (d) stop(); };
  document.addEventListener('touchend', end, true);
  document.addEventListener('touchcancel', end, true);

  return {
    active: () => !!d,
    begin(tile, x, y) {
      stop();
      d = { list: [], index: new Map(), base: new Set(getSel()), anchor: 0, lo: 0, hi: 0, x, y, raf: 0, scroller: scrollParent(root) };
      rebuild();
      const a = d.index.get(tile);
      if (a === undefined) { d = null; return; }
      d.anchor = d.lo = d.hi = a;
      d.raf = requestAnimationFrame(loop);
    }
  };
}
