// pdfcompose-ui.js — order sheet and picture conversion for Merge PDFs and Make a PDF from pictures (Decision 168). DOM only.
// Nothing is stored: the sheet holds the list in memory and is removed when it closes.

import '../css/pdfpages.css';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// items: [{ id, label }] in the order selected. Resolves { ids, name } in the order set, or null on Cancel, Back or a lock.
// hooks: { open(finish), close() } let the app route Back and locks to finish(null).
function askCompose({ title, text = '', items, name = '', ok = 'Make PDF', hooks = {} }) {
  return new Promise((resolve) => {
    const order = items.slice();
    const el = document.createElement('div');
    el.className = 'modal-overlay pdf-compose';
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
    el.innerHTML = `<div class="modal-box"><h3>${esc(title)}</h3><p>${esc(text)}</p><div class="pdf-cp-list"></div>
      <input class="pdf-cp-name" type="text" autocomplete="off" placeholder="Name" aria-label="Name" value="${esc(name)}">
      <div class="sheet-actions"><button type="button" class="pdf-cp-cancel secondary-btn">Cancel</button><button type="button" class="pdf-cp-ok">${esc(ok)}</button></div></div>`;
    document.body.append(el);
    const list = el.querySelector('.pdf-cp-list'), input = el.querySelector('.pdf-cp-name');
    const paint = () => {
      list.innerHTML = order.map((it, i) => `<div class="pdf-cp-row"><span class="pdf-cp-n">${i + 1}</span><span class="pdf-cp-label">${esc(it.label)}</span>
        <button type="button" data-i="${i}" data-d="-1" aria-label="Move earlier"${i === 0 ? ' disabled' : ''}>▲</button>
        <button type="button" data-i="${i}" data-d="1" aria-label="Move later"${i === order.length - 1 ? ' disabled' : ''}>▼</button></div>`).join('');
    };
    const finish = (v) => {
      if (!el.isConnected) return;
      el.remove();
      if (hooks.close) hooks.close();
      resolve(v);
    };
    list.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || b.disabled) return;
      const i = Number(b.dataset.i), j = i + Number(b.dataset.d);
      if (j < 0 || j >= order.length) return;
      [order[i], order[j]] = [order[j], order[i]];
      paint();
    });
    el.querySelector('.pdf-cp-cancel').onclick = () => finish(null);
    el.querySelector('.pdf-cp-ok').onclick = () => { const n = input.value.trim(); if (!n) { input.focus(); return; } finish({ ids: order.map((it) => it.id), name: n }); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.querySelector('.pdf-cp-ok').click(); });
    paint();
    if (hooks.open) hooks.open(finish);
  });
}

// Any picture the WebView can decode, to JPEG bytes: the camera's orientation is applied, transparency becomes white,
// and the long side is limited to `maxSide` so one large picture does not exhaust memory.
async function toJpegBytes(bytes, maxSide = 3000) {
  const bmp = await createImageBitmap(new Blob([bytes]), { imageOrientation: 'from-image' });
  try {
    const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('A picture could not be converted'))), 'image/jpeg', 0.9));
    c.width = 0; c.height = 0;
    return new Uint8Array(await blob.arrayBuffer());
  } finally { if (bmp.close) bmp.close(); }
}

export { askCompose, toJpegBytes };
