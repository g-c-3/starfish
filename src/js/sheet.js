// sheet.js — a dashboard dialog: a title with a Close button, a body, and a tap outside that closes it (Decision 450).
// It is a .modal-overlay shown and hidden with the hidden class, so it enters and leaves with the one motion recipe.
let n = 0;
export function openSheet({ title = '', build = () => {}, onClose = () => {} } = {}) {
  const ov = document.createElement('div');
  ov.className = 'modal-overlay sheet-overlay hidden'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
  const id = `sheet-title-${++n}`; ov.setAttribute('aria-labelledby', id);
  const box = document.createElement('div'); box.className = 'modal-box sheet-box';
  const head = document.createElement('div'); head.className = 'sheet-head';
  const h = document.createElement('h3'); h.id = id; h.textContent = title;
  const x = document.createElement('button'); x.type = 'button'; x.className = 'sheet-x'; x.setAttribute('aria-label', 'Close');
  x.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  head.append(h, x);
  const host = document.createElement('div'); host.className = 'sheet-body';
  box.append(head, host); ov.appendChild(box);
  let closed = false;
  const close = (value = null) => {
    if (closed) return; closed = true;
    ov.classList.add('hidden'); setTimeout(() => ov.remove(), 500); // after the exit has played
    onClose(value);
  };
  x.onclick = () => close(null);
  ov.addEventListener('click', (e) => { if (e.target === ov) close(null); });
  build(host, close);
  document.body.appendChild(ov); void ov.offsetWidth; ov.classList.remove('hidden');
  return { close, get closed() { return closed; } };
}
