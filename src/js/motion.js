// Screen motion (Decisions 385 to 391). Watches the `hidden` class and acts after the change, so app logic sees the final state at once.
// One recipe for everything that opens or closes, the category one: the old page leaves (fade plus a short slide), then the new page arrives.
// Two pages never overlap, and nothing is a full-width slide. A file or the explorer opening over a page is the same: the page under it
// leaves, the file arrives; on close the file leaves, the page returns. Only transform and opacity animate.
import '../css/motion.css';

const LAYERS = '#editor-screen, #viewer-screen, #explorer-screen, #phone-screen, #explorer-viewer'; // every file or page that opens over another
const DIALOGS = '.modal-overlay';
// Pages by depth. A page that appears while another of the same parent goes away is a pair: deeper = forward, shallower = back.
const DEPTH = {
  'first-run-setup': -1, 'lock-screen': -1, 'main-screen': 0, 'vault-screen': 1,
  'home-tab': 0, 'settings-tab': 1,
  'vault-locked-view': 0, 'vault-pin-setup-view': 0, 'vault-content': 1,
  'home-main': 0, 'folder-view': 1, 'trash-view': 1,
  'vault-main': 0, 'vault-trash-view': 1, 'vault-settings-view': 1, 'vault-folder-view': 1,
};
const NO_EXIT = new Set(['vault-content']); // Vault content is never shown through an exit: a Vault lock hides it at once
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
const root = document.documentElement;
const hasHidden = (cls) => !!cls && /(^|\s)hidden(\s|$)/.test(cls);
const FAILSAFE_MS = 700;
let running = 0;
let lastY = 0; // where the page was scrolled before a change: the page that leaves stays where it was seen
window.addEventListener('scroll', () => { lastY = window.scrollY; }, { passive: true });

const ALL = ['mx-in', 'mx-out', 'mx-view', 'mx-after', 'mx-from-r', 'mx-from-l', 'mx-to-r', 'mx-to-l', 'mx-u-in', 'mx-u-out'];

function play(el, cls, cleanup) {
  el.classList.remove(...ALL);
  void el.offsetWidth; // restart on a quick re-toggle
  el.classList.add(...cls);
  running++; root.classList.add('mx-x'); // the page never scrolls sideways while a slide runs
  let over = false;
  const end = (e) => {
    if (over || (e && e.target !== el)) return;
    over = true;
    el.removeEventListener('animationend', end);
    el.classList.remove(...cls);
    if (cleanup) cleanup();
    if (--running <= 0) { running = 0; root.classList.remove('mx-x'); }
  };
  el.addEventListener('animationend', end);
  setTimeout(() => end(), FAILSAFE_MS);
}

function locked() { // a lock must never be delayed or shown through an exit
  const lock = document.getElementById('lock-screen');
  return document.hidden || (lock && !lock.classList.contains('hidden'));
}

// The page a layer opens over: the screen on view, or, for the explorer's file viewer, the explorer's own page.
function under(layer) {
  const list = layer.id === 'explorer-viewer'
    ? Array.from(layer.parentElement ? layer.parentElement.children : [])
    : Array.from(document.querySelectorAll('.screen'));
  return list.filter((u) => u instanceof HTMLElement && u !== layer && !u.classList.contains('hidden') && !u.classList.contains('mx-out'));
}

function layerOrDialog(el, was, now) {
  const layer = el.matches(LAYERS), dialog = !layer && el.matches(DIALOGS);
  if (!layer && !dialog) return false;
  if (was && !now) { // shown
    el.classList.remove('mx-out');
    if (layer) {
      try { el.style.setProperty('--mx-d', getComputedStyle(el).display); } catch { /* default applies */ }
      if (locked()) return true;
      const list = under(el); // the page under leaves and stays gone until the file has arrived
      list.forEach((u) => { u.classList.remove(...ALL); u.classList.add('mx-u-out'); });
      play(el, ['mx-in', 'mx-view', 'mx-from-r', 'mx-after'], () => list.forEach((u) => u.classList.remove('mx-u-out')));
    }
  } else if (!was && now && !locked()) { // hidden: stays painted while it leaves
    if (!el.style.getPropertyValue('--mx-d')) el.style.setProperty('--mx-d', 'flex');
    if (layer) under(el).forEach((u) => play(u, ['mx-u-in'])); // the page under returns once the file has left
    play(el, layer ? ['mx-out', 'mx-view', 'mx-to-r'] : ['mx-out']);
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
    const pair = !!out && !NO_EXIT.has(out.id) && !locked() && !!inc.offsetParent;
    const box = pair ? inc.getBoundingClientRect() : null; // measured before the arriving page gets its starting offset, or the old page would start displaced
    play(inc, ['mx-in', 'mx-view', back ? 'mx-from-l' : 'mx-from-r'].concat(pair ? ['mx-after'] : []));
    if (pair) {
      // The old page leaves over the viewport, exactly where it was seen. It is fixed, so a tall page (Settings) no longer stretches the
      // document: the new page is in view at once instead of sitting scrolled away until the animation ends.
      out.style.setProperty('--mx-d', 'block');
      const st = out.style;
      st.position = 'fixed';
      st.top = box.top + window.scrollY - lastY + 'px';
      st.left = box.left + 'px';
      st.width = box.width + 'px';
      play(out, ['mx-out', 'mx-view', back ? 'mx-to-r' : 'mx-to-l'], () => { st.position = ''; st.top = ''; st.left = ''; st.width = ''; });
    }
  }
}).observe(root, { subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });
