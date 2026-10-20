// office-render.js — draws what office-read.js returns into the explorer viewer (Decisions 226, 227, 233, 234). Every string from a file
// is set with textContent; no markup from a file is ever parsed. Pictures become object URLs, revoked on destroy.

import { Preferences } from '@capacitor/preferences';
import { chartSvg } from './office-chart.js';
import { chromeOnScroll } from './chrome-scroll.js';
import { paginate, paginateAuto, hasSavedBreaks, pickHF } from './office-pages.js';
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

// ---- colours: every colour is set for both themes, so switching needs no redraw (see the .eo-* rules in style.css) ----
const toRgb = (h) => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
function lum(h) { const [r, g, b] = toRgb(h).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
function hsl(h) {
  const [r, g, b] = toRgb(h).map((v) => v / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const hh = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [hh * 60, s, l];
}
function fromHsl(h, s, l) {
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}
// A dark text colour becomes a light one of the same hue; light colours stay.
function adaptText(h) { const [hh, s, l] = hsl(h); return l >= 0.5 ? h : fromHsl(hh, Math.min(s, 0.8), Math.min(0.93, 1 - l * 0.6)); }
// Sets the light and dark variants of one colour role on an element (key: c text, f fill, bt bb bl br borders).
function cv(e, key, light, dark) {
  e.classList.add(`eo-${key}`);
  e.style.setProperty(`--${key}-l`, `#${light}`);
  e.style.setProperty(`--${key}-d`, dark ? `#${dark}` : 'transparent');
}
const nearWhite = (hex) => Math.min(...toRgb(hex)) >= 225; // a near-white fill becomes the dark page in dark mode; colours stay
const fillInfo = (hex) => ({ hex, kept: !nearWhite(hex) });
function applyFill(e, hex) {
  const fi = fillInfo(hex);
  cv(e, 'f', hex, fi.kept ? hex : null);
  const dark = lum(hex) > 0.5 ? '111111' : 'FFFFFF';
  cv(e, 'c', dark, fi.kept ? dark : 'E8E6F2');
  return fi;
}
// ---- fonts: bundled stand-ins (Decisions 231, 232), a similar bundled font for any other name, and a notice for missing ones ----
const BUNDLED = new Set(['Anton', 'Aptos', 'Arial', 'Caladea', 'Calibri', 'Calibri Light', 'Cambria', 'Candara', 'Century Gothic', 'Comic Neue', 'Comic Sans MS', 'Consolas', 'Corbel', 'Courier New', 'Cousine', 'Gelasio', 'Georgia', 'Gotham', 'Helvetica', 'Helvetica Neue', 'Impact', 'Lato', 'Lucida Console', 'Montserrat', 'Open Sans', 'Poppins', 'Roboto', 'Segoe UI', 'Tahoma', 'Times', 'Times New Roman', 'Trebuchet MS', 'Verdana']);
const SERIF = /times|georgia|cambria|garamond|palatino|book antiqua|bookman|baskerville|minion|century schoolbook|constantia|didot|serif/i;
const MONO = /courier|consolas|mono|menlo|lucida console|andale|typewriter/i;
let usedFonts = new Set();
let embeddedNames = new Set();
function stack(name) {
  const n = name.replace(/[^\p{L}\p{N} _.-]/gu, '').trim() || 'sans-serif';
  usedFonts.add(n);
  if (BUNDLED.has(n)) {
    const gen = SERIF.test(n) && !/sans/i.test(n) ? 'serif' : MONO.test(n) ? 'monospace' : 'sans-serif';
    return `"${n}", ${gen}`;
  }
  if (SERIF.test(n) && !/sans/i.test(n)) return `"${n}", "Times New Roman", serif`;
  if (MONO.test(n)) return `"${n}", "Courier New", monospace`;
  return `"${n}", "Open Sans", sans-serif`;
}
// Whether the phone itself has a font: a name that changes the width of a test string against plain fallbacks is present.
function phoneHasFont(name) {
  try {
    const c = document.createElement('canvas').getContext('2d');
    if (!c) return true;
    const t = 'mmmmmmmmmmlliWW@';
    const w = (f) => { c.font = `72px ${f}`; return c.measureText(t).width; };
    return ['monospace', 'serif', 'sans-serif'].some((g) => w(`"${name}",${g}`) !== w(g));
  } catch { return true; }
}
function fontNotice(host) {
  const missing = [...usedFonts].filter((n) => !BUNDLED.has(n) && !embeddedNames.has(n) && !/^(sans-serif|serif|monospace)$/.test(n) && !phoneHasFont(n));
  if (!missing.length) return null;
  const note = el('div', 'eo-fontnote');
  note.appendChild(el('span', 'eo-fontnote-t', `Fonts not on this phone, shown in a similar one: ${missing.slice(0, 4).join(', ')}${missing.length > 4 ? ` and ${missing.length - 4} more` : ''}.`));
  const x = el('button', 'eo-fontnote-x', '\u00d7'); x.type = 'button'; x.setAttribute('aria-label', 'Close notice');
  x.onclick = () => note.remove();
  note.appendChild(x);
  const bar = host.querySelector('.eo-bar');
  if (bar) bar.after(note); else host.prepend(note);
  return note;
}

// ---- viewer settings: one theme for the three viewers, kept on this phone (Decision 227) ----
const PREF_KEY = 'arkly_office_prefs';
const prefs = { theme: 'system', doc: 'page' };
let prefsLoaded = null;
function loadPrefs() {
  if (!prefsLoaded) {
    prefsLoaded = Preferences.get({ key: PREF_KEY }).then(({ value }) => {
      const p = value ? JSON.parse(value) : {};
      if (['system', 'light', 'dark'].includes(p.theme)) prefs.theme = p.theme;
      if (['page', 'reflow'].includes(p.doc)) prefs.doc = p.doc;
    }).catch(() => {});
  }
  return prefsLoaded;
}
const savePrefs = () => { try { Preferences.set({ key: PREF_KEY, value: JSON.stringify(prefs) }).catch(() => {}); } catch { /* a setting that cannot be saved still applies for now */ } };


// ---- tools shared by the three viewers: Find, Copy, Info (Decision 234). Text is only read and highlighted; the file is never changed. ----
function mark(root, q) { // wraps each match of q in a <mark>; a match inside one run of text
  const out = [];
  if (!root || !q) return out;
  const lq = q.toLowerCase(); const nodes = [];
  const w = document.createTreeWalker(root, 4); // text nodes
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const par = n.parentElement;
    if (n.nodeValue.toLowerCase().includes(lq) && par && !par.closest('mark.eo-hit, .eo-mark')) nodes.push(n);
  }
  for (const n of nodes) {
    const t = n.nodeValue; const lt = t.toLowerCase(); const frag = document.createDocumentFragment(); let i = 0;
    for (let j = lt.indexOf(lq); j >= 0; j = lt.indexOf(lq, i)) {
      frag.appendChild(document.createTextNode(t.slice(i, j)));
      const m = el('mark', 'eo-hit', t.slice(j, j + q.length)); frag.appendChild(m); out.push(m); i = j + q.length;
    }
    frag.appendChild(document.createTextNode(t.slice(i)));
    n.parentNode.replaceChild(frag, n);
  }
  return out;
}
function unmark(root) {
  if (!root) return;
  for (const m of Array.from(root.querySelectorAll('mark.eo-hit'))) m.replaceWith(document.createTextNode(m.textContent));
  root.normalize();
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back below */ }
  try {
    const ta = el('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove(); return !!ok;
  } catch { return false; }
}
const plural = (n, w) => `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`;
const wordCount = (t) => (t.trim() ? t.trim().split(/\s+/).length : 0);
const fontList = () => (usedFonts && usedFonts.size ? ` \u00b7 Fonts: ${[...usedFonts].slice(0, 6).join(', ')}` : '');
// t: { find: { count(q), go(k, q), clear() }, copy(), info(), goto?(n) }
function buildTools(host, ui, bar, t) {
  const closeMenu = () => host.classList.remove('eo-menu-open');
  const seg = el('div', 'eo-seg'); bar.appendChild(seg);
  const mkb = (text, label) => { const b = el('button', 'eo-segbtn', text); b.type = 'button'; b.setAttribute('aria-label', label); seg.appendChild(b); return b; };
  const bFind = mkb('Find', 'Find in this file'); const bCopy = mkb('Copy', 'Copy text'); const bInfo = mkb('Info', 'File information');
  const o = t.outline || null; const bOut = o ? mkb(o.label, o.title) : null;
  if (t.open) { const bo = mkb('Open with', 'Open with another app'); bo.onclick = () => { closeMenu(); ui.onActivity(); t.open(); }; }
  const fbar = el('div', 'eo-fbar'); fbar.hidden = true;
  const inp = el('input', 'eo-finput'); inp.type = 'search'; inp.placeholder = 'Find'; inp.setAttribute('aria-label', 'Find text');
  const cnt = el('span', 'eo-fcount');
  const fb = (text, label) => { const b = el('button', 'eo-segbtn eo-fbtn', text); b.type = 'button'; b.setAttribute('aria-label', label); return b; };
  const fp = fb('\u2039', 'Previous match'); const fn = fb('\u203a', 'Next match'); const fx = fb('\u00d7', 'Close find');
  fbar.append(inp, cnt, fp, fn);
  let gi = null;
  if (t.goto) { gi = el('input', 'eo-finput eo-gin'); gi.type = 'number'; gi.min = '1'; gi.placeholder = 'Go to #'; gi.setAttribute('aria-label', 'Go to slide number'); fbar.appendChild(gi); }
  fbar.appendChild(fx);
  const info = el('div', 'eo-info'); info.hidden = true;
  const panel = el('div', `eo-outline${o && o.strip ? ' eo-strip' : ''}`); panel.hidden = true;
  host.append(fbar, info, panel);
  let n = 0; let k = 0; let last = ''; let timer = null;
  const run = () => {
    const q = inp.value.trim(); last = q; ui.onActivity();
    t.find.clear(); n = q ? t.find.count(q) : 0; k = 0;
    cnt.textContent = !q ? '' : n ? `1/${n}` : 'No match';
    if (n) t.find.go(0, q);
  };
  const step = (d) => { if (!n) return; ui.onActivity(); k = (k + d + n) % n; cnt.textContent = `${k + 1}/${n}`; t.find.go(k, last); };
  inp.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 350); });
  inp.addEventListener('keydown', (e) => { if (e.key !== 'Enter') return; clearTimeout(timer); if (n && inp.value.trim() === last) step(1); else run(); });
  fp.onclick = () => step(-1); fn.onclick = () => step(1);
  if (gi) gi.addEventListener('keydown', (e) => { if (e.key === 'Enter' && gi.value) { ui.onActivity(); t.goto(Number(gi.value)); } });
  const toggleFind = () => {
    fbar.hidden = !fbar.hidden; bFind.classList.toggle('active', !fbar.hidden);
    if (fbar.hidden) { clearTimeout(timer); inp.value = ''; cnt.textContent = ''; n = 0; t.find.clear(); } else { ui.onActivity(); closeMenu(); inp.focus(); }
  };
  bFind.onclick = toggleFind; fx.onclick = toggleFind;
  let flash = null;
  bCopy.onclick = async () => {
    ui.onActivity(); const ok = await copyText(t.copy());
    bCopy.textContent = ok ? 'Copied' : 'Not copied'; clearTimeout(flash); flash = setTimeout(() => { bCopy.textContent = 'Copy'; }, 1400);
  };
  bInfo.onclick = () => { ui.onActivity(); info.hidden = !info.hidden; bInfo.classList.toggle('active', !info.hidden); if (!info.hidden) { info.textContent = t.info(); closeMenu(); } };
  const closePanel = () => { panel.hidden = true; if (bOut) bOut.classList.remove('active'); if (o) o.release(); panel.replaceChildren(); };
  if (bOut) bOut.onclick = () => {
    ui.onActivity();
    if (!panel.hidden) { closePanel(); return; }
    closeMenu(); panel.hidden = false; bOut.classList.add('active'); o.fill(panel, closePanel);
  };
  return { destroy() { clearTimeout(timer); clearTimeout(flash); if (o) o.release(); } };
}
const scrollTo = (e) => { if (e && e.scrollIntoView) e.scrollIntoView({ block: 'center', inline: 'center' }); };
const setCur = (state, m) => { if (state.cur) state.cur.classList.remove('eo-cur'); state.cur = m || null; if (state.cur) state.cur.classList.add('eo-cur'); };

