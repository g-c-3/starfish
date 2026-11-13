// epubview.js — the EPUB reader (Decision 472): an EPUB is a zip of pages. One chapter at a time in a sandboxed frame, a bottom bar with
// previous, next, the contents, the text size and the page colour. Pictures and style sheets are read from the zip and inlined as data:
// (the frame's policy allows nothing else), so nothing is fetched; links inside a page do not open, the contents list is the way around.
import { unzipSync } from 'fflate';
import { openSheet } from './sheet.js';
import { cleanHtml } from './textrender.js';
import '../css/epubview.css';

const IMG_MAX = 3 * 1024 * 1024; // a picture larger than this stays a placeholder
const FONT_MAX = 1024 * 1024;
const CSS_MAX = 400 * 1024;
const UNZIP_MAX = 400 * 1024 * 1024; // the declared size of everything in the zip, as a guard
const SIZES = [70, 85, 100, 115, 130, 150, 175, 200];
const THEMES = ['light', 'sepia', 'dark'];
const THEME_NAME = { light: 'Light page', sepia: 'Sepia page', dark: 'Dark page' };
const MIMES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2' };
let sizeIx = 2; let themeName = null; // kept for the session

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const fail = (m) => { const e = new Error(m); e.office = true; return e; };
const ascii = (b, o, n) => { let s = ''; for (let i = 0; i < n && o + i < b.length; i++) s += String.fromCharCode(b[o + i]); return s; };
export const isEpub = (b) => !!b && b.length > 60 && b[0] === 0x50 && b[1] === 0x4b && ascii(b, 30, 8) === 'mimetype' && ascii(b, 38, 20) === 'application/epub+zip';
const dec = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '');
const join = (base, ref) => { const out = []; for (const seg of (base + dec(ref)).split('/')) { if (seg === '..') out.pop(); else if (seg && seg !== '.') out.push(seg); } return out.join('/'); };
const strip = (ref) => String(ref || '').split('#')[0].split('?')[0];
const all = (doc, name) => [...doc.getElementsByTagName('*')].filter((e) => e.localName === name);
const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const xml = (u8) => new DOMParser().parseFromString(new TextDecoder('utf-8').decode(u8), 'application/xml');

// bytes -> { title, author, chapters: [{ path }], toc: [{ title, index, depth }], file(path) -> Uint8Array | null }
export function parseEpub(bytes) {
  let total = 0; let count = 0;
  const first = unzipSync(bytes, { filter: (f) => { total += f.originalSize; count++; return count < 30000 && total < UNZIP_MAX && /^META-INF\/container\.xml$/i.test(f.name); } });
  if (total >= UNZIP_MAX || count >= 30000) throw fail('This book is too large to open here.');
  const cont = first['META-INF/container.xml']; if (!cont) throw fail('This is not a readable EPUB.');
  const rf = all(xml(cont), 'rootfile')[0]; const opfPath = rf && rf.getAttribute('full-path'); if (!opfPath) throw fail('This is not a readable EPUB.');
  const cache = new Map();
  const file = (p) => { if (cache.has(p)) return cache.get(p); const r = unzipSync(bytes, { filter: (f) => f.name === p && f.originalSize < 64 * 1024 * 1024 }); const v = r[p] || null; if (v && v.length < 600 * 1024) cache.set(p, v); return v; };
  const opfBytes = file(opfPath); if (!opfBytes) throw fail('This is not a readable EPUB.');
  const opf = xml(opfBytes); const base = dirOf(opfPath);
  const man = new Map(); for (const it of all(opf, 'item')) man.set(it.getAttribute('id'), { href: join(base, it.getAttribute('href') || ''), type: it.getAttribute('media-type') || '', props: it.getAttribute('properties') || '' });
  const chapters = []; const at = new Map();
  for (const r of all(opf, 'itemref')) {
    const m = man.get(r.getAttribute('idref')); if (!m || r.getAttribute('linear') === 'no' || !/x?html/i.test(m.type)) continue;
    at.set(m.href, chapters.length); chapters.push({ path: m.href });
  }
  if (!chapters.length) throw fail('This book has no readable pages.');
  const meta = (n) => { const e = all(opf, n)[0]; return e ? e.textContent.trim() : ''; };
  let toc = [];
  const nav = [...man.values()].find((m) => /\bnav\b/.test(m.props));
  if (nav && file(nav.href)) {
    const d = new DOMParser().parseFromString(new TextDecoder('utf-8').decode(file(nav.href)), 'text/html');
    const n = [...d.querySelectorAll('nav')].find((x) => /toc/.test(x.getAttribute('epub:type') || '')) || d.querySelector('nav');
    if (n) for (const a of n.querySelectorAll('a[href]')) { const idx = at.get(join(dirOf(nav.href), strip(a.getAttribute('href')))); let depth = 0; for (let p = a.parentElement; p && p !== n; p = p.parentElement) if (p.localName === 'ol' || p.localName === 'ul') depth++; if (idx !== undefined) toc.push({ title: a.textContent.replace(/\s+/g, ' ').trim() || `Section ${idx + 1}`, index: idx, depth: Math.max(0, depth - 1) }); }
  }
  if (!toc.length) {
    const sp = all(opf, 'spine')[0]; const ncx = sp && man.get(sp.getAttribute('toc'));
    if (ncx && file(ncx.href)) {
      const d = xml(file(ncx.href));
      for (const np of all(d, 'navPoint')) {
        const c = [...np.children].find((x) => x.localName === 'content'); const l = [...np.children].find((x) => x.localName === 'navLabel');
        const idx = c ? at.get(join(dirOf(ncx.href), strip(c.getAttribute('src')))) : undefined; let depth = 0; for (let p = np.parentElement; p; p = p.parentElement) if (p.localName === 'navPoint') depth++;
        if (idx !== undefined) toc.push({ title: (l ? l.textContent : '').replace(/\s+/g, ' ').trim() || `Section ${idx + 1}`, index: idx, depth });
      }
    }
  }
  if (!toc.length) toc = chapters.map((_, i) => ({ title: `Section ${i + 1}`, index: i, depth: 0 }));
  return { title: meta('title'), author: meta('creator'), chapters, toc, file };
}

// one chapter -> a complete inert page; pictures, style sheets and fonts come out of the zip as data:
export function chapterHtml(book, index, view) {
  const ch = book.chapters[index]; const raw = book.file(ch.path);
  if (!raw) return '<p>This page is missing from the book.</p>';
  const dir = dirOf(ch.path);
  const mime = (p) => MIMES[(p.split('.').pop() || '').toLowerCase()];
  const data = (p, max) => { const u = book.file(p); const m = mime(p); return u && m && u.length <= max ? `data:${m};base64,${b64(u)}` : null; };
  const cssAt = (path, depth) => {
    const u = book.file(path); if (!u || u.length > CSS_MAX || depth > 3) return '';
    const cdir = dirOf(path);
    return new TextDecoder('utf-8').decode(u).replace(/@import\s+(?:url\()?\s*['"]?([^'")\s;]+)['"]?\s*\)?[^;]*;?/gi, (_, r) => cssAt(join(cdir, strip(r)), depth + 1))
      .replace(/url\(\s*['"]?([^'")]+?)['"]?\s*\)/gi, (m, r) => { if (/^data:/i.test(r)) return m; const d = data(join(cdir, strip(r)), /\.(woff2?|ttf|otf)$/i.test(r) ? FONT_MAX : IMG_MAX); return d ? `url(${d})` : 'none'; });
  };
  const resolve = (ref, kind) => { const p = join(dir, strip(ref)); return kind === 'css' ? cssAt(p, 0) : data(p, IMG_MAX); };
  const dark = view.theme === 'dark';
  const colour = view.theme === 'sepia' ? 'html{background:#f4ecd8;color:#3b2f1e}' : dark ? 'html,body{background:#121118!important;color:#e8e6f2!important}body *{color:inherit!important;background-color:transparent!important}a{text-decoration:underline}' : '';
  const extra = `body{box-sizing:border-box;margin:0;padding:14px 18px 32px;overflow-wrap:anywhere}html{font-size:${SIZES[view.size]}%!important}${colour}`;
  return cleanHtml(new TextDecoder('utf-8').decode(raw), { resolve, extraStyle: extra });
}

