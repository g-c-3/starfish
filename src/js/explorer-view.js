// explorer-view.js — built-in viewers of the File explorer (Decision 211): text (view and edit, saved back to the file),
// image, PDF (reading tools only), audio, video, and docx, xlsx and pptx (view only, Decision 226). Files are read where they are; nothing is copied, stored or sent
// anywhere, and no database row is written. The screen's own lock rules apply: destroy() runs on an app or Vault lock.

import { Filesystem, Encoding } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';

export const VIEW_KINDS = ['text', 'image', 'pdf', 'audio', 'video', 'docx', 'xlsx', 'pptx'];
export const TEXT_MAX = 2 * 1024 * 1024; // larger text goes to another app: a textarea of that size is slow on a phone
export const PDF_MAX = 150 * 1024 * 1024; // the whole file is held in memory while it is open
export const OFFICE_MAX = 50 * 1024 * 1024; // same reason; docx, xlsx and pptx are unpacked in memory

// Binary data (a NUL) is not text. U+FFFD means invalid bytes were replaced on reading: saving would write the
// replacements back, so such a file opens read-only.
export function inspectText(text) {
  if (text.includes('\u0000')) return { binary: true, lossy: false, crlf: false };
  return { binary: false, lossy: text.includes('\uFFFD'), crlf: text.includes('\r\n') };
}
// A textarea reports every line break as LF; a file that used CRLF is written back with CRLF.
export const restoreEol = (value, crlf) => (crlf ? value.replace(/\r?\n/g, '\r\n') : value);
// Capacitor's local server streams a file:// path with range support, so large media is not read into memory.
export const mediaSrc = (uri) => Capacitor.convertFileSrc(uri);

const errText = (e) => (e && e.message ? `: ${e.message}` : '.');

