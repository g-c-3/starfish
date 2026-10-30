// filesview.js — Arkly's own viewers for a stored file in the Files folder (Decision 333): text (read only), audio, and docx, xlsx
// and pptx (view only). The bytes come from the encrypted store in memory; nothing is written to the phone. Each function draws into
// the body of the entry viewer and returns { destroy }. Images, video and PDF use the viewers they already had.
import { kindOf } from './explorer.js';
import { inspectText, TEXT_MAX, OFFICE_MAX } from './explorer-view.js';

const ARKLY_KINDS = new Set(['text', 'image', 'video', 'pdf', 'audio', 'docx', 'xlsx', 'pptx']);
// The viewer for a file's extension, or null: it goes to the phone's apps (archives, old Office formats, unknown types).
export function arklyKind(extension) {
  const ext = String(extension || '').replace(/^\./, '').toLowerCase();
  if (!ext) return null;
  const kind = kindOf(`x.${ext}`);
  return ARKLY_KINDS.has(kind) ? kind : null;
}
export const FILE_LIMIT = { text: TEXT_MAX, docx: OFFICE_MAX, xlsx: OFFICE_MAX, pptx: OFFICE_MAX };

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

// bytes -> a read-only code view with Find, Go to, Wrap and size tools. Throws { notText: true } for binary data.
export async function mountTextFile(body, bytes, name, ui) {
  const text = new TextDecoder('utf-8').decode(bytes);
  const info = inspectText(text);
  if (info.binary) throw Object.assign(new Error('This is not a text file.'), { notText: true });
  body.replaceChildren();
  const wrap = el('div', 'ev-text-wrap');
  if (info.lossy) wrap.appendChild(el('div', 'ev-banner', 'Parts of this file are not valid text and may look garbled.'));
  const bar = el('div', 'ev-tools'), host = el('div', 'ev-code');
  wrap.append(bar, host); body.appendChild(wrap);
  const { createCodeEditor } = await import('./codeeditor.js');
  const ed = createCodeEditor({ parent: host, text, name, editable: false, ui, onChange: () => ui.onActivity() });
  if (ed.setEditing) ed.setEditing(false, false);
  const tool = (label, title, fn) => { const b = el('button', 'ev-tool', label); b.type = 'button'; b.title = title; b.setAttribute('aria-label', title); b.onclick = () => { ui.onActivity(); fn(b); }; bar.appendChild(b); return b; };
  tool('Find', 'Find', (b) => b.classList.toggle('on', ed.find()));
  tool('Go to', 'Go to line', () => ed.goTo());
  const w = tool('Wrap', 'Wrap long lines', (b) => b.classList.toggle('on', ed.toggleWrap()));
  w.classList.toggle('on', ed.isWrapped());
  tool('A\u2212', 'Smaller text', () => ed.bumpSize(-1));
  tool('A+', 'Larger text', () => ed.bumpSize(1));
  return { destroy() { ed.destroy(); } };
}

// A blob URL of the decrypted audio, played with the phone's own controls; paused when the app is not in front.
export function mountAudioFile(body, url, name, ui) {
  body.replaceChildren();
  const box = el('div', 'ev-media ev-audio');
  box.appendChild(el('div', 'ev-audio-name', name));
  const m = el('audio'); m.controls = true; m.preload = 'metadata';
  box.appendChild(m); body.appendChild(box);
  let last = 0;
  m.addEventListener('timeupdate', () => { const now = Date.now(); if (now - last > 20000) { last = now; ui.onActivity(); } }); // keeps the auto-lock timer from firing mid-play
  m.addEventListener('error', () => { box.replaceChildren(el('p', 'ev-media-msg', 'This phone cannot play this file here. Use Open with app.')); });
  const onVisible = () => { if (document.hidden) m.pause(); };
  document.addEventListener('visibilitychange', onVisible);
  m.src = url;
  return { destroy() { document.removeEventListener('visibilitychange', onVisible); m.pause(); m.removeAttribute('src'); m.load(); } };
}

// docx, xlsx or pptx bytes -> the Office view. The toolbar sits behind a menu: toggleMenu() shows and hides it.
// ctx: { ui, setCount(text), openWith() }. Throws an OfficeError (message fit to show) or any other error.
export async function mountOfficeFile(body, kind, bytes, ctx) {
  const { mountOffice } = await import('./office-render.js');
  body.replaceChildren();
  const host = el('div', 'eo-host');
  body.appendChild(host);
  host.addEventListener('pointerdown', (e) => { if (host.classList.contains('eo-menu-open') && !e.target.closest('.eo-bar')) host.classList.remove('eo-menu-open'); });
  const mounted = mountOffice(kind, bytes, host, { ui: ctx.ui, setCount: ctx.setCount, onChrome: () => {}, openWith: ctx.openWith });
  return { toggleMenu: () => host.classList.toggle('eo-menu-open'), destroy() { mounted.destroy(); } };
}
