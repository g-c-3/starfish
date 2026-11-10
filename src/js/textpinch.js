// textpinch.js — pinch to change the text size of a code view (Decision 445).

// Two fingers on the text change its size, following the fingers (Decisions 443, 445); the same rule as a note. Used by the Files text
// viewer and the File explorer's text view. host: the element that holds the editor; ed: a code editor. Returns a function that removes it.
export function attachTextPinch(host, ed) {
  let start = null, raf = 0, want = 0;
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const onStart = (e) => { if (e.touches.length === 2) start = { d: dist(e.touches), size: ed.getSize().size }; };
  const onMove = (e) => {
    if (!start || e.touches.length !== 2) return;
    e.preventDefault();
    want = start.size * (dist(e.touches) / start.d);
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; ed.setSize(want); });
  };
  const onEnd = (e) => { if (e.touches.length < 2) start = null; };
  host.addEventListener('touchstart', onStart, { passive: true });
  host.addEventListener('touchmove', onMove, { passive: false });
  host.addEventListener('touchend', onEnd, { passive: true });
  host.addEventListener('touchcancel', onEnd, { passive: true });
  return () => { if (raf) cancelAnimationFrame(raf); host.removeEventListener('touchstart', onStart); host.removeEventListener('touchmove', onMove); host.removeEventListener('touchend', onEnd); host.removeEventListener('touchcancel', onEnd); };
}
