// Screen motion (Decisions 385 to 387). Watches the `hidden` class and acts after the change, so app logic sees the final state at once.
// Layers have a solid background: they push in over the page and pop out, no fade, so no page shows through.
// In-page views have none: the old one leaves, then the new one arrives (the reminder tab timing), so two pages never overlap.
// Only transform and opacity animate.
import '../css/motion.css';

const LAYERS = '#editor-screen, #viewer-screen, #explorer-screen, #phone-screen';
const DIALOGS = '.modal-overlay';
// In-page views by depth. A view that appears while another of the same parent goes away is a pair: deeper = forward, shallower = back.
const DEPTH = { 'home-main': 0, 'folder-view': 1, 'trash-view': 1, 'vault-main': 0, 'vault-trash-view': 1, 'vault-settings-view': 1, 'vault-folder-view': 1 };
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
const hasHidden = (cls) => !!cls && /(^|\s)hidden(\s|$)/.test(cls);
const FAILSAFE_MS = 500;
let running = 0;

function play(el, cls, cleanup) {
  el.classList.remove('mx-in', 'mx-out', 'mx-layer', 'mx-view', 'mx-after', 'mx-from-r', 'mx-from-l', 'mx-to-r', 'mx-to-l');
  void el.offsetWidth; // restart on a quick re-toggle
  el.classList.add(...cls);
  running++; document.documentElement.classList.add('mx-x'); // the page never scrolls sideways while a slide runs
  let over = false;
  const end = (e) => {
    if (over || (e && e.target !== el)) return;
    over = true;
    el.removeEventListener('animationend', end);
    el.classList.remove(...cls);
    if (cleanup) cleanup();
    if (--running <= 0) { running = 0; document.documentElement.classList.remove('mx-x'); }
  };
  el.addEventListener('animationend', end);
  setTimeout(() => end(), FAILSAFE_MS);
}

function locked() { // a lock must never be delayed or shown through an exit
  const lock = document.getElementById('lock-screen');
  return document.hidden || (lock && !lock.classList.contains('hidden'));
}

function layerOrDialog(el, was, now) {
  const layer = el.matches(LAYERS), dialog = !layer && el.matches(DIALOGS);
  if (!layer && !dialog) return false;
  if (was && !now) { // shown
    el.classList.remove('mx-out');
    if (layer) { try { el.style.setProperty('--mx-d', getComputedStyle(el).display); } catch { /* default applies */ } play(el, ['mx-in', 'mx-layer']); }
  } else if (!was && now && !locked()) { // hidden: stays painted while it slides or fades out
    if (!el.style.getPropertyValue('--mx-d')) el.style.setProperty('--mx-d', 'flex');
    play(el, layer ? ['mx-out', 'mx-layer'] : ['mx-out']);
  }
  return true;
}

new MutationObserver((records) => {
  if (reduced.matches) return;
  const shown = [], gone = [];
  for (const r of records) {
    const el = r.target;
    if (!(el instanceof HTMLElement)) continue;
    const was = hasHidden(r.oldValue), now = el.classList.contains('hidden');
    if (was === now || layerOrDialog(el, was, now)) continue;
    if (!(el.id in DEPTH)) continue;
    (was && !now ? shown : gone).push(el);
  }
  for (const inc of shown) {
    const out = gone.find((g) => g.parentElement === inc.parentElement && g.classList.contains('hidden'));
    const back = !!out && DEPTH[inc.id] < DEPTH[out.id];
    inc.classList.remove('mx-out');
    const pair = !!out && !locked() && !!inc.offsetParent;
    play(inc, ['mx-in', 'mx-view', back ? 'mx-from-l' : 'mx-from-r'].concat(pair ? ['mx-after'] : []));
    if (pair) { // the old view slides away over the new one, out of the page flow
      out.style.setProperty('--mx-d', 'block');
      const st = out.style;
      st.position = 'absolute'; st.top = inc.offsetTop + 'px'; st.left = inc.offsetLeft + 'px'; st.width = inc.offsetWidth + 'px';
      play(out, ['mx-out', 'mx-view', back ? 'mx-to-r' : 'mx-to-l'], () => { st.position = ''; st.top = ''; st.left = ''; st.width = ''; });
    }
  }
}).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });
