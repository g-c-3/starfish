// pdftools.js — reading tools UI for the in-app PDF viewer (Decision 153): find in PDF, pages (thumbnails), outline, go to page.
// DOM only; every document operation goes through the `view` object from pdfviewer.js. Nothing is stored: the query,
// results and thumbnails live in memory and are dropped when a tool closes or the viewer closes.

import { clampPage } from './pdfsearch.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ICON_FIND = '<svg class="ic" aria-hidden="true"><use href="#i-search"/></svg>';
const ICON_PAGES = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></svg>';
const ICON_UP = '<svg class="ic" aria-hidden="true" style="transform:rotate(-90deg)"><use href="#i-chevron"/></svg>';
const ICON_DOWN = '<svg class="ic" aria-hidden="true" style="transform:rotate(90deg)"><use href="#i-chevron"/></svg>';
const ICON_X = '<svg class="ic" aria-hidden="true"><use href="#i-x"/></svg>';

// Mounts the tool buttons inside `body` (the viewer body). Returns { closeTop, destroy }.
// closeTop() closes the topmost open tool and returns true, or returns false when none is open (Back then leaves the viewer).
function mountPdfTools(body, view, { onActivity = () => {} } = {}) {
  const tools = document.createElement('div');
  tools.className = 'pdf-tools';
  tools.innerHTML = `<button type="button" class="pdf-find-btn" aria-label="Find in PDF" title="Find in PDF">${ICON_FIND}</button>
    <button type="button" class="pdf-pages-btn" aria-label="Pages and outline" title="Pages and outline">${ICON_PAGES}</button>`;
  body.append(tools);
  let bar = null, panel = null, thumbs = null, debounce = 0;

  // ---- Find ----
  function closeFind() {
    clearTimeout(debounce);
    if (!bar) return;
    view.clearSearch();
    bar.input.value = '';
    bar.el.remove();
    bar = null;
  }
  function openFind() {
    onActivity();
    if (bar) { bar.input.focus(); return; }
    const el = document.createElement('div');
    el.className = 'pdf-searchbar';
    el.innerHTML = `<input type="search" class="pdf-find-input" enterkeyhint="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Find in PDF" aria-label="Find in PDF">
      <span class="pdf-find-count" role="status" aria-live="polite"></span>
      <button type="button" class="icon-btn pdf-find-prev" aria-label="Previous match">${ICON_UP}</button>
      <button type="button" class="icon-btn pdf-find-next" aria-label="Next match">${ICON_DOWN}</button>
      <button type="button" class="icon-btn pdf-find-close" aria-label="Close find">${ICON_X}</button>`;
    body.append(el);
    const input = el.querySelector('.pdf-find-input'), count = el.querySelector('.pdf-find-count');
    bar = { el, input };
    const show = (r) => {
      if (r.cancelled) return;
      if (r.tooShort) count.textContent = input.value.trim() ? 'Type 2 or more characters' : '';
      else if (!r.total) count.textContent = 'No matches';
      else count.textContent = `${r.index + 1} of ${r.total}${r.capped ? '+' : ''}`;
    };
    const run = async () => {
      clearTimeout(debounce);
      onActivity();
      count.textContent = 'Searching…';
      const r = await view.search(input.value, { onProgress: ({ page, total }) => { count.textContent = `Searching… ${page}/${view.pageCount} · ${total}`; } });
      if (bar && bar.input === input) show(r);
    };
    input.addEventListener('input', () => {
      onActivity();
      clearTimeout(debounce);
      if (!input.value.trim()) { view.clearSearch(); count.textContent = ''; return; }
      debounce = setTimeout(run, 500);
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); run(); } });
    el.querySelector('.pdf-find-prev').onclick = () => { onActivity(); show(view.stepHit(-1)); };
    el.querySelector('.pdf-find-next').onclick = () => { onActivity(); show(view.stepHit(1)); };
    el.querySelector('.pdf-find-close').onclick = closeFind;
    setTimeout(() => input.focus(), 50);
  }

  // ---- Pages panel: thumbnails and outline, with go to page ----
  function closePanel() {
    if (thumbs) { thumbs.destroy(); thumbs = null; }
    if (panel) { panel.remove(); panel = null; }
  }
  function openPanel() {
    onActivity();
    if (panel) return;
    const el = document.createElement('div');
    el.className = 'pdf-panel';
    el.innerHTML = `<div class="pdf-panel-head">
        <div class="pdf-tabs"><button type="button" class="pdf-tab active" data-tab="pages">Pages</button><button type="button" class="pdf-tab" data-tab="outline">Outline</button></div>
        <button type="button" class="icon-btn pdf-panel-close" aria-label="Close">${ICON_X}</button></div>
      <div class="pdf-goto"><input type="text" inputmode="numeric" class="pdf-goto-input" placeholder="Page 1–${view.pageCount}" aria-label="Go to page" autocomplete="off"><button type="button" class="pdf-goto-go">Go</button></div>
      <div class="pdf-panel-body"></div>`;
    body.append(el);
    panel = el;
    const pbody = el.querySelector('.pdf-panel-body');
    const input = el.querySelector('.pdf-goto-input');
    const jump = (n) => { onActivity(); view.goToPage(n); closePanel(); };
    const go = () => {
      const n = clampPage(input.value, view.pageCount);
      if (n === null) { input.focus(); return; }
      jump(n);
    };
    el.querySelector('.pdf-goto-go').onclick = go;
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    el.querySelector('.pdf-panel-close').onclick = closePanel;
    const showPages = () => {
      if (thumbs) thumbs.destroy();
      pbody.innerHTML = '<div class="pdf-thumbs"></div>';
      thumbs = view.attachThumbnails(pbody.firstChild, { root: pbody, onPick: jump });
      thumbs.markCurrent(view.currentPage());
    };
    const showOutline = async () => {
      if (thumbs) { thumbs.destroy(); thumbs = null; }
      pbody.innerHTML = '<div class="pdf-ol-msg">Loading…</div>';
      const items = await view.getOutline();
      if (panel !== el || !pbody.isConnected || el.querySelector('.pdf-tab.active')?.dataset.tab !== 'outline') return;
      if (!items.length) { pbody.innerHTML = '<div class="pdf-ol-msg">This PDF has no outline.</div>'; return; }
      pbody.innerHTML = items.map((it, i) => `<button type="button" class="pdf-ol-item" data-i="${i}" style="padding-left:${10 + Math.min(it.depth, 5) * 14}px"><span class="pdf-ol-title">${esc(it.title)}</span><span class="pdf-ol-page">${it.page}</span></button>`).join('');
      pbody.onclick = (e) => { const b = e.target.closest('.pdf-ol-item'); if (b) jump(items[Number(b.dataset.i)].page); };
    };
    el.querySelectorAll('.pdf-tab').forEach((b) => {
      b.onclick = () => {
        onActivity();
        el.querySelectorAll('.pdf-tab').forEach((x) => x.classList.toggle('active', x === b));
        if (b.dataset.tab === 'pages') showPages(); else showOutline();
      };
    });
    showPages();
  }

  tools.querySelector('.pdf-find-btn').onclick = openFind;
  tools.querySelector('.pdf-pages-btn').onclick = openPanel;

  return {
    closeTop() {
      if (panel) { closePanel(); return true; }
      if (bar) { closeFind(); return true; }
      return false;
    },
    destroy() { closePanel(); closeFind(); tools.remove(); }
  };
}

export { mountPdfTools };
