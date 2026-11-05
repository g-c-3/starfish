// Screen motion (Decisions 385 to 389). Watches the `hidden` class and acts after the change, so app logic sees the final state at once.
// Layers (a file, the explorer, the editor) have a solid background: they push in over the page, with a soft edge shadow and a light
// dim of the page beneath, and pop out. No page shows through.
// Pages without a background (folders, Trash, Settings, Vault, Home) leave first and the next arrives, so two pages never overlap.
// Only transform and opacity animate.
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

const ALL = ['mx-in', 'mx-out', 'mx-layer', 'mx-view', 'mx-after', 'mx-from-r', 'mx-from-l', 'mx-to-r', 'mx-to-l'];

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

let dimTimer = 0;
function dim(dir) { // the page under a layer darkens slightly as the layer arrives and clears as it leaves
  root.classList.remove('mx-dim-in', 'mx-dim-out');
  void root.offsetWidth;
  root.classList.add(dir === 'in' ? 'mx-dim-in' : 'mx-dim-out');
  clearTimeout(dimTimer);
  dimTimer = setTimeout(() => root.classList.remove('mx-dim-in', 'mx-dim-out'), 480);
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
    if (layer) { try { el.style.setProperty('--mx-d', getComputedStyle(el).display); } catch { /* default applies */ } dim('in'); play(el, ['mx-in', 'mx-layer']); }
  } else if (!was && now && !locked()) { // hidden: stays painted while it slides or fades out
    if (!el.style.getPropertyValue('--mx-d')) el.style.setProperty('--mx-d', 'flex');
    if (layer) dim('out');
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
    const pair = !!out && !NO_EXIT.has(out.id) && !locked() && !!inc.offsetParent;
    play(inc, ['mx-in', 'mx-view', back ? 'mx-from-l' : 'mx-from-r'].concat(pair ? ['mx-after'] : []));
    if (pair) { // the old page leaves out of the page flow, where it was seen, so the new one never shifts
      out.style.setProperty('--mx-d', 'block');
      const st = out.style;
      const screen = out.classList.contains('screen');
      const shift = lastY - window.scrollY; // the page got shorter and the browser moved the scroll: put the old page back
      st.position = screen ? 'fixed' : 'absolute';
      st.top = screen ? -lastY + 'px' : inc.offsetTop - shift + 'px';
      st.left = screen ? '0px' : inc.offsetLeft + 'px';
      st.width = screen ? '100%' : inc.offsetWidth + 'px';
      play(out, ['mx-out', 'mx-view', back ? 'mx-to-r' : 'mx-to-l'], () => { st.position = ''; st.top = ''; st.left = ''; st.width = ''; });
    }
  }
}).observe(root, { subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });
