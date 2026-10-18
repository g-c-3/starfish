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
const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
const BUILTIN_TIME = new Set([18, 19, 20, 21, 45, 46, 47]);
const BUILTIN_PERCENT = new Set([9, 10]);
function codeKind(code) {
  const c = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '').replace(/_./g, '');
  if (/[dmyhs]/i.test(c)) return /[dy]/i.test(c) ? 'date' : 'time';
  return /%/.test(c) ? 'percent' : 'plain';
}
const colIndex = (ref) => {
  let n = 0;
  for (const ch of ref) { const k = ch.charCodeAt(0) - 64; if (k < 1 || k > 26) break; n = n * 26 + k; }
  return n - 1;
};
export const colName = (i) => { let s = ''; let x = i + 1; while (x > 0) { const r = (x - 1) % 26; s = String.fromCharCode(65 + r) + s; x = Math.floor((x - 1) / 26); } return s; };
const two = (n) => String(n).padStart(2, '0');
function serialText(v, kind, is1904) {
  const ms = Math.round((v - (is1904 ? 24107 : 25569)) * 86400000);
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return String(v);
  const date = `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}`;
  const time = `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())}`;
  if (kind === 'time') return time;
  return v % 1 ? `${date} ${time}` : date;
}
function numberText(raw, kind, is1904) {
  const v = Number(raw);
  if (!Number.isFinite(v)) return raw;
  if (kind === 'date' || kind === 'time') return serialText(v, kind, is1904);
  if (kind === 'percent') return `${parseFloat((v * 100).toPrecision(12))}%`;
  return String(parseFloat(v.toPrecision(15)));
}

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
  // cell format index -> kind
  const custom = {};
  const st = xml(files, 'xl/styles.xml');
  for (const f of kids(kid(st, 'numFmts'), 'numFmt')) custom[at(f, 'numFmtId')] = codeKind(at(f, 'formatCode') || '');
  const xfKind = kids(kid(st, 'cellXfs'), 'xf').map((xf) => {
    const id = Number(at(xf, 'numFmtId') || 0);
    if (custom[id]) return custom[id];
    if (BUILTIN_TIME.has(id)) return 'time';
    if (BUILTIN_DATE.has(id)) return 'date';
    return BUILTIN_PERCENT.has(id) ? 'percent' : 'plain';
  });

  const sheets = [];
  for (const s of kids(kid(wb, 'sheets'), 'sheet')) {
    if (at(s, 'state') === 'hidden' || at(s, 'state') === 'veryHidden') continue;
    const r = rel[rat(s, 'id')];
    if (r && files[r.path]) sheets.push({ name: at(s, 'name') || 'Sheet', path: r.path });
  }
  if (!sheets.length) throw new OfficeError('This workbook has no sheets to show.');

  function load(i) {
    const root = xml(files, sheets[i].path);
    if (!root) throw new OfficeError('This sheet could not be read.');
    const rows = []; let ncols = 0; let truncated = false;
    let rowNo = 0;
    for (const row of kids(kid(root, 'sheetData'), 'row')) {
      rowNo = Number(at(row, 'r')) || rowNo + 1;
      if (rowNo > SHEET_ROW_MAX) { truncated = true; break; }
      const cells = []; let colNo = 0;
      for (const c of kids(row, 'c')) {
        const ref = at(c, 'r');
        colNo = ref ? colIndex(ref) : colNo;
        if (colNo >= SHEET_COL_MAX) { truncated = true; colNo++; continue; }
        const t = at(c, 't');
        const v = kid(c, 'v');
        let text = '';
        if (t === 'inlineStr') text = descendants(kid(c, 'is') || c, 't').map((x) => x.textContent).join('');
        else if (v) {
          const raw = v.textContent;
          if (t === 's') text = sst[Number(raw)] ?? '';
          else if (t === 'b') text = raw === '1' ? 'TRUE' : 'FALSE';
          else if (t === 'str' || t === 'e') text = raw;
          else text = numberText(raw, xfKind[Number(at(c, 's') || 0)] || 'plain', is1904);
        }
        if (text !== '') { cells[colNo] = text; if (colNo + 1 > ncols) ncols = colNo + 1; }
        colNo++;
      }
      rows[rowNo - 1] = cells;
    }
    for (let k = 0; k < rows.length; k++) rows[k] = Array.from(rows[k] || [], (x) => x ?? '');
    return { rows, ncols, truncated };
  }
  return { kind: 'xlsx', names: sheets.map((s) => s.name), load };
}

