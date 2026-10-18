// office-read.js — view-only readers for docx, xlsx and pptx (Decision 226). A file is a zip of XML parts: fflate unpacks
// only the parts needed, DOMParser reads them, and each reader returns plain data. Nothing is rendered, written or sent
// here, and no markup from the file is ever passed on: the renderer sets text with textContent only.

import { unzipSync } from 'fflate';

const PART_MAX = 25 * 1024 * 1024; // one unpacked part
const TOTAL_MAX = 120 * 1024 * 1024; // all unpacked parts together
export const DOC_BLOCK_MAX = 10000;
export const SHEET_ROW_MAX = 5000;
export const SHEET_COL_MAX = 200;
const SLIDE_MAX = 500;
const IMG_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' };

export class OfficeError extends Error { constructor(m) { super(m); this.office = true; } } // office: true marks a message fit to show

// ---- Zip and XML helpers ----
function unpack(bytes, rootDir, mainPart) {
  let files;
  let total = 0;
  try {
    files = unzipSync(bytes, {
      filter: (f) => {
        if (!f.name.startsWith(rootDir)) return false;
        const ext = f.name.slice(f.name.lastIndexOf('.') + 1).toLowerCase();
        if (ext !== 'xml' && ext !== 'rels' && !IMG_MIME[ext]) return false;
        if (f.originalSize > PART_MAX) return false;
        total += f.originalSize;
        return total <= TOTAL_MAX;
      }
    });
  } catch {
    throw new OfficeError('This file is protected or damaged.');
  }
  if (!files[mainPart]) throw new OfficeError('This is not a valid file of this type.');
  return files;
}

const decoder = new TextDecoder('utf-8');
function xml(files, name) {
  const b = files[name];
  if (!b) return null;
  const doc = new DOMParser().parseFromString(decoder.decode(b), 'application/xml');
  return doc.getElementsByTagName('parsererror').length ? null : doc.documentElement;
}
const kids = (n, local) => (n ? Array.from(n.children).filter((c) => c.localName === local) : []);
const kid = (n, local) => (n ? Array.from(n.children).find((c) => c.localName === local) || null : null);
const at = (n, local) => {
  if (!n) return null;
  for (const a of n.attributes) if (a.localName === local) return a.value;
  return null;
};
// An attribute in the relationships namespace (r:id, r:embed): sldId also has a plain id, so the local name is not enough.
const rat = (n, local) => {
  if (!n) return null;
  for (const a of n.attributes) if (a.localName === local && /relationships$/.test(a.namespaceURI || '')) return a.value;
  return null;
};
const flag = (n) => !!n && !['0', 'false', 'none'].includes((at(n, 'val') ?? '1').toLowerCase());

function dirOf(path) { const i = path.lastIndexOf('/'); return i < 0 ? '' : path.slice(0, i + 1); }
function resolve(base, target) {
  if (target.startsWith('/')) return target.slice(1);
  const out = dirOf(base).split('/').filter(Boolean);
  for (const seg of target.split('/')) { if (seg === '..') out.pop(); else if (seg && seg !== '.') out.push(seg); }
  return out.join('/');
}
// Relationships of a part: Id -> { path, type }.
function rels(files, part) {
  const map = {};
  const root = xml(files, `${dirOf(part)}_rels/${part.slice(part.lastIndexOf('/') + 1)}.rels`);
  for (const r of kids(root, 'Relationship')) {
    if (at(r, 'TargetMode') === 'External') continue;
    map[at(r, 'Id')] = { path: resolve(part, at(r, 'Target') || ''), type: at(r, 'Type') || '' };
  }
  return map;
}
function image(files, path) {
  const ext = (path.slice(path.lastIndexOf('.') + 1) || '').toLowerCase();
  const mime = IMG_MIME[ext];
  return mime && files[path] ? { bytes: files[path], mime } : null;
}
function descendants(n, local, out = []) {
  for (const c of n.children) { if (c.localName === local) out.push(c); descendants(c, local, out); }
  return out;
}
// The first picture reference inside a drawing: a:blip r:embed (DrawingML) or v:imagedata r:id (VML).
function blipId(n) {
  const b = descendants(n, 'blip')[0];
  if (b) return rat(b, 'embed');
  const v = descendants(n, 'imagedata')[0];
  return v ? rat(v, 'id') : null;
}

// ---- docx ----
const HEAD = /^heading\s*([1-9])$/i;
const PX_PT = 4 / 3; // 1 pt = 4/3 px at 96 dpi
const tw = (v) => (v === null || v === undefined || v === '' ? undefined : Number(v) / 15); // twips to px
const HL = { yellow: 'FFFF00', green: '00FF00', cyan: '00FFFF', magenta: 'FF00FF', blue: '0000FF', red: 'FF0000', darkBlue: '000080', darkCyan: '008080', darkGreen: '008000', darkMagenta: '800080', darkRed: '800000', darkYellow: '808000', darkGray: '808080', lightGray: 'C0C0C0', black: '000000', white: 'FFFFFF' };
const THEME_NAME = { dark1: 'dk1', light1: 'lt1', dark2: 'dk2', light2: 'lt2', text1: 'dk1', background1: 'lt1', text2: 'dk2', background2: 'lt2', hyperlink: 'hlink', followedHyperlink: 'folHlink' };
function roman(n, upper) {
  const t = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let s = ''; let x = n;
  for (const [v, k] of t) while (x >= v) { s += k; x -= v; }
  return upper ? s.toUpperCase() : s;
}
function letters(n, upper) {
  let s = ''; let x = n;
  while (x > 0) { x -= 1; s = String.fromCharCode(97 + (x % 26)) + s; x = Math.floor(x / 26); }
  return upper ? s.toUpperCase() : s;
}
function formatNum(n, fmt) {
  if (fmt === 'lowerLetter') return letters(n, false);
  if (fmt === 'upperLetter') return letters(n, true);
  if (fmt === 'lowerRoman') return roman(n, false);
  if (fmt === 'upperRoman') return roman(n, true);
  if (fmt === 'decimalZero') return String(n).padStart(2, '0');
  return String(n);
}
function bulletChar(t) {
  if (!t) return '\u2022';
  const c = t.charCodeAt(0);
  if (c >= 0xf000 && c <= 0xf0ff) return c === 0xf0a7 ? '\u25aa' : '\u2022'; // symbol-font private use
  if (t === 'o') return '\u25e6';
  if (t === '\u00a7') return '\u25aa';
  return t;
}

export function readDocx(bytes) {
  const files = unpack(bytes, 'word/', 'word/document.xml');
  const main = 'word/document.xml';
  const root = xml(files, main);
  if (!root) throw new OfficeError('This is not a valid file of this type.');
  const rel = rels(files, main);

  // ---- theme: colours and fonts ----
  const tColors = {}; const tFonts = { major: null, minor: null };
  const th = xml(files, 'word/theme/theme1.xml');
  if (th) {
    const cs = descendants(th, 'clrScheme')[0];
    for (const c of cs ? cs.children : []) { const v = c.firstElementChild; if (v) tColors[c.localName] = at(v, 'val') && v.localName === 'srgbClr' ? at(v, 'val') : at(v, 'lastClr'); }
    for (const k of ['major', 'minor']) { const f = descendants(th, `${k}Font`)[0]; tFonts[k] = at(kid(f, 'latin'), 'typeface') || null; }
  }
  const hex2 = (h) => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  const toHex = (a) => a.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('').toUpperCase();
  function colorOf(n, valAttr = 'val', themeAttr = 'themeColor') {
    if (!n) return null;
    let hex = null;
    const tc = at(n, themeAttr);
    if (tc) {
      const base = tColors[THEME_NAME[tc] || tc];
      if (base && /^[0-9a-f]{6}$/i.test(base)) {
        let rgb = hex2(base);
        const tint = at(n, `${themeAttr}Tint`) || at(n, 'themeTint'); const shade = at(n, `${themeAttr}Shade`) || at(n, 'themeShade');
        if (tint) { const t = parseInt(tint, 16) / 255; rgb = rgb.map((c) => 255 - (255 - c) * t); }
        if (shade) { const s = parseInt(shade, 16) / 255; rgb = rgb.map((c) => c * s); }
        hex = toHex(rgb);
      }
    }
    if (!hex) { const v = at(n, valAttr); if (v && /^[0-9a-f]{6}$/i.test(v)) hex = v.toUpperCase(); }
    return hex;
  }

  // ---- property readers ----
  function parseR(rp) {
    const o = {};
    if (!rp) return o;
    const f = kid(rp, 'rFonts');
    if (f) {
      const t = at(f, 'asciiTheme') || at(f, 'hAnsiTheme');
      const name = t ? (t.startsWith('major') ? tFonts.major : tFonts.minor) : (at(f, 'ascii') || at(f, 'hAnsi') || at(f, 'eastAsia'));
      if (name) o.font = name;
    }
    const sz = at(kid(rp, 'sz'), 'val'); if (sz) o.size = (Number(sz) / 2) * PX_PT;
    const c = kid(rp, 'color'); if (c) o.color = colorOf(c);
    for (const [k, n] of [['b', 'b'], ['i', 'i'], ['u', 'u'], ['s', 'strike'], ['caps', 'caps'], ['sc', 'smallCaps'], ['hidden', 'vanish']]) if (kid(rp, n)) o[k] = flag(kid(rp, n));
    const va = at(kid(rp, 'vertAlign'), 'val'); if (va === 'superscript') o.sup = true; else if (va === 'subscript') o.sub = true; else if (va === 'baseline') { o.sup = false; o.sub = false; }
    const hl = at(kid(rp, 'highlight'), 'val'); if (hl) o.bg = HL[hl] || null;
    const shd = kid(rp, 'shd'); if (shd && !o.bg) o.bg = colorOf(shd, 'fill', 'themeFill');
    return o;
  }
  function side(b) {
    if (!b) return undefined;
    const v = at(b, 'val');
    if (!v || v === 'nil' || v === 'none') return { none: true };
    const sz = Number(at(b, 'sz') || 4);
    return { w: Math.max(1, Math.round(sz / 6)), color: colorOf(b), style: /dash|dot/i.test(v) ? 'dashed' : v === 'double' ? 'double' : 'solid' };
  }
  function borders(n) {
    if (!n) return undefined;
    const o = {};
    for (const [k, names] of [['t', ['top']], ['b', ['bottom']], ['l', ['left', 'start']], ['r', ['right', 'end']], ['h', ['insideH']], ['v', ['insideV']]]) for (const nm of names) { const s = side(kid(n, nm)); if (s) o[k] = s; }
    return o;
  }
  function parseP(pp) {
    const o = {};
    if (!pp) return o;
    const jc = at(kid(pp, 'jc'), 'val');
    if (jc) o.align = jc === 'both' || jc === 'distribute' ? 'justify' : jc === 'end' ? 'right' : jc === 'start' ? 'left' : jc;
    const sp = kid(pp, 'spacing');
    if (sp) {
      if (at(sp, 'before') !== null) o.sb = tw(at(sp, 'before'));
      if (at(sp, 'after') !== null) o.sa = tw(at(sp, 'after'));
      const line = at(sp, 'line');
      if (line !== null) o.line = (at(sp, 'lineRule') || 'auto') === 'auto' ? { mult: Number(line) / 240 } : { px: Number(line) / 15, atLeast: at(sp, 'lineRule') === 'atLeast' };
    }
    const ind = kid(pp, 'ind');
    if (ind) {
      const l = at(ind, 'left') ?? at(ind, 'start'); const rr = at(ind, 'right') ?? at(ind, 'end');
      if (l !== null) o.l = tw(l);
      if (rr !== null) o.r = tw(rr);
      if (at(ind, 'hanging') !== null) o.first = -tw(at(ind, 'hanging'));
      else if (at(ind, 'firstLine') !== null) o.first = tw(at(ind, 'firstLine'));
    }
    const shd = kid(pp, 'shd'); if (shd) o.bg = colorOf(shd, 'fill', 'themeFill');
    const bd = borders(kid(pp, 'pBdr')); if (bd) o.borders = bd;
    if (kid(pp, 'pageBreakBefore')) o.pb = flag(kid(pp, 'pageBreakBefore'));
    const ol = at(kid(pp, 'outlineLvl'), 'val'); if (ol !== null && Number(ol) < 9) o.outline = Number(ol) + 1;
    return o;
  }

  // ---- styles ----
  const styles = {}; let defPara = null;
  const stRoot = xml(files, 'word/styles.xml');
  const dd = kid(stRoot, 'docDefaults');
  const defaults = { r: parseR(kid(kid(dd, 'rPrDefault'), 'rPr')), p: parseP(kid(kid(dd, 'pPrDefault'), 'pPr')) };
  for (const s of kids(stRoot, 'style')) {
    const id = at(s, 'styleId');
    const name = at(kid(s, 'name'), 'val') || '';
    const snp = kid(kid(s, 'pPr'), 'numPr');
    const tblPr = kid(s, 'tblPr');
    const first = kids(s, 'tblStylePr').find((x) => at(x, 'type') === 'firstRow');
    styles[id] = {
      type: at(s, 'type'), name, basedOn: at(kid(s, 'basedOn'), 'val'), r: parseR(kid(s, 'rPr')), p: parseP(kid(s, 'pPr')),
      num: snp && at(kid(snp, 'numId'), 'val') ? { id: at(kid(snp, 'numId'), 'val'), lv: at(kid(snp, 'ilvl'), 'val') || '0' } : null,
      tbl: tblPr ? { borders: borders(kid(tblPr, 'tblBorders')) } : null,
      first: first ? { r: parseR(kid(first, 'rPr')), bg: colorOf(kid(kid(first, 'tcPr'), 'shd'), 'fill', 'themeFill') } : null
    };
    if (at(s, 'type') === 'paragraph' && at(s, 'default') === '1') defPara = id;
  }
  const memo = {};
  function resolve(id) {
    if (!id || !styles[id]) return { r: {}, p: {}, num: null, tbl: null, first: null, level: 0 };
    if (memo[id]) return memo[id];
    memo[id] = { r: {}, p: {}, num: null, tbl: null, first: null, level: 0 }; // guards a cycle
    const s = styles[id];
    const base = s.basedOn ? resolve(s.basedOn) : { r: {}, p: {}, num: null, tbl: null, first: null, level: 0 };
    const m = HEAD.exec(s.name);
    const level = m ? Number(m[1]) : /^title$/i.test(s.name) ? 1 : (s.p.outline || base.level || 0);
    memo[id] = { r: { ...base.r, ...s.r }, p: { ...base.p, ...s.p }, num: s.num || base.num, tbl: s.tbl || base.tbl, first: s.first || base.first, level };
    return memo[id];
  }

  // ---- numbering ----
  const abstract = {}; const numTo = {};
  const numRoot = xml(files, 'word/numbering.xml');
  for (const a of kids(numRoot, 'abstractNum')) {
    const lv = {};
    for (const l of kids(a, 'lvl')) {
      const pp = parseP(kid(l, 'pPr'));
      lv[at(l, 'ilvl')] = { fmt: at(kid(l, 'numFmt'), 'val') || 'decimal', text: at(kid(l, 'lvlText'), 'val') ?? '', start: Number(at(kid(l, 'start'), 'val') || 1), l: pp.l, first: pp.first };
    }
    abstract[at(a, 'abstractNumId')] = lv;
  }
  for (const n of kids(numRoot, 'num')) numTo[at(n, 'numId')] = at(kid(n, 'abstractNumId'), 'val');
  const counters = {};
  function marker(numId, ilvl) {
    const lvls = abstract[numTo[numId]] || {};
    const lv = lvls[ilvl] || { fmt: 'bullet', text: '', start: 1 };
    const c = (counters[numId] = counters[numId] || {});
    const k = Number(ilvl);
    if (lv.fmt === 'bullet') return { text: bulletChar(lv.text), l: lv.l, first: lv.first };
    c[k] = (c[k] === undefined ? lv.start : c[k] + 1);
    for (const x of Object.keys(c)) if (Number(x) > k) delete c[x];
    if (lv.fmt === 'none') return { text: '', l: lv.l, first: lv.first };
    const text = (lv.text || `%${k + 1}.`).replace(/%([1-9])/g, (_, d) => {
      const j = Number(d) - 1; const lj = lvls[String(j)] || lv;
      return formatNum(c[j] === undefined ? lj.start : c[j], lj.fmt);
    });
    return { text, l: lv.l, first: lv.first };
  }

  // ---- media, footnotes ----
  const media = {};
  const addMedia = (id) => {
    const r = id && rel[id];
    if (!r) return null;
    const img = image(files, r.path);
    if (!img) return null;
    media[r.path] = img;
    return r.path;
  };
  const fnNo = {}; const fnOrder = [];
  let count = 0; let truncated = false;

  // ---- runs ----
  const runsOf = (node, out, base, link) => {
    for (const c of node.children) {
      const n = c.localName;
      if (n === 'r') {
        const rp = kid(c, 'rPr');
        const rs = at(kid(rp, 'rStyle'), 'val');
        const f = { ...base, ...resolve(rs).r, ...parseR(rp) };
        if (link && !rs && f.color === undefined) { f.color = '0563C1'; f.u = true; }
        if (f.hidden) continue;
        const props = {};
        for (const k of ['font', 'size', 'color', 'bg', 'b', 'i', 'u', 's', 'caps', 'sc', 'sup', 'sub']) if (f[k]) props[k] = f[k];
        let text = '';
        const flush = () => { if (text) { out.push({ ...props, text }); text = ''; } };
        for (const k of c.children) {
          const kn = k.localName;
          if (kn === 't') text += k.textContent;
          else if (kn === 'tab') text += '\t';
          else if (kn === 'noBreakHyphen') text += '-';
          else if (kn === 'br' || kn === 'cr') { flush(); out.push(at(k, 'type') === 'page' ? { pb: true } : { br: true }); }
          else if (kn === 'footnoteReference') {
            flush();
            const id = at(k, 'id');
            if (id && !(id in fnNo)) { fnNo[id] = fnOrder.length + 1; fnOrder.push(id); }
            if (id) out.push({ ...props, text: String(fnNo[id]), sup: true });
          } else if (kn === 'drawing' || kn === 'pict') {
            flush();
            const p = addMedia(blipId(k));
            if (p) {
              const ex = descendants(k, 'extent')[0];
              const w = ex ? Number(at(ex, 'cx')) / 9525 : 0; const h = ex ? Number(at(ex, 'cy')) / 9525 : 0;
              out.push({ img: p, w: w > 0 ? w : undefined, h: h > 0 ? h : undefined });
            }
          }
        }
        flush();
      } else if (['hyperlink', 'ins', 'smartTag', 'fldSimple', 'moveTo'].includes(n)) runsOf(c, out, base, link || n === 'hyperlink');
      else if (n === 'sdt') runsOf(kid(c, 'sdtContent') || c, out, base, link);
      else if (n === 'AlternateContent') { const ch = kid(c, 'Choice'); if (ch) runsOf(ch, out, base, link); }
    }
    return out;
  };

  // ---- paragraphs and tables ----
  const paragraph = (p) => {
    const pp = kid(p, 'pPr');
    const st = at(kid(pp, 'pStyle'), 'val') || defPara;
    const rs = resolve(st);
    const direct = parseP(pp);
    let eff = { ...defaults.p, ...resolve(defPara).p, ...rs.p };
    const rbase = { ...defaults.r, ...resolve(defPara).r, ...rs.r };
    let level = rs.level || 0;
    if (direct.outline) level = direct.outline;
    let list = null;
    const np = kid(pp, 'numPr');
    let id = null; let lv = '0';
    if (np) { id = at(kid(np, 'numId'), 'val'); lv = at(kid(np, 'ilvl'), 'val') || '0'; } else if (rs.num) ({ id, lv } = rs.num);
    if (id && id !== '0') {
      const m = marker(id, lv);
      list = { marker: m.text, level: Number(lv) };
      if (m.l !== undefined) eff.l = m.l;
      if (m.first !== undefined) eff.first = m.first;
    }
    eff = { ...eff, ...direct };
    const runs = runsOf(p, [], rbase, false);
    if (list) { const t = runs.find((x) => x.text); list.fmt = t ? { font: t.font, size: t.size, b: t.b, i: t.i, color: t.color } : { font: rbase.font, size: rbase.size }; list.hang = eff.first < 0 ? -eff.first : 0; }
    const { outline, ...pr } = eff;
    return { t: 'p', level: Math.min(level, 6), list, pr, runs };
  };
  const blocksOf = (node, depth) => {
    const out = [];
    for (const c of node.children) {
      if (count >= DOC_BLOCK_MAX) { truncated = true; break; }
      const n = c.localName;
      if (n === 'p') { out.push(paragraph(c)); count++; }
      else if (n === 'tbl' && depth < 4) out.push(table(c, depth));
      else if (n === 'sdt') out.push(...blocksOf(kid(c, 'sdtContent') || c, depth));
    }
    return out;
  };
  function table(tbl, depth) {
    const tp = kid(tbl, 'tblPr');
    const ts = resolve(at(kid(tp, 'tblStyle'), 'val'));
    const look = kid(tp, 'tblLook');
    const firstRow = !!ts.first && (at(look, 'firstRow') === '1' || (at(look, 'val') && (parseInt(at(look, 'val'), 16) & 0x20) !== 0));
    const bd = { ...(ts.tbl && ts.tbl.borders), ...borders(kid(tp, 'tblBorders')) };
    const w = kid(tp, 'tblW');
    const grid = kids(kid(tbl, 'tblGrid'), 'gridCol').map((g) => tw(at(g, 'w')));
    const mar = kid(tp, 'tblCellMar');
    const pad = { t: tw(at(kid(mar, 'top'), 'w')), l: tw(at(kid(mar, 'left') || kid(mar, 'start'), 'w')), r: tw(at(kid(mar, 'right') || kid(mar, 'end'), 'w')), b: tw(at(kid(mar, 'bottom'), 'w')) };
    const rows = kids(tbl, 'tr').map((tr, ri) => {
      let col = 0;
      return kids(tr, 'tc').map((tc) => {
        const cp = kid(tc, 'tcPr');
        const span = Number(at(kid(cp, 'gridSpan'), 'val')) || 1;
        const vm = kid(cp, 'vMerge');
        const cell = {
          span, col, vm: vm ? (at(vm, 'val') === 'restart' ? 'restart' : 'cont') : null,
          bg: colorOf(kid(cp, 'shd'), 'fill', 'themeFill') || (firstRow && ri === 0 ? ts.first.bg : null),
          borders: borders(kid(cp, 'tcBorders')), valign: at(kid(cp, 'vAlign'), 'val'),
          width: at(kid(cp, 'tcW'), 'type') === 'dxa' ? tw(at(kid(cp, 'tcW'), 'w')) : undefined,
          bold: firstRow && ri === 0 && ts.first.r.b, blocks: blocksOf(tc, depth + 1)
        };
        col += span;
        return cell;
      });
    });
    for (let ri = 0; ri < rows.length; ri++) for (const cell of rows[ri]) {
      if (cell.vm !== 'restart') continue;
      let n = 1;
      for (let k = ri + 1; k < rows.length; k++) { const nx = rows[k].find((x) => x.col === cell.col); if (nx && nx.vm === 'cont') { nx.skip = true; n++; } else break; }
      cell.rowSpan = n;
    }
    return { t: 'table', rows, borders: bd, grid, pct: at(w, 'type') === 'pct' ? Number(at(w, 'w')) / 50 : null, pad, align: at(kid(tp, 'jc'), 'val') };
  }

  const body = kid(root, 'body') || root;
  const blocks = blocksOf(body, 0);

  // ---- page, header, footer, footnotes ----
  const sect = kid(body, 'sectPr');
  const sz = kid(sect, 'pgSize') || kid(sect, 'pgSz'); const mg = kid(sect, 'pgMar');
  const page = {
    w: tw(at(sz, 'w')) || 816, h: tw(at(sz, 'h')) || 1056,
    t: tw(at(mg, 'top')) ?? 96, r: tw(at(mg, 'right')) ?? 96, b: tw(at(mg, 'bottom')) ?? 96, l: tw(at(mg, 'left')) ?? 96
  };
  const part = (refName) => {
    const refs = kids(sect, refName);
    const ref = refs.find((x) => at(x, 'type') === 'default') || refs[0];
    const rr = ref && rel[rat(ref, 'id')];
    const hr = rr && xml(files, rr.path);
    return hr ? blocksOf(hr, 0) : [];
  };
  const header = part('headerReference'); const footer = part('footerReference');
  const footnotes = [];
  if (fnOrder.length) {
    const fr = xml(files, 'word/footnotes.xml');
    for (const id of fnOrder) {
      const f = kids(fr, 'footnote').find((x) => at(x, 'id') === id);
      if (f) footnotes.push({ n: fnNo[id], blocks: blocksOf(f, 0) });
    }
  }
  return { kind: 'docx', blocks, media, truncated, page, header, footer, footnotes };
}

// ---- xlsx ----
const BUILTIN_FMT = { 0: 'General', 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%', 11: '0.00E+00', 14: 'yyyy-mm-dd', 15: 'd-mmm-yy', 16: 'd-mmm', 17: 'mmm-yy', 18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM', 20: 'h:mm', 21: 'h:mm:ss', 22: 'yyyy-mm-dd h:mm', 37: '#,##0 ;(#,##0)', 38: '#,##0 ;(#,##0)', 39: '#,##0.00;(#,##0.00)', 40: '#,##0.00;(#,##0.00)', 45: 'mm:ss', 46: 'h:mm:ss', 47: 'mm:ss.0', 49: '@' };
const INDEXED = ['000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF', '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF', '800000', '008000', '000080', '808000', '800080', '008080', 'C0C0C0', '808080', '9999FF', '993366', 'FFFFCC', 'CCFFFF', '660066', 'FF8080', '0066CC', 'CCCCFF', '000080', 'FF00FF', 'FFFF00', '00FFFF', '800080', '800000', '008080', '0000FF', '00CCFF', 'CCFFFF', 'CCFFCC', 'FFFF99', '99CCFF', 'FF99CC', 'CC99FF', 'FFCC99', '3366FF', '33CCCC', '99CC00', 'FFCC00', 'FF9900', 'FF6600', '666699', '969696', '003366', '339966', '003300', '333300', '993300', '993366', '333399', '333333'];
const THEME_IDX = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const two = (n) => String(n).padStart(2, '0');
const general = (v) => String(parseFloat(v.toPrecision(15)));
const colIndex = (ref) => {
  let n = 0;
  for (const ch of ref) { const k = ch.charCodeAt(0) - 64; if (k < 1 || k > 26) break; n = n * 26 + k; }
  return n - 1;
};
export const colName = (i) => { let s = ''; let x = i + 1; while (x > 0) { const r = (x - 1) % 26; s = String.fromCharCode(65 + r) + s; x = Math.floor((x - 1) / 26); } return s; };
const cellRef = (ref) => { const m = /^([A-Za-z]+)(\d+)$/.exec(ref || ''); return m ? { c: colIndex(m[1].toUpperCase()), r: Number(m[2]) - 1 } : null; };