// file: { name, path, size }. ctx: { kind, siblings (images of the folder, in listing order), toUri(path),
// ui { askYesNo, askText, attachZoomPan, onActivity }, toast, external(file, chooser), isVault, onClose({ changed }) }.
// Returns { back, destroy }; back() asks before dropping unsaved text and closes an open PDF tool first.
export function openFileViewer(file, ctx) {
  const { siblings = [], toUri, ui, toast, external, isVault = false, readOnly = false, onClose = () => {} } = ctx;
  const $ = (id) => document.getElementById(id);
  const root = $('explorer-viewer'), body = $('ev-body'), titleEl = $('ev-title'), countEl = $('ev-count');
  const saveBtn = $('ev-save-btn'), openBtn = $('ev-open-btn');
  let current = file, token = 0, closed = false, changed = false;
  let guard = async () => true; // resolves false when Back must not leave yet
  let cleanup = () => {};
  let officeOpen = false; let menuBtn = null; let chromeHidden = false;
  const header = root.querySelector('.editor-bar');
  // Office files get the whole screen: the title bar folds away while scrolling down, the three-dot menu holds the tools
  function setChrome(hidden) {
    if (!header || hidden === chromeHidden) return;
    chromeHidden = hidden;
    if (hidden) header.style.marginTop = `-${header.offsetHeight}px`; else header.style.marginTop = '';
    header.classList.toggle('ev-head-hidden', hidden);
  }
  function leaveOffice() {
    officeOpen = false; setChrome(false);
    if (menuBtn) { menuBtn.remove(); menuBtn = null; }
    root.classList.remove('ev-full'); document.body.classList.remove('ev-full');
  }

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const note = (text) => { body.replaceChildren(); const b = el('div', 'pdf-msg'); b.appendChild(el('p', '', text)); body.appendChild(b); };
  const reset = () => {
    try { cleanup(); } catch { /* a teardown must not block the next file */ }
    cleanup = () => {}; guard = async () => true;
    leaveOffice();
    token++;
    saveBtn.classList.add('hidden'); saveBtn.disabled = true; saveBtn.onclick = null;
    countEl.textContent = '';
    body.replaceChildren();
  };

  // ---- Text ----
  async function showText(f, mine) {
    if (f.size > TEXT_MAX) { note('This file is too large to open here. Use Open with app.'); return; }
    note('Loading…');
    let data;
    try { ({ data } = await Filesystem.readFile({ path: toUri(f.path), encoding: Encoding.UTF8 })); }
    catch (e) { if (mine === token) note(`The file could not be read${errText(e)}`); return; }
    if (mine !== token || closed) return;
    const text = typeof data === 'string' ? data : '';
    const info = inspectText(text);
    if (info.binary) { note('This is not a text file. Use Open with app.'); return; }
    body.replaceChildren();
    const wrap = el('div', 'ev-text-wrap');
    if (info.lossy) wrap.appendChild(el('div', 'ev-banner', 'Parts of this file are not valid text. It is open for reading only, so saving cannot damage it.'));
    const ta = el('textarea', 'ev-text');
    const editable = !info.lossy && !readOnly; // readOnly: a copy taken out of an archive; saving would be lost
    if (readOnly && !info.lossy) wrap.appendChild(el('div', 'ev-banner', 'Opened from an archive: read only. Extract the archive to edit.'));
    ta.value = text; ta.readOnly = !editable; ta.spellcheck = false;
    ta.setAttribute('autocapitalize', 'off'); ta.setAttribute('autocomplete', 'off'); ta.setAttribute('aria-label', f.name);
    wrap.appendChild(ta); body.appendChild(wrap);
    let base = ta.value, saving = false;
    const dirty = () => editable && ta.value !== base;
    ta.addEventListener('input', () => { saveBtn.disabled = !dirty() || saving; ui.onActivity(); });
    if (editable) {
      saveBtn.classList.remove('hidden'); saveBtn.disabled = true;
      saveBtn.onclick = async () => {
        if (saving || !dirty()) return;
        saving = true; saveBtn.disabled = true;
        const value = ta.value;
        try {
          await Filesystem.writeFile({ path: toUri(f.path), data: restoreEol(value, info.crlf), encoding: Encoding.UTF8 });
          base = value; changed = true; toast('Saved');
        } catch (e) { toast(`Could not save the file${errText(e)}`); }
        saving = false; saveBtn.disabled = !dirty();
      };
      guard = async () => !dirty() || ui.askYesNo({ title: 'Discard changes?', text: 'This file has not been saved.', yes: 'Yes, discard', no: 'No, keep editing' });
    }
    cleanup = () => { ta.oninput = null; ta.blur(); };
  }

  // ---- Image ----
  function showImage(f) {
    const list = siblings.length ? siblings : [f];
    let index = Math.max(0, list.findIndex((s) => s.path === f.path));
    body.innerHTML = '<div class="img-stage"><img class="img-full" alt="" draggable="false"><div class="img-loading">Loading…</div></div>';
    const stage = body.querySelector('.img-stage'), img = body.querySelector('.img-full'), loading = body.querySelector('.img-loading');
    if (list.length > 1) countEl.textContent = `${index + 1}/${list.length}`;
    img.alt = f.name;
    img.onload = () => loading.remove();
    img.onerror = () => { loading.textContent = 'This image cannot be shown here. Use Open with app.'; };
    img.src = mediaSrc(toUri(f.path));
    const go = (step) => { const n = index + step; if (n < 0 || n >= list.length) { zoom.reset(); return; } ui.onActivity(); show(list[n]); };
    const zoom = ui.attachZoomPan(stage, img, { onSwipe: list.length > 1 ? go : null, onActivity: ui.onActivity });
    cleanup = () => { img.onload = img.onerror = null; img.removeAttribute('src'); zoom.destroy(); };
  }

  // ---- PDF ----
  async function showPdf(f, mine) {
    if (f.size > PDF_MAX) { note('This PDF is too large to open here. Use Open with app.'); return; }
    body.innerHTML = '<div class="pdf-scroll"><div class="pdf-msg">Loading…</div></div>';
    const scroll = body.querySelector('.pdf-scroll');
    let view = null, tools = null;
    cleanup = () => { if (tools) { tools.destroy(); tools = null; } if (view) { view.destroy(); view = null; } };
    guard = async () => !(tools && await tools.closeTop());
    try {
      const res = await fetch(mediaSrc(toUri(f.path)));
      if (!res.ok) throw new Error('The file could not be read.');
      const bytes = new Uint8Array(await res.arrayBuffer());
      const { createPdfView } = await import('./pdfviewer.js');
      const next = await createPdfView(scroll, bytes, {
        onActivity: ui.onActivity,
        askPassword: (wasWrong) => ui.askText({ title: wasWrong ? 'Wrong password' : 'Password needed', text: 'This PDF is protected.', password: true, ok: 'Open', isVault }),
        onPage: (n) => { if (view) countEl.textContent = `${n}/${view.pageCount}`; }
      });
      if (mine !== token || closed) { next.destroy(); return; }
      view = next;
      countEl.textContent = `1/${view.pageCount}`;
      body.insertAdjacentHTML('beforeend', '<div class="pdf-zoom"><button type="button" class="pdf-zin" aria-label="Zoom in">+</button><button type="button" class="pdf-zout" aria-label="Zoom out">\u2212</button></div>');
      body.querySelector('.pdf-zin').onclick = () => { ui.onActivity(); view?.zoomIn(); };
      body.querySelector('.pdf-zout').onclick = () => { ui.onActivity(); view?.zoomOut(); };
      const { mountPdfTools } = await import('./pdftools.js');
      if (mine !== token || closed) return;
      tools = mountPdfTools(body, view, { onActivity: ui.onActivity });
    } catch (err) {
      if (mine !== token) return;
      const msg = err && err.name === 'PasswordException' ? err.message : 'This PDF cannot be shown here. Use Open with app.';
      scroll.replaceChildren(); const b = el('div', 'pdf-msg'); b.appendChild(el('p', '', msg)); scroll.appendChild(b);
    }
  }

  // ---- Office documents (view only) ----
  async function showOffice(f, kind, mine) {
    if (f.size > OFFICE_MAX) { note('This file is too large to open here. Use Open with app.'); return; }
    note('Loading…');
    let mounted = null;
    cleanup = () => { if (mounted) { mounted.destroy(); mounted = null; } };
    try {
      const res = await fetch(mediaSrc(toUri(f.path)));
      if (!res.ok) throw new Error('The file could not be read.');
      const bytes = new Uint8Array(await res.arrayBuffer());
      const { mountOffice } = await import('./office-render.js');
      if (mine !== token || closed) return;
      body.replaceChildren();
      const host = el('div', 'eo-host');
      body.appendChild(host);
      officeOpen = true; root.classList.add('ev-full'); document.body.classList.add('ev-full');
      menuBtn = el('button', 'icon-btn ev-menu-btn'); menuBtn.type = 'button'; menuBtn.setAttribute('aria-label', 'Menu'); menuBtn.title = 'Menu';
      const ns = 'http://www.w3.org/2000/svg'; const dots = document.createElementNS(ns, 'svg'); dots.setAttribute('class', 'ic'); dots.setAttribute('viewBox', '0 0 24 24'); dots.setAttribute('aria-hidden', 'true');
      for (const cy of [5, 12, 19]) { const c = document.createElementNS(ns, 'circle'); c.setAttribute('cx', '12'); c.setAttribute('cy', String(cy)); c.setAttribute('r', '2'); c.setAttribute('fill', 'currentColor'); c.setAttribute('stroke', 'none'); dots.appendChild(c); }
      menuBtn.appendChild(dots); openBtn.before(menuBtn);
      menuBtn.onclick = () => { setChrome(false); host.classList.toggle('eo-menu-open'); };
      host.addEventListener('pointerdown', (e) => { if (host.classList.contains('eo-menu-open') && !e.target.closest('.eo-bar')) host.classList.remove('eo-menu-open'); });
      mounted = mountOffice(kind, bytes, host, {
        ui, setCount: (t) => { if (mine === token) countEl.textContent = t; },
        onChrome: (h) => { if (h) host.classList.remove('eo-menu-open'); setChrome(h); },
        openWith: () => { if (!closed) external(current, true); }
      });
    } catch (err) {
      if (mine !== token) return;
      if (mounted) { mounted.destroy(); mounted = null; }
      note(err && err.office ? err.message : 'This file cannot be shown here. Use Open with app.');
    }
  }

  // ---- Audio and video ----
  function showMedia(f, kind) {
    const box = el('div', kind === 'video' ? 'ev-media' : 'ev-media ev-audio');
    if (kind === 'audio') box.appendChild(el('div', 'ev-audio-name', f.name));
    const m = el(kind); // <audio> or <video>
    m.controls = true; m.preload = 'metadata';
    if (kind === 'video') m.setAttribute('playsinline', '');
    box.appendChild(m); body.appendChild(box);
    let last = 0;
    m.addEventListener('timeupdate', () => { const now = Date.now(); if (now - last > 20000) { last = now; ui.onActivity(); } }); // keeps the auto-lock timer from firing mid-play
    m.addEventListener('error', () => { box.replaceChildren(el('p', 'ev-media-msg', 'This phone cannot play this file here. Use Open with app.')); });
    const onVisible = () => { if (document.hidden) m.pause(); }; // nothing keeps playing behind a lock
    document.addEventListener('visibilitychange', onVisible);
    m.src = mediaSrc(toUri(f.path));
    cleanup = () => { document.removeEventListener('visibilitychange', onVisible); m.pause(); m.removeAttribute('src'); m.load(); };
  }

  function show(f) {
    reset();
    current = f;
    titleEl.textContent = f.name;
    const kind = f === file ? ctx.kind : 'image'; // only images are stepped through
    const mine = token;
    if (kind === 'text') showText(f, mine);
    else if (kind === 'image') showImage(f);
    else if (kind === 'pdf') showPdf(f, mine);
    else if (kind === 'docx' || kind === 'xlsx' || kind === 'pptx') showOffice(f, kind, mine);
    else showMedia(f, kind);
  }

  function destroy() {
    if (closed) return;
    closed = true;
    reset();
    root.classList.add('hidden');
    $('ev-back-btn').onclick = null; openBtn.onclick = null;
    onClose({ changed });
  }
  async function back() {
    if (closed) return;
    if (!(await guard())) return;
    destroy();
  }

  $('ev-back-btn').onclick = back;
  openBtn.onclick = () => { if (!closed) external(current, officeOpen); }; // an office file: always the list of apps to choose from
  root.classList.remove('hidden');
  show(file);
  return { back, destroy };
}
