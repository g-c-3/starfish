// chrome-scroll.js — scrolling down folds the viewer's title bar, scrolling up (or reaching the top) brings it back (Decision 235).
// root: where the scroll events are caught (they do not bubble, so they are caught on the way down); selector: which scroll areas count;
// onChrome(hidden): the shell's callback. Direction is judged over a short run, and events right after a change are ignored,
// because the change moves the scroll area.
export function chromeOnScroll(root, onChrome, selector) {
  if (!onChrome) return () => {};
  const last = new WeakMap(); let acc = 0; let hidden = false; let quiet = 0;
  const set = (h) => { if (h === hidden) return; hidden = h; quiet = Date.now() + 450; acc = 0; onChrome(h); };
  const on = (e) => {
    const t = e.target;
    if (!t || t.nodeType !== 1 || !t.matches(selector)) return;
    const top = t.scrollTop; const prev = last.has(t) ? last.get(t) : top; last.set(t, top);
    if (Date.now() < quiet) return;
    if (top < 12) { set(false); return; }
    const dy = top - prev; if (!dy) return;
    acc = (acc > 0) === (dy > 0) ? acc + dy : dy;
    if (acc > 28) set(true); else if (acc < -28) set(false);
  };
  root.addEventListener('scroll', on, true);
  return () => root.removeEventListener('scroll', on, true);
}