function sections(code) {
  const out = []; let cur = ''; let q = false; let br = false;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch === '\\') { cur += ch + (code[++i] || ''); continue; }
    if (ch === '"') q = !q; else if (!q && ch === '[') br = true; else if (!q && ch === ']') br = false;
    if (ch === ';' && !q && !br) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}
// Literal text (quoted, escaped, currency) is moved out of the pattern so only placeholders and tokens remain.
function mask(sec) {
  const lits = [];
  let s = sec.replace(/\[\$([^\]-]*)(?:-[^\]]*)?\]/g, (m, c) => { lits.push(c); return String.fromCharCode(0xe100 + lits.length - 1); });
  s = s.replace(/\[[^\]]*\]/g, '');
  s = s.replace(/"([^"]*)"|\\(.)|_(.)|\*(.)/g, (m, q, e, u) => { lits.push(q !== undefined ? q : e !== undefined ? e : u !== undefined ? ' ' : ''); return String.fromCharCode(0xe100 + lits.length - 1); });
  return { s, lits };
}
const unmask = (s, lits) => s.replace(/[\ue100-\uf8ff]/g, (m) => lits[m.charCodeAt(0) - 0xe100]);
const isDateCode = (s) => /[dmyhs]|AM\/PM|A\/P/i.test(s.replace(/[\ue100-\uf8ff]/g, ''));

