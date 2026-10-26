// pulltorefresh.js — a quiet pull-down-to-refresh for a scrolling list (Decision 296). A small round mark follows the pull and
// turns as it nears the threshold; letting go past it calls onRefresh(). Nothing moves the list itself, and it only reacts when the
// list is at the top and the finger moves mostly downward. attachPullToRefresh(scroller, { enabled(), onRefresh() }) -> { destroy() }.
// The scroller's parent must be positioned.
export function attachPullToRefresh(scroller, { enabled = () => true, onRefresh = () => {}, threshold = 72 } = {}) {
  const host = scroller.parentElement;
  const mark = document.createElement('div');
  mark.className = 'ex-ptr';
  mark.setAttribute('aria-hidden', 'true');
  mark.innerHTML = '<svg class="ic" viewBox="0 0 24 24"><use href="#i-refresh"/></svg>';
  host.appendChild(mark);
  let y0 = 0, x0 = 0, pulling = false, armed = false, spinT = 0;
  const show = (p) => { // p: 0..1
    mark.style.top = `${scroller.offsetTop + 6}px`;
    mark.style.opacity = String(Math.min(1, p * 1.2));
    mark.style.transform = `translateY(${Math.round(p * 18)}px) rotate(${Math.round(p * 270)}deg)`;
  };
  const hide = () => { mark.classList.remove('spin'); mark.style.opacity = '0'; mark.style.transform = 'translateY(0) rotate(0deg)'; };
  const onStart = (e) => {
    pulling = false; armed = false;
    if (e.touches.length !== 1 || scroller.scrollTop > 0 || !enabled()) return;
    y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; armed = true;
  };
  const onMove = (e) => {
    if (!armed) return;
    if (scroller.scrollTop > 0 || !enabled()) { armed = pulling = false; hide(); return; }
    const dy = e.touches[0].clientY - y0, dx = Math.abs(e.touches[0].clientX - x0);
    if (!pulling) {
      if (dy < 12) return;
      if (dx > dy) { armed = false; return; } // a sideways swipe
      pulling = true;
    }
    show(Math.min(1, Math.max(0, dy - 12) / threshold));
  };
  const onEnd = (e) => {
    if (!pulling) { armed = false; return; }
    const dy = (e.changedTouches[0]?.clientY ?? y0) - y0;
    pulling = armed = false;
    if (dy - 12 >= threshold && enabled() && scroller.scrollTop === 0) {
      mark.classList.add('spin'); mark.style.opacity = '1';
      onRefresh();
      clearTimeout(spinT); spinT = setTimeout(hide, 700);
    } else hide();
  };
  scroller.addEventListener('touchstart', onStart, { passive: true });
  scroller.addEventListener('touchmove', onMove, { passive: true });
  scroller.addEventListener('touchend', onEnd, { passive: true });
  scroller.addEventListener('touchcancel', () => { pulling = armed = false; hide(); }, { passive: true });
  return { destroy() { clearTimeout(spinT); mark.remove(); scroller.removeEventListener('touchstart', onStart); scroller.removeEventListener('touchmove', onMove); scroller.removeEventListener('touchend', onEnd); } };
}