function docTools(host, doc) {
  const root = () => host.querySelector('.eo-scroll'); const st = { cur: null }; let marks = [];
  const text = () => { const r = root(); if (!r) return ''; const c = r.querySelectorAll('.eo-sh-content'); return c.length ? Array.from(c, (x) => x.innerText || x.textContent || '').join('\n') : r.innerText || r.textContent || ''; };
  return {
    find: { count(q) { marks = mark(root(), q); return marks.length; }, go(k) { setCur(st, marks[k]); scrollTo(marks[k]); }, clear() { unmark(root()); marks = []; st.cur = null; } },
    copy: text,
    info: () => { const t = text(); return `${plural(wordCount(t), 'word')} \u00b7 ${plural(t.replace(/\s/g, '').length, 'character')}${fontList()}`; },
    // headings outline (Decision 240): one row per top-level heading, indented by level; a tap scrolls to it
    outline: {
      label: 'Outline', title: 'Headings outline',
      fill(panel, done) {
        let n = 0;
        for (const h of (doc && doc.heads) || []) {
          const label = (h.textContent || '').replace(/\s+/g, ' ').trim();
          if (!label || n >= 500) continue;
          n++;
          const lv = Math.min(6, Math.max(1, Number(h.tagName.slice(1)) - 1));
          const b = el('button', 'eo-orow', label.length > 90 ? `${label.slice(0, 89)}\u2026` : label); b.type = 'button';
          b.style.paddingLeft = `${14 + (lv - 1) * 14}px`;
          b.onclick = () => { done(); h.scrollIntoView({ block: 'start' }); };
          panel.appendChild(b);
        }
        if (!n) panel.appendChild(el('div', 'eo-ohint', 'This document has no headings.'));
      },
      release() {}
    }
  };
}
function xlTools(model, xl, host) {
  let hits = []; const st = { cur: null };
  const cells = () => host.querySelector('.eo-cells');
  return {
    find: {
      count(q) {
        const lq = q.toLowerCase(); hits = [];
        for (let i = 0; i < model.names.length && hits.length < 2000; i++) {
          let s; try { s = model.load(i); } catch { continue; }
          s.rows.forEach((row, r) => row.forEach((cell, c) => { if (cell && cell.v && hits.length < 2000 && cell.v.toLowerCase().includes(lq)) hits.push({ i, r, c }); }));
        }
        return hits.length;
      },
      go(k, q) {
        const h = hits[k]; if (!h) return;
        if (xl.cur() !== h.i) xl.show(h.i);
        unmark(cells());
        const td = host.querySelector(`.eo-cells tr[data-r="${h.r}"] td[data-c="${h.c}"]`); if (!td) return;
        setCur(st, mark(td, q)[0]); scrollTo(td); td.click();
      },
      clear() { unmark(cells()); hits = []; st.cur = null; }
    },
    copy: () => { const s = model.load(xl.cur()); return s.rows.map((row) => Array.from({ length: s.ncols }, (_, c) => (row[c] ? row[c].v : '')).join('\t')).join('\n'); },
    info: () => { const s = model.load(xl.cur()); return `${model.names.length} sheet${model.names.length === 1 ? '' : 's'} \u00b7 this sheet: ${s.rows.length.toLocaleString()} rows \u00d7 ${s.ncols} columns${fontList()}`; }
  };
}
const slideParas = (s) => { // one string per paragraph, in drawing order
  const out = []; const body = (b) => { for (const p of b.paras) out.push(p.runs.filter((r) => !r.br).map((r) => r.text).join('')); };
  for (const it of s.items) { if (it.text) body(it.text); if (it.t === 'table') for (const row of it.rows) for (const c of row.cells) if (!c.skip && c.body) body(c.body); }
  return out;
};
const slideRuns = (s) => { // one string per run, the units the drawing writes
  const out = []; const body = (b) => { for (const p of b.paras) for (const r of p.runs) if (!r.br && r.text) out.push(r.text); };
  for (const it of s.items) { if (it.text) body(it.text); if (it.t === 'table') for (const row of it.rows) for (const c of row.cells) if (!c.skip && c.body) body(c.body); }
  return out;
};
function pptTools(model, pp) {
  let hits = []; const st = { cur: null }; let tu = null; let io = null;
  return {
    find: {
      count(q) {
        const lq = q.toLowerCase(); hits = [];
        for (let i = 0; i < model.count && hits.length < 2000; i++) {
          let s; try { s = model.load(i); } catch { continue; }
          let k = 0;
          for (const t of slideRuns(s)) { const lt = t.toLowerCase(); for (let j = lt.indexOf(lq); j >= 0; j = lt.indexOf(lq, j + lq.length)) { if (hits.length < 2000) hits.push({ i, k }); k++; } }
        }
        return hits.length;
      },
      go(k, q) {
        const h = hits[k]; if (!h) return;
        if (pp.cur() !== h.i) pp.go(h.i);
        unmark(pp.stage); setCur(st, mark(pp.stage, q)[h.k]);
      },
      clear() { unmark(pp.stage); hits = []; st.cur = null; }
    },
    copy: () => { const s = model.load(pp.cur()); return [...slideParas(s), ...(s.notes ? ['', 'Notes', s.notes] : [])].join('\n'); },
    info: () => { const s = model.load(pp.cur()); return `${plural(model.count, 'slide')} \u00b7 slide ${pp.cur() + 1}: ${plural(wordCount(slideParas(s).join(' ')), 'word')}${fontList()}`; },
    goto: (n) => pp.go(Math.min(Math.max(1, n), model.count) - 1),
    // slide thumbnails (Decision 240): a strip drawn lazily with the slide drawing, scaled down; own object URLs, released on close
    outline: {
      label: 'Slides', title: 'Slide thumbnails', strip: true,
      fill(panel, done) {
        tu = urls();
        const W = 132; const bh = Math.round(W * model.size.h / model.size.w);
        const draw = (row) => {
          if (row.dataset.done) return; row.dataset.done = '1';
          let s; try { s = model.load(Number(row.dataset.i)); } catch { return; }
          const k = W / s.w; const box = row.querySelector('.eo-tbox');
          box.style.height = `${Math.round(s.h * k)}px`;
          const sc = el('div', 'eo-tscale'); sc.style.width = `${s.w}px`; sc.style.height = `${s.h}px`; sc.style.transform = `scale(${k})`;
          sc.appendChild(slideDom(s, tu)); box.appendChild(sc);
          const first = slideParas(s)[0]; if (first) row.querySelector('.eo-ttitle').textContent = first.slice(0, 60);
        };
        if (window.IntersectionObserver) {
          io = new window.IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { draw(e.target); io.unobserve(e.target); } }, { root: panel, rootMargin: '200px' });
        }
        for (let i = 0; i < model.count; i++) {
          const row = el('button', `eo-trow${i === pp.cur() ? ' eo-ocur' : ''}`); row.type = 'button'; row.dataset.i = String(i);
          row.setAttribute('aria-label', `Slide ${i + 1}`);
          const box = el('div', 'eo-tbox'); box.style.height = `${bh}px`;
          const cap = el('div', 'eo-tcap'); cap.append(el('span', 'eo-tnum', String(i + 1)), el('span', 'eo-ttitle'));
          row.append(box, cap);
          row.onclick = () => { done(); pp.go(i); };
          panel.appendChild(row);
          if (io) io.observe(row); else if (i < 20) draw(row);
        }
        const cur = panel.querySelector('.eo-ocur'); if (cur && cur.scrollIntoView) cur.scrollIntoView({ inline: 'center', block: 'nearest' });
      },
      release() { if (io) { io.disconnect(); io = null; } if (tu) { tu.revoke(); tu = null; } }
    }
  };
}

// ---- toolbar: theme switch (all kinds), view and zoom (docx) ----
function segment(labels, current, onPick) {
  const wrap = el('div', 'eo-seg');
  const btns = labels.map(([value, text, label]) => {
    const b = el('button', 'eo-segbtn', text); b.type = 'button'; b.setAttribute('aria-label', label);
    b.onclick = () => onPick(value);
    wrap.appendChild(b);
    return [value, b];
  });
  const sync = (v) => btns.forEach(([k, b]) => { b.classList.toggle('active', k === v); b.setAttribute('aria-pressed', String(k === v)); });
  sync(current);
  return { wrap, sync };
}
function buildBar(host, ui, extra, tools) {
  const bar = el('div', 'eo-bar');
  const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const applyTheme = () => { host.dataset.theme = prefs.theme === 'system' ? (mq && mq.matches ? 'dark' : 'light') : prefs.theme; };
  const theme = segment([['system', 'Auto', 'Follow the system theme'], ['light', 'Light', 'Light theme'], ['dark', 'Dark', 'Dark theme']], prefs.theme, (v) => {
    ui.onActivity(); prefs.theme = v; theme.sync(v); applyTheme(); savePrefs();
  });
  bar.appendChild(theme.wrap);
  if (extra) extra(bar);
  host.appendChild(bar);
  const tb = tools ? buildTools(host, ui, bar, tools) : null;
  applyTheme();
  if (mq && mq.addEventListener) mq.addEventListener('change', applyTheme);
  let gone = false;
  loadPrefs().then(() => { if (!gone) { theme.sync(prefs.theme); applyTheme(); } });
  return { theme, applyTheme, destroy() { gone = true; if (tb) tb.destroy(); if (mq && mq.removeEventListener) mq.removeEventListener('change', applyTheme); } };
}

function appendRuns(parent, runs, media, u, ctx = {}) {
  for (const r of runs) {
    if (r.br) { parent.appendChild(document.createElement('br')); continue; }
    if (r.lrb) continue;
    if (r.pb) { parent.appendChild(el('span', 'eo-pb')); continue; }
    if (r.chart) {
      const w = el('span', 'eo-chartwrap'); w.style.width = `${r.w}px`; cv(w, 'c', '404040', 'E8E6F2');
      w.appendChild(chartSvg(r.chart, r.w, r.h)); parent.appendChild(w);
      continue;
    }
    if (r.img) {
      const src = u.get(r.img, media);
      if (src) { const im = el('img', 'eo-img'); im.alt = ''; im.src = src; if (r.w) im.style.width = `${r.w}px`; parent.appendChild(im); }
      continue;
    }
    let node = el('span', '', r.field && ctx.pg ? ({ page: ctx.pg.label, numpages: String(ctx.pg.total), sectionpages: String(ctx.pg.secPages) })[r.field] : r.text);
    if (r.sup) { const s = el('sup'); s.appendChild(node); node = s; } else if (r.sub) { const s = el('sub'); s.appendChild(node); node = s; }
    const t = node;
    const st = t.style;
    if (r.font) st.fontFamily = stack(r.font);
    if (r.size) st.fontSize = `${r.size}px`;
    if (r.b) st.fontWeight = '700';
    if (r.i) st.fontStyle = 'italic';
    const deco = [r.u ? 'underline' : '', r.s ? 'line-through' : ''].filter(Boolean).join(' ');
    if (deco) st.textDecoration = deco;
    if (r.caps) st.textTransform = 'uppercase'; else if (r.sc) st.fontVariant = 'small-caps';
    if (r.text && r.text.includes('\t')) st.whiteSpace = 'pre-wrap';
    let fill = ctx.fill || null;
    if (r.bg) fill = applyFill(t, r.bg);
    if (r.color) cv(t, 'c', r.color, fill && fill.kept ? r.color : adaptText(r.color));
    parent.appendChild(node);
  }
}

// ---- docx: Page view (the page as set in the file, scaled to the screen) or Reflow ----
function borderStyle(e, key, side, spec) {
  const Side = { bt: 'Top', bb: 'Bottom', bl: 'Left', br: 'Right' }[key];
  if (!spec) return;
  if (spec.none) { e.style[`border${Side}`] = 'none'; return; }
  e.style[`border${Side}Width`] = `${spec.w}px`; e.style[`border${Side}Style`] = spec.style;
  if (spec.color) cv(e, key, spec.color, adaptText(spec.color)); else e.style[`border${Side}Color`] = 'var(--eo-line)';
}
function docxTable(b, media, u, ctx) {
  const wrap = el('div', 'eo-tablewrap');
  const t = el('table', 'eo-table eo-dtable');
  const total = b.grid.reduce((a, x) => a + (x || 0), 0);
  if (b.pct) t.style.width = `${b.pct}%`; else if (total) t.style.width = `${total}px`;
  if (b.grid.length && total) { t.style.tableLayout = 'fixed'; const cg = el('colgroup'); for (const g of b.grid) { const c = el('col'); if (g) c.style.width = `${g}px`; cg.appendChild(c); } t.appendChild(cg); }
  if (b.align === 'center') t.style.margin = '0 auto'; else if (b.align === 'right') t.style.marginLeft = 'auto';
  const tb = el('tbody');
  const last = b.rows.length - 1;
  b.rows.forEach((row, ri) => {
    const tr = el('tr');
    row.forEach((cell, ci) => {
      if (cell.skip) return;
      const td = el('td');
      if (cell.span > 1) td.colSpan = cell.span;
      if (cell.rowSpan > 1) td.rowSpan = cell.rowSpan;
      if (b.pad.l !== undefined) td.style.paddingLeft = `${b.pad.l}px`;
      if (b.pad.r !== undefined) td.style.paddingRight = `${b.pad.r}px`;
      if (b.pad.t !== undefined) td.style.paddingTop = `${b.pad.t}px`;
      if (b.pad.b !== undefined) td.style.paddingBottom = `${b.pad.b}px`;
      if (cell.valign === 'center') td.style.verticalAlign = 'middle'; else if (cell.valign === 'bottom') td.style.verticalAlign = 'bottom';
      const own = cell.borders || {};
      const lastCol = ci === row.length - 1;
      borderStyle(td, 'bt', 't', own.t || (ri === 0 ? b.borders.t : b.borders.h));
      borderStyle(td, 'bb', 'b', own.b || (ri === last ? b.borders.b : b.borders.h));
      borderStyle(td, 'bl', 'l', own.l || (ci === 0 ? b.borders.l : b.borders.v));
      borderStyle(td, 'br', 'r', own.r || (lastCol ? b.borders.r : b.borders.v));
      let fill = ctx.fill || null;
      if (cell.bg) fill = applyFill(td, cell.bg);
      if (cell.bold) td.style.fontWeight = '700';
      docxBlocks(cell.blocks, td, media, u, { fill, pg: ctx.pg });
      tr.appendChild(td);
    });
    tb.appendChild(tr);
  });
  t.appendChild(tb); wrap.appendChild(t);
  return wrap;
}
function docxBlocks(blocks, parent, media, u, ctx = {}) {
  for (const b of blocks) {
    if (b.t === 'table') { parent.appendChild(docxTable(b, media, u, ctx)); continue; }
    const pr = b.pr;
    const p = el(b.level ? `h${Math.min(b.level + 1, 6)}` : 'p', 'eo-p');
    const st = p.style;
    if (pr.align) st.textAlign = pr.align;
    st.marginTop = `${pr.sb || 0}px`; st.marginBottom = `${pr.sa || 0}px`;
    if (pr.l) st.marginLeft = `calc(${pr.l}px * var(--eo-indk, 1))`;
    if (pr.r) st.marginRight = `calc(${pr.r}px * var(--eo-indk, 1))`;
    if (pr.first) st.textIndent = `calc(${pr.first}px * var(--eo-indk, 1))`;
    if (pr.line) st.lineHeight = pr.line.mult ? String(pr.line.mult) : `${pr.line.px}px`;
    let fill = ctx.fill || null;
    if (pr.bg) fill = applyFill(p, pr.bg);
    if (pr.borders) { const bd = pr.borders; for (const [k, s] of [['bt', bd.t], ['bb', bd.b], ['bl', bd.l], ['br', bd.r]]) borderStyle(p, k, k, s); if (bd.t || bd.b || bd.l || bd.r) st.padding = '2px 4px'; }
    if (pr.pb) p.classList.add('eo-pbb');
    if (b.list) {
      const m = el('span', 'eo-mark', b.list.marker);
      const f = b.list.fmt || {};
      if (f.font) m.style.fontFamily = stack(f.font);
      if (f.size) m.style.fontSize = `${f.size}px`;
      if (f.b) m.style.fontWeight = '700';
      if (f.i) m.style.fontStyle = 'italic';
      if (b.list.hang) m.style.minWidth = `calc(${b.list.hang}px * var(--eo-indk, 1))`; else m.style.marginRight = '6px';
      if (f.color) cv(m, 'c', f.color, fill && fill.kept ? f.color : adaptText(f.color));
      p.appendChild(m);
    }
    appendRuns(p, b.runs, media, u, { fill, pg: ctx.pg });
    if (!b.runs.length) p.appendChild(el('br'));
    if (ctx.heads && b.level && b.runs.length && !b.cont) ctx.heads.push(p);
    parent.appendChild(p);
  }
}
// Zoom shared by docx and xlsx: CSS zoom on the content, two-finger pinch around the midpoint, 0.5 to 5 times.
function setupZoom(scroll, zoomer, fit, ui) {
  let user = 1;
  const level = () => fit() * user;
  const apply = () => { zoomer.style.zoom = String(level()); };
  const by = (factor, cx = 0, cy = 0) => {
    const z0 = level(); user = Math.max(0.5, Math.min(5, user * factor)); const z1 = level(); apply();
    if (z0 > 0) { scroll.scrollLeft = (scroll.scrollLeft + cx) * (z1 / z0) - cx; scroll.scrollTop = (scroll.scrollTop + cy) * (z1 / z0) - cy; }
  };
  let pinch = null;
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  scroll.addEventListener('touchstart', (e) => { if (e.touches.length === 2) pinch = { d: dist(e.touches), last: 1 }; }, { passive: true });
  scroll.addEventListener('touchmove', (e) => {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault(); ui.onActivity();
    const f = dist(e.touches) / pinch.d; const rc = scroll.getBoundingClientRect();
    by(f / pinch.last, (e.touches[0].clientX + e.touches[1].clientX) / 2 - rc.left, (e.touches[0].clientY + e.touches[1].clientY) / 2 - rc.top);
    pinch.last = f;
  }, { passive: false });
  scroll.addEventListener('touchend', () => { pinch = null; }, { passive: true });
  return { apply, by, user: () => user, reset() { user = 1; apply(); } };
}
function zoomButtons(ui, zoom) {
  const zin = el('button', 'eo-segbtn eo-zbtn', '+'); const zout = el('button', 'eo-segbtn eo-zbtn', '\u2212');
  zin.type = zout.type = 'button'; zin.setAttribute('aria-label', 'Zoom in'); zout.setAttribute('aria-label', 'Zoom out');
  zin.onclick = () => { ui.onActivity(); zoom.by(1.25); }; zout.onclick = () => { ui.onActivity(); zoom.by(0.8); };
  const z = el('div', 'eo-seg'); z.append(zout, zin);
  return z;
}

// Measuring for files with no saved page marker (Decision 243): the blocks are drawn once in a hidden column as wide as the
// page text area; tops and bottoms are read back, and a paragraph is cut at the last line that ends above the page bottom.
function makeEnv(model, u) {
  let host = null; let kids = []; let top0 = 0;
  const lineH = (c) => { const cs = getComputedStyle(c); const v = parseFloat(cs.lineHeight); return Number.isFinite(v) ? v : (parseFloat(cs.fontSize) || 16) * 1.2; };
  return {
    measure(blocks, page) {
      if (host) host.remove();
      host = el('div', 'eo-paper eo-measure'); host.style.width = `${page.w - page.l - page.r}px`; host.style.setProperty('--eo-indk', '1');
      document.body.appendChild(host);
      docxBlocks(blocks, host, model.media, u, {});
      top0 = host.getBoundingClientRect().top; kids = Array.from(host.children);
      return kids.map((c) => {
        const r = c.getBoundingClientRect();
        const m = { top: r.top - top0, bottom: r.bottom - top0, lh: lineH(c) };
        const tb = c.querySelector('table');
        if (tb) m.rows = Array.from(tb.rows).map((tr) => { const q = tr.getBoundingClientRect(); return { top: q.top - top0, bottom: q.bottom - top0 }; });
        return m;
      });
    },
    cut(i, limit) {
      const p = kids[i]; const nodes = []; let total = 0;
      const w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentNode && n.parentNode.closest && n.parentNode.closest('.eo-mark') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
      for (let n = w.nextNode(); n; n = w.nextNode()) { nodes.push({ n, s: total }); total += n.data.length; }
      const rg = document.createRange();
      const bottomAt = (o) => {
        let k = 0; while (k < nodes.length - 1 && o > nodes[k].s + nodes[k].n.data.length) k++;
        rg.setStart(p, 0); rg.setEnd(nodes[k].n, o - nodes[k].s);
        return rg.getBoundingClientRect().bottom - top0;
      };
      if (!nodes.length) return { offset: 0, bottom: p.getBoundingClientRect().bottom - top0 };
      let lo = 0; let hi = total;
      while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (bottomAt(mid) <= limit + 0.5) lo = mid; else hi = mid - 1; }
      return { offset: lo, bottom: bottomAt(lo) };
    },
    done() { if (host) host.remove(); host = null; kids = []; }
  };
}
const fontsReady = () => Promise.race([document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve(), new Promise((r) => setTimeout(r, 2500))]);