function fmtDate(v, s, lits, is1904) {
  const d = new Date(Math.round((v - (is1904 ? 24107 : 25569)) * 86400) * 1000);
  if (!Number.isFinite(d.getTime())) return null;
  const ap = /AM\/PM|A\/P/i.test(s);
  const toks = [...s.matchAll(/yyyy|yy|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss|s|AM\/PM|A\/P|\.0+/gi)];
  const h24 = d.getUTCHours(); const h12 = h24 % 12 || 12;
  let out = ''; let last = 0;
  toks.forEach((m, k) => {
    out += s.slice(last, m.index); last = m.index + m[0].length;
    const t = m[0].toLowerCase();
    const prev = toks[k - 1] && toks[k - 1][0].toLowerCase(); const next = toks[k + 1] && toks[k + 1][0].toLowerCase();
    const minute = (t === 'm' || t === 'mm') && (prev === 'h' || prev === 'hh' || next === 's' || next === 'ss');
    let x;
    if (minute) x = t === 'mm' ? two(d.getUTCMinutes()) : String(d.getUTCMinutes());
    else if (t === 'yyyy') x = String(d.getUTCFullYear()); else if (t === 'yy') x = two(d.getUTCFullYear() % 100);
    else if (t === 'mmmm') x = MONTHS[d.getUTCMonth()]; else if (t === 'mmm') x = MONTHS[d.getUTCMonth()].slice(0, 3);
    else if (t === 'mm') x = two(d.getUTCMonth() + 1); else if (t === 'm') x = String(d.getUTCMonth() + 1);
    else if (t === 'dddd') x = DAYS[d.getUTCDay()]; else if (t === 'ddd') x = DAYS[d.getUTCDay()].slice(0, 3);
    else if (t === 'dd') x = two(d.getUTCDate()); else if (t === 'd') x = String(d.getUTCDate());
    else if (t === 'hh') x = two(ap ? h12 : h24); else if (t === 'h') x = String(ap ? h12 : h24);
    else if (t === 'ss') x = two(d.getUTCSeconds()); else if (t === 's') x = String(d.getUTCSeconds());
    else if (t === 'am/pm') x = h24 < 12 ? 'AM' : 'PM'; else if (t === 'a/p') x = h24 < 12 ? 'A' : 'P';
    else x = '';
    out += x;
  });
  return unmask(out + s.slice(last), lits);
}
function fmtNum(val, s, lits) {
  const m = /[#0?][#0?,]*(?:\.[#0?]*)?(?:E[+-]0+)?|\.[#0?]+/.exec(s);
  if (!m) return unmask(s, lits);
  const pre = s.slice(0, m.index); let suf = s.slice(m.index + m[0].length);
  const pct = (pre + suf).split('%').length - 1;
  const sci = /E([+-])(0+)$/.exec(m[0]);
  const body = sci ? m[0].slice(0, sci.index) : m[0];
  const dot = body.indexOf('.');
  let intPat = dot < 0 ? body : body.slice(0, dot);
  const fracPat = dot < 0 ? '' : body.slice(dot + 1);
  let scale = 0;
  while (intPat.endsWith(',')) { intPat = intPat.slice(0, -1); scale++; } // trailing commas divide by 1000 each
  while (suf.startsWith(',')) { suf = suf.slice(1); scale++; }
  const thousands = intPat.includes(',');
  const digits = intPat.replace(/,/g, '');
  let x = val * 100 ** pct / 1000 ** scale;
  const dec = fracPat.length;
  let intStr; let fracStr; let exp = '';
  if (sci) {
    const e = x === 0 ? 0 : Math.floor(Math.log10(Math.abs(x)));
    const mant = x / 10 ** e;
    const [i, f = ''] = mant.toFixed(dec).split('.');
    intStr = i; fracStr = f;
    exp = `E${e < 0 ? '-' : sci[1] === '+' ? '+' : ''}${String(Math.abs(e)).padStart(sci[2].length, '0')}`;
  } else {
    [intStr, fracStr = ''] = x.toFixed(dec).split('.');
  }
  const minInt = (digits.match(/0/g) || []).length;
  if (intStr.length < minInt) intStr = intStr.padStart(minInt, '0');
  if (!minInt && intStr === '0') intStr = '';
  if (thousands) intStr = intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  let frac = '';
  if (dec) {
    // trailing optional placeholders (# and ?) drop trailing zeros
    let keep = dec;
    while (keep > 0 && fracPat[keep - 1] !== '0' && fracStr[keep - 1] === '0') keep--;
    frac = keep ? `.${fracStr.slice(0, keep)}` : '';
  }
  return unmask(pre, lits) + intStr + frac + exp + unmask(suf, lits);
}
// Shows a stored number the way its format code asks (common codes only; anything else falls back to General).
export function formatValue(raw, code, is1904) {
  const v = Number(raw);
  if (!Number.isFinite(v)) return raw;
  if (!code || /^general$/i.test(code)) return general(v);
  const secs = sections(code);
  let idx = 0; const val = Math.abs(v);
  if (secs.length >= 2 && v < 0) idx = 1; else if (secs.length >= 3 && v === 0) idx = 2;
  const { s, lits } = mask(secs[idx]);
  if (!s.trim()) return '';
  if (s.trim() === '@' || /^\s*general\s*$/i.test(s)) return general(v);
  if (isDateCode(s)) { const r = fmtDate(v, s, lits, is1904); return r === null ? general(v) : r; }
  if (/[?#0]\/[?#0\d]/.test(s)) return general(v);
  const out = fmtNum(val, s, lits);
  return v < 0 && idx === 0 ? `-${out}` : out;
}
const isDateKind = (code) => !!code && !/^general$/i.test(code) && sections(code).some((x) => { const { s } = mask(x); return s.trim() !== '@' && isDateCode(s); });

export function readXlsx(bytes) {
  const files = unpack(bytes, 'xl/', 'xl/workbook.xml');
  const main = 'xl/workbook.xml';
  const wb = xml(files, main);
  if (!wb) throw new OfficeError('This is not a valid file of this type.');
  const rel = rels(files, main);
  const is1904 = /^(1|true)$/i.test(at(kid(wb, 'workbookPr'), 'date1904') || '');

  const sst = [];
  for (const si of kids(xml(files, 'xl/sharedStrings.xml'), 'si')) {
    // t elements of plain and rich runs, not the phonetic ones (rPh)
    let s = '';
    const walk = (n) => { for (const c of n.children) { if (c.localName === 't') s += c.textContent; else if (c.localName === 'r') walk(c); } };
    walk(si);
    sst.push(s);
  }

  // ---- theme colours and styles ----
  const tc = {};
  const th = xml(files, 'xl/theme/theme1.xml');
  const cs = th && descendants(th, 'clrScheme')[0];
  for (const c of cs ? cs.children : []) { const v = c.firstElementChild; if (v) tc[c.localName] = at(v, 'val') && v.localName === 'srgbClr' ? at(v, 'val') : at(v, 'lastClr'); }
  const rgbArr = (h) => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  const hexOf = (a) => a.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('').toUpperCase();
  function colorX(n) {
    if (!n) return null;
    let hex = null;
    const rgb = at(n, 'rgb'); const theme = at(n, 'theme'); const idx = at(n, 'indexed');
    if (rgb && /^[0-9a-f]{8}$/i.test(rgb)) hex = rgb.slice(2).toUpperCase();
    else if (theme !== null && tc[THEME_IDX[Number(theme)]]) hex = String(tc[THEME_IDX[Number(theme)]]).toUpperCase();
    else if (idx !== null && INDEXED[Number(idx)]) hex = INDEXED[Number(idx)];
    if (!hex || !/^[0-9A-F]{6}$/.test(hex)) return null;
    const tint = Number(at(n, 'tint') || 0);
    if (tint) hex = hexOf(rgbArr(hex).map((c) => (tint > 0 ? c * (1 - tint) + 255 * tint : c * (1 + tint))));
    return hex;
  }
  const st = xml(files, 'xl/styles.xml');
  const custom = {};
  for (const f of kids(kid(st, 'numFmts'), 'numFmt')) custom[at(f, 'numFmtId')] = at(f, 'formatCode') || '';
  const fonts = kids(kid(st, 'fonts'), 'font').map((f) => ({
    name: at(kid(f, 'name'), 'val') || 'Calibri', size: Number(at(kid(f, 'sz'), 'val') || 11), b: !!kid(f, 'b') && flag(kid(f, 'b')), i: !!kid(f, 'i') && flag(kid(f, 'i')),
    u: !!kid(f, 'u') && at(kid(f, 'u'), 'val') !== 'none', s: !!kid(f, 'strike') && flag(kid(f, 'strike')), color: colorX(kid(f, 'color'))
  }));
  const fills = kids(kid(st, 'fills'), 'fill').map((f) => { const p = kid(f, 'patternFill'); return p && at(p, 'patternType') === 'solid' ? colorX(kid(p, 'fgColor')) : null; });
  const bside = (b) => { const s = at(b, 'style'); return s ? { style: s, color: colorX(kid(b, 'color')) } : null; };
  const borders = kids(kid(st, 'borders'), 'border').map((b) => ({ l: bside(kid(b, 'left') || kid(b, 'start')), r: bside(kid(b, 'right') || kid(b, 'end')), t: bside(kid(b, 'top')), b: bside(kid(b, 'bottom')) }));
  const xfs = kids(kid(st, 'cellXfs'), 'xf').map((xf) => {
    const id = Number(at(xf, 'numFmtId') || 0);
    const code = custom[id] !== undefined ? custom[id] : BUILTIN_FMT[id] || 'General';
    const al = kid(xf, 'alignment');
    return {
      code, date: isDateKind(code), font: fonts[Number(at(xf, 'fontId') || 0)] || fonts[0], fill: fills[Number(at(xf, 'fillId') || 0)] || null, border: borders[Number(at(xf, 'borderId') || 0)] || null,
      h: at(al, 'horizontal') || 'general', v: at(al, 'vertical') || 'bottom', wrap: at(al, 'wrapText') === '1' || at(al, 'wrapText') === 'true', indent: Number(at(al, 'indent') || 0)
    };
  });
  if (!xfs.length) xfs.push({ code: 'General', date: false, font: fonts[0] || { name: 'Calibri', size: 11 }, fill: null, border: null, h: 'general', v: 'bottom', wrap: false, indent: 0 });

  const sheets = [];
  for (const s of kids(kid(wb, 'sheets'), 'sheet')) {
    if (at(s, 'state') === 'hidden' || at(s, 'state') === 'veryHidden') continue;
    const r = rel[rat(s, 'id')];
    if (r && files[r.path]) sheets.push({ name: at(s, 'name') || 'Sheet', path: r.path });
  }
  if (!sheets.length) throw new OfficeError('This workbook has no sheets to show.');

  const colPx = (w) => Math.round(w * 7 + 5);
  function load(i) {
    const root = xml(files, sheets[i].path);
    if (!root) throw new OfficeError('This sheet could not be read.');
    const fmtPr = kid(root, 'sheetFormatPr');
    const defCol = colPx(Number(at(fmtPr, 'defaultColWidth') || at(fmtPr, 'baseColWidth') || 8.43));
    const defRow = Math.round(Number(at(fmtPr, 'defaultRowHeight') || 15) * PX_PT);
    const colW = {}; // index -> px (0 = hidden)
    for (const c of kids(kid(root, 'cols'), 'col')) {
      const w = at(c, 'hidden') === '1' ? 0 : colPx(Number(at(c, 'width') || 8.43));
      for (let k = Number(at(c, 'min')) - 1; k < Math.min(Number(at(c, 'max')), SHEET_COL_MAX); k++) colW[k] = w;
    }
    const rowH = {}; const rows = []; let ncols = 0; let truncated = false; let cellCount = 0;
    let rowNo = 0;
    for (const row of kids(kid(root, 'sheetData'), 'row')) {
      rowNo = Number(at(row, 'r')) || rowNo + 1;
      if (rowNo > SHEET_ROW_MAX || cellCount > 100000) { truncated = true; break; }
      if (at(row, 'hidden') === '1') rowH[rowNo - 1] = 0;
      else if (at(row, 'ht') && at(row, 'customHeight') !== '0') rowH[rowNo - 1] = Math.round(Number(at(row, 'ht')) * PX_PT);
      const cells = []; let colNo = 0;
      for (const c of kids(row, 'c')) {
        const ref = at(c, 'r');
        colNo = ref ? colIndex(ref) : colNo;
        if (colNo >= SHEET_COL_MAX) { truncated = true; colNo++; continue; }
        const t = at(c, 't'); const sIdx = Number(at(c, 's') || 0);
        const x = xfs[sIdx] || xfs[0];
        const v = kid(c, 'v');
        let text = ''; let kind = 's';
        if (t === 'inlineStr') text = descendants(kid(c, 'is') || c, 't').map((y) => y.textContent).join('');
        else if (v) {
          const raw = v.textContent;
          if (t === 's') text = sst[Number(raw)] ?? '';
          else if (t === 'b') { text = raw === '1' ? 'TRUE' : 'FALSE'; kind = 'b'; }
          else if (t === 'str') text = raw;
          else if (t === 'e') { text = raw; kind = 'b'; }
          else { text = formatValue(raw, x.code, is1904); kind = 'n'; }
        }
        if (text !== '' || sIdx) { cells[colNo] = { v: text, s: sIdx, k: kind }; cellCount++; if (text !== '' || x.fill || x.border) { if (colNo + 1 > ncols) ncols = colNo + 1; } }
        colNo++;
      }
      rows[rowNo - 1] = cells;
    }
    for (let k = 0; k < rows.length; k++) rows[k] = Array.from(rows[k] || []);
    const merges = [];
    for (const m of kids(kid(root, 'mergeCells'), 'mergeCell')) {
      const [a1, b1] = (at(m, 'ref') || '').split(':'); const a = cellRef(a1); const b = cellRef(b1 || a1);
      if (a && b && b.r < SHEET_ROW_MAX && a.c < SHEET_COL_MAX) merges.push({ r: a.r, c: a.c, rs: b.r - a.r + 1, cs: Math.min(b.c, SHEET_COL_MAX - 1) - a.c + 1 });
    }
    const view = kid(kid(root, 'sheetViews'), 'sheetView');
    const pane = kid(view, 'pane');
    const frozen = pane && at(pane, 'state') && /frozen/.test(at(pane, 'state'));
    return {
      rows, ncols, truncated, colW, defCol, rowH, defRow, merges,
      freeze: frozen ? { rows: Math.min(Number(at(pane, 'ySplit') || 0), 20), cols: Math.min(Number(at(pane, 'xSplit') || 0), 10) } : { rows: 0, cols: 0 },
      grid: at(view, 'showGridLines') !== '0' && at(view, 'showGridLines') !== 'false',
      hasDrawing: !!kid(root, 'drawing')
    };
  }
  return { kind: 'xlsx', names: sheets.map((s) => s.name), load, xfs };
}

// ---- pptx ----
// Slides are resolved here to absolutely positioned items in px (shapes, pictures, tables, lines), with every
// inherited property (placeholder position, text size, colour, bullet, background) already applied, so drawing is plain.
const EMU = 9525;
const PRST = { black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00', gray: '808080', grey: '808080', orange: 'FFA500', purple: '800080', cyan: '00FFFF', magenta: 'FF00FF' };
function toHsl(h) {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const hh = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [hh * 60, s, l];
}
function fromHsl(h, s, l) {
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map((v) => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, '0')).join('').toUpperCase();
}
const mixHex = (hex, to, t) => [0, 2, 4].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - t) + parseInt(to.slice(i, i + 2), 16) * t).toString(16).padStart(2, '0')).join('').toUpperCase();

