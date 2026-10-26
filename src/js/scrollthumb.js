// scrollthumb.js — a draggable scroll handle for a scrolling list (Decision 296). It sits beside the list, shows while the list
// scrolls or the handle is dragged, and fades after a moment. Lists shorter than about one and a half screens get none.
// attachScrollThumb(scroller) -> { destroy() }. The scroller's parent must be positioned.
export function attachScrollThumb(scroller) {
  const host = scroller.parentElement;
  const thumb = document.createElement('div');
  thumb.className = 'ex-thumb';
  host.appendChild(thumb);
  let hideT = 0, dragging = false;
  const metrics = () => {
    const h = scroller.clientHeight, max = scroller.scrollHeight - h;
    return { h, max, ok: max >= h * 0.5 };
  };
  const place = (show) => {
    const { h, max, ok } = metrics();
    if (!ok) { thumb.classList.remove('on'); return; }
    const th = Math.max(44, h * h / scroller.scrollHeight);
    thumb.style.top = `${scroller.offsetTop}px`;
    thumb.style.height = `${th}px`;
    thumb.style.transform = `translateY(${(scroller.scrollTop / max) * (h - th)}px)`;
    if (!show) return;
    thumb.classList.add('on'); clearTimeout(hideT);
    if (!dragging) hideT = setTimeout(() => thumb.classList.remove('on'), 1200);
  };
  const onScroll = () => place(true);
  scroller.addEventListener('scroll', onScroll, { passive: true });
  thumb.addEventListener('pointerdown', (e) => { dragging = true; thumb.setPointerCapture(e.pointerId); e.preventDefault(); clearTimeout(hideT); });
  thumb.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const { h, max } = metrics(), th = thumb.offsetHeight;
    const top = scroller.getBoundingClientRect().top;
    const f = Math.min(1, Math.max(0, (e.clientY - top - th / 2) / (h - th)));
    scroller.scrollTop = f * max;
  });
  const endDrag = () => { dragging = false; place(true); };
  thumb.addEventListener('pointerup', endDrag);
  thumb.addEventListener('pointercancel', endDrag);
  return { destroy() { clearTimeout(hideT); scroller.removeEventListener('scroll', onScroll); thumb.remove(); } };
}
