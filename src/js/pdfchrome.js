// pdfchrome.js — a tap on the PDF page folds the four tools away and the next tap brings them back (Decision 362). DOM only.
// Scrolling, pinching, selecting text and any tap while editing are not taps for this purpose. Shared by the Home, Vault and File explorer viewers.

import '../css/pdfchrome.css';

const TAP_MOVE = 10; // px
const TAP_TIME = 450; // ms

function mountPdfChrome(body, scroll, { onActivity = () => {} } = {}) {
  let down = null;
  const onDown = (e) => {
    if (!e.isPrimary) { down = null; return; } // a second finger: a pinch
    if (e.pointerType === 'mouse' && e.button !== 0) { down = null; return; }
    down = { id: e.pointerId, x: e.clientX, y: e.clientY, t: Date.now(), ok: !body.classList.contains('pdf-marking') && !e.target.closest('.pdf-mark-layer.active') };
  };
  const onMove = (e) => { if (down && e.pointerId === down.id && Math.hypot(e.clientX - down.x, e.clientY - down.y) > TAP_MOVE) down = null; };
  const onUp = (e) => {
    const d = down; down = null;
    if (!d || !d.ok || e.pointerId !== d.id || Date.now() - d.t > TAP_TIME) return;
    const sel = window.getSelection ? String(window.getSelection()) : '';
    if (sel) return; // a text selection is in progress
    onActivity();
    // Edit mode may claim the tap (a mark was tapped): it then does not fold the tools.
    if (!body.dispatchEvent(new CustomEvent('arkly-pdf-tap', { detail: { x: e.clientX, y: e.clientY }, cancelable: true }))) return;
    const hidden = body.classList.toggle('pdf-tools-hidden');
    // the title bar goes and comes with the tools (Decision 380)
    const bar = body.closest('#viewer-screen, #explorer-viewer');
    if (bar) bar.querySelector('.editor-bar')?.classList.toggle('bar-folded', hidden);
  };
  const cancel = () => { down = null; };
  scroll.addEventListener('pointerdown', onDown, { passive: true });
  scroll.addEventListener('pointermove', onMove, { passive: true });
  scroll.addEventListener('pointerup', onUp, { passive: true });
  scroll.addEventListener('pointercancel', cancel, { passive: true });
  return {
    destroy() {
      scroll.removeEventListener('pointerdown', onDown);
      scroll.removeEventListener('pointermove', onMove);
      scroll.removeEventListener('pointerup', onUp);
      scroll.removeEventListener('pointercancel', cancel);
      body.classList.remove('pdf-tools-hidden');
      body.closest('#viewer-screen, #explorer-viewer')?.querySelector('.editor-bar')?.classList.remove('bar-folded');
    }
  };
}

export { mountPdfChrome };