function mountDocx(model, host, u, ui, bars) {
  const scroll = el('div', 'eo-scroll'); const zoomer = el('div', 'eo-zoomer'); const paper = el('div', 'eo-paper');
  const saved = hasSavedBreaks(model);
  let lay = saved ? paginate(model) : null; // sheets from the saved breaks (Decision 242), or from measuring (Decision 243), or null: one sheet
  let auto = saved || !model.blocks.length ? 'done' : 'idle'; // measuring runs once, the first time Page view is shown
  let gone = false;
  const pgOf = () => (lay ? { ...model.page, w: Math.max(...lay.sheets.map((s) => model.sections[s.sec].page.w)) } : model.page);
  let pg = pgOf();
  const heads = []; // top-level heading elements, for the outline (Decision 240); refilled on each build
  let built = null;
  const banner = (t) => paper.appendChild(el('div', 'ev-banner', t));
  const notesOf = (list, parent) => {
    const fn = el('div', 'eo-fn');
    for (const f of list) { const row = el('div', 'eo-fnrow'); row.appendChild(el('sup', '', String(f.n))); const c = el('div'); docxBlocks(f.blocks, c, model.media, u); row.appendChild(c); fn.appendChild(row); }
    parent.appendChild(fn);
  };
  const flowDom = () => {
    if (model.truncated) banner(`Showing the first ${DOC_BLOCK_MAX.toLocaleString()} paragraphs. Use Open with app for the rest.`);
    if (auto === 'busy') banner('Laying out pages\u2026');
    else if (!lay && auto === 'done' && !saved && model.blocks.length && prefs.doc === 'page') banner('Pages could not be laid out for this file. Shown as one sheet.');
    if (model.header.length) { const h = el('div', 'eo-hf'); docxBlocks(model.header, h, model.media, u); paper.appendChild(h); }
    docxBlocks(model.blocks, paper, model.media, u, { heads });
    if (!model.blocks.length) paper.appendChild(el('p', 'ev-media-msg', 'This document has no text to show.'));
    if (model.footnotes.length) notesOf(model.footnotes, paper);
    if (model.footer.length) { const h = el('div', 'eo-hf'); docxBlocks(model.footer, h, model.media, u); paper.appendChild(h); }
  };
  const sheetsDom = () => {
    if (model.truncated) banner(`Showing the first ${DOC_BLOCK_MAX.toLocaleString()} paragraphs. Use Open with app for the rest.`);
    if (lay.note) banner(lay.note);
    const col = el('div', 'eo-sheetcol');
    for (const s of lay.sheets) {
      const q = model.sections[s.sec].page;
      const ctx = { pg: { label: s.label, total: lay.total, secPages: s.secPages } };
      const sh = el('section', 'eo-sheet'); sh.style.width = `${q.w}px`; sh.style.minHeight = `${q.h}px`;
      const head = el('div', 'eo-sh-head'); head.style.padding = `${q.hd}px ${q.r}px 0 ${q.l}px`; head.style.minHeight = `${q.t}px`;
      const hb = pickHF(model, s, 'hdr'); if (hb.length) { const h = el('div', 'eo-hf'); docxBlocks(hb, h, model.media, u, ctx); head.appendChild(h); }
      const body = el('div', 'eo-sh-body'); body.style.padding = `0 ${q.r}px 0 ${q.l}px`;
      const content = el('div', 'eo-sh-content'); docxBlocks(s.blocks, content, model.media, u, { heads }); body.appendChild(content);
      const notes = s.fns.map((n) => model.footnotes.find((f) => f.n === n)).filter(Boolean);
      if (notes.length) notesOf(notes, body);
      const foot = el('div', 'eo-sh-foot'); foot.style.padding = `0 ${q.r}px ${q.ft}px ${q.l}px`; foot.style.minHeight = `${q.b}px`;
      const fb = pickHF(model, s, 'ftr'); if (fb.length) { const h = el('div', 'eo-hf'); docxBlocks(fb, h, model.media, u, ctx); foot.appendChild(h); }
      sh.append(head, body, foot); col.appendChild(sh);
    }
    paper.appendChild(col);
  };
  const build = (page) => { // the DOM is rebuilt only when the view changes
    if (built === page) return;
    built = page; paper.replaceChildren(); heads.length = 0;
    if (page && lay) sheetsDom(); else flowDom();
  };
  const fit = () => (prefs.doc === 'page' && scroll.clientWidth ? Math.max(0.2, (scroll.clientWidth - 16) / pg.w) : 1);
  const zoom = setupZoom(scroll, zoomer, fit, ui);
  const apply = () => {
    const page = prefs.doc === 'page'; const sheeted = page && !!lay;
    if (page && auto === 'idle') { // show the text at once, then lay the pages out
      auto = 'busy';
      setTimeout(async () => {
        await fontsReady();
        if (gone) return;
        const env = makeEnv(model, u);
        try { lay = paginateAuto(model, env); } catch { lay = null; }
        env.done(); auto = 'done'; pg = pgOf(); built = null; apply();
      }, 30);
    }
    build(page);
    paper.classList.toggle('eo-pagemode', page && !lay); paper.classList.toggle('eo-sheets', sheeted); paper.classList.toggle('eo-reflow', !page);
    paper.style.setProperty('--eo-indk', page ? '1' : '0.5');
    zoomer.style.width = page ? `${pg.w}px` : '100%';
    paper.style.padding = sheeted ? '0' : page ? `${pg.t}px ${pg.r}px ${pg.b}px ${pg.l}px` : '16px';
    zoom.apply();
  };
  bars.extra = (bar) => {
    const view = segment([['page', 'Page', 'Page view'], ['reflow', 'Reflow', 'Reflow view']], prefs.doc, (v) => { ui.onActivity(); prefs.doc = v; view.sync(v); zoom.reset(); apply(); savePrefs(); });
    bar.append(view.wrap, zoomButtons(ui, zoom));
    bars.viewSync = () => view.sync(prefs.doc);
  };
  zoomer.appendChild(paper); scroll.appendChild(zoomer); host.appendChild(scroll);
  apply();
  let ro = null;
  if (window.ResizeObserver) { ro = new window.ResizeObserver(apply); ro.observe(scroll); }
  return { heads, destroy() { gone = true; if (ro) ro.disconnect(); } };
}