// host: the .eo-host of the Office viewers; ctx: { ui, openWith }. Returns { toggleMenu (the contents), destroy }.
export function mountEpub(host, bytes, ctx = {}) {
  const book = parseEpub(bytes);
  const ui = ctx.ui || {}; const act = () => { if (ui.onActivity) ui.onActivity(); };
  if (!themeName) themeName = host.dataset.theme === 'dark' ? 'dark' : 'light';
  host.replaceChildren();
  const stage = el('div', 'ep-stage'); const bar = el('div', 'ep-bar');
  const mk = (cls, text, label, fn) => { const b = el('button', `ep-btn ${cls}`, text); b.type = 'button'; b.setAttribute('aria-label', label); b.onclick = () => { act(); fn(); }; return b; };
  let cur = -1; let frame = null; const timers = new Set(); let gone = false;
  const later = (f, ms) => { const t = setTimeout(() => { timers.delete(t); f(); }, ms); timers.add(t); };
  const pos = el('button', 'ep-btn ep-pos', ''); pos.type = 'button'; pos.setAttribute('aria-label', 'Contents');
  const view = () => ({ size: sizeIx, theme: themeName });
  const go = (i, quiet) => {
    if (gone || i < 0 || i >= book.chapters.length || (i === cur && frame)) return;
    const f = document.createElement('iframe'); f.className = 'ep-frame tr-fade hidden'; f.setAttribute('sandbox', ''); f.setAttribute('referrerpolicy', 'no-referrer'); f.title = 'Book page';
    try { f.srcdoc = chapterHtml(book, i, view()); } catch { f.srcdoc = '<p>This page could not be shown.</p>'; }
    stage.appendChild(f); void f.offsetWidth;
    const old = frame; frame = f; cur = i;
    // the old page leaves, the new one arrives after the gap (the one recipe, opacity only)
    if (old) { old.classList.add('tr-fade', 'hidden', 'mx-out'); later(() => { old.srcdoc = ''; old.remove(); }, 260); }
    f.classList.add('mx-after'); if (!old || quiet) f.classList.remove('mx-after'); f.classList.remove('hidden');
    pos.textContent = `${i + 1} / ${book.chapters.length}`; prev.disabled = i === 0; next.disabled = i === book.chapters.length - 1;
  };
  const prev = mk('ep-prev', '\u2039', 'Previous page', () => go(cur - 1));
  const next = mk('ep-next', '\u203a', 'Next page', () => go(cur + 1));
  const smaller = mk('ep-a', 'A\u2212', 'Smaller text', () => { if (sizeIx > 0) { sizeIx--; redo(); } });
  const bigger = mk('ep-a', 'A+', 'Larger text', () => { if (sizeIx < SIZES.length - 1) { sizeIx++; redo(); } });
  const tone = mk('ep-tone', '\u25d0', 'Page colour', () => { themeName = THEMES[(THEMES.indexOf(themeName) + 1) % THEMES.length]; tone.title = THEME_NAME[themeName]; redo(); });
  tone.title = THEME_NAME[themeName];
  const redo = () => { const i = cur; cur = -1; const old = frame; frame = null; if (old) { old.srcdoc = ''; old.remove(); } go(i, true); };
  const contents = () => {
    act();
    openSheet({
      title: book.title || 'Contents',
      build: (h, close) => {
        if (book.author) h.appendChild(el('p', 'ep-author', book.author));
        const list = el('div', 'ep-toc');
        for (const t of book.toc) { const b = el('button', `ep-toc-i${t.index === cur ? ' on' : ''}`, t.title); b.type = 'button'; b.style.paddingLeft = `${12 + Math.min(t.depth, 4) * 16}px`; b.onclick = () => { close(); go(t.index); }; list.appendChild(b); }
        h.appendChild(list);
        if (ctx.openWith) { const o = el('button', 'secondary-btn', "Open in the phone's app"); o.type = 'button'; o.onclick = () => { close(); ctx.openWith(); }; h.appendChild(o); }
      }
    });
  };
  pos.onclick = contents;
  bar.append(prev, smaller, bigger, tone, pos, next);
  host.append(stage, bar);
  go(0);
  return { toggleMenu: contents, destroy() { gone = true; for (const t of timers) clearTimeout(t); timers.clear(); if (frame) frame.srcdoc = ''; host.replaceChildren(); } };
}
