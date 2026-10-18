// office-render.js — draws what office-read.js returns into the explorer viewer (Decisions 226, 227). Every string from a file
// is set with textContent; no markup from a file is ever parsed. Pictures become object URLs, revoked on destroy.

import { Preferences } from '@capacitor/preferences';
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
function stack(name) {
  const n = name.replace(/["']/g, '');
  const gen = /times|georgia|cambria|garamond|palatino|book antiqua|minion|century|serif(?!.*sans)/i.test(n) && !/sans/i.test(n) ? 'serif' : /courier|consolas|mono|menlo|lucida console/i.test(n) ? 'monospace' : 'sans-serif';
  const alias = { Calibri: 'Calibri, Carlito, Roboto', Cambria: 'Cambria, Caladea, "Noto Serif"', Arial: 'Arial, Roboto', 'Times New Roman': '"Times New Roman", "Noto Serif"', 'Courier New': '"Courier New", "Droid Sans Mono"' }[n];
  return `${alias || `"${n}"`}, ${gen}`;
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
function buildBar(host, ui, extra) {
  const bar = el('div', 'eo-bar');
  const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const applyTheme = () => { host.dataset.theme = prefs.theme === 'system' ? (mq && mq.matches ? 'dark' : 'light') : prefs.theme; };
  const theme = segment([['system', 'Auto', 'Follow the system theme'], ['light', 'Light', 'Light theme'], ['dark', 'Dark', 'Dark theme']], prefs.theme, (v) => {
    ui.onActivity(); prefs.theme = v; theme.sync(v); applyTheme(); savePrefs();
  });
  bar.appendChild(theme.wrap);
  if (extra) extra(bar);
  host.appendChild(bar);
  applyTheme();
  if (mq && mq.addEventListener) mq.addEventListener('change', applyTheme);
  let gone = false;
  loadPrefs().then(() => { if (!gone) { theme.sync(prefs.theme); applyTheme(); } });
  return { theme, applyTheme, destroy() { gone = true; if (mq && mq.removeEventListener) mq.removeEventListener('change', applyTheme); } };
}

function appendRuns(parent, runs, media, u, ctx = {}) {
  for (const r of runs) {
    if (r.br) { parent.appendChild(document.createElement('br')); continue; }
    if (r.pb) { parent.appendChild(el('span', 'eo-pb')); continue; }
    if (r.img) {
      const src = u.get(r.img, media);
      if (src) { const im = el('img', 'eo-img'); im.alt = ''; im.src = src; if (r.w) im.style.width = `${r.w}px`; parent.appendChild(im); }
      continue;
    }
    let node = el('span', '', r.text);
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
      docxBlocks(cell.blocks, td, media, u, { fill });
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
    appendRuns(p, b.runs, media, u, { fill });
    if (!b.runs.length) p.appendChild(el('br'));
    parent.appendChild(p);
  }
}
function mountDocx(model, host, u, ui, bars) {
  const scroll = el('div', 'eo-scroll'); const zoomer = el('div', 'eo-zoomer'); const paper = el('div', 'eo-paper');
  let user = 1;
  const pg = model.page;
  const fit = () => (prefs.doc === 'page' && scroll.clientWidth ? Math.max(0.2, (scroll.clientWidth - 16) / pg.w) : 1);
  const level = () => fit() * user;
  const apply = () => {
    const page = prefs.doc === 'page';
    paper.classList.toggle('eo-pagemode', page); paper.classList.toggle('eo-reflow', !page);
    paper.style.setProperty('--eo-indk', page ? '1' : '0.5');
    zoomer.style.width = page ? `${pg.w}px` : '100%';
    paper.style.padding = page ? `${pg.t}px ${pg.r}px ${pg.b}px ${pg.l}px` : '16px';
    zoomer.style.zoom = String(level());
  };
  const zoomBy = (factor, cx = 0, cy = 0) => {
    const z0 = level(); user = Math.max(0.5, Math.min(5, user * factor)); const z1 = level(); apply();
    if (z0 > 0) { scroll.scrollLeft = (scroll.scrollLeft + cx) * (z1 / z0) - cx; scroll.scrollTop = (scroll.scrollTop + cy) * (z1 / z0) - cy; }
  };
  bars.extra = (bar) => {
    const view = segment([['page', 'Page', 'Page view'], ['reflow', 'Reflow', 'Reflow view']], prefs.doc, (v) => { ui.onActivity(); prefs.doc = v; view.sync(v); user = 1; apply(); savePrefs(); });
    const zin = el('button', 'eo-segbtn eo-zbtn', '+'); const zout = el('button', 'eo-segbtn eo-zbtn', '\u2212');
    zin.type = zout.type = 'button'; zin.setAttribute('aria-label', 'Zoom in'); zout.setAttribute('aria-label', 'Zoom out');
    zin.onclick = () => { ui.onActivity(); zoomBy(1.25); }; zout.onclick = () => { ui.onActivity(); zoomBy(0.8); };
    const z = el('div', 'eo-seg'); z.append(zout, zin);
    bar.append(view.wrap, z);
    bars.viewSync = () => view.sync(prefs.doc);
  };
  // pinch with two fingers: zoom around the midpoint
  let pinch = null;
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  scroll.addEventListener('touchstart', (e) => { if (e.touches.length === 2) pinch = { d: dist(e.touches), last: 1 }; }, { passive: true });
  scroll.addEventListener('touchmove', (e) => {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault(); ui.onActivity();
    const f = dist(e.touches) / pinch.d; const r = scroll.getBoundingClientRect();
    zoomBy(f / pinch.last, (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left, (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top);
    pinch.last = f;
  }, { passive: false });
  scroll.addEventListener('touchend', () => { pinch = null; }, { passive: true });

  if (model.truncated) paper.appendChild(el('div', 'ev-banner', `Showing the first ${DOC_BLOCK_MAX.toLocaleString()} paragraphs. Use Open with app for the rest.`));
  if (model.header.length) { const h = el('div', 'eo-hf'); docxBlocks(model.header, h, model.media, u); paper.appendChild(h); }
  docxBlocks(model.blocks, paper, model.media, u);
  if (!model.blocks.length) paper.appendChild(el('p', 'ev-media-msg', 'This document has no text to show.'));
  if (model.footnotes.length) {
    const fn = el('div', 'eo-fn');
    for (const f of model.footnotes) { const row = el('div', 'eo-fnrow'); row.appendChild(el('sup', '', String(f.n))); const c = el('div'); docxBlocks(f.blocks, c, model.media, u); row.appendChild(c); fn.appendChild(row); }
    paper.appendChild(fn);
  }
  if (model.footer.length) { const h = el('div', 'eo-hf'); docxBlocks(model.footer, h, model.media, u); paper.appendChild(h); }
  zoomer.appendChild(paper); scroll.appendChild(zoomer); host.appendChild(scroll);
  apply();
  let ro = null;
  if (window.ResizeObserver) { ro = new window.ResizeObserver(apply); ro.observe(scroll); }
  return { destroy() { if (ro) ro.disconnect(); } };
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
  const bars = {};
  let inner = {};
  const model = kind === 'docx' ? readDocx(bytes) : kind === 'xlsx' ? readXlsx(bytes) : kind === 'pptx' ? readPptx(bytes) : null;
  if (!model) throw new OfficeError('This type is not supported here.');
  if (kind === 'docx') {
    // the toolbar comes first; the docx mount fills in its view and zoom controls through bars.extra
    const holder = el('div'); const tmp = { extra: null };
    inner = mountDocx(model, holder, u, ui, tmp);
    bars.bar = buildBar(host, ui, tmp.extra);
    if (tmp.viewSync) loadPrefs().then(tmp.viewSync);
    while (holder.firstChild) host.appendChild(holder.firstChild);
  } else {
    bars.bar = buildBar(host, ui, null);
    inner = kind === 'xlsx' ? mountXlsx(model, host, ui) : mountPptx(model, host, ui, setCount, u);
  }
  return { destroy() { if (inner.destroy) inner.destroy(); bars.bar.destroy(); u.revoke(); host.replaceChildren(); host.classList.remove('ev-office'); delete host.dataset.theme; setCount(''); } };
}
