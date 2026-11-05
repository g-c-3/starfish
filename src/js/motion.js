// Screen motion (Decision 385). Watches the `hidden` class: layers and dialogs slide/fade in and out, in-page views fade in.
// Only transform and opacity animate. No app.js hook: the class change is read after it happened, so app logic sees the final state at once.
import '../css/motion.css';

const LAYERS = '#editor-screen, #viewer-screen, #explorer-screen, #phone-screen';
const DIALOGS = '.modal-overlay';
const VIEWS = '#folder-view, #trash-view, #vault-trash-view, #vault-settings-view, #vault-folder-view, #vault-locked-view, #vault-pin-setup-view';
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
const hasHidden = (cls) => !!cls && /(^|\s)hidden(\s|$)/.test(cls);
const FAILSAFE_MS = 450;

function run(el, cls) {
  el.classList.remove('mx-in', 'mx-out');
  void el.offsetWidth; // restart the animation on a quick re-toggle
  el.classList.add(cls);
  const done = (e) => { if (e && e.target !== el) return; el.classList.remove(cls); el.removeEventListener('animationend', done); };
  el.addEventListener('animationend', done);
  setTimeout(() => { el.classList.remove(cls); el.removeEventListener('animationend', done); }, FAILSAFE_MS);
}

function locked() { // a lock must never be delayed or shown through an exit
  const lock = document.getElementById('lock-screen');
  return document.hidden || (lock && !lock.classList.contains('hidden'));
}

new MutationObserver((records) => {
  if (reduced.matches) return;
  for (const r of records) {
    const el = r.target;
    if (!(el instanceof HTMLElement)) continue;
    const was = hasHidden(r.oldValue), now = el.classList.contains('hidden');
    if (was === now) continue;
    const layer = el.matches(LAYERS), dialog = !layer && el.matches(DIALOGS), view = !layer && !dialog && el.matches(VIEWS);
    if (!layer && !dialog && !view) continue;
    if (was && !now) { // shown
      el.classList.remove('mx-out');
      if (layer || view) { try { el.style.setProperty('--mx-d', getComputedStyle(el).display); } catch { /* default applies */ } }
      if (layer || view) run(el, 'mx-in');
    } else if (!was && now && !view && !locked()) { // hidden: keep it on screen while it animates out
      el.style.setProperty('--mx-d', el.style.getPropertyValue('--mx-d') || 'flex');
      run(el, 'mx-out');
    }
  }
}).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });
