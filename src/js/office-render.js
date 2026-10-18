// office-render.js — draws what office-read.js returns into the explorer viewer (Decision 226). Every string from a file
// is set with textContent; no markup from a file is ever parsed. Pictures become object URLs, revoked on destroy.

import { readDocx, readXlsx, readPptx, colName, OfficeError, DOC_BLOCK_MAX, SHEET_ROW_MAX, SHEET_COL_MAX } from './office-read.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

function urls() {
  const made = new Map();
  return {
    get(path, media) {
      const m = media[path];
      if (!m) return null;
      if (!made.has(path)) made.set(path, URL.createObjectURL(new Blob([m.bytes], { type: m.mime })));
      return made.get(path);
    },
    revoke() { for (const u of made.values()) URL.revokeObjectURL(u); made.clear(); }
  };
}

function appendRuns(parent, runs, media, u) {
  for (const r of runs) {
    if (r.br) { parent.appendChild(document.createElement('br')); continue; }
    if (r.img) {
      const src = u.get(r.img, media);
      if (src) { const im = el('img', 'eo-img'); im.alt = ''; im.src = src; parent.appendChild(im); }
      continue;
    }
    let node = el('span', '', r.text);
    if (r.sup) { const s = el('sup'); s.appendChild(node); node = s; } else if (r.sub) { const s = el('sub'); s.appendChild(node); node = s; }
    if (r.b) node.style.fontWeight = '700';
    if (r.i) node.style.fontStyle = 'italic';
    const deco = [r.u ? 'underline' : '', r.s ? 'line-through' : ''].filter(Boolean).join(' ');
    if (deco) node.style.textDecoration = deco;
    if (r.text && r.text.includes('\t')) node.style.whiteSpace = 'pre-wrap';
    parent.appendChild(node);
  }
}

// ---- docx: one scrolling page ----
function docxBlocks(blocks, parent, media, u) {
  for (const b of blocks) {
    if (b.t === 'table') {
      const wrap = el('div', 'eo-tablewrap'); const t = el('table', 'eo-table'); const tb = el('tbody');
      for (const row of b.rows) {
        const tr = el('tr');
        for (const cell of row) { const td = el('td'); if (cell.span > 1) td.colSpan = cell.span; docxBlocks(cell.blocks, td, media, u); tr.appendChild(td); }
        tb.appendChild(tr);
      }
      t.appendChild(tb); wrap.appendChild(t); parent.appendChild(wrap);
      continue;
    }
    const p = el(b.level ? `h${Math.min(b.level + 1, 6)}` : 'p', b.level ? 'eo-h' : 'eo-p');
    if (b.align !== 'left') p.style.textAlign = b.align;
    if (b.list) { p.classList.add('eo-li'); p.style.marginLeft = `${Math.min(b.list.level, 6) * 18 + 4}px`; p.appendChild(el('span', 'eo-mark', b.list.marker)); }
    appendRuns(p, b.runs, media, u);
    if (!b.runs.length) p.appendChild(el('br'));
    parent.appendChild(p);
  }
}
function mountDocx(model, host, u) {
  const page = el('div', 'eo-page');
  if (model.truncated) page.appendChild(el('div', 'ev-banner', `Showing the first ${DOC_BLOCK_MAX.toLocaleString()} paragraphs. Use Open with app for the rest.`));
  docxBlocks(model.blocks, page, model.media, u);
  if (!model.blocks.length) page.appendChild(el('p', 'ev-media-msg', 'This document has no text to show.'));
  host.appendChild(page);
  return {};
}

// ---- xlsx: a tab per sheet, a grid with column letters and row numbers ----
function mountXlsx(model, host, ui) {
  const tabs = el('div', 'eo-tabs'); const grid = el('div', 'eo-grid');
  host.append(tabs, grid);
  const buttons = model.names.map((name, i) => {
    const b = el('button', 'eo-tab', name); b.type = 'button';
    b.onclick = () => { ui.onActivity(); show(i); };
    tabs.appendChild(b);
    return b;
  });
  function show(i) {
    buttons.forEach((b, k) => b.classList.toggle('active', k === i));
    grid.replaceChildren();
    let s;
    try { s = model.load(i); } catch (e) { grid.appendChild(el('p', 'ev-media-msg', e instanceof OfficeError ? e.message : 'This sheet could not be read.')); return; }
    if (!s.rows.length) { grid.appendChild(el('p', 'ev-media-msg', 'This sheet is empty.')); return; }
    if (s.truncated) grid.appendChild(el('div', 'ev-banner', `Showing the first ${SHEET_ROW_MAX.toLocaleString()} rows and ${SHEET_COL_MAX} columns. Use Open with app for the rest.`));
    const wrap = el('div', 'eo-tablewrap eo-sheet'); const t = el('table', 'eo-table eo-cells');
    const head = el('tr'); head.appendChild(el('th', 'eo-corner'));
    for (let c = 0; c < s.ncols; c++) head.appendChild(el('th', 'eo-col', colName(c)));
    const th = el('thead'); th.appendChild(head); t.appendChild(th);
    const tb = el('tbody');
    s.rows.forEach((row, r) => {
      const tr = el('tr'); tr.appendChild(el('th', 'eo-row', String(r + 1)));
      for (let c = 0; c < s.ncols; c++) {
        const v = row[c] || '';
        const td = el('td', /^-?\d+(\.\d+)?%?$/.test(v) ? 'eo-num' : '', v);
        tr.appendChild(td);
      }
      tb.appendChild(tr);
    });
    t.appendChild(tb); wrap.appendChild(t); grid.appendChild(wrap);
  }
  show(0);
  return {};
}

// ---- pptx: one slide at a time, Previous and Next ----
function mountPptx(model, host, ui, count, u) {
  const stage = el('div', 'eo-slide-stage'); const bar = el('div', 'eo-slidebar');
  const prev = el('button', 'eo-nav', 'Previous'); const next = el('button', 'eo-nav', 'Next');
  prev.type = next.type = 'button';
  bar.append(prev, next); host.append(stage, bar);
  let index = 0;
  function show(i) {
    index = i;
    count(`${i + 1}/${model.count}`);
    prev.disabled = i === 0; next.disabled = i === model.count - 1;
    stage.replaceChildren(); stage.scrollTop = 0; u.revoke();
    let s;
    try { s = model.load(i); } catch (e) { stage.appendChild(el('p', 'ev-media-msg', e instanceof OfficeError ? e.message : 'This slide could not be read.')); return; }
    const card = el('div', 'eo-slide');
    for (const b of s.blocks) {
      if (b.t === 'title') { const h = el('h2', 'eo-slide-title'); appendRuns(h, b.runs, s.media, u); card.appendChild(h); }
      else if (b.t === 'p') {
        const p = el('p', 'eo-p'); p.style.marginLeft = `${b.level * 18}px`;
        if (b.bullet) p.appendChild(el('span', 'eo-mark', '\u2022'));
        appendRuns(p, b.runs, s.media, u); card.appendChild(p);
      } else if (b.t === 'img') { const src = u.get(b.path, s.media); if (src) { const im = el('img', 'eo-img'); im.alt = ''; im.src = src; card.appendChild(im); } }
      else if (b.t === 'table') {
        const wrap = el('div', 'eo-tablewrap'); const t = el('table', 'eo-table'); const tb = el('tbody');
        for (const row of b.rows) { const tr = el('tr'); for (const cell of row) { const td = el('td', '', cell.text); td.style.whiteSpace = 'pre-wrap'; if (cell.span > 1) td.colSpan = cell.span; tr.appendChild(td); } tb.appendChild(tr); }
        t.appendChild(tb); wrap.appendChild(t); card.appendChild(wrap);
      } else if (b.t === 'note') card.appendChild(el('p', 'eo-note', b.text));
    }
    if (!card.childNodes.length) card.appendChild(el('p', 'eo-note', 'This slide has no text to show.'));
    stage.appendChild(card);
    if (s.notes) { const n = el('div', 'eo-notes'); n.appendChild(el('div', 'eo-notes-h', 'Notes')); n.appendChild(el('div', 'eo-notes-t', s.notes)); stage.appendChild(n); }
  }
  prev.onclick = () => { ui.onActivity(); if (index > 0) show(index - 1); };
  next.onclick = () => { ui.onActivity(); if (index < model.count - 1) show(index + 1); };
  show(0);
  return {};
}

// Reads the bytes and draws them into host (an empty element). Returns { destroy }. Throws OfficeError with a message
// fit to show; any other error is shown as the generic one by the caller.
export function mountOffice(kind, bytes, host, ctx) {
  const { ui, setCount = () => {} } = ctx;
  const u = urls();
  host.classList.add('ev-office');
  if (kind === 'docx') mountDocx(readDocx(bytes), host, u);
  else if (kind === 'xlsx') mountXlsx(readXlsx(bytes), host, ui);
  else if (kind === 'pptx') mountPptx(readPptx(bytes), host, ui, setCount, u);
  else throw new OfficeError('This type is not supported here.');
  return { destroy() { u.revoke(); host.replaceChildren(); host.classList.remove('ev-office'); setCount(''); } };
}
