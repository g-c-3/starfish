// office-odf.js — view-only readers for odt, ods and odp (Decision 451). An OpenDocument file is a zip of XML parts; the
// readers return the same plain models as office-read.js (Word, Excel, PowerPoint), so office-render.js draws them
// unchanged. Nothing is rendered, written or sent here, and no markup from the file is passed on.

import { unzipSync } from 'fflate';
import { OfficeError, DOC_BLOCK_MAX, SHEET_ROW_MAX, SHEET_COL_MAX } from './office-read.js';

const PART_MAX = 25 * 1024 * 1024; // one unpacked part
const TOTAL_MAX = 120 * 1024 * 1024; // all unpacked parts together
const SLIDE_MAX = 500;
const IMG_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' };
const PX_PT = 4 / 3;
const MIMES = { text: 'application/vnd.oasis.opendocument.text', spreadsheet: 'application/vnd.oasis.opendocument.spreadsheet', presentation: 'application/vnd.oasis.opendocument.presentation' };

// ---- zip and XML helpers ----
const decoder = new TextDecoder('utf-8');

// 'text', 'spreadsheet', 'presentation' or null when the bytes are not an OpenDocument file.
export function odfKind(bytes) {
  try {
    const f = unzipSync(bytes, { filter: (e) => e.name === 'mimetype' && e.originalSize < 256 });
    const m = f.mimetype ? decoder.decode(f.mimetype).trim() : '';
    for (const k of Object.keys(MIMES)) if (m.startsWith(MIMES[k])) return k;
  } catch { /* not a zip */ }
  return null;
}

function unpack(bytes) {
  let files; let total = 0;
  try {
    files = unzipSync(bytes, {
      filter: (f) => {
        const n = f.name;
        if (n.startsWith('Thumbnails/') || n.includes('..')) return false;
        const ext = n.slice(n.lastIndexOf('.') + 1).toLowerCase();
        if (!(n === 'content.xml' || n === 'styles.xml' || n === 'settings.xml' || (n.startsWith('Pictures/') && IMG_MIME[ext]))) return false;
        if (f.originalSize > PART_MAX) return false;
        total += f.originalSize;
        return total <= TOTAL_MAX;
      }
    });
  } catch { throw new OfficeError('This file is protected or damaged.'); }
  if (!files['content.xml']) throw new OfficeError('This is not a valid file of this type.');
  return files;
}

function xml(files, name) {
  const b = files[name];
  if (!b) return null;
  const txt = decoder.decode(b);
  const doc = new DOMParser().parseFromString(txt, 'application/xml');
  const root = doc.documentElement; if (!root) return null;
  if (txt.length > 2e6) return root.localName === 'parsererror' || (root.firstElementChild && root.firstElementChild.localName === 'parsererror') ? null : root;
  return doc.getElementsByTagName('parsererror').length ? null : root;
}

const kids = (n, local) => { const o = []; if (n) for (const c of n.children) if (c.localName === local) o.push(c); return o; };
const kid = (n, local) => { if (n) for (const c of n.children) if (c.localName === local) return c; return null; };
const at = (n, local) => { if (!n) return null; for (const a of n.attributes) if (a.localName === local) return a.value; return null; };
const desc = (n, local, out = []) => { if (n) for (const c of n.children) { if (c.localName === local) out.push(c); desc(c, local, out); } return out; };