// ---- xlsx: a tab per sheet; cells keep font, fill, border, alignment, number format, widths, heights, merges ----
const HEAD_H = 24; const ROWNO_W = 44;
const BORDER_W = { hair: 1, thin: 1, dotted: 1, dashed: 1, medium: 2, mediumDashed: 2, thick: 3, double: 3 };
function cellCss(x, n) {
  const f = x.font; const L = []; const D = [];
  L.push(`font-family:${stack(f.name)}`, `font-size:${(f.size * 4 / 3).toFixed(2)}px`);
  if (f.b) L.push('font-weight:700'); if (f.i) L.push('font-style:italic');
  const deco = [f.u ? 'underline' : '', f.s ? 'line-through' : ''].filter(Boolean).join(' '); if (deco) L.push(`text-decoration:${deco}`);
  const kept = !!x.fill && !nearWhite(x.fill);
  if (x.fill) { L.push(`background:#${x.fill}`); D.push(`background:${kept ? `#${x.fill}` : 'transparent'}`); }
  if (f.color) { L.push(`color:#${f.color}`); D.push(`color:#${kept ? f.color : adaptText(f.color)}`); }
  else if (x.fill) { const ink = lum(x.fill) > 0.5 ? '111111' : 'FFFFFF'; L.push(`color:#${ink}`); D.push(`color:${kept ? `#${ink}` : '#E8E6F2'}`); }
  if (x.border) {
    for (const [k, Side] of [['t', 'top'], ['b', 'bottom'], ['l', 'left'], ['r', 'right']]) {
      const s = x.border[k]; if (!s) continue;
      const dashed = /dash/i.test(s.style) ? 'dashed' : /dot/i.test(s.style) ? 'dotted' : s.style === 'double' ? 'double' : 'solid';
      L.push(`border-${Side}:${BORDER_W[s.style] || 1}px ${dashed} #${s.color || '000000'}`);
      D.push(`border-${Side}-color:#${s.color ? adaptText(s.color) : 'E8E6F2'}`);
    }
  }
  if (x.h === 'left' || x.h === 'center' || x.h === 'right') L.push(`text-align:${x.h}`); else if (x.h === 'justify') L.push('text-align:justify');
  if (x.v === 'top') L.push('vertical-align:top'); else if (x.v === 'center') L.push('vertical-align:middle');
  if (x.wrap) L.push('white-space:pre-wrap', 'word-break:break-word');
  if (x.indent && (x.h === 'left' || x.h === 'general')) L.push(`padding-left:${x.indent * 9 + 3}px`);
  return `.xs${n}{${L.join(';')}}${D.length ? `.eo-host[data-theme="dark"] .xs${n}{${D.join(';')}}` : ''}`;
}
function mountXlsx(model, host, ui, bars, u) {
  const tabs = el('div', 'eo-tabs'); const grid = el('div', 'eo-grid'); const zoomer = el('div', 'eo-xzoom');
  const css = el('style'); const cellbar = el('div', 'eo-cellbar'); cellbar.hidden = true;
  const cbRef = el('span', 'eo-cbref'); const cbText = el('div', 'eo-cbtext'); cellbar.append(cbRef, cbText);
  grid.appendChild(zoomer);
  host.append(tabs, cellbar, grid, css);
  let selected = null;
  // tap a cell to read all of it, including text the cell is too small to show
  zoomer.addEventListener('click', (e) => {
    const td = e.target.closest && e.target.closest('td');
    if (selected) { selected.classList.remove('eo-sel'); selected = null; }
    if (!td || td.dataset.c === undefined) { cellbar.hidden = true; return; }
    ui.onActivity();
    selected = td; td.classList.add('eo-sel');
    cbRef.textContent = `${colName(Number(td.dataset.c))}${Number(td.parentElement.dataset.r) + 1}`;
    cbText.textContent = td.textContent; cellbar.hidden = false;
  });
  const zoom = setupZoom(grid, zoomer, () => 1, ui);
  bars.extra = (bar) => bar.appendChild(zoomButtons(ui, zoom));
  let cur = 0;
  const buttons = model.names.map((name, i) => {
    const b = el('button', 'eo-tab', name); b.type = 'button';
    b.onclick = () => { ui.onActivity(); show(i); };
    tabs.appendChild(b);
    return b;
  });
  function show(i) {
    cur = i;
    buttons.forEach((b, k) => b.classList.toggle('active', k === i));
    zoomer.replaceChildren(); css.textContent = ''; grid.scrollTop = 0; grid.scrollLeft = 0; cellbar.hidden = true; selected = null;
    let s;
    try { s = model.load(i); } catch (e) { zoomer.appendChild(el('p', 'ev-media-msg', e instanceof OfficeError ? e.message : 'This sheet could not be read.')); return; }
    if (!s.ncols && !s.rows.some((r) => r.length)) { zoomer.appendChild(el('p', 'ev-media-msg', 'This sheet is empty.')); return; }
    const notes = [];
    if (s.truncated) notes.push(`Showing the first ${SHEET_ROW_MAX.toLocaleString()} rows and ${SHEET_COL_MAX} columns. Use Open with app for the rest.`);
    if (s.hasDrawing) notes.push('Shapes and other drawings in this sheet are not shown.');
    for (const n of notes) zoomer.appendChild(el('div', 'ev-banner', n));
    // styles used by this sheet
    const used = new Set();
    for (const row of s.rows) for (const c of row) if (c && c.s) used.add(c.s);
    css.textContent = [...used].map((n) => cellCss(model.xfs[n] || model.xfs[0], n)).join('\n');
    const nrows = s.rows.length;
    const width = (c) => (s.colW[c] !== undefined ? s.colW[c] : s.defCol);
    const height = (r) => (s.rowH[r] !== undefined ? s.rowH[r] : s.defRow);
    const merge = new Map(); const skip = new Set(); const spilled = new Set();
    for (const m of s.merges) { merge.set(`${m.r},${m.c}`, m); for (let r = m.r; r < m.r + m.rs; r++) for (let c = m.c; c < m.c + m.cs; c++) if (r !== m.r || c !== m.c) skip.add(`${r},${c}`); }
    // how many columns a text cell runs over: the empty, unstyled cells to its right, as in a spreadsheet
    const spanOf = (r, c) => {
      const row = s.rows[r] || []; const cell = row[c]; const x = cell && model.xfs[cell.s];
      if (!cell || cell.k !== 's' || cell.v === '' || x.wrap || !(x.h === 'general' || x.h === 'left') || merge.has(`${r},${c}`)) return 1;
      const need = cell.v.length * x.font.size * 0.6 * 4 / 3; let have = width(c); let cs = 1;
      while (have < need && c + cs < SHEET_COL_MAX && width(c + cs) > 0) {
        const nx = row[c + cs];
        if (skip.has(`${r},${c + cs}`) || merge.has(`${r},${c + cs}`) || (nx && (nx.v !== '' || model.xfs[nx.s].fill || model.xfs[nx.s].border))) break;
        have += width(c + cs); cs++;
      }
      return cs;
    };
    // the table gets the columns that text runs into, and a few spare ones, so nothing is cut at the table edge
    let vcols = s.ncols;
    for (let r = 0; r < nrows; r++) { const row = s.rows[r] || []; for (let c = 0; c < row.length; c++) if (row[c]) vcols = Math.max(vcols, c + spanOf(r, c)); }
    vcols = Math.min(SHEET_COL_MAX, Math.max(vcols, s.ncols + 3));
    const topOf = []; let acc = HEAD_H; for (let r = 0; r < Math.min(s.freeze.rows, nrows); r++) { topOf[r] = acc; acc += height(r); }
    const leftOf = []; acc = ROWNO_W; for (let c = 0; c < s.freeze.cols; c++) { leftOf[c] = acc; acc += width(c); }
    const wrap = el('div', 'eo-sheet'); const t = el('table', `eo-cells${s.grid ? '' : ' eo-nogrid'}`);
    let total = ROWNO_W; for (let c = 0; c < vcols; c++) total += width(c);
    t.style.width = `${total}px`;
    const cg = el('colgroup'); const c0 = el('col'); c0.style.width = `${ROWNO_W}px`; cg.appendChild(c0);
    for (let c = 0; c < vcols; c++) { const col = el('col'); if (width(c) === 0) col.style.visibility = 'collapse'; else col.style.width = `${width(c)}px`; cg.appendChild(col); }
    t.appendChild(cg);
    const head = el('tr'); head.appendChild(el('th', 'eo-corner'));
    for (let c = 0; c < vcols; c++) { const th = el('th', 'eo-col', colName(c)); if (c < s.freeze.cols && s.freeze.cols) { th.style.left = `${leftOf[c]}px`; th.style.zIndex = '4'; } head.appendChild(th); }
    const thead = el('thead'); thead.appendChild(head); t.appendChild(thead);
    const tb = el('tbody');
    for (let r = 0; r < nrows; r++) {
      const tr = el('tr'); tr.dataset.r = String(r);
      if (height(r) === 0) { tr.style.display = 'none'; tb.appendChild(tr); continue; }
      tr.style.height = `${height(r)}px`;
      const rn = el('th', 'eo-row', String(r + 1));
      if (r < s.freeze.rows) { rn.style.top = `${topOf[r]}px`; rn.style.zIndex = '4'; }
      tr.appendChild(rn);
      const row = s.rows[r] || [];
      for (let c = 0; c < vcols; c++) {
        if (skip.has(`${r},${c}`) || spilled.has(`${r},${c}`)) continue;
        const cell = row[c];
        const x = cell ? model.xfs[cell.s] || model.xfs[0] : null;
        const td = el('td', cell && cell.s ? `xs${cell.s}` : '');
        if (cell && cell.v !== '') { td.textContent = cell.v; td.dataset.c = String(c); }
        if (cell && cell.k === 'n' && x.h === 'general') td.classList.add('eo-r'); else if (cell && cell.k === 'b' && x.h === 'general') td.classList.add('eo-ctr');
        const m = merge.get(`${r},${c}`);
        let cs = 1;
        if (m) { if (m.cs > 1) td.colSpan = m.cs; if (m.rs > 1) td.rowSpan = m.rs; cs = m.cs; }
        else {
          cs = spanOf(r, c);
          for (let k = 1; k < cs; k++) spilled.add(`${r},${c + k}`);
          if (cs > 1) td.colSpan = cs;
        }
        const fr = r < s.freeze.rows; const fc = c < s.freeze.cols;
        if (fr || fc) { td.classList.add('eo-frz'); if (fr) td.style.top = `${topOf[r]}px`; if (fc) td.style.left = `${leftOf[c]}px`; td.style.zIndex = fr && fc ? '3' : '2'; }
        tr.appendChild(td);
      }
      tb.appendChild(tr);
    }
    t.appendChild(tb);
    // charts and pictures sit over the cells they were placed on, behind the frozen headers
    if (s.objects && s.objects.length) {
      const ov = el('div', 'eo-xobjs');
      const colLeft = (c) => { let x = ROWNO_W; for (let k = 0; k < c; k++) x += width(k); return x; };
      const rowTop = (r) => { let y = HEAD_H; for (let k = 0; k < r; k++) y += height(k); return y; };
      for (const o of s.objects) {
        let x; let y; let w = 0; let h = 0;
        if (o.from) { x = colLeft(o.from.col) + o.from.colOff; y = rowTop(o.from.row) + o.from.rowOff; } else { x = ROWNO_W + o.abs.x; y = HEAD_H + o.abs.y; }
        if (o.to) { w = colLeft(o.to.col) + o.to.colOff - x; h = rowTop(o.to.row) + o.to.rowOff - y; } else if (o.ext) { w = o.ext.w; h = o.ext.h; }
        if (!(w > 8 && h > 8)) continue;
        const box = el('div', `eo-xobj${o.t === 'chart' ? ' eo-xchart' : ''}`);
        box.style.left = `${x}px`; box.style.top = `${y}px`; box.style.width = `${w}px`; box.style.height = `${h}px`;
        if (o.t === 'chart') { cv(box, 'c', '404040', 'E8E6F2'); box.appendChild(chartSvg(o.model, w, h)); }
        else { const src = u.get(o.path, s.media); if (!src) continue; const im = el('img'); im.alt = ''; im.src = src; box.appendChild(im); }
        ov.appendChild(box);
      }
      wrap.appendChild(ov);
    }
    wrap.appendChild(t); zoomer.appendChild(wrap);
  }
  show(0);
  return { show, cur: () => cur };
}

// ---- pptx: a slide on a canvas at the size set in the file, scaled to fit and centred; First, Previous, Play/Pause, Next, Last, swipe, zoom ----
const css = (c) => (c.a < 1 ? `rgba(${parseInt(c.hex.slice(0, 2), 16)},${parseInt(c.hex.slice(2, 4), 16)},${parseInt(c.hex.slice(4, 6), 16)},${c.a})` : `#${c.hex}`);
function fillCss(f) {
  if (!f) return '';
  if (f.grad) return `linear-gradient(${f.ang}deg,${f.grad.map((g) => `${css(g.c)} ${g.pos}%`).join(',')})`;
  return css(f);
}
const CLIP = { triangle: 'polygon(50% 0,100% 100%,0 100%)', rtTriangle: 'polygon(0 0,100% 100%,0 100%)', diamond: 'polygon(50% 0,100% 50%,50% 100%,0 50%)', hexagon: 'polygon(25% 0,75% 0,100% 50%,75% 100%,25% 100%,0 50%)', pentagon: 'polygon(50% 0,100% 38%,82% 100%,18% 100%,0 38%)', parallelogram: 'polygon(25% 0,100% 0,75% 100%,0 100%)', trapezoid: 'polygon(25% 0,75% 0,100% 100%,0 100%)', rightArrow: 'polygon(0 25%,60% 25%,60% 0,100% 50%,60% 100%,60% 75%,0 75%)', leftArrow: 'polygon(100% 25%,40% 25%,40% 0,0 50%,40% 100%,40% 75%,100% 75%)', chevron: 'polygon(0 0,75% 0,100% 50%,75% 100%,0 100%,25% 50%)', homePlate: 'polygon(0 0,75% 0,100% 50%,75% 100%,0 100%)' };
function paragraphs(body, parent, u, scale) {
  for (const p of body.paras) {
    const d = el('div');
    const st = d.style;
    st.textAlign = p.algn; st.whiteSpace = body.wrap === false ? 'pre' : 'pre-wrap';
    if (p.marL) st.marginLeft = `${p.marL}px`;
    const size = (p.size || 24) * scale;
    if (p.indent) st.textIndent = `${p.indent}px`;
    if (p.sb) st.marginTop = p.sb.px !== undefined ? `${p.sb.px}px` : `${p.sb.pct * size}px`;
    if (p.sa) st.marginBottom = p.sa.px !== undefined ? `${p.sa.px}px` : `${p.sa.pct * size}px`;
    if (p.ln) st.lineHeight = p.ln.pct !== undefined ? String(p.ln.pct * 1.2) : `${p.ln.px}px`; else st.lineHeight = '1.2';
    if (p.bullet) {
      const m = el('span', 'eo-mark', p.bullet.text);
      m.style.display = 'inline-block'; m.style.textIndent = '0';
      if (p.indent < 0) m.style.minWidth = `${-p.indent}px`; else m.style.marginRight = '6px';
      if (p.bullet.color) m.style.color = css(p.bullet.color);
      if (p.bullet.size) m.style.fontSize = `${size * p.bullet.size}px`;
      d.appendChild(m);
    }
    for (const r of p.runs) {
      if (r.br) { d.appendChild(document.createElement('br')); continue; }
      let node = el('span', '', r.text);
      if (r.sup) { const x = el('sup'); x.appendChild(node); node = x; } else if (r.sub) { const x = el('sub'); x.appendChild(node); node = x; }
      const ns = node.style;
      ns.fontFamily = stack(r.font || 'Calibri'); ns.fontSize = `${(r.size || 24) * scale}px`;
      if (r.color) ns.color = css(r.color);
      if (r.b) ns.fontWeight = '700'; if (r.i) ns.fontStyle = 'italic';
      const deco = [r.u ? 'underline' : '', r.s ? 'line-through' : ''].filter(Boolean).join(' '); if (deco) ns.textDecoration = deco;
      if (r.caps) ns.textTransform = 'uppercase';
      d.appendChild(node);
    }
    if (!p.runs.length) { d.appendChild(el('br')); st.fontSize = `${size}px`; }
    parent.appendChild(d);
  }
}
function slideDom(s, u) {
  const cv = el('div', 'eo-canvas');
  const ink = s.bg && s.bg.hex && lum(s.bg.hex) < 0.35 ? '#F2F2F2' : '#404040'; // chart text against this slide's background
  cv.style.width = `${s.w}px`; cv.style.height = `${s.h}px`;
  if (s.bg && s.bg.img) { const url = u.get(s.bg.img, s.media); if (url) { cv.style.backgroundImage = `url(${url})`; cv.style.backgroundSize = '100% 100%'; } }
  else if (s.bg) cv.style.background = fillCss(s.bg);
  for (const it of s.items) {
    const n = el('div', 'eo-it'); const st = n.style;
    st.left = `${it.x}px`; st.top = `${it.y}px`; st.width = `${it.w}px`; st.height = `${it.h}px`;
    const tf = [it.rot ? `rotate(${it.rot}deg)` : '', it.fh ? 'scaleX(-1)' : '', it.fv ? 'scaleY(-1)' : ''].filter(Boolean).join(' '); if (tf) st.transform = tf;
    if (it.t === 'pic') {
      const url = u.get(it.path, s.media);
      if (!url) continue;
      st.overflow = 'hidden';
      const im = el('img'); im.alt = ''; im.src = url; im.style.position = 'absolute';
      if (it.crop && (it.crop.l || it.crop.r || it.crop.t || it.crop.b)) {
        const iw = it.w * 100 / Math.max(1, 100 - it.crop.l - it.crop.r); const ih = it.h * 100 / Math.max(1, 100 - it.crop.t - it.crop.b);
        im.style.width = `${iw}px`; im.style.height = `${ih}px`; im.style.left = `${-iw * it.crop.l / 100}px`; im.style.top = `${-ih * it.crop.t / 100}px`;
      } else { im.style.width = '100%'; im.style.height = '100%'; }
      n.appendChild(im);
      if (it.line && it.line.color) { st.boxSizing = 'border-box'; st.border = `${it.line.w}px ${it.line.dash} ${css(it.line.color)}`; }
    } else if (it.t === 'table') {
      const total = it.cols.reduce((a, x) => a + x, 0);
      st.width = `${total}px`; st.height = 'auto';
      const t = el('table', 'eo-ptable'); t.style.width = `${total}px`;
      const cg = el('colgroup'); for (const w of it.cols) { const c = el('col'); c.style.width = `${w}px`; cg.appendChild(c); } t.appendChild(cg);
      const tb = el('tbody');
      for (const row of it.rows) {
        const tr = el('tr'); tr.style.height = `${row.h}px`;
        for (const c of row.cells) {
          if (c.skip) continue;
          const td = el('td'); const ts = td.style;
          if (c.span > 1) td.colSpan = c.span; if (c.rowSpan > 1) td.rowSpan = c.rowSpan;
          if (c.fill) ts.background = fillCss(c.fill);
          for (const [k, side] of [['l', 'Left'], ['r', 'Right'], ['t', 'Top'], ['b', 'Bottom']]) { const b = c.bd[k]; ts[`border${side}`] = b && b.color ? `${b.w}px ${b.dash} ${css(b.color)}` : 'none'; }
          ts.padding = `${c.pt}px ${c.pr}px ${c.pb}px ${c.pl}px`; ts.verticalAlign = c.anchor === 'ctr' ? 'middle' : c.anchor === 'b' ? 'bottom' : 'top';
          paragraphs(c.body, td, u, 1);
          tr.appendChild(td);
        }
        tb.appendChild(tr);
      }
      t.appendChild(tb); n.appendChild(t);
    } else if (it.t === 'chart') {
      st.background = 'rgba(255,255,255,0)';
      n.appendChild(chartSvg(it.chart, it.w, it.h, ink));
    } else if (it.t === 'note') {
      st.border = '1px dashed #888'; st.display = 'flex'; st.alignItems = 'center'; st.justifyContent = 'center'; st.color = '#666'; st.fontSize = '16px'; st.background = 'rgba(128,128,128,.08)';
      n.textContent = it.text;
    } else {
      const g = it.geom;
      st.boxSizing = 'border-box';
      if (/^(line|straightConnector1|bentConnector\d|curvedConnector\d)$/.test(g)) {
        const ns = 'http://www.w3.org/2000/svg';
        const sv = document.createElementNS(ns, 'svg'); sv.setAttribute('width', String(Math.max(1, it.w))); sv.setAttribute('height', String(Math.max(1, it.h))); sv.style.overflow = 'visible';
        const ln = document.createElementNS(ns, 'line'); ln.setAttribute('x1', '0'); ln.setAttribute('y1', '0'); ln.setAttribute('x2', String(it.w)); ln.setAttribute('y2', String(it.h));
        ln.setAttribute('stroke', it.line && it.line.color ? css(it.line.color) : '#000'); ln.setAttribute('stroke-width', String(it.line ? it.line.w : 1));
        if (it.line && it.line.dash !== 'solid') ln.setAttribute('stroke-dasharray', it.line.dash === 'dotted' ? '2 3' : '6 4');
        sv.appendChild(ln); n.appendChild(sv);
      } else {
        if (it.fill) st.background = fillCss(it.fill);
        if (CLIP[g]) st.clipPath = CLIP[g];
        else {
          if (it.line && it.line.color) st.border = `${it.line.w}px ${it.line.dash} ${css(it.line.color)}`;
          if (g === 'ellipse') st.borderRadius = '50%';
          else if (g === 'roundRect') st.borderRadius = `${Math.min(it.w, it.h) * (it.adj ? it.adj / 100000 : 0.16667)}px`;
        }
      }
      if (it.text) {
        const b = it.text; const tx = el('div', 'eo-tx'); const ts = tx.style;
        ts.padding = `${b.t}px ${b.r}px ${b.b}px ${b.l}px`;
        ts.justifyContent = b.anchor === 'ctr' ? 'center' : b.anchor === 'b' ? 'flex-end' : 'flex-start';
        paragraphs(b, tx, u, b.scale);
        n.appendChild(tx);
      }
    }
    cv.appendChild(n);
  }
  return cv;
}
const ICONS = {
  first: 'M6 5h2.4v14H6zM19 5v14L9 12z', prev: 'M17 5v14L7 12z', play: 'M8 5v14l11-7z', pause: 'M6.5 5h4v14h-4zM13.5 5h4v14h-4z',
  next: 'M7 5v14l10-7z', last: 'M15.6 5H18v14h-2.4zM5 5v14l10-7z'
};
function icon(kind) {
  const ns = 'http://www.w3.org/2000/svg';
  const sv = document.createElementNS(ns, 'svg'); sv.setAttribute('viewBox', '0 0 24 24'); sv.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path'); path.setAttribute('d', ICONS[kind]); path.setAttribute('fill', 'currentColor');
  sv.appendChild(path);
  return sv;
}
const PLAY_MS = 5000; // time each slide stays up while playing

// root is the viewer host (the part of the page that goes full screen while playing)
function mountPptx(model, host, ui, count, u, bars, root) {
  const scroll = el('div', 'eo-scroll eo-pscroll'); const zoomer = el('div', 'eo-zoomer'); const stage = el('div'); const notes = el('div', 'eo-notes-wrap');
  const veil = el('div', 'eo-veil');
  const bar = el('div', 'eo-slidebar');
  const mk = (label, kind) => { const b = el('button', 'eo-nav eo-navi'); b.type = 'button'; b.setAttribute('aria-label', label); b.appendChild(icon(kind)); return b; };
  const first = mk('First slide', 'first'); const prev = mk('Previous slide', 'prev'); const play = mk('Play', 'play'); const next = mk('Next slide', 'next'); const last = mk('Last slide', 'last');
  bar.append(first, prev, play, next, last);
  zoomer.appendChild(stage); scroll.append(zoomer, notes); host.append(veil, scroll, bar);
  const sw = model.size.w; const sh = model.size.h;
  // the whole slide fits the area, in portrait and in landscape
  const fit = () => {
    const cw = scroll.clientWidth - 16; const ch = scroll.clientHeight - 24;
    if (!(cw > 0)) return 1;
    const byW = cw / sw;
    return Math.max(0.1, ch > 0 ? Math.min(byW, ch / sh) : byW);
  };
  const zoom = setupZoom(scroll, zoomer, fit, ui);
  zoomer.style.width = `${sw}px`;
  bars.extra = (b) => b.appendChild(zoomButtons(ui, zoom));
  let index = 0; let playing = false; let timer = null;
  function show(i) {
    index = i;
    count(`${i + 1}/${model.count}`);
    first.disabled = prev.disabled = i === 0; next.disabled = last.disabled = i === model.count - 1;
    stage.replaceChildren(); notes.replaceChildren(); u.revoke();
    zoom.reset(); scroll.scrollTop = 0; scroll.scrollLeft = 0;
    let s;
    try { s = model.load(i); } catch (e) { stage.appendChild(el('p', 'ev-media-msg', e instanceof OfficeError ? e.message : 'This slide could not be read.')); return; }
    stage.appendChild(slideDom(s, u));
    if (s.notes) { const n = el('div', 'eo-notes'); n.appendChild(el('div', 'eo-notes-h', 'Notes')); n.appendChild(el('div', 'eo-notes-t', s.notes)); notes.appendChild(n); }
  }
  // Play: each slide stays PLAY_MS, then the next; stops on the last. Playing blurs the rest of the page (see .eo-playing).
  // The timer is not user activity, so the auto-lock still applies.
  const arm = () => { if (timer) clearInterval(timer); timer = setInterval(() => { if (index < model.count - 1) show(index + 1); else setPlaying(false); }, PLAY_MS); };
  function setPlaying(on) {
    playing = on;
    if (timer) { clearInterval(timer); timer = null; }
    root.classList.toggle('eo-playing', on);
    play.replaceChildren(icon(on ? 'pause' : 'play')); play.setAttribute('aria-label', on ? 'Pause' : 'Play');
    if (on) arm();
    zoom.reset();
  }
  const go = (i) => { if (i < 0 || i >= model.count || i === index) return; ui.onActivity(); show(i); if (playing) arm(); };
  first.onclick = () => go(0); prev.onclick = () => go(index - 1); next.onclick = () => go(index + 1); last.onclick = () => go(model.count - 1);
  play.onclick = () => { ui.onActivity(); if (!playing && index === model.count - 1) show(0); setPlaying(!playing); };
  // swipe sideways to change slide, only while not zoomed in
  let t0 = null;
  scroll.addEventListener('touchstart', (e) => { t0 = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null; }, { passive: true });
  scroll.addEventListener('touchend', (e) => {
    if (!t0 || !e.changedTouches.length || zoom.user() > 1.05) { t0 = null; return; }
    const dx = e.changedTouches[0].clientX - t0.x; const dy = e.changedTouches[0].clientY - t0.y; t0 = null;
    if (Math.abs(dx) > 70 && Math.abs(dy) < 50) go(dx < 0 ? index + 1 : index - 1);
  }, { passive: true });
  show(0);
  let ro = null;
  if (window.ResizeObserver) { ro = new window.ResizeObserver(() => zoom.apply()); ro.observe(scroll); }
  return { stage, go, cur: () => index, destroy() { if (timer) clearInterval(timer); root.classList.remove('eo-playing'); if (ro) ro.disconnect(); } };
}

// Reads the bytes and draws them into host (an empty element). Returns { destroy }. Throws OfficeError with a message
// fit to show; any other error is shown as the generic one by the caller.
export function mountOffice(kind, bytes, host, ctx) {
  const { ui, setCount = () => {} } = ctx;
  const u = urls();
  host.classList.add('ev-office');
  usedFonts = new Set(); embeddedNames = new Set();
  const faces = [];
  const bars = {};
  let inner = {};
  const model = kind === 'docx' ? readDocx(bytes) : kind === 'xlsx' ? readXlsx(bytes) : kind === 'pptx' ? readPptx(bytes) : null;
  if (!model) throw new OfficeError('This type is not supported here.');
  if (kind === 'docx' && model.embedded.length && typeof FontFace !== 'undefined') {
    for (const f of model.embedded) {
      try {
        const face = new FontFace(f.name, f.bytes, { weight: f.b ? '700' : '400', style: f.i ? 'italic' : 'normal' });
        face.load().then(() => document.fonts.add(face)).catch(() => {});
        faces.push(face); embeddedNames.add(f.name);
      } catch { /* a font that cannot be read is skipped */ }
    }
  }
  if (kind === 'docx') {
    // the toolbar comes first; the docx mount fills in its view and zoom controls through bars.extra
    const holder = el('div'); const tmp = { extra: null };
    inner = mountDocx(model, holder, u, ui, tmp);
    tmp.tools = docTools(host, inner); tmp.tools.open = ctx.openWith;
    bars.bar = buildBar(host, ui, tmp.extra, tmp.tools);
    if (tmp.viewSync) loadPrefs().then(tmp.viewSync);
    while (holder.firstChild) host.appendChild(holder.firstChild);
  } else if (kind === 'xlsx') {
    const holder = el('div'); const tmp = { extra: null };
    inner = mountXlsx(model, holder, ui, tmp, u);
    tmp.tools = xlTools(model, inner, host); tmp.tools.open = ctx.openWith;
    bars.bar = buildBar(host, ui, tmp.extra, tmp.tools);
    while (holder.firstChild) host.appendChild(holder.firstChild);
  } else {
    const holder = el('div'); const tmp = { extra: null };
    inner = mountPptx(model, holder, ui, setCount, u, tmp, host);
    tmp.tools = pptTools(model, inner); tmp.tools.open = ctx.openWith;
    bars.bar = buildBar(host, ui, tmp.extra, tmp.tools);
    while (holder.firstChild) host.appendChild(holder.firstChild);
  }
  const fnote = fontNotice(host);
  // the notice folds away with the title bar on scroll (Decision 243)
  const stopChrome = chromeOnScroll(host, (h) => { if (fnote) fnote.classList.toggle('eo-folded', h); if (ctx.onChrome) ctx.onChrome(h); }, '.eo-scroll, .eo-grid');
  return { destroy() { stopChrome(); for (const f of faces) { try { document.fonts.delete(f); } catch { /* not added */ } } if (inner.destroy) inner.destroy(); bars.bar.destroy(); u.revoke(); host.replaceChildren(); host.classList.remove('ev-office'); delete host.dataset.theme; setCount(''); } };
}