// ---- pptx ----
function textRuns(p) {
  const out = [];
  for (const c of p.children) {
    if (c.localName === 'r' || c.localName === 'fld') {
      const rp = kid(c, 'rPr');
      const text = kids(c, 't').map((t) => t.textContent).join('');
      if (!text) continue;
      const f = { text };
      if (rp) {
        if (at(rp, 'b') === '1' || at(rp, 'b') === 'true') f.b = true;
        if (at(rp, 'i') === '1' || at(rp, 'i') === 'true') f.i = true;
        const u = at(rp, 'u'); if (u && u !== 'none') f.u = true;
      }
      out.push(f);
    } else if (c.localName === 'br') out.push({ br: true });
  }
  return out;
}
const BODY_PH = new Set(['body', 'obj', '']);

export function readPptx(bytes) {
  const files = unpack(bytes, 'ppt/', 'ppt/presentation.xml');
  const main = 'ppt/presentation.xml';
  const pres = xml(files, main);
  if (!pres) throw new OfficeError('This is not a valid file of this type.');
  const rel = rels(files, main);
  const slides = [];
  for (const s of kids(kid(pres, 'sldIdLst'), 'sldId')) {
    const r = rel[rat(s, 'id')];
    if (r && files[r.path]) slides.push(r.path);
    if (slides.length >= SLIDE_MAX) break;
  }
  if (!slides.length) throw new OfficeError('This presentation has no slides to show.');

  function load(i) {
    const part = slides[i];
    const root = xml(files, part);
    if (!root) throw new OfficeError('This slide could not be read.');
    const srel = rels(files, part);
    const media = {};
    const blocks = [];
    const paragraphs = (tx, isTitle, bulletDefault) => {
      const out = [];
      for (const p of kids(tx, 'p')) {
        const runs = textRuns(p);
        if (!runs.some((r) => r.text)) continue;
        const pp = kid(p, 'pPr');
        const explicit = !!(kid(pp, 'buChar') || kid(pp, 'buAutoNum'));
        const none = !!kid(pp, 'buNone');
        out.push({ t: 'p', level: Math.min(Number(at(pp, 'lvl') || 0), 5), bullet: !isTitle && !none && (explicit || bulletDefault), runs });
      }
      return out;
    };
    const shapes = (node) => {
      for (const c of node.children) {
        const n = c.localName;
        if (n === 'sp') {
          const ph = kid(kid(kid(c, 'nvSpPr'), 'nvPr'), 'ph');
          const type = ph ? at(ph, 'type') || '' : null;
          const isTitle = type === 'title' || type === 'ctrTitle';
          const tx = kid(c, 'txBody');
          if (!tx) continue;
          const paras = paragraphs(tx, isTitle, ph !== null && BODY_PH.has(type));
          if (isTitle && paras.length) blocks.push({ t: 'title', runs: paras.flatMap((p) => p.runs) });
          else blocks.push(...paras);
        } else if (n === 'pic') {
          const r = srel[blipId(c)];
          const img = r && image(files, r.path);
          if (img) { media[r.path] = img; blocks.push({ t: 'img', path: r.path }); }
        } else if (n === 'graphicFrame') {
          const tbl = descendants(c, 'tbl')[0];
          if (tbl) {
            blocks.push({ t: 'table', rows: kids(tbl, 'tr').map((tr) => kids(tr, 'tc').map((tc) => ({
              span: Number(at(tc, 'gridSpan')) || 1,
              text: kids(kid(tc, 'txBody'), 'p').map((p) => textRuns(p).map((r) => r.text || '\n').join('')).join('\n')
            }))) });
          } else blocks.push({ t: 'note', text: 'A chart or diagram is not shown here.' });
        } else if (n === 'grpSp') shapes(c);
        else if (n === 'AlternateContent') { const ch = kid(c, 'Choice'); if (ch) shapes(ch); }
      }
    };
    shapes(kid(kid(root, 'cSld'), 'spTree') || root);
    // speaker notes: the body placeholder of the notes page
    let notes = '';
    const nr = Object.values(srel).find((r) => r.type.endsWith('/notesSlide'));
    const nroot = nr && xml(files, nr.path);
    if (nroot) {
      notes = descendants(nroot, 'sp').filter((sp) => at(kid(kid(kid(sp, 'nvSpPr'), 'nvPr'), 'ph'), 'type') === 'body')
        .map((sp) => kids(kid(sp, 'txBody'), 'p').map((p) => textRuns(p).map((r) => r.text || '\n').join('')).join('\n')).join('\n').trim();
    }
    return { blocks, media, notes };
  }
  return { kind: 'pptx', count: slides.length, load };
}