// Lengths in px at 96 dpi; null when absent or not a length.
function px(v) {
  if (v === null || v === undefined) return null;
  const m = /^(-?[\d.]+)\s*(cm|mm|in|pt|px|pc)?$/.exec(String(v).trim());
  if (!m) return null;
  const n = Number(m[1]); const u = m[2] || 'px';
  return u === 'cm' ? n * 37.7953 : u === 'mm' ? n * 3.77953 : u === 'in' ? n * 96 : u === 'pt' ? n * PX_PT : u === 'pc' ? n * 16 : n;
}
const hex = (v) => { const m = /^#([0-9a-f]{6})$/i.exec(v || ''); return m ? m[1].toUpperCase() : null; };

function image(files, href) {
  if (!href) return null;
  const path = href.replace(/^\.\//, '');
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return IMG_MIME[ext] && files[path] ? { path, bytes: files[path], mime: IMG_MIME[ext] } : null;
}

// ---- styles ----
// Every style:style of content.xml and styles.xml, by family and name, with the parent chain resolved on demand.
function readStyles(roots) {
  const st = { style: {}, def: {}, list: {}, layout: {}, master: {}, firstMaster: null };
  for (const root of roots) {
    if (!root) continue;
    for (const holder of root.children) {
      const hn = holder.localName;
      if (hn !== 'styles' && hn !== 'automatic-styles' && hn !== 'master-styles') continue;
      for (const s of holder.children) {
        const n = s.localName;
        if (n === 'style') st.style[`${at(s, 'family')}:${at(s, 'name')}`] = s;
        else if (n === 'default-style') st.def[at(s, 'family')] = s;
        else if (n === 'list-style') st.list[at(s, 'name')] = s;
        else if (n === 'page-layout') st.layout[at(s, 'name')] = s;
        else if (n === 'master-page') { st.master[at(s, 'name')] = s; if (!st.firstMaster) st.firstMaster = s; }
      }
    }
  }
  return st;
}

function propsOf(el, name) { return kid(el, name); }

// Merged text, paragraph, cell, column, row and graphic properties of a style and its parents (nearest wins).
function resolve(st, family, name, seen = 0) {
  const out = { text: {}, para: {}, cell: {}, col: {}, row: {}, gfx: {}, page: {}, page2: {} };
  const apply = (s) => {
    for (const [k, tag] of [['text', 'text-properties'], ['para', 'paragraph-properties'], ['cell', 'table-cell-properties'], ['col', 'table-column-properties'], ['row', 'table-row-properties'], ['gfx', 'graphic-properties'], ['page', 'drawing-page-properties']]) {
      const p = propsOf(s, tag); if (!p) continue;
      for (const a of p.attributes) out[k][a.localName] = a.value;
    }
  };
  if (!name || seen > 12) { const d = st.def[family]; if (d) apply(d); return out; }
  const s = st.style[`${family}:${name}`];
  if (!s) return out;
  const parent = at(s, 'parent-style-name');
  const base = resolve(st, family, parent, seen + 1);
  for (const k of Object.keys(out)) out[k] = base[k];
  apply(s);
  return out;
}

const ALIGN = { start: 'left', left: 'left', end: 'right', right: 'right', center: 'center', justify: 'justify' };

// Run properties as the models hold them: font, size (px), color, bg, b, i, u, s, caps, sc, sup, sub.
function textProps(t, parentSize) {
  const o = {};
  const fam = t['font-family'] || t['font-name'];
  if (fam) o.font = fam.replace(/['"]/g, '');
  const sz = t['font-size'];
  if (sz) { if (sz.endsWith('%')) { if (parentSize) o.size = parentSize * parseFloat(sz) / 100; } else { const v = px(sz); if (v) o.size = v; } }
  const c = hex(t.color); if (c) o.color = c;
  const bg = hex(t['background-color']); if (bg) o.bg = bg;
  if (t['font-weight']) o.b = t['font-weight'] === 'bold' || Number(t['font-weight']) >= 600;
  if (t['font-style']) o.i = t['font-style'] === 'italic' || t['font-style'] === 'oblique';
  if (t['text-underline-style']) o.u = t['text-underline-style'] !== 'none';
  if (t['text-line-through-style']) o.s = t['text-line-through-style'] !== 'none';
  if (t['text-transform']) o.caps = t['text-transform'] === 'uppercase';
  if (t['font-variant']) o.sc = t['font-variant'] === 'small-caps';
  const pos = t['text-position'];
  if (pos) { const p = pos.trim().split(/\s+/)[0]; if (/^super/.test(p) || parseFloat(p) > 0) o.sup = true; else if (/^sub/.test(p) || parseFloat(p) < 0) o.sub = true; else { o.sup = false; o.sub = false; } }
  return o;
}

function side(v) {
  if (!v || v === 'none' || v === 'hidden') return null;
  const m = /^([\d.]+\w*)\s+(\w+)\s+(#[0-9a-f]{6})/i.exec(v);
  if (!m) return { w: 1, color: '000000', style: 'solid' };
  return { w: Math.max(1, Math.round(px(m[1]) || 1)), color: hex(m[3]) || '000000', style: m[2] === 'double' ? 'double' : /dash|dot/.test(m[2]) ? 'dashed' : 'solid' };
}
function cellBorders(c) {
  const o = {};
  for (const [k, names] of [['t', ['border-top']], ['b', ['border-bottom']], ['l', ['border-left']], ['r', ['border-right']]]) {
    const v = c[names[0]] !== undefined ? c[names[0]] : c.border;
    const s = side(v); if (s) o[k] = s; else if (v === 'none') o[k] = { none: true };
  }
  return o;
}

// ---- counters for numbered lists ----
const ROMAN = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
function roman(n) { let s = ''; for (const [v, r] of ROMAN) while (n >= v) { s += r; n -= v; } return s; }
function letters(n) { let s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(97 + r) + s; n = Math.floor((n - 1) / 26); } return s; }
function numText(n, fmt) {
  if (fmt === 'a') return letters(n);
  if (fmt === 'A') return letters(n).toUpperCase();
  if (fmt === 'i') return roman(n);
  if (fmt === 'I') return roman(n).toUpperCase();
  return String(n);
}

// ============================================================ odt
export function readOdt(bytes) {
  const T0 = performance.now();
  const files = unpack(bytes);
  const content = xml(files, 'content.xml');
  const sRoot = xml(files, 'styles.xml');
  if (!content) throw new OfficeError('This is not a valid file of this type.');
  const T1 = performance.now();
  const st = readStyles([sRoot, content]);
  const body = kid(kid(content, 'body'), 'text');
  if (!body) throw new OfficeError('This is not a valid file of this type.');
  const T2 = performance.now();

  const media = {};
  const fnOrder = []; const footnotes = [];
  let count = 0; let truncated = false;
  const defPara = resolve(st, 'paragraph', null);
  const baseSize = textProps(defPara.text).size;

  function paraProps(ps) {
    const p = ps.para; const o = {};
    if (p['text-align']) o.align = ALIGN[p['text-align']] || 'left';
    const sb = px(p['margin-top']); if (sb !== null) o.sb = sb;
    const sa = px(p['margin-bottom']); if (sa !== null) o.sa = sa;
    const lh = p['line-height'];
    if (lh) { if (lh.endsWith('%')) o.line = { mult: parseFloat(lh) / 100 }; else { const v = px(lh); if (v) o.line = { px: v, atLeast: false }; } }
    const l = px(p['margin-left']); if (l !== null) o.l = l;
    const r = px(p['margin-right']); if (r !== null) o.r = r;
    const f = px(p['text-indent']); if (f !== null) o.first = f;
    const bg = hex(p['background-color']); if (bg) o.bg = bg;
    if (p['break-before'] === 'page') o.pb = true;
    return o;
  }

  // inline content of a paragraph or heading: runs in the Word model's shape
  function runsOf(node, base, out) {
    let text = '';
    const flush = () => { if (text) { out.push({ ...pickProps(base), text }); text = ''; } };
    for (const c of node.childNodes) {
      if (c.nodeType === 3) { text += c.nodeValue; continue; }
      if (c.nodeType !== 1) continue;
      const n = c.localName;
      if (n === 's') text += ' '.repeat(Math.min(Number(at(c, 'c') || 1), 200));
      else if (n === 'tab') text += '\t';
      else if (n === 'line-break') { flush(); out.push({ br: true }); }
      else if (n === 'span' || n === 'a') {
        flush();
        const r = resolve(st, 'text', at(c, 'style-name'));
        const f = { ...base, ...textProps(r.text, base.size) };
        if (n === 'a' && !at(c, 'style-name')) { f.color = f.color || '0563C1'; f.u = true; }
        runsOf(c, f, out);
      } else if (n === 'page-number') { flush(); out.push({ ...pickProps(base), field: 'PAGE', text: '1' }); }
      else if (n === 'page-count') { flush(); out.push({ ...pickProps(base), field: 'NUMPAGES', text: '1' }); }
      else if (n === 'note') {
        flush();
        const nb = kid(c, 'note-body');
        const no = fnOrder.length + 1; fnOrder.push(no);
        out.push({ ...pickProps(base), text: String(no), sup: true, fn: no });
        if (nb) footnotes.push({ n: no, blocks: blocksOf(nb, 0, null) });
      } else if (n === 'frame') {
        flush();
        const im = kid(c, 'image');
        const img = im && image(files, at(im, 'href'));
        if (img) { media[img.path] = { bytes: img.bytes, mime: img.mime }; const w = px(at(c, 'width')); const h = px(at(c, 'height')); out.push({ img: img.path, w: w > 0 ? w : undefined, h: h > 0 ? h : undefined }); }
      } else if (n === 'soft-page-break' || n === 'bookmark' || n === 'bookmark-start' || n === 'bookmark-end' || n === 'annotation' || n === 'annotation-end') { /* no text */ }
      else runsOf(c, base, out);
    }
    flush();
    return out;
  }
  function pickProps(f) { const o = {}; for (const k of ['font', 'size', 'color', 'bg', 'b', 'i', 'u', 's', 'caps', 'sc', 'sup', 'sub']) if (f[k]) o[k] = f[k]; return o; }

  function paragraph(p, list) {
    const sname = at(p, 'style-name');
    const ps = resolve(st, 'paragraph', sname);
    const pr = paraProps(ps);
    let level = 0;
    if (p.localName === 'h') level = Math.min(Number(at(p, 'outline-level') || 1), 6);
    const base = textProps(ps.text, baseSize);
    const runs = runsOf(p, base, []);
    let lst = null;
    if (list) {
      lst = { marker: list.marker, level: list.level, fmt: { font: base.font, size: base.size, b: base.b, i: base.i, color: base.color }, hang: list.hang };
      pr.l = list.l; pr.first = -list.hang;
    }
    return { t: 'p', level, list: lst, pr, runs, sectEnd: undefined };
  }

  // marker, indent and hang of a list level (a numbered one counts per list and level)
  function listLevel(ls, counters, lvl) {
    const lv = ls && [...ls.children].find((x) => at(x, 'level') === String(lvl + 1));
    const al = lv && propsOf(kid(lv, 'list-level-properties'), 'list-level-label-alignment');
    let l = al ? px(at(al, 'margin-left')) : null; let hang = al ? -(px(at(al, 'text-indent')) || 0) : null;
    if (l === null) l = 24 * (lvl + 1);
    if (!hang || hang < 0) hang = 18;
    let marker = '\u2022';
    if (lv) {
      const n = lv.localName;
      if (n === 'list-level-style-bullet') marker = at(lv, 'bullet-char') || '\u2022';
      else if (n === 'list-level-style-number') {
        counters[lvl] = (counters[lvl] || 0) + 1; counters.length = lvl + 1;
        const f = at(lv, 'num-format');
        marker = f === '' ? '' : `${at(lv, 'num-prefix') || ''}${numText(counters[lvl], f || '1')}${at(lv, 'num-suffix') ?? '.'}`;
      } else if (n === 'list-level-style-image') marker = '\u2022';
    } else marker = '\u2022';
    return { marker, level: lvl, l, hang };
  }

  function listBlocks(lst, ctx, lvl, out, depth) {
    const ls = st.list[at(lst, 'style-name')] || ctx.ls;
    const cx = { ls, counters: ctx.counters || [] };
    for (const item of kids(lst, 'list-item').concat(kids(lst, 'list-header'))) {
      let first = true;
      for (const c of item.children) {
        const n = c.localName;
        if (n === 'p' || n === 'h') {
          if (count >= DOC_BLOCK_MAX) { truncated = true; return; }
          const info = first ? listLevel(ls, cx.counters, lvl) : { marker: '', level: lvl, l: listLevel(ls, [], lvl).l, hang: 0 };
          out.push(paragraph(c, info)); count++; first = false;
        } else if (n === 'list' && depth < 8) listBlocks(c, cx, lvl + 1, out, depth + 1);
        else if (n === 'table' && depth < 4) out.push(table(c, depth));
      }
    }
  }

  function table(tbl, depth) {
    const cols = []; // width px per grid column
    const walkCols = (parent) => {
      for (const c of parent.children) {
        if (c.localName === 'table-column') {
          const w = px(resolve(st, 'table-column', at(c, 'style-name')).col['column-width']) || 96;
          for (let i = 0; i < Math.min(Number(at(c, 'number-columns-repeated') || 1), 200); i++) cols.push(Math.round(w));
        } else if (c.localName === 'table-columns' || c.localName === 'table-header-columns') walkCols(c);
      }
    };
    walkCols(tbl);
    const remain = []; // rows still covered by a cell above, per grid column
    const rows = [];
    const rowEls = [];
    const walkRows = (parent) => { for (const c of parent.children) { if (c.localName === 'table-row') rowEls.push(c); else if (c.localName === 'table-rows' || c.localName === 'table-header-rows') walkRows(c); } };
    walkRows(tbl);
    for (const tr of rowEls) {
      const cells = []; let col = 0;
      for (const tc of tr.children) {
        const n = tc.localName;
        if (n !== 'table-cell' && n !== 'covered-table-cell') continue;
        const rep = Math.min(Number(at(tc, 'number-columns-repeated') || 1), 100);
        for (let k = 0; k < rep; k++) {
          if (n === 'covered-table-cell') {
            if (remain[col] > 0) { remain[col]--; cells.push({ span: 1, col, vm: 'cont', skip: true, bg: null, borders: {}, blocks: [] }); }
            col++;
            continue;
          }
          const cs = resolve(st, 'table-cell', at(tc, 'style-name'));
          const span = Math.max(1, Number(at(tc, 'number-columns-spanned') || 1));
          const rs = Math.max(1, Number(at(tc, 'number-rows-spanned') || 1));
          const cell = {
            span, col, vm: rs > 1 ? 'restart' : null, bg: hex(cs.cell['background-color']), borders: cellBorders(cs.cell),
            valign: cs.cell['vertical-align'] === 'middle' ? 'center' : cs.cell['vertical-align'] === 'bottom' ? 'bottom' : undefined,
            width: undefined, bold: false, blocks: blocksOf(tc, depth + 1, null)
          };
          if (rs > 1) { cell.rowSpan = rs; for (let j = 0; j < span; j++) remain[col + j] = rs - 1; }
          cells.push(cell);
          col += span;
        }
      }
      rows.push(cells);
    }
    return { t: 'table', rows, rowBrk: rows.map(() => false), borders: {}, grid: cols, pct: null, pad: { t: 3, l: 7, r: 7, b: 3 }, align: null };
  }

  function blocksOf(node, depth, list) {
    const out = [];
    for (const c of node.children) {
      const n = c.localName;
      if (n === 'p' || n === 'h') { if (count >= DOC_BLOCK_MAX) { truncated = true; break; } out.push(paragraph(c, list)); count++; }
      else if (n === 'list' && depth < 8) listBlocks(c, { ls: null, counters: [] }, 0, out, 0);
      else if (n === 'table' && depth < 4) out.push(table(c, depth));
      else if (n === 'section' || n === 'table-of-content' || n === 'index-body' || n === 'alphabetical-index' || n === 'user-index') out.push(...blocksOf(c, depth, list));
      else if (n === 'index-title') out.push(...blocksOf(c, depth, list));
    }
    return out;
  }

  const blocks = blocksOf(body, 0, null);

  // page set-up, header and footer from the first master page
  const mp = st.firstMaster;
  const pl = mp && st.layout[at(mp, 'page-layout-name')];
  const pp = pl && propsOf(pl, 'page-layout-properties');
  const page = {
    w: Math.round(px(at(pp, 'page-width')) || 816), h: Math.round(px(at(pp, 'page-height')) || 1056),
    t: Math.round(px(at(pp, 'margin-top')) ?? 96), r: Math.round(px(at(pp, 'margin-right')) ?? 96), b: Math.round(px(at(pp, 'margin-bottom')) ?? 96), l: Math.round(px(at(pp, 'margin-left')) ?? 96),
    hd: 48, ft: 48
  };
  const part = (name) => { const e = mp && kid(mp, name); return e ? blocksOf(e, 0, null) : undefined; };
  const hdr = { default: part('header'), first: part('header-first'), even: part('header-left') };
  const ftr = { default: part('footer'), first: part('footer-first'), even: part('footer-left') };
  const sections = [{ page, type: 'nextPage', titlePg: !!hdr.first || !!ftr.first, pgStart: null, pgFmt: null, hdr, ftr }];
  const T3 = performance.now();
  return {
    kind: 'docx', blocks, media, truncated, page, header: hdr.default || [], footer: ftr.default || [], footnotes, embedded: [], sections,
    evenOdd: false, storedPages: 0, timing: { unzip: T1 - T0, parse: T2 - T1, read: T3 - T2 }
  };
}

// ============================================================ ods
export function readOds(bytes) {
  const files = unpack(bytes);
  const content = xml(files, 'content.xml');
  const sRoot = xml(files, 'styles.xml');
  const sheetsEl = kid(kid(content, 'body'), 'spreadsheet');
  if (!sheetsEl) throw new OfficeError('This is not a valid file of this type.');
  const st = readStyles([sRoot, content]);
  const tables = kids(sheetsEl, 'table').filter((t) => at(t, 'display') !== 'false');
  if (!tables.length) throw new OfficeError('This workbook has no sheets to show.');

  // one cell format per distinct style, in the Excel model's shape
  const defFont = { name: 'Liberation Sans', size: 10, b: false, i: false, u: false, s: false, color: null };
  const xfs = [{ code: 'General', date: false, font: defFont, fill: null, border: null, h: 'general', v: 'bottom', wrap: false, indent: 0 }];
  const xfIndex = { '': 0 };
  function xfOf(name) {
    const key = name || '';
    if (key in xfIndex) return xfIndex[key];
    const r = resolve(st, 'table-cell', name);
    const t = textProps(r.text, null);
    const font = { name: t.font || defFont.name, size: t.size ? t.size / PX_PT : defFont.size, b: !!t.b, i: !!t.i, u: !!t.u, s: !!t.s, color: t.color ? { hex: t.color } : null };
    const bd = cellBorders(r.cell);
    const bs = (s) => (s && !s.none ? { style: s.style === 'dashed' ? 'dashed' : s.style === 'double' ? 'double' : s.w > 1 ? 'medium' : 'thin', color: { hex: s.color } } : null);
    const border = bd.t || bd.b || bd.l || bd.r ? { l: bs(bd.l), r: bs(bd.r), t: bs(bd.t), b: bs(bd.b) } : null;
    const bg = hex(r.cell['background-color']);
    const al = r.para['text-align'];
    xfs.push({
      code: 'General', date: false, font, fill: bg ? { hex: bg } : null, border,
      h: al ? (ALIGN[al] === 'justify' ? 'justify' : ALIGN[al]) : 'general', v: r.cell['vertical-align'] === 'middle' ? 'center' : r.cell['vertical-align'] === 'top' ? 'top' : 'bottom',
      wrap: r.cell['wrap-option'] === 'wrap', indent: 0
    });
    xfIndex[key] = xfs.length - 1;
    return xfs.length - 1;
  }

  function load(i) {
    const tbl = tables[i];
    if (!tbl) throw new OfficeError('This sheet could not be read.');
    const colW = {}; const colStyle = []; let ci = 0;
    const walkCols = (parent) => {
      for (const c of parent.children) {
        const n = c.localName;
        if (n === 'table-column') {
          const rep = Number(at(c, 'number-columns-repeated') || 1);
          const w = px(resolve(st, 'table-column', at(c, 'style-name')).col['column-width']);
          const hid = at(c, 'visibility') === 'collapse' || at(c, 'visibility') === 'filter';
          for (let k = 0; k < rep && ci < SHEET_COL_MAX; k++, ci++) { colW[ci] = hid ? 0 : w ? Math.round(w) : undefined; colStyle[ci] = at(c, 'default-cell-style-name'); if (colW[ci] === undefined) delete colW[ci]; }
          if (ci >= SHEET_COL_MAX) ci = SHEET_COL_MAX;
        } else if (n === 'table-columns' || n === 'table-header-columns' || n === 'table-column-group') walkCols(c);
      }
    };
    walkCols(tbl);
    const rowEls = [];
    const walkRows = (parent) => { for (const c of parent.children) { const n = c.localName; if (n === 'table-row') rowEls.push(c); else if (n === 'table-rows' || n === 'table-header-rows' || n === 'table-row-group') walkRows(c); } };
    walkRows(tbl);

    const rows = []; const rowH = {}; const merges = []; let ncols = 0; let truncated = false; let cellCount = 0; let r = 0;
    for (const tr of rowEls) {
      const rrep = Math.min(Number(at(tr, 'number-rows-repeated') || 1), SHEET_ROW_MAX + 1);
      const cellEls = [...tr.children].filter((c) => c.localName === 'table-cell' || c.localName === 'covered-table-cell');
      // a row with no value and no style is only skipped over
      const rowStyle = resolve(st, 'table-row', at(tr, 'style-name')).row;
      const rh = px(rowStyle['row-height'] || rowStyle['min-row-height']);
      const hidden = at(tr, 'visibility') === 'collapse' || at(tr, 'visibility') === 'filter';
      const hasContent = cellEls.some((c) => c.localName === 'table-cell' && (at(c, 'value-type') || kid(c, 'p') || at(c, 'style-name')));
      if (!hasContent && rrep > 1) { r += rrep; continue; }
      for (let rk = 0; rk < rrep; rk++, r++) {
        if (r >= SHEET_ROW_MAX || cellCount > 100000) { truncated = true; break; }
        if (hidden) rowH[r] = 0; else if (rh) rowH[r] = Math.round(rh);
        const cells = []; let c = 0;
        for (const tc of cellEls) {
          const crep = Math.min(Number(at(tc, 'number-columns-repeated') || 1), SHEET_COL_MAX + 1);
          const covered = tc.localName === 'covered-table-cell';
          const vt = at(tc, 'value-type');
          const text = vt === 'boolean' ? (at(tc, 'boolean-value') === 'true' ? 'TRUE' : 'FALSE') : kids(tc, 'p').map((p) => p.textContent).join('\n');
          const sname = at(tc, 'style-name') || colStyle[c];
          const empty = covered || (text === '' && !sname);
          if (empty && crep > 1) { c += crep; continue; }
          for (let ck = 0; ck < crep; ck++, c++) {
            if (c >= SHEET_COL_MAX) { truncated = true; break; }
            if (covered) continue;
            const s = xfOf(sname || colStyle[c]);
            const kind = vt === 'float' || vt === 'percentage' || vt === 'currency' || vt === 'date' || vt === 'time' ? 'n' : vt === 'boolean' ? 'b' : 's';
            if (text !== '' || s) { cells[c] = { v: text, s, k: kind }; cellCount++; if (text !== '' || xfs[s].fill || xfs[s].border) if (c + 1 > ncols) ncols = c + 1; }
            const cs = Number(at(tc, 'number-columns-spanned') || 1); const rs = Number(at(tc, 'number-rows-spanned') || 1);
            if ((cs > 1 || rs > 1) && ck === 0 && rk === 0) merges.push({ r, c, rs, cs: Math.min(cs, SHEET_COL_MAX - c) });
          }
        }
        rows[r] = Array.from(cells);
      }
      if (truncated) break;
    }
    for (let k = 0; k < rows.length; k++) rows[k] = Array.from(rows[k] || []);
    const hasDrawing = desc(tbl, 'frame').length > 0 || desc(tbl, 'shapes').length > 0;
    return {
      rows, ncols, truncated, colW, defCol: 90, rowH, defRow: 20, merges, freeze: { rows: 0, cols: 0 }, grid: true,
      objects: [], media: {}, hasDrawing
    };
  }
  return { kind: 'xlsx', names: tables.map((t, k) => at(t, 'name') || `Sheet ${k + 1}`), load, xfs };
}

// ============================================================ odp
export function readOdp(bytes) {
  const files = unpack(bytes);
  const content = xml(files, 'content.xml');
  const sRoot = xml(files, 'styles.xml');
  const pres = kid(kid(content, 'body'), 'presentation');
  if (!pres) throw new OfficeError('This is not a valid file of this type.');
  const st = readStyles([sRoot, content]);
  const pages = kids(pres, 'page').slice(0, SLIDE_MAX);
  if (!pages.length) throw new OfficeError('This presentation has no slides to show.');
  const mp0 = st.firstMaster;
  const pl = mp0 && st.layout[at(mp0, 'page-layout-name')];
  const pp = pl && propsOf(pl, 'page-layout-properties');
  const W = Math.round(px(at(pp, 'page-width')) || 960); const H = Math.round(px(at(pp, 'page-height')) || 540);
  const DEF = { title: 44, subtitle: 32, outline: 32 };

  function runsOf(node, base, out) {
    let text = '';
    const flush = () => { if (text) { out.push({ ...base, text }); text = ''; } };
    for (const c of node.childNodes) {
      if (c.nodeType === 3) { text += c.nodeValue; continue; }
      if (c.nodeType !== 1) continue;
      const n = c.localName;
      if (n === 's') text += ' '.repeat(Math.min(Number(at(c, 'c') || 1), 200));
      else if (n === 'tab') text += '\t';
      else if (n === 'line-break') { flush(); out.push({ br: true }); }
      else if (n === 'span' || n === 'a') {
        flush();
        const t = textProps(resolve(st, 'text', at(c, 'style-name')).text, base.size);
        const f = { ...base };
        if (t.font) f.font = t.font;
        if (t.size) f.size = t.size;
        if (t.b !== undefined) f.b = t.b;
        if (t.i !== undefined) f.i = t.i;
        if (t.u !== undefined) f.u = t.u;
        if (t.color) f.color = { hex: t.color, a: 1 };
        runsOf(c, f, out);
      } else if (n === 'page-number') { text += '\u2039#\u203a'; }
      else runsOf(c, base, out);
    }
    flush();
    return out;
  }
  function paraOf(p, cls, level, bullet) {
    const ps = resolve(st, 'paragraph', at(p, 'style-name'));
    const t = textProps(ps.text, null);
    const size = t.size || (DEF[cls] ? DEF[cls] * PX_PT : 18 * PX_PT);
    const base = { size, b: !!t.b, i: !!t.i, u: !!t.u };
    if (t.font) base.font = t.font;
    if (t.color) base.color = { hex: t.color, a: 1 };
    const runs = runsOf(p, base, []);
    const al = ps.para['text-align'];
    const marL = level ? level * 28 : 0;
    return { algn: al ? ALIGN[al] || 'left' : cls === 'title' || cls === 'subtitle' ? 'center' : 'left', marL: bullet ? marL + 24 : marL, indent: bullet ? -24 : 0, bullet: bullet ? { text: '\u2022' } : null, runs, size };
  }
  function parasOf(node, cls, level, out) {
    for (const c of node.children) {
      if (c.localName === 'p' || c.localName === 'h') out.push(paraOf(c, cls, level, false));
      else if (c.localName === 'list') for (const it of kids(c, 'list-item')) {
        for (const q of it.children) {
          if (q.localName === 'p' || q.localName === 'h') out.push(paraOf(q, cls, level, cls === 'outline' || cls === 'subtitle' ? cls === 'outline' : true));
          else if (q.localName === 'list') parasOf(q, cls, level + 1, out);
        }
      }
    }
    return out;
  }

  function load(i) {
    const page = pages[i];
    const media = {};
    const items = [];
    const ps = resolve(st, 'drawing-page', at(page, 'style-name'));
    const mstyle = resolve(st, 'drawing-page', at(st.master[at(page, 'master-page-name')] || mp0, 'style-name'));
    const bgOf = (g) => (g.fill === 'solid' && hex(g['fill-color']) ? { hex: hex(g['fill-color']), a: 1 } : null);
    const bg = bgOf(ps.page) || bgOf(mstyle.page) || { hex: 'FFFFFF', a: 1 };
    let notes = '';
    const pos = (e) => ({ x: px(at(e, 'x')) || 0, y: px(at(e, 'y')) || 0, w: px(at(e, 'width')) || 0, h: px(at(e, 'height')) || 0 });
    const gfxOf = (e) => resolve(st, 'graphic', at(e, 'style-name')).gfx;
    const textBody = (paras, g) => (paras.length ? { anchor: g['textarea-vertical-align'] === 'middle' ? 'ctr' : g['textarea-vertical-align'] === 'bottom' ? 'b' : 't', l: 10, r: 10, t: 5, b: 5, wrap: true, scale: 1, paras } : null);
    const walk = (parent, depth) => {
      for (const e of parent.children) {
        const n = e.localName;
        if (n === 'g' && depth < 6) { walk(e, depth + 1); continue; }
        if (n === 'notes') {
          notes = desc(e, 'p').map((p) => p.textContent).join('\n').trim();
          continue;
        }
        const b = pos(e);
        if (n === 'frame') {
          const im = kid(e, 'image'); const tb = kid(e, 'text-box');
          const img = im && image(files, at(im, 'href'));
          if (img) { media[img.path] = { bytes: img.bytes, mime: img.mime }; items.push({ t: 'pic', ...b, rot: 0, path: img.path, line: null, crop: null }); }
          else if (tb) {
            const cls = at(e, 'class');
            const g = resolve(st, 'presentation', at(e, 'style-name')).gfx;
            const gg = Object.keys(g).length ? g : gfxOf(e);
            const text = textBody(parasOf(tb, cls, 0, []), cls === 'title' ? { 'textarea-vertical-align': 'middle' } : gg);
            if (text) items.push({ t: 'shape', ...b, rot: 0, geom: 'rect', adj: null, fill: bgOf(gg), line: null, text });
          }
        } else if (n === 'custom-shape' || n === 'rect' || n === 'ellipse' || n === 'circle') {
          const g = gfxOf(e);
          const text = textBody(parasOf(e, null, 0, []), { 'textarea-vertical-align': 'middle' });
          if (text) text.paras.forEach((p) => { p.algn = p.algn === 'left' ? 'center' : p.algn; });
          items.push({ t: 'shape', ...b, rot: 0, geom: n === 'ellipse' || n === 'circle' ? 'ellipse' : 'rect', adj: null, fill: g.fill === 'none' ? null : bgOf(g), line: null, text });
        }
      }
    };
    walk(page, 0);
    return { w: W, h: H, bg, items, media, notes };
  }
  return { kind: 'pptx', count: pages.length, load, size: { w: W, h: H } };
}