export function readPptx(bytes) {
  const files = unpack(bytes, 'ppt/', 'ppt/presentation.xml');
  const main = 'ppt/presentation.xml';
  const pres = xml(files, main);
  if (!pres) throw new OfficeError('This is not a valid file of this type.');
  const rel = rels(files, main);
  const sz = kid(pres, 'sldSz');
  const W = Number(at(sz, 'cx') || 9144000) / EMU; const H = Number(at(sz, 'cy') || 6858000) / EMU;
  const defText = kid(pres, 'defaultTextStyle');
  const slides = [];
  for (const s of kids(kid(pres, 'sldIdLst'), 'sldId')) {
    const r = rel[rat(s, 'id')];
    if (r && files[r.path]) slides.push(r.path);
    if (slides.length >= SLIDE_MAX) break;
  }
  if (!slides.length) throw new OfficeError('This presentation has no slides to show.');
  const themes = {};
  function themeOf(masterPath, mrel) {
    if (themes[masterPath]) return themes[masterPath];
    const t = { colors: {}, major: 'Calibri', minor: 'Calibri' };
    const tr = Object.values(mrel).find((x) => x.type.endsWith('/theme'));
    const th = tr && xml(files, tr.path);
    if (th) {
      const cs = descendants(th, 'clrScheme')[0];
      for (const c of cs ? cs.children : []) { const v = c.firstElementChild; if (v) t.colors[c.localName] = String((v.localName === 'srgbClr' ? at(v, 'val') : at(v, 'lastClr')) || '000000').toUpperCase(); }
      t.major = at(kid(descendants(th, 'majorFont')[0], 'latin'), 'typeface') || t.major;
      t.minor = at(kid(descendants(th, 'minorFont')[0], 'latin'), 'typeface') || t.minor;
    }
    themes[masterPath] = t;
    return t;
  }

  function load(i) {
    const part = slides[i];
    const root = xml(files, part);
    if (!root) throw new OfficeError('This slide could not be read.');
    const srel = rels(files, part);
    const lr = Object.values(srel).find((x) => x.type.endsWith('/slideLayout'));
    const layout = lr && xml(files, lr.path); const lrel = lr ? rels(files, lr.path) : {};
    const mr = Object.values(lrel).find((x) => x.type.endsWith('/slideMaster'));
    const master = mr && xml(files, mr.path); const mrel = mr ? rels(files, mr.path) : {};
    const T = mr ? themeOf(mr.path, mrel) : { colors: {}, major: 'Calibri', minor: 'Calibri' };
    const clrMap = {};
    for (const a of kid(master, 'clrMap') ? kid(master, 'clrMap').attributes : []) clrMap[a.localName] = a.value;
    const media = {};
    const photo = (rl, id) => { const x = rl[id]; const im = x && image(files, x.path); if (im) { media[x.path] = im; return x.path; } return null; };

    // ---- colour ----
    function clr(parent, ph) {
      const c = parent && Array.from(parent.children).find((x) => ['srgbClr', 'schemeClr', 'sysClr', 'prstClr'].includes(x.localName));
      if (!c) return null;
      let hex = null; const v = at(c, 'val');
      if (c.localName === 'srgbClr') hex = (v || '').toUpperCase();
      else if (c.localName === 'sysClr') hex = (at(c, 'lastClr') || '000000').toUpperCase();
      else if (c.localName === 'prstClr') hex = PRST[v] || '000000';
      else if (v === 'phClr') hex = ph || null;
      else hex = T.colors[clrMap[v] || v] || null;
      if (!hex || !/^[0-9A-F]{6}$/.test(hex)) return null;
      let a = 1;
      for (const t of c.children) {
        const n = t.localName; const val = Number(at(t, 'val') || 0) / 100000;
        if (n === 'lumMod' || n === 'lumOff') { const [h, s, l] = toHsl(hex); hex = fromHsl(h, s, n === 'lumMod' ? Math.min(1, l * val) : Math.min(1, l + val)); }
        else if (n === 'tint') hex = mixHex(hex, 'FFFFFF', 1 - val);
        else if (n === 'shade') hex = mixHex(hex, '000000', 1 - val);
        else if (n === 'alpha') a = val;
      }
      return { hex, a };
    }
    const fillOf = (sp, ph) => { // undefined: not set here; null: no fill
      if (!sp) return undefined;
      if (kid(sp, 'noFill')) return null;
      if (kid(sp, 'solidFill')) return clr(kid(sp, 'solidFill'), ph);
      const g = kid(sp, 'gradFill');
      if (g) {
        const stops = kids(kid(g, 'gsLst'), 'gs').map((s) => ({ pos: Number(at(s, 'pos') || 0) / 1000, c: clr(s, ph) })).filter((s) => s.c);
        const ang = (Number(at(kid(g, 'lin'), 'ang') || 5400000) / 60000 + 90) % 360;
        return stops.length ? { grad: stops, ang } : null;
      }
      return undefined;
    };
    const lineOf = (ln, ph) => {
      if (!ln) return undefined;
      if (kid(ln, 'noFill')) return null;
      const c = kid(ln, 'solidFill') ? clr(kid(ln, 'solidFill'), ph) : undefined;
      if (c === undefined) return at(ln, 'w') ? { w: Math.max(1, Number(at(ln, 'w')) / EMU) } : undefined;
      const d = at(kid(ln, 'prstDash'), 'val');
      return c && { w: Math.max(1, Number(at(ln, 'w') || 12700) / EMU), color: c, dash: d && d !== 'solid' ? (/sys|dot/i.test(d) ? 'dotted' : 'dashed') : 'solid' };
    };

    // ---- text property readers ----
    const fontName = (f) => (f === '+mj-lt' ? T.major : f === '+mn-lt' ? T.minor : f);
    const readR = (rp) => {
      const o = {};
      if (!rp) return o;
      if (at(rp, 'sz')) o.size = Number(at(rp, 'sz')) / 100 * PX_PT;
      for (const [k, n] of [['b', 'b'], ['i', 'i']]) if (at(rp, n) !== null) o[k] = at(rp, n) === '1' || at(rp, n) === 'true';
      if (at(rp, 'u') !== null) o.u = at(rp, 'u') !== 'none';
      if (at(rp, 'strike') !== null) o.s = at(rp, 'strike') !== 'noStrike';
      if (at(rp, 'cap') !== null) o.caps = at(rp, 'cap') === 'all';
      if (at(rp, 'baseline')) { const b = Number(at(rp, 'baseline')); if (b > 0) o.sup = true; else if (b < 0) o.sub = true; }
      const sf = kid(rp, 'solidFill'); if (sf) o.color = clr(sf);
      const lat = kid(rp, 'latin'); if (lat && at(lat, 'typeface')) o.font = fontName(at(lat, 'typeface'));
      return o;
    };
    const readP = (pp) => {
      const o = {};
      if (!pp) return o;
      const al = at(pp, 'algn'); if (al) o.algn = { l: 'left', ctr: 'center', r: 'right', just: 'justify', dist: 'justify' }[al] || 'left';
      if (at(pp, 'marL') !== null) o.marL = Number(at(pp, 'marL')) / EMU;
      if (at(pp, 'indent') !== null) o.indent = Number(at(pp, 'indent')) / EMU;
      const sp = (n) => { const x = kid(pp, n); if (!x) return undefined; const pt = kid(x, 'spcPts'); const pc = kid(x, 'spcPct'); return pt ? { px: Number(at(pt, 'val')) / 100 * PX_PT } : pc ? { pct: Number(at(pc, 'val')) / 100000 } : undefined; };
      o.sb = sp('spcBef'); o.sa = sp('spcAft');
      const ls = sp('lnSpc'); if (ls) o.ln = ls;
      if (kid(pp, 'buNone')) o.bu = { none: true };
      else if (kid(pp, 'buChar')) o.bu = { char: at(kid(pp, 'buChar'), 'char') || '\u2022' };
      else if (kid(pp, 'buAutoNum')) o.bu = { auto: at(kid(pp, 'buAutoNum'), 'type') || 'arabicPeriod', start: Number(at(kid(pp, 'buAutoNum'), 'startAt') || 1) };
      if (o.bu || kid(pp, 'buClr') || kid(pp, 'buSzPct') || kid(pp, 'buFont')) {
        o.buc = kid(pp, 'buClr') ? clr(kid(pp, 'buClr')) : undefined;
        o.bus = kid(pp, 'buSzPct') ? Number(at(kid(pp, 'buSzPct'), 'val')) / 100000 : undefined;
        o.buf = kid(pp, 'buFont') ? at(kid(pp, 'buFont'), 'typeface') : undefined;
      }
      const d = kid(pp, 'defRPr'); if (d) o.r = readR(d);
      return o;
    };
    const lvlProps = (chain, lvl) => {
      const p = {}; const rr = {};
      for (let k = chain.length - 1; k >= 0; k--) {
        const x = chain[k] && kid(chain[k], `lvl${lvl + 1}pPr`);
        if (!x) continue;
        const pp = readP(x);
        for (const [key, val] of Object.entries(pp)) if (val !== undefined && key !== 'r') p[key] = val;
        if (pp.r) Object.assign(rr, pp.r);
      }
      return { p, r: rr };
    };

    // ---- placeholders: find the matching shape in the layout and master ----
    const spTreeOf = (n) => kid(kid(n, 'cSld'), 'spTree');
    const phOf = (sp) => kid(kid(kid(sp, 'nvSpPr'), 'nvPr'), 'ph');
    const baseType = (t) => (t === 'ctrTitle' ? 'title' : t === 'subTitle' || t === 'obj' || t === '' || t === null ? 'body' : t);
    function findPh(tree, ph) {
      if (!tree || !ph) return null;
      const idx = at(ph, 'idx'); const type = at(ph, 'type');
      const all = kids(tree, 'sp').filter((s) => phOf(s));
      return all.find((s) => idx !== null && at(phOf(s), 'idx') === idx && (at(phOf(s), 'type') || null) === (type || null))
        || all.find((s) => idx !== null && at(phOf(s), 'idx') === idx)
        || all.find((s) => baseType(at(phOf(s), 'type')) === baseType(type)) || null;
    }
    const lTree = spTreeOf(layout); const mTree = spTreeOf(master);
    const txCat = (type) => { const b = baseType(type); return b === 'title' ? 'titleStyle' : b === 'body' ? 'bodyStyle' : 'otherStyle'; };
    const txStyles = kid(master, 'txStyles');

    function xfrmOf(spPr) {
      const x = kid(spPr, 'xfrm');
      if (!x) return null;
      const off = kid(x, 'off'); const ext = kid(x, 'ext');
      if (!ext) return null;
      return { x: Number(at(off, 'x') || 0), y: Number(at(off, 'y') || 0), w: Number(at(ext, 'cx') || 0), h: Number(at(ext, 'cy') || 0), rot: Number(at(x, 'rot') || 0) / 60000, fh: at(x, 'flipH') === '1', fv: at(x, 'flipV') === '1' };
    }
    const place = (g, xf) => ({ x: (xf.sx * g.x + xf.tx) / EMU, y: (xf.sy * g.y + xf.ty) / EMU, w: (g.w * xf.sx) / EMU, h: (g.h * xf.sy) / EMU, rot: g.rot, fh: g.fh, fv: g.fv });

    function textBody(tx, chain, ctx) {
      const bp = kid(tx, 'bodyPr');
      const body = { anchor: at(ctx.bodyPr[0], 'anchor') || at(ctx.bodyPr[1], 'anchor') || at(ctx.bodyPr[2], 'anchor') || 't' };
      const pick = (n, d) => { for (const b of ctx.bodyPr) if (b && at(b, n) !== null) return Number(at(b, n)); return d; };
      body.l = pick('lIns', 91440) / EMU; body.r = pick('rIns', 91440) / EMU; body.t = pick('tIns', 45720) / EMU; body.b = pick('bIns', 45720) / EMU;
      const wb = ctx.bodyPr.find((b) => b && at(b, 'wrap') !== null); body.wrap = !wb || at(wb, 'wrap') !== 'none';
      const na = kid(bp, 'normAutofit'); body.scale = na && at(na, 'fontScale') ? Number(at(na, 'fontScale')) / 100000 : 1;
      const counters = [];
      body.paras = [];
      for (const p of kids(tx, 'p')) {
        const pp = kid(p, 'pPr'); const lvl = Math.min(Number(at(pp, 'lvl') || 0), 8);
        const base = lvlProps(chain, lvl); const own = readP(pp);
        const props = { ...base.p, ...Object.fromEntries(Object.entries(own).filter(([k, v]) => v !== undefined && k !== 'r')) };
        const runs = [];
        for (const c of p.children) {
          if (c.localName === 'r' || c.localName === 'fld') {
            const text = kids(c, 't').map((t) => t.textContent).join('');
            if (!text) continue;
            const f = { ...base.r, ...(own.r || {}), ...readR(kid(c, 'rPr')) };
            runs.push({ text, font: f.font || T.minor, size: f.size, b: f.b, i: f.i, u: f.u, s: f.s, caps: f.caps, sup: f.sup, sub: f.sub, color: f.color || ctx.color });
          } else if (c.localName === 'br') runs.push({ br: true });
        }
        const endR = { ...base.r, ...readR(kid(p, 'endParaRPr')) };
        let bullet = null;
        if (runs.length && props.bu && !props.bu.none) {
          if (props.bu.char) bullet = { text: props.bu.char === '\u00a7' ? '\u25aa' : props.bu.char };
          else { counters[lvl] = counters[lvl] === undefined ? props.bu.start : counters[lvl] + 1; counters.length = lvl + 1; const n = counters[lvl]; bullet = { text: /alpha/i.test(props.bu.auto) ? letters(n, /Uc/.test(props.bu.auto)) + (/ParenR/.test(props.bu.auto) ? ')' : '.') : n + (/ParenR/.test(props.bu.auto) ? ')' : '.') }; }
          bullet.color = props.buc || (runs.find((x) => x.color) || {}).color; bullet.size = props.bus;
        } else if (!props.bu) counters.length = Math.min(counters.length, lvl);
        body.paras.push({ algn: props.algn || 'left', marL: props.marL || 0, indent: props.indent || 0, sb: props.sb, sa: props.sa, ln: props.ln, bullet, runs, size: endR.size || (runs.find((x) => x.size) || {}).size });
      }
      return body;
    }
    const dText = defText ? [defText] : [];

    const items = [];
    const defColor = { hex: T.colors[clrMap.tx1 || 'tx1'] || T.colors.dk1 || '000000', a: 1 };
    function walk(tree, rl, xf, level) {
      for (const c of tree.children) {
        const n = c.localName;
        if (n === 'AlternateContent') { const ch = kid(c, 'Choice'); if (ch) walk({ children: ch.children }, rl, xf, level); continue; }
        if (n === 'grpSp') {
          const gx = kid(kid(c, 'grpSpPr'), 'xfrm');
          let nx = xf;
          if (gx && kid(gx, 'off') && kid(gx, 'chOff')) {
            const o = kid(gx, 'off'), e = kid(gx, 'ext'), co = kid(gx, 'chOff'), ce = kid(gx, 'chExt');
            const kx = Number(at(ce, 'cx')) ? Number(at(e, 'cx')) / Number(at(ce, 'cx')) : 1; const ky = Number(at(ce, 'cy')) ? Number(at(e, 'cy')) / Number(at(ce, 'cy')) : 1;
            nx = { sx: xf.sx * kx, sy: xf.sy * ky, tx: xf.sx * (Number(at(o, 'x')) - Number(at(co, 'x')) * kx) + xf.tx, ty: xf.sy * (Number(at(o, 'y')) - Number(at(co, 'y')) * ky) + xf.ty };
          }
          walk(c, rl, nx, level);
          continue;
        }
        if (n === 'pic') {
          const spPr = kid(c, 'spPr'); const g = xfrmOf(spPr); if (!g) continue;
          const path = photo(rl, rat(kid(kid(c, 'blipFill'), 'blip'), 'embed')); if (!path) continue;
          const sr = kid(kid(c, 'blipFill'), 'srcRect');
          items.push({ t: 'pic', ...place(g, xf), path, crop: sr ? { l: Number(at(sr, 'l') || 0) / 1000, t: Number(at(sr, 't') || 0) / 1000, r: Number(at(sr, 'r') || 0) / 1000, b: Number(at(sr, 'b') || 0) / 1000 } : null, line: lineOf(kid(spPr, 'ln')) || null });
          continue;
        }
        if (n === 'graphicFrame') {
          const fx = kid(c, 'xfrm'); const g = fx ? { x: Number(at(kid(fx, 'off'), 'x') || 0), y: Number(at(kid(fx, 'off'), 'y') || 0), w: Number(at(kid(fx, 'ext'), 'cx') || 0), h: Number(at(kid(fx, 'ext'), 'cy') || 0), rot: 0 } : null;
          if (!g) continue;
          const tbl = descendants(c, 'tbl')[0];
          items.push(tbl ? { t: 'table', ...place(g, xf), ...table(tbl, c) } : { t: 'note', ...place(g, xf), text: 'A chart or diagram is not shown here.' });
          continue;
        }
        if (n !== 'sp' && n !== 'cxnSp') continue;
        const ph = n === 'sp' ? phOf(c) : null;
        if (ph && level !== 'slide') continue; // layout and master placeholders only lend their properties
        const spPr = kid(c, 'spPr');
        const lph = level === 'slide' && ph ? findPh(lTree, ph) : null;
        const mph = ph ? findPh(mTree, lph ? phOf(lph) : ph) : null;
        const g = xfrmOf(spPr) || xfrmOf(kid(lph, 'spPr')) || xfrmOf(kid(mph, 'spPr'));
        if (!g) continue;
        const style = kid(c, 'style');
        const fr = kid(style, 'fillRef'); const lnr = kid(style, 'lnRef'); const fnr = kid(style, 'fontRef');
        const phc = (n2) => (n2 ? clr(n2) : null);
        let fill; let line;
        for (const sp of [spPr, kid(lph, 'spPr'), kid(mph, 'spPr')]) { if (fill === undefined) fill = fillOf(sp); if (line === undefined) line = lineOf(kid(sp, 'ln')); }
        if (fill === undefined) fill = fr && Number(at(fr, 'idx')) > 0 ? phc(fr) : null;
        if (line === undefined) line = lnr && Number(at(lnr, 'idx')) > 0 ? { w: 1.5, color: phc(lnr), dash: 'solid' } : null;
        else if (line && line.color === undefined) line = lnr && Number(at(lnr, 'idx')) > 0 ? { ...line, color: phc(lnr), dash: 'solid' } : null;
        const prst = at(kid(spPr, 'prstGeom'), 'prst') || (n === 'cxnSp' ? 'line' : 'rect');
        const gd = kid(kid(kid(spPr, 'prstGeom'), 'avLst'), 'gd'); const am = gd && /val (-?\d+)/.exec(at(gd, 'fmla') || ''); const adj = am ? Number(am[1]) : 0;
        const item = { t: 'shape', ...place(g, xf), geom: prst, adj: adj || null, fill, line };
        const tx = kid(c, 'txBody');
        if (tx && n === 'sp') {
          const lst = (nd) => kid(kid(nd, 'txBody'), 'lstStyle');
          const chain = [kid(tx, 'lstStyle'), lst(lph), lst(mph), ph ? kid(txStyles, txCat(at(ph, 'type'))) : null, ...dText];
          const color = fnr ? phc(fnr) || defColor : defColor;
          const body = textBody(tx, chain, { bodyPr: [kid(tx, 'bodyPr'), kid(kid(lph, 'txBody'), 'bodyPr'), kid(kid(mph, 'txBody'), 'bodyPr')], color });
          if (body.paras.some((p) => p.runs.length)) item.text = body;
        }
        if (item.text || item.fill || item.line || level !== 'slide') items.push(item);
      }
    }
    function table(tbl, frame) {
      const tp = kid(tbl, 'tblPr'); const sid = kid(tp, 'tableStyleId') ? kid(tp, 'tableStyleId').textContent.trim() : '';
      const cols = kids(kid(tbl, 'tblGrid'), 'gridCol').map((x) => Number(at(x, 'w')) / EMU);
      const first = at(tp, 'firstRow') === '1'; const band = at(tp, 'bandRow') === '1';
      const a1 = T.colors.accent1 || '4472C4'; const lt = T.colors.lt1 || 'FFFFFF'; const dk = T.colors.dk1 || '000000';
      const none = /2D5ABB26/i.test(sid); const grid = /5940675A/i.test(sid);
      const rows = kids(tbl, 'tr').map((tr, ri) => ({
        h: Number(at(tr, 'h') || 0) / EMU,
        cells: kids(tr, 'tc').map((tc) => {
          const cp = kid(tc, 'tcPr');
          const own = fillOf(cp);
          let fill = own; let color = defColor; let bold = false;
          if (own === undefined && !none && !grid) {
            if (first && ri === 0) { fill = { hex: a1, a: 1 }; color = { hex: lt, a: 1 }; bold = true; }
            else fill = { hex: mixHex(a1, 'FFFFFF', band && ri % 2 === 1 ? 0.6 : 0.8), a: 1 };
          }
          const bd = {};
          for (const [k, nm] of [['l', 'lnL'], ['r', 'lnR'], ['t', 'lnT'], ['b', 'lnB']]) { const l = lineOf(kid(cp, nm)); bd[k] = l === undefined ? (none ? null : grid ? { w: 1, color: { hex: dk, a: 1 }, dash: 'solid' } : { w: 1, color: { hex: lt, a: 1 }, dash: 'solid' }) : l; }
          const tx = kid(tc, 'txBody');
          const body = tx ? textBody(tx, [kid(tx, 'lstStyle'), ...dText], { bodyPr: [null, null, null], color }) : { paras: [] };
          if (bold) for (const p of body.paras) for (const r2 of p.runs) if (r2.b === undefined) r2.b = true;
          const pad = (nm, d) => (at(cp, nm) !== null ? Number(at(cp, nm)) / EMU : d);
          return { span: Number(at(tc, 'gridSpan') || 1), rowSpan: Number(at(tc, 'rowSpan') || 1), skip: at(tc, 'hMerge') === '1' || at(tc, 'vMerge') === '1', fill, bd, anchor: at(cp, 'anchor') || 't', pl: pad('marL', 9.6), pr: pad('marR', 9.6), pt: pad('marT', 4.8), pb: pad('marB', 4.8), body };
        })
      }));
      return { cols, rows };
    }

    const media0 = media;
    // ---- background ----
    let bg = null;
    for (const [node, rl] of [[root, srel], [layout, lrel], [master, mrel]]) {
      const b = kid(kid(node, 'cSld'), 'bg'); if (!b) continue;
      const pr = kid(b, 'bgPr'); const ref = kid(b, 'bgRef');
      const f = pr ? fillOf(pr) : ref ? clr(ref) : undefined;
      if (f !== undefined) { bg = f; break; }
      const bl = kid(pr, 'blipFill'); if (bl) { const p = photo(rl, rat(kid(bl, 'blip'), 'embed')); if (p) { bg = { img: p }; break; } }
    }
    if (bg === null) bg = { hex: T.colors[clrMap.bg1 || 'bg1'] || T.colors.lt1 || 'FFFFFF', a: 1 };
    const id = { sx: 1, sy: 1, tx: 0, ty: 0 };
    const showM = at(root, 'showMasterSp') !== '0' && at(layout, 'showMasterSp') !== '0';
    if (master && showM) walk(spTreeOf(master), mrel, id, 'master');
    if (layout && at(root, 'showMasterSp') !== '0') walk(lTree, lrel, id, 'layout');
    walk(spTreeOf(root), srel, id, 'slide');
    // speaker notes: the body placeholder of the notes page
    let notes = '';
    const nr = Object.values(srel).find((x) => x.type.endsWith('/notesSlide'));
    const nroot = nr && xml(files, nr.path);
    if (nroot) {
      notes = descendants(nroot, 'sp').filter((sp) => at(phOf(sp), 'type') === 'body')
        .map((sp) => kids(kid(sp, 'txBody'), 'p').map((p) => descendants(p, 't').map((t) => t.textContent).join('')).join('\n')).join('\n').trim();
    }
    return { w: W, h: H, bg, items, media: media0, notes };
  }
  return { kind: 'pptx', count: slides.length, load, size: { w: W, h: H } };
}
