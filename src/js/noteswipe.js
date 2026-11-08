// noteswipe.js — swipe to the next or previous note while the note editor is open (Decision 419).
// The neighbour is a ghost page (title, a real read-only editor, count) that moves with the page on screen, edge to edge, and both
// continue at the finger's speed on release (timing of Decisions 404 and 405). The caller then swaps the live editor to the neighbour
// under the ghost, which leaves two frames later: nothing blank, nothing that jumps.
import '../css/noteswipe.css';
import { SWIPE_EASE, swipeMs } from './pageswipe.js';

// screen: the editor screen. movers(): the elements that make up the page (title, text, count). canStart(): false while the keyboard,
// the dictation panel or a text selection is up. has(step): is there a neighbour that way.
// prepare(step): saves the note on screen, builds the neighbour and resolves { el, data, dispose } or null (null also when the save failed).
// onCommit(step, data): swap the live editor to the neighbour, in this task. onStart(): the gesture became horizontal.
const REGION = '#editor-name, #editor-host, #editor-count';
const IGNORE = 'button, .cm-panels, .cm-thumb, .ev-pop, .ns-float, .dict-panel, input:not(#editor-name), textarea, select, a';

export function attachNoteSwipe({ screen, movers, canStart, has, prepare, onCommit, onStart = () => {} }) {
  const ghosts = new Map(), building = new Set();
  let st = null, leaving = false;
  const W = () => screen.clientWidth;
  const ease = (el, ms, to) => { if (el) { el.style.transition = ms ? `transform ${ms}ms ${SWIPE_EASE}` : 'none'; el.style.transform = to; } };
  const clearGhosts = () => { for (const g of ghosts.values()) { g.el.remove(); try { g.dispose(); } catch { /* gone anyway */ } } ghosts.clear(); };
  const rest = () => { for (const m of movers()) { m.style.transition = ''; m.style.transform = ''; } screen.classList.remove('ev-swiping'); };

  async function ensureGhost(step) {
    if (ghosts.has(step) || building.has(step)) return;
    building.add(step);
    let r = null;
    try { r = await prepare(step); } catch { r = null; }
    building.delete(step);
    if (!r) return;
    if (!screen.isConnected || (!st && !leaving)) { try { r.dispose(); } catch { /* gone anyway */ } r.el.remove(); return; }
    ghosts.set(step, r);
    ease(r.el, 0, `translateX(${step * W() + (st && (st.dx < 0 ? 1 : -1) === step ? st.dx : 0)}px)`);
  }
  const place = (dx) => {
    const step = dx < 0 ? 1 : -1, ok = has(step), x = ok ? dx : dx * 0.3;
    for (const m of movers()) ease(m, 0, `translateX(${x}px)`);
    for (const [s, g] of ghosts) ease(g.el, 0, `translateX(${s * W() + (s === step ? dx : 0)}px)`);
  };
  const settleBack = () => {
    for (const m of movers()) ease(m, 200, '');
    for (const [s, g] of ghosts) ease(g.el, 200, `translateX(${s * W()}px)`);
    setTimeout(() => { if (!leaving && !st) { clearGhosts(); rest(); } }, 220);
  };

  const onDown = (e) => {
    if (st && e.pointerId !== st.id) { const was = st; st = null; if (was.mode === 'h') settleBack(); return; } // a second finger: a pinch, not a swipe
    if (leaving || !e.isPrimary || !e.target.closest(REGION) || e.target.closest(IGNORE) || !canStart()) return;
    st = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, mode: null, samples: [[performance.now(), e.clientX]] };
  };
  const onMove = (e) => {
    if (!st || e.pointerId !== st.id) return;
    st.dx = e.clientX - st.x;
    const dy = e.clientY - st.y;
    if (!st.mode && (Math.abs(st.dx) > 8 || Math.abs(dy) > 8)) st.mode = Math.abs(st.dx) > Math.abs(dy) * 1.2 ? 'h' : 'v';
    if (st.mode === 'v') { st = null; return; }
    if (st.mode !== 'h') return;
    if (!st.captured) {
      st.captured = true; screen.classList.add('ev-swiping'); onStart();
      try { screen.setPointerCapture(e.pointerId); } catch { /* moves still arrive */ }
    }
    const t = performance.now();
    st.samples.push([t, e.clientX]);
    while (st.samples.length > 2 && t - st.samples[0][0] > 100) st.samples.shift();
    const step = st.dx < 0 ? 1 : -1;
    if (has(step)) ensureGhost(step);
    place(st.dx);
  };
  const onUp = (e) => {
    if (!st || e.pointerId !== st.id) return;
    const s = st; st = null;
    if (s.mode !== 'h') return;
    const step = s.dx < 0 ? 1 : -1, w = W();
    const [t0, x0] = s.samples[0], [t1, x1] = s.samples[s.samples.length - 1];
    const v = t1 > t0 ? (x1 - x0) / (t1 - t0) : 0; // px per ms, signed
    const flick = Math.abs(v) > 0.5 && Math.abs(s.dx) > 30 && Math.sign(v) === Math.sign(s.dx);
    const g = ghosts.get(step);
    if (e.type === 'pointerup' && (Math.abs(s.dx) > w * 0.2 || flick) && has(step) && g) {
      leaving = true;
      const ms = swipeMs(w - Math.abs(s.dx), v);
      for (const m of movers()) ease(m, ms, `translateX(${-step * w}px)`);
      ease(g.el, ms, 'translateX(0px)');
      setTimeout(() => {
        try { onCommit(step, g.data); } catch { /* the caller reports it */ }
        for (const m of movers()) { m.style.transition = 'none'; m.style.transform = ''; } // same task as the swap
        requestAnimationFrame(() => requestAnimationFrame(() => { clearGhosts(); rest(); leaving = false; })); // the ghost covers the first frames
      }, ms + 30);
    } else settleBack();
  };
  const ev = [['pointerdown', onDown], ['pointermove', onMove], ['pointerup', onUp], ['pointercancel', onUp]];
  for (const [n, f] of ev) screen.addEventListener(n, f);
  return {
    detach() { for (const [n, f] of ev) screen.removeEventListener(n, f); clearGhosts(); rest(); }
  };
}
