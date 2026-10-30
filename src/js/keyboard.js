// keyboard.js — makes room for the on-screen keyboard (Decision 336). DOM only.
// With the content padded by hand (ArklyCutoutBridge), the page shrinks to the space above the keyboard. This marks the body `kb-open`
// while it is shrunk, so keyboard.css can give dialogs that space, and scrolls the focused field into view once the keyboard is up.
import '../css/keyboard.css';

let baseH = window.innerHeight, baseW = window.innerWidth;

function update() {
  const w = window.innerWidth, h = window.innerHeight;
  if (Math.abs(w - baseW) > 40) { baseW = w; baseH = h; } // rotated: a new reference height
  if (h > baseH) baseH = h;
  if (document.body) document.body.classList.toggle('kb-open', h < baseH * 0.78);
}

function revealFocused() {
  const t = document.activeElement;
  if (!(t instanceof HTMLElement) || !t.matches('input, textarea, select')) return;
  if (t.closest('.cm-editor, #editor-screen') || t.id === 'search-input') return; // these keep their own caret handling
  try { t.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch { /* stays where it is */ }
}

let timer = 0;
const later = () => { clearTimeout(timer); timer = setTimeout(revealFocused, 300); };
window.addEventListener('resize', () => { update(); later(); });
document.addEventListener('focusin', later);
update();
