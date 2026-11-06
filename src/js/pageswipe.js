// pageswipe.js — swipe between the pages of one viewer (Decision 405).
// The neighbour page is built ahead and moves with the page on screen, edge to edge: nothing blank between them.
// On release both continue at the finger's speed (same timing as the image carousel, Decision 404); the viewer then
// redraws itself with the neighbour's entry, whose markup is the same as the ghost's, so the swap is invisible.

export const SWIPE_EASE = 'cubic-bezier(0.3, 0.4, 0.35, 1)'; // first slope 4/3, soft stop
// Time that keeps the first frame after release near the finger's speed: 4/3 x distance / speed, held in 300..420 ms.
export const swipeMs = (distance, speed) => Math.round(Math.min(420, Math.max(300, (4 / 3) * distance / Math.max(Math.abs(speed), 0.8))));

// body: the viewer body. pageSel: the one page element inside it. canGo(step): is there a neighbour that way.
// ghostHtml(step): the neighbour's page markup (inner, same as the page's), or null. onCommit(step): move to it and redraw.
// ignoreSel: touches that start on these are never a swipe (player controls, a map). Returns { detach, settle }.
export function attachPageSwipe({ body, pageSel, canGo, ghostHtml, onCommit, ignoreSel = 'button, input, select, a' }) {
  const ghosts = new Map(), building = new Set();
  let st = null, leaving = false;
  const W = () => body.clientWidth;
  const page = () => body.querySelector(`${pageSel}:not(.pg-ghost)`);
  const clearGhosts = () => { for (const g of ghosts.values()) g.remove(); ghosts.clear(); };
  const ease = (el, ms, to) => { if (el) { el.style.transition = ms ? `transform ${ms}ms ${SWIPE_EASE}` : 'none'; el.style.transform = to; } };

  async function ensureGhost(step) {
    if (ghosts.has(step) || building.has(step)) return;
    building.add(step);
    let html = null;
    try { html = await ghostHtml(step); } catch { html = null; }
    building.delete(step);
    if (html == null || !body.isConnected || (!st && !leaving)) return;
    const g = document.createElement('div');
    g.className = `${pageSel.replace(/^\./, '')} pg-ghost`;
    g.setAttribute('aria-hidden', 'true');
    g.innerHTML = html.replace(/\sid="[^"]*"/g, ''); // the page on screen owns the ids
    const cs = getComputedStyle(body);
    g.style.cssText = `position:absolute;left:${parseFloat(cs.paddingLeft) || 0}px;right:${parseFloat(cs.paddingRight) || 0}px;top:${body.scrollTop + (parseFloat(cs.paddingTop) || 0)}px;pointer-events:none;will-change:transform;transform:translateX(${step * W() + (st ? st.dx : 0)}px)`;
    body.appendChild(g);
    ghosts.set(step, g);
  }
  const place = (dx) => {
    const step = dx < 0 ? 1 : -1, ok = canGo(step);
    ease(page(), 0, `translateX(${ok ? dx : dx * 0.3}px)`);
    for (const [s, g] of ghosts) ease(g, 0, `translateX(${s * W() + (s === step ? dx : 0)}px)`);
  };
  const settleBack = () => {
    ease(page(), 200, '');
    for (const [s, g] of ghosts) ease(g, 200, `translateX(${s * W()}px)`);
    setTimeout(() => { if (!leaving && !st) clearGhosts(); }, 220);
  };

  const onDown = (e) => {
    if (leaving || !page() || !e.isPrimary || e.target.closest(ignoreSel)) return;
    st = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, mode: null, samples: [[performance.now(), e.clientX]] };
  };
  const onMove = (e) => {
    if (!st || e.pointerId !== st.id) return;
    st.dx = e.clientX - st.x;
    const dy = e.clientY - st.y;
    if (!st.mode && (Math.abs(st.dx) > 8 || Math.abs(dy) > 8)) st.mode = Math.abs(st.dx) > Math.abs(dy) * 1.2 ? 'h' : 'v';
    if (st.mode === 'v') { st = null; return; }
    if (st.mode !== 'h') return;
    if (!st.captured) { st.captured = true; try { body.setPointerCapture(e.pointerId); } catch { /* moves still arrive */ } }
    const t = performance.now();
    st.samples.push([t, e.clientX]);
    while (st.samples.length > 2 && t - st.samples[0][0] > 100) st.samples.shift();
    const step = st.dx < 0 ? 1 : -1;
    if (canGo(step)) ensureGhost(step);
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
    if (e.type === 'pointerup' && (Math.abs(s.dx) > w * 0.2 || flick) && canGo(step) && g) {
      leaving = true;
      const ms = swipeMs(w - Math.abs(s.dx), v);
      ease(page(), ms, `translateX(${-step * w}px)`);
      ease(g, ms, 'translateX(0px)');
      setTimeout(async () => {
        try { await onCommit(step); } finally { leaving = false; clearGhosts(); }
      }, ms + 30);
    } else settleBack();
  };
  const ev = [['pointerdown', onDown], ['pointermove', onMove], ['pointerup', onUp], ['pointercancel', onUp]];
  for (const [n, f] of ev) body.addEventListener(n, f);
  body.classList.add('vv-swipe');
  const prevPos = body.style.position;
  body.style.position = 'relative';
  return {
    // Called by the redraw right after it replaced the markup, in the same task: the new page starts at the top.
    settle() { if (leaving) body.scrollTop = 0; },
    detach() {
      for (const [n, f] of ev) body.removeEventListener(n, f);
      clearGhosts(); body.classList.remove('vv-swipe'); body.style.position = prevPos;
    }
  };
}
