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
function unpack(bytes, rootDir, mainPart, extra = []) {
  let files;
  let total = 0;
  try {
    files = unzipSync(bytes, {
      filter: (f) => {
        if (!f.name.startsWith(rootDir) && !extra.includes(f.name)) return false;
        const ext = f.name.slice(f.name.lastIndexOf('.') + 1).toLowerCase();
        if (ext !== 'xml' && ext !== 'rels' && ext !== 'odttf' && !IMG_MIME[ext]) return false;
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
  const txt = decoder.decode(b);
  const doc = new DOMParser().parseFromString(txt, 'application/xml');
  const root = doc.documentElement; if (!root) return null;
  // searching a very large tree for the error element is itself slow, so a big part is checked at the root only (Decision 248)
  if (txt.length > 2e6) return root.localName === 'parsererror' || (root.firstElementChild && root.firstElementChild.localName === 'parsererror') ? null : root;
  return doc.getElementsByTagName('parsererror').length ? null : root;
}
const kids = (n, local) => { const o = []; if (n) for (const c of n.children) if (c.localName === local) o.push(c); return o; };
const kid = (n, local) => { if (n) for (const c of n.children) if (c.localName === local) return c; return null; };
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
export function formatNum(n, fmt) {
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

const PROP_KEYS = ['font', 'size', 'color', 'bg', 'b', 'i', 'u', 's', 'caps', 'sc', 'sup', 'sub'];
const fieldKind = (s) => { const m = /^\s*(PAGE|NUMPAGES|SECTIONPAGES)\b/i.exec(s || ''); return m ? m[1].toLowerCase() : null; };
function hasLrb(blocks) { // a saved page break (Decision 242) anywhere in these blocks
  for (const b of blocks) {
    if (b.t === 'table') { if (b.rows.some((r) => r.some((c) => hasLrb(c.blocks)))) return true; } else if (b.runs.some((r) => r.lrb)) return true;
  }
  return false;
}

export function readDocx(bytes) {
  const T0 = performance.now(); // timings are shown in the Word Info line while load time is being tuned (Decision 248)
  const files = unpack(bytes, 'word/', 'word/document.xml', ['docProps/app.xml']);
  const T1 = performance.now();
  const main = 'word/document.xml';
  const root = xml(files, main);
  const T2 = performance.now();
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
    if (kid(pp, 'keepNext')) o.kn = flag(kid(pp, 'keepNext'));
    if (kid(pp, 'keepLines')) o.kl = flag(kid(pp, 'keepLines'));
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

  // ---- drawings: inline pictures and charts stay in the line; anchored pictures, shapes and text boxes become floats (Decision 250) ----
  const SCHEME = { tx1: 'dk1', bg1: 'lt1', tx2: 'dk2', bg2: 'lt2' };
  const clrOf = (n) => {
    const sc = kid(n, 'srgbClr'); if (sc) return at(sc, 'val');
    const th = kid(n, 'schemeClr'); if (th) { const v = at(th, 'val'); return tColors[SCHEME[v] || v] || null; }
    return null;
  };
  const clrA = (n) => { // colour with its transforms: alpha, lumMod, lumOff, tint, shade (Decision 252)
    const c = n && Array.from(n.children).find((x) => ['srgbClr', 'schemeClr'].includes(x.localName));
    let hex = c ? clrOf(n) : null;
    if (!hex || !/^[0-9A-Fa-f]{6}$/.test(hex)) return null;
    hex = hex.toUpperCase(); let a = 1;
    for (const t of c.children) {
      const nm = t.localName; const val = Number(at(t, 'val') || 0) / 100000;
      if (nm === 'lumMod' || nm === 'lumOff') { const [h, sa, l] = toHsl(hex); hex = fromHsl(h, sa, nm === 'lumMod' ? Math.min(1, l * val) : Math.min(1, l + val)); }
      else if (nm === 'tint') hex = mixHex(hex, 'FFFFFF', 1 - val);
      else if (nm === 'shade') hex = mixHex(hex, '000000', 1 - val);
      else if (nm === 'alpha') a = val;
    }
    return { hex, a };
  };
  const posOf = (n) => { const al = kid(n, 'align'); const of = kid(n, 'posOffset'); return { rel: at(n, 'relativeFrom') || 'column', align: al ? al.textContent.trim() : null, off: of ? Number(of.textContent) / 9525 : 0 }; };
  const textBoxBody = (w) => {
    const tb = kid(kid(w, 'txbx'), 'txbxContent'); if (!tb) return null;
    const bp = kid(w, 'bodyPr'); const ins = (k, d) => (at(bp, k) !== null && at(bp, k) !== '' ? Number(at(bp, k)) : d) / 9525;
    const baseSize = (defaults.r && defaults.r.size) || 14.67;
    const paras = kids(tb, 'p').map((p) => {
      const jc = at(kid(kid(p, 'pPr'), 'jc'), 'val');
      const runs = [];
      for (const r of descendants(p, 'r')) {
        const rp = kid(r, 'rPr'); const on = (k) => { const e = kid(rp, k); return !!e && at(e, 'val') !== '0' && at(e, 'val') !== 'false'; };
        const sz = at(kid(rp, 'sz'), 'val'); const col = at(kid(rp, 'color'), 'val');
        const base = { font: at(kid(rp, 'rFonts'), 'ascii') || undefined, size: sz ? (Number(sz) / 2) * PX_PT : baseSize, b: on('b'), i: on('i'), u: on('u'), color: col && col !== 'auto' ? { hex: col, a: 1 } : undefined };
        let text = '';
        for (const k of r.children) {
          if (k.localName === 't') text += k.textContent; else if (k.localName === 'tab') text += '\t';
          else if (k.localName === 'br') { if (text) { runs.push({ ...base, text }); text = ''; } runs.push({ br: true }); }
        }
        if (text) runs.push({ ...base, text });
      }
      return { algn: jc === 'center' ? 'center' : jc === 'right' || jc === 'end' ? 'right' : jc === 'both' ? 'justify' : 'left', marL: 0, indent: 0, bullet: null, runs, size: (runs.find((x) => x.size) || {}).size || baseSize };
    });
    return { anchor: at(bp, 'anchor') || 't', l: ins('lIns', 91440), r: ins('rIns', 91440), t: ins('tIns', 45720), b: ins('bIns', 45720), wrap: at(bp, 'wrap') !== 'none', scale: 1, paras };
  };
  const picOf = (pic, x, y, w, h) => {
    const path = addMedia(blipId(pic)); if (!path) return null;
    const sr = kid(kid(pic, 'blipFill'), 'srcRect');
    return { t: 'pic', x, y, w, h, rot: 0, path, line: null, crop: sr ? { l: Number(at(sr, 'l') || 0) / 1000, t: Number(at(sr, 't') || 0) / 1000, r: Number(at(sr, 'r') || 0) / 1000, b: Number(at(sr, 'b') || 0) / 1000 } : null };
  };
  const custOf = (cg) => { // a free-form outline as one SVG path in its own units
    const pl = kid(cg, 'pathLst'); const ps = pl ? kids(pl, 'path') : []; let d = ''; let w = 0; let h = 0; let nf = true;
    for (const p of ps) {
      const pw = Number(at(p, 'w') || 0); const ph = Number(at(p, 'h') || 0); if (!(pw > 0 && ph > 0)) continue;
      if (!w) { w = pw; h = ph; }
      if (at(p, 'fill') !== 'none') nf = false;
      const pt = (n) => `${(Number(at(n, 'x')) || 0) * w / pw} ${(Number(at(n, 'y')) || 0) * h / ph}`;
      for (const c of p.children) {
        const pts = kids(c, 'pt').map(pt); const ln = c.localName;
        if (ln === 'moveTo' && pts[0]) d += `M${pts[0]}`; else if (ln === 'lnTo' && pts[0]) d += `L${pts[0]}`;
        else if (ln === 'cubicBezTo' && pts.length === 3) d += `C${pts.join(' ')}`; else if (ln === 'quadBezTo' && pts.length === 2) d += `Q${pts.join(' ')}`; else if (ln === 'close') d += 'Z';
      }
      if (d.length > 200000) return null;
    }
    return d && w ? { w, h, d, nf } : null;
  };
  const shapeOf = (wsp, x, y, w, h) => {
    const sp = kid(wsp, 'spPr'); const xf = kid(sp, 'xfrm');
    let fill = null; const sf = kid(sp, 'solidFill'); if (sf) { const c = clrA(sf); if (c && c.a > 0) fill = c; }
    let line = null; const ln = kid(sp, 'ln');
    if (ln && !kid(ln, 'noFill')) {
      const lc = kid(ln, 'solidFill'); const c = lc && clrA(lc); const d = at(kid(ln, 'prstDash'), 'val') || '';
      line = { w: Math.max(1, Number(at(ln, 'w') || 9525) / 9525), color: { hex: c ? c.hex : '000000', a: c ? c.a : 1 }, dash: /dot/i.test(d) ? 'dotted' : /dash/i.test(d) ? 'dashed' : 'solid' };
    }
    const gn = kid(sp, 'prstGeom'); const cg = kid(sp, 'custGeom'); const cust = cg ? custOf(cg) : null; const text = textBoxBody(wsp);
    return { t: 'shape', x, y, w, h, rot: xf && at(xf, 'rot') ? Number(at(xf, 'rot')) / 60000 : 0, geom: at(gn, 'prst') || 'rect', adj: null, fill, line, text: text && text.paras.some((q) => q.runs.length) ? text : null, ...(cust ? { cust } : {}) };
  };
  const floatOf = (k, an) => {
    const gd = descendants(k, 'graphicData')[0]; if (!gd) return null;
    const ex = kid(an, 'extent'); const w = ex ? Number(at(ex, 'cx')) / 9525 : 0; const h = ex ? Number(at(ex, 'cy')) / 9525 : 0;
    if (!(w > 0 && h > 0)) return null;
    const wgp = descendants(gd, 'wgp')[0]; const pic = descendants(gd, 'pic')[0]; const wsp = descendants(gd, 'wsp')[0];
    let item = null;
    if (wgp) { // a group: its pictures and shapes placed by the group's child scale (Decision 252)
      const gx = kid(kid(wgp, 'grpSpPr'), 'xfrm'); const co = kid(gx, 'chOff'); const ce = kid(gx, 'chExt');
      const cw = ce ? Number(at(ce, 'cx')) : 0; const ch = ce ? Number(at(ce, 'cy')) : 0;
      if (!(cw > 0 && ch > 0)) return null;
      const ox = co ? Number(at(co, 'x')) || 0 : 0; const oy = co ? Number(at(co, 'y')) || 0 : 0; const sx = w / cw; const sy = h / ch;
      const items = [];
      for (const c of wgp.children) {
        const isPic = c.localName === 'pic'; if (!isPic && c.localName !== 'wsp') continue;
        const xf2 = kid(kid(c, 'spPr'), 'xfrm'); const off = kid(xf2, 'off'); const ext = kid(xf2, 'ext'); if (!off || !ext) continue;
        const gx0 = ((Number(at(off, 'x')) || 0) - ox) * sx; const gy0 = ((Number(at(off, 'y')) || 0) - oy) * sy; const gw = (Number(at(ext, 'cx')) || 0) * sx; const gh = (Number(at(ext, 'cy')) || 0) * sy;
        const it = isPic ? picOf(c, gx0, gy0, gw, gh) : shapeOf(c, gx0, gy0, gw, gh);
        if (it) items.push(it);
      }
      if (!items.length) return null;
      item = { t: 'group', x: 0, y: 0, w, h, items };
    } else if (pic) { item = picOf(pic, 0, 0, w, h); if (!item) return null; }
    else if (wsp) item = shapeOf(wsp, 0, 0, w, h);
    else return null;
    const wn = ['wrapNone', 'wrapSquare', 'wrapTight', 'wrapThrough', 'wrapTopAndBottom'].find((x) => kid(an, x));
    const dist = (a) => Number(at(an, a) || 0) / 9525;
    return { item, h: posOf(kid(an, 'positionH')), v: posOf(kid(an, 'positionV')), wrap: wn ? wn.slice(4).toLowerCase() : 'none', behind: at(an, 'behindDoc') === '1', dist: { l: dist('distL'), r: dist('distR'), t: dist('distT'), b: dist('distB') } };
  };
  const addDrawing = (k, kn, out) => {
    const chEl = kn === 'drawing' ? descendants(k, 'chart')[0] : null;
    if (chEl) {
      const cr = rel[rat(chEl, 'id')];
      const model = cr && readChart(files, cr.path, { colors: tColors, map: null });
      const ex = descendants(k, 'extent')[0];
      const w = ex ? Number(at(ex, 'cx')) / 9525 : 0; const h = ex ? Number(at(ex, 'cy')) / 9525 : 0;
      if (model && w > 0 && h > 0) out.push({ chart: model, w, h });
      return;
    }
    const an = kn === 'drawing' ? kid(k, 'anchor') : null;
    if (an) { const f = floatOf(k, an); if (f) { out.push({ float: f }); return; } }
    const p = addMedia(blipId(k));
    if (p) {
      const ex = descendants(k, 'extent')[0];
      const w = ex ? Number(at(ex, 'cx')) / 9525 : 0; const h = ex ? Number(at(ex, 'cy')) / 9525 : 0;
      out.push({ img: p, w: w > 0 ? w : undefined, h: h > 0 ? h : undefined });
    }
  };

  // ---- equations (Decision 251): Office Math read into a small tree, drawn by the renderer ----
  const MATH_NODES = 600; const MATH_DEPTH = 24;
  const isM = (n) => /\/math$/.test(n.namespaceURI || '');
  const mval = (n, name, dflt) => { const x = kid(n, name); if (!x) return dflt; const v = at(x, 'val'); return v === null ? dflt : v; };
  const readMath = (root, base) => {
    let count = 0;
    const seq = (n, d) => {
      const out = [];
      if (!n || d > MATH_DEPTH) return out;
      for (const c of n.children) {
        if (count >= MATH_NODES) break;
        const x = one(c, d + 1);
        if (x) { if (Array.isArray(x)) out.push(...x); else out.push(x); }
      }
      return out;
    };
    const one = (c, d) => {
      const ln = c.localName;
      if (ln === 'ins') return seq(c, d);
      if (ln === 'del' || /Pr$/.test(ln) || !isM(c)) return null;
      count++;
      const arg = (name) => seq(kid(c, name), d);
      switch (ln) {
        case 'r': {
          const rps = kids(c, 'rPr'); const mp = rps.find(isM); const wp = rps.find((x) => !isM(x));
          let text = ''; for (const t of c.children) if (t.localName === 't') text += t.textContent;
          if (!text) return null;
          const sty = mp ? mval(mp, 'sty', '') : '';
          const f = { ...base, ...parseR(wp) };
          const o = { k: 'r', text, plain: sty === 'p' || sty === 'b' || (!!mp && flag(kid(mp, 'nor'))) };
          if (sty === 'b' || sty === 'bi' || f.b) o.b = true;
          if (f.color) o.color = f.color;
          return o;
        }
        case 'f': return { k: 'f', type: mval(kid(c, 'fPr'), 'type', 'bar'), num: arg('num'), den: arg('den') };
        case 'sSup': return { k: 'sup', e: arg('e'), sup: arg('sup') };
        case 'sSub': return { k: 'sub', e: arg('e'), sub: arg('sub') };
        case 'sSubSup': return { k: 'ss', e: arg('e'), sub: arg('sub'), sup: arg('sup') };
        case 'sPre': return { k: 'pre', e: arg('e'), sub: arg('sub'), sup: arg('sup') };
        case 'rad': return { k: 'rad', noDeg: flag(kid(kid(c, 'radPr'), 'degHide')), deg: arg('deg'), e: arg('e') };
        case 'nary': {
          const p = kid(c, 'naryPr');
          return { k: 'nary', chr: mval(p, 'chr', '\u222b'), und: mval(p, 'limLoc', 'subSup') === 'undOvr', sub: flag(kid(p, 'subHide')) ? null : arg('sub'), sup: flag(kid(p, 'supHide')) ? null : arg('sup'), e: arg('e') };
        }
        case 'd': {
          const p = kid(c, 'dPr');
          return { k: 'd', beg: mval(p, 'begChr', '('), end: mval(p, 'endChr', ')'), sep: mval(p, 'sepChr', '|'), es: kids(c, 'e').map((e) => seq(e, d)) };
        }
        case 'func': return { k: 'func', name: arg('fName'), e: arg('e') };
        case 'acc': return { k: 'acc', chr: mval(kid(c, 'accPr'), 'chr', '\u0302'), e: arg('e') };
        case 'bar': return { k: 'bar', top: mval(kid(c, 'barPr'), 'pos', 'bot') === 'top', e: arg('e') };
        case 'groupChr': { const p = kid(c, 'groupChrPr'); return { k: 'grp', chr: mval(p, 'chr', '\u23df'), top: mval(p, 'pos', 'bot') === 'top', e: arg('e') }; }
        case 'limLow': return { k: 'lim', low: true, e: arg('e'), lim: arg('lim') };
        case 'limUpp': return { k: 'lim', low: false, e: arg('e'), lim: arg('lim') };
        case 'm': return { k: 'mat', rows: kids(c, 'mr').map((r) => kids(r, 'e').map((e) => seq(e, d))) };
        case 'eqArr': return { k: 'arr', rows: kids(c, 'e').map((e) => seq(e, d)) };
        case 'borderBox': return { k: 'bbox', e: arg('e') };
        case 'box': case 'phant': return arg('e');
        case 'e': case 'oMath': return seq(c, d);
        default: return null;
      }
    };
    return seq(root, 0);
  };

  // ---- runs ----
  let fld = null; // complex field being read: PAGE, NUMPAGES and SECTIONPAGES become markers (Decision 242)
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
        for (const k of PROP_KEYS) if (f[k]) props[k] = f[k];
        let text = '';
        const flush = () => { if (text) { out.push({ ...props, text }); text = ''; } };
        for (const k of c.children) {
          const kn = k.localName;
          if (kn === 'fldChar') {
            flush();
            const ty = at(k, 'fldCharType');
            if (ty === 'begin') { if (!fld) fld = { depth: 1, instr: '', stage: 'instr', kind: null, props, text: '' }; else fld.depth++; }
            else if (ty === 'separate') { if (fld && fld.depth === 1) { fld.stage = 'result'; fld.kind = fieldKind(fld.instr); fld.props = props; } }
            else if (ty === 'end' && fld) { fld.depth--; if (fld.depth === 0) { if (fld.kind) out.push({ ...fld.props, field: fld.kind, text: fld.text }); fld = null; } }
          } else if (kn === 'instrText') { if (fld && fld.depth === 1 && fld.stage === 'instr') fld.instr += k.textContent; }
          else if (kn === 'lastRenderedPageBreak') { flush(); out.push({ lrb: true }); }
          else if (kn === 't') { if (fld && fld.stage === 'instr') continue; if (fld && fld.kind) fld.text += k.textContent; else text += k.textContent; }
          else if (kn === 'tab') text += '\t';
          else if (kn === 'noBreakHyphen') text += '-';
          else if (kn === 'br' || kn === 'cr') { flush(); out.push(at(k, 'type') === 'page' ? { pb: true } : { br: true }); }
          else if (kn === 'footnoteReference') {
            flush();
            const id = at(k, 'id');
            if (id && !(id in fnNo)) { fnNo[id] = fnOrder.length + 1; fnOrder.push(id); }
            if (id) out.push({ ...props, text: String(fnNo[id]), sup: true, fn: fnNo[id] });
          } else if (kn === 'drawing' || kn === 'pict') {
            flush(); addDrawing(k, kn, out);
          } else if (kn === 'AlternateContent') { // a text box or shape: the first choice holds the drawing
            const ch = kid(k, 'Choice'); const dr = ch && (kid(ch, 'drawing') || kid(ch, 'pict'));
            if (dr) { flush(); addDrawing(dr, dr.localName, out); }
          }
        }
        flush();
      } else if (n === 'fldSimple' && fieldKind(at(c, 'instr'))) {
        const rr = kid(c, 'r'); const rp = kid(rr, 'rPr');
        const f = { ...base, ...resolve(at(kid(rp, 'rStyle'), 'val')).r, ...parseR(rp) };
        const props = {}; for (const k of PROP_KEYS) if (f[k]) props[k] = f[k];
        out.push({ ...props, field: fieldKind(at(c, 'instr')), text: rr ? rr.textContent : '' });
      } else if (['hyperlink', 'ins', 'smartTag', 'fldSimple', 'moveTo'].includes(n)) runsOf(c, out, base, link || n === 'hyperlink');
      else if (n === 'oMath' || n === 'oMathPara') {
        const props = {}; for (const k of ['size', 'color']) if (base[k]) props[k] = base[k];
        for (const m of n === 'oMath' ? [c] : kids(c, 'oMath')) { const tree = readMath(m, base); if (tree.length) out.push({ ...props, math: tree, disp: n === 'oMathPara' }); }
      }
      else if (n === 'sdt') runsOf(kid(c, 'sdtContent') || c, out, base, link);
      else if (n === 'AlternateContent') { const ch = kid(c, 'Choice'); if (ch) runsOf(ch, out, base, link); }
    }
    return out;
  };

  const sectNodes = []; // sectPr of each paragraph that ends a section, in order
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
    fld = null;
    const runs = runsOf(p, [], rbase, false);
    const sp = kid(pp, 'sectPr'); let sectEnd;
    if (sp) { sectNodes.push(sp); sectEnd = sectNodes.length - 1; }
    if (list) { const t = runs.find((x) => x.text); list.fmt = t ? { font: t.font, size: t.size, b: t.b, i: t.i, color: t.color } : { font: rbase.font, size: rbase.size }; list.hang = eff.first < 0 ? -eff.first : 0; }
    const { outline, ...pr } = eff;
    return { t: 'p', level: Math.min(level, 6), list, pr, runs, sectEnd };
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
    return { t: 'table', rows, rowBrk: rows.map((r) => r.some((c) => hasLrb(c.blocks))), borders: bd, grid, pct: at(w, 'type') === 'pct' ? Number(at(w, 'w')) / 50 : null, pad, align: at(kid(tp, 'jc'), 'val') };
  }

  const body = kid(root, 'body') || root;
  const blocks = blocksOf(body, 0);

  // ---- page, header, footer, footnotes ----
  const sect = kid(body, 'sectPr');
  const pageOf = (sp) => {
    const sz = kid(sp, 'pgSize') || kid(sp, 'pgSz'); const mg = kid(sp, 'pgMar');
    return {
      w: tw(at(sz, 'w')) || 816, h: tw(at(sz, 'h')) || 1056,
      t: tw(at(mg, 'top')) ?? 96, r: tw(at(mg, 'right')) ?? 96, b: tw(at(mg, 'bottom')) ?? 96, l: tw(at(mg, 'left')) ?? 96,
      hd: tw(at(mg, 'header')) ?? 48, ft: tw(at(mg, 'footer')) ?? 48
    };
  };
  const page = pageOf(sect);
  const partCache = {}; // a header or footer part is read once, even when several sections use it
  const loadPart = (ref) => {
    const rr = ref && rel[rat(ref, 'id')];
    if (!rr) return null;
    if (!(rr.path in partCache)) { const hr = xml(files, rr.path); partCache[rr.path] = hr ? blocksOf(hr, 0) : []; }
    return partCache[rr.path];
  };
  const part = (refName) => {
    const refs = kids(sect, refName);
    return loadPart(refs.find((x) => at(x, 'type') === 'default') || refs[0]) || [];
  };
  const header = part('headerReference'); const footer = part('footerReference');
  // sections (Decision 242): page set-up, how the section starts, numbering and the header and footer of each kind;
  // a section without its own header or footer reference takes the previous one
  const refsOf = (sp, name) => { const o = {}; for (const r of kids(sp, name)) o[at(r, 'type') || 'default'] = r; return o; };
  let prevHF = { hdr: {}, ftr: {} };
  const sections = [...sectNodes, sect].map((sp) => {
    const hr = refsOf(sp, 'headerReference'); const fr = refsOf(sp, 'footerReference');
    const hdr = {}; const ftr = {};
    for (const t of ['default', 'first', 'even']) { hdr[t] = hr[t] ? loadPart(hr[t]) : prevHF.hdr[t]; ftr[t] = fr[t] ? loadPart(fr[t]) : prevHF.ftr[t]; }
    prevHF = { hdr, ftr };
    const pn = kid(sp, 'pgNumType');
    const st = pn && at(pn, 'start');
    return {
      page: pageOf(sp), type: at(kid(sp, 'type'), 'val') || 'nextPage', titlePg: flag(kid(sp, 'titlePg')),
      pgStart: st !== null && st !== undefined && st !== '' ? Number(st) : null, pgFmt: pn ? at(pn, 'fmt') : null, hdr, ftr
    };
  });
  const evenOdd = !!kid(xml(files, 'word/settings.xml'), 'evenAndOddHeaders');
  const app = xml(files, 'docProps/app.xml');
  const pagesEl = app ? descendants(app, 'Pages')[0] : null;
  const storedPages = pagesEl ? Number(pagesEl.textContent) || 0 : 0; // pages as last saved by the program that wrote the file
  const footnotes = [];
  if (fnOrder.length) {
    const fr = xml(files, 'word/footnotes.xml');
    for (const id of fnOrder) {
      const f = kids(fr, 'footnote').find((x) => at(x, 'id') === id);
      if (f) footnotes.push({ n: fnNo[id], blocks: blocksOf(f, 0) });
    }
  }
  // fonts the author embedded in the file: obfuscated by XOR of the first 32 bytes with the font's key
  const embedded = [];
  const ft = xml(files, 'word/fontTable.xml');
  if (ft) {
    const frel = rels(files, 'word/fontTable.xml');
    for (const f of kids(ft, 'font')) {
      for (const [tag, b, i] of [['embedRegular', false, false], ['embedBold', true, false], ['embedItalic', false, true], ['embedBoldItalic', true, true]]) {
        const e = kid(f, tag);
        const part = e && frel[rat(e, 'id')];
        const data = part && files[part.path];
        const key = (at(e, 'fontKey') || '').replace(/[{}-]/g, '');
        if (!data || key.length !== 32) continue;
        const out = new Uint8Array(data);
        const kb = Array.from({ length: 16 }, (_, k) => parseInt(key.slice(k * 2, k * 2 + 2), 16));
        for (let k = 0; k < 32 && k < out.length; k++) out[k] ^= kb[15 - (k % 16)];
        embedded.push({ name: at(f, 'name'), b, i, bytes: out });
      }
    }
  }
  const T3 = performance.now();
  return { kind: 'docx', blocks, media, truncated, page, header, footer, footnotes, embedded, sections, evenOdd, storedPages, timing: { unzip: T1 - T0, parse: T2 - T1, read: T3 - T2 } };
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
  let xTheme = null;
  const xt = () => xTheme || (xTheme = themeColorsOf(files, 'xl/theme/theme1.xml'));
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
    // charts and pictures: placed by the cell they start at (and end at), read from the sheet's drawing part
    const objects = []; const media = {}; let other = 0;
    const dRid = rat(kid(root, 'drawing'), 'id');
    const dRel = dRid ? rels(files, sheets[i].path)[dRid] : null;
    const droot = dRel && xml(files, dRel.path);
    if (droot) {
      const drel = rels(files, dRel.path);
      const num = (n, l) => { const x = kid(n, l); return x ? Number(x.textContent) || 0 : 0; };
      const pt = (n) => (n ? { col: num(n, 'col'), colOff: num(n, 'colOff') / EMU, row: num(n, 'row'), rowOff: num(n, 'rowOff') / EMU } : null);
      for (const a of droot.children) {
        if (!/Anchor$/.test(a.localName)) continue;
        if (objects.length >= 40) { other++; continue; }
        const frm = kid(a, 'graphicFrame'); const pic = kid(a, 'pic'); let obj = null;
        const chEl = frm && descendants(frm, 'chart')[0];
        if (chEl) { const cr = drel[rat(chEl, 'id')]; const model = cr && readChart(files, cr.path, { colors: xt(), map: null }); if (model) obj = { t: 'chart', model }; }
        else if (pic) { const bl = descendants(pic, 'blip')[0]; const pr = bl && drel[rat(bl, 'embed')]; const im = pr && image(files, pr.path); if (im) { media[pr.path] = im; obj = { t: 'pic', path: pr.path }; } }
        if (!obj) { other++; continue; }
        const ext = kid(a, 'ext'); const ps = kid(a, 'pos');
        obj.from = pt(kid(a, 'from')); obj.to = a.localName === 'twoCellAnchor' ? pt(kid(a, 'to')) : null;
        obj.ext = ext ? { w: Number(at(ext, 'cx') || 0) / EMU, h: Number(at(ext, 'cy') || 0) / EMU } : null;
        obj.abs = ps ? { x: Number(at(ps, 'x') || 0) / EMU, y: Number(at(ps, 'y') || 0) / EMU } : null;
        if (!obj.from && !obj.abs) { other++; continue; }
        objects.push(obj);
      }
    }
    const view = kid(kid(root, 'sheetViews'), 'sheetView');
    const pane = kid(view, 'pane');
    const frozen = pane && at(pane, 'state') && /frozen/.test(at(pane, 'state'));
    return {
      rows, ncols, truncated, colW, defCol, rowH, defRow, merges,
      freeze: frozen ? { rows: Math.min(Number(at(pane, 'ySplit') || 0), 20), cols: Math.min(Number(at(pane, 'xSplit') || 0), 10) } : { rows: 0, cols: 0 },
      grid: at(view, 'showGridLines') !== '0' && at(view, 'showGridLines') !== 'false',
      objects, media, hasDrawing: other > 0
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
    // a slide (or its layout) can remap the scheme, e.g. a dark slide whose text colour is light
    const ovr = (n) => kid(kid(n, 'clrMapOvr'), 'overrideClrMapping');
    const om = ovr(root) || ovr(layout);
    if (om) for (const a of om.attributes) clrMap[a.localName] = a.value;
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

    const dText = defText ? [defText] : [];
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
        // a shape's style font colour sits above the presentation defaults, below its own list style and runs
        if (ctx.styleColor && base.r.color && !lvlProps(chain.filter((x) => !dText.includes(x)), lvl).r.color) base.r = { ...base.r, color: ctx.styleColor };
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
          if (tbl) { items.push({ t: 'table', ...place(g, xf), ...table(tbl, c) }); continue; }
          const chEl = descendants(c, 'chart')[0];
          if (chEl) {
            const cr = rl[rat(chEl, 'id')]; const model = cr && readChart(files, cr.path, { colors: T.colors, map: clrMap });
            if (model) { items.push({ t: 'chart', ...place(g, xf), chart: model }); continue; }
          }
          // a diagram (SmartArt): the file keeps a ready drawing of it beside its data; its shapes are drawn like any others
          const ids = descendants(c, 'relIds')[0];
          if (ids) {
            const dm = rl[rat(ids, 'dm')]; const dmx = dm && xml(files, dm.path);
            const ext = dmx && descendants(dmx, 'dataModelExt')[0];
            const dr = ext && rl[at(ext, 'relId')]; const dx = dr && xml(files, dr.path); const tree = kid(dx, 'spTree');
            if (tree) { walk(tree, rels(files, dr.path), { sx: xf.sx, sy: xf.sy, tx: xf.sx * g.x + xf.tx, ty: xf.sy * g.y + xf.ty }, 'slide'); continue; }
          }
          items.push({ t: 'note', ...place(g, xf), text: 'This object is not shown here.' });
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
        const gn = [spPr, kid(lph, 'spPr'), kid(mph, 'spPr')].map((x) => kid(x, 'prstGeom')).find(Boolean);
        const prst = at(gn, 'prst') || (n === 'cxnSp' ? 'line' : 'rect');
        const gd = kid(kid(gn, 'avLst'), 'gd'); const am = gd && /val (-?\d+)/.exec(at(gd, 'fmla') || ''); const adj = am ? Number(am[1]) : 0;
        const item = { t: 'shape', ...place(g, xf), geom: prst, adj: adj || null, fill, line };
        const tx = kid(c, 'txBody');
        if (tx && n === 'sp') {
          const lst = (nd) => kid(kid(nd, 'txBody'), 'lstStyle');
          const chain = [kid(tx, 'lstStyle'), lst(lph), lst(mph), ph ? kid(txStyles, txCat(at(ph, 'type'))) : null, ...dText];
          const color = fnr ? phc(fnr) || defColor : defColor;
          const body = textBody(tx, chain, { bodyPr: [kid(tx, 'bodyPr'), kid(kid(lph, 'txBody'), 'bodyPr'), kid(kid(mph, 'txBody'), 'bodyPr')], color, styleColor: !ph && fnr ? phc(fnr) : null });
          const tg = xfrmOf(kid(c, 'txXfrm')); // diagram shapes carry their own text rectangle
          if (tg) {
            body.l += (tg.x - g.x) * xf.sx / EMU; body.t += (tg.y - g.y) * xf.sy / EMU;
            body.r = Math.max(0, body.r + ((g.x + g.w) - (tg.x + tg.w)) * xf.sx / EMU); body.b = Math.max(0, body.b + ((g.y + g.h) - (tg.y + tg.h)) * xf.sy / EMU);
            body.l = Math.max(0, body.l); body.t = Math.max(0, body.t);
          }
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

// ---- charts (docx, xlsx, pptx) ----
// A chart part becomes a plain model: { title, autoTitle, legend, axes, groups: [{ kind, series }] }. office-chart.js draws it.
// Values come from the cached copy stored in the chart part; nothing is recalculated.
const CHART_PTS = 500;
const CHART_SERIES = 40;
const SCHEME_MAP = { tx1: 'dk1', bg1: 'lt1', tx2: 'dk2', bg2: 'lt2' };
const ACCENTS = ['4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47'];
function themeColorsOf(files, path) {
  const t = {}; const th = xml(files, path);
  const cs = th && descendants(th, 'clrScheme')[0];
  for (const c of cs ? cs.children : []) { const v = c.firstElementChild; if (v) t[c.localName] = String((v.localName === 'srgbClr' ? at(v, 'val') : at(v, 'lastClr')) || '000000').toUpperCase(); }
  return t;
}
function chartClr(parent, tc) {
  const c = parent && Array.from(parent.children).find((x) => ['srgbClr', 'schemeClr', 'sysClr', 'prstClr'].includes(x.localName));
  if (!c) return null;
  const v = at(c, 'val'); let hex = null;
  if (c.localName === 'srgbClr') hex = (v || '').toUpperCase();
  else if (c.localName === 'sysClr') hex = (at(c, 'lastClr') || '000000').toUpperCase();
  else if (c.localName === 'prstClr') hex = PRST[v] || '000000';
  else hex = String((tc.colors || {})[(tc.map && tc.map[v]) || SCHEME_MAP[v] || v] || '').toUpperCase() || null;
  if (!hex || !/^[0-9A-F]{6}$/.test(hex)) return null;
  for (const t of c.children) {
    const n = t.localName; const val = Number(at(t, 'val') || 0) / 100000;
    if (n === 'lumMod' || n === 'lumOff') { const [h, s, l] = toHsl(hex); hex = fromHsl(h, s, n === 'lumMod' ? Math.min(1, l * val) : Math.min(1, l + val)); }
    else if (n === 'tint') hex = mixHex(hex, 'FFFFFF', 1 - val);
    else if (n === 'shade') hex = mixHex(hex, '000000', 1 - val);
  }
  return hex;
}
// undefined: not set here; null: explicitly no fill or line
function chartFill(sp, tc) {
  if (!sp) return undefined;
  if (kid(sp, 'noFill')) return null;
  const sf = kid(sp, 'solidFill'); if (sf) return chartClr(sf, tc) || undefined;
  const g = kid(sp, 'gradFill'); const gs = g && kids(kid(g, 'gsLst'), 'gs')[0];
  return gs ? chartClr(gs, tc) || undefined : undefined;
}
function chartLine(sp, tc) {
  const ln = kid(sp, 'ln');
  if (!ln) return undefined;
  if (kid(ln, 'noFill')) return null;
  const sf = kid(ln, 'solidFill'); return sf ? chartClr(sf, tc) || undefined : undefined;
}
const BAR_T = ['barChart', 'bar3DChart']; const LINE_T = ['lineChart', 'line3DChart']; const AREA_T = ['areaChart', 'area3DChart'];
const PIE_T = ['pieChart', 'pie3DChart', 'ofPieChart'];
export function readChart(files, path, tc) {
  const root = xml(files, path);
  const chart = kid(root, 'chart'); const plot = kid(chart, 'plotArea');
  if (!plot) return null;
  const val = (n, d = null) => { const x = n && at(n, 'val'); return x === null || x === undefined ? d : x; };
  const on = (n, d = false) => (n ? !['0', 'false'].includes(String(val(n, '1')).toLowerCase()) : d);
  const textOf = (n) => (n ? descendants(n, 't').map((x) => x.textContent).join('') : '');
  const data = (n) => {
    const ref = n && Array.from(n.children).find((x) => ['numRef', 'strRef', 'multiLvlStrRef', 'numLit', 'strLit'].includes(x.localName));
    if (!ref) return null;
    let cache = Array.from(ref.children).find((x) => /Cache$/.test(x.localName)) || ref;
    if (cache.localName === 'multiLvlStrCache') cache = kids(cache, 'lvl')[0] || cache;
    const out = [];
    for (const p of kids(cache, 'pt')) { const i = Number(at(p, 'idx')); if (i >= 0 && i < CHART_PTS) out[i] = kid(p, 'v') ? kid(p, 'v').textContent : ''; }
    out.length = Math.min(CHART_PTS, Math.max(out.length, Number(val(kid(cache, 'ptCount'), 0))));
    const fc = kid(cache, 'formatCode');
    return { pts: Array.from(out, (v) => v ?? ''), fmt: fc ? fc.textContent : null };
  };
  const nums = (d) => (d ? d.pts.map((v) => (v === '' || Number.isNaN(Number(v)) ? null : Number(v))) : []);
  const labelsOf = (d) => {
    if (!d || on(kid(d, 'delete'))) return null;
    const nf = kid(d, 'numFmt');
    return { val: on(kid(d, 'showVal')), cat: on(kid(d, 'showCatName')), pct: on(kid(d, 'showPercent')), fmt: nf && at(nf, 'sourceLinked') !== '1' ? at(nf, 'formatCode') : null };
  };
  const axes = {};
  for (const ax of plot.children) {
    if (!['catAx', 'valAx', 'dateAx', 'serAx'].includes(ax.localName)) continue;
    const id = val(kid(ax, 'axId')); const sc = kid(ax, 'scaling'); const nf = kid(ax, 'numFmt');
    axes[id] = {
      id, kind: ax.localName === 'valAx' ? 'val' : 'cat', pos: val(kid(ax, 'axPos'), 'b'),
      min: sc && kid(sc, 'min') ? Number(val(kid(sc, 'min'))) : null, max: sc && kid(sc, 'max') ? Number(val(kid(sc, 'max'))) : null,
      rev: !!sc && val(kid(sc, 'orientation')) === 'maxMin', del: on(kid(ax, 'delete')), title: textOf(kid(ax, 'title')),
      fmt: nf && at(nf, 'sourceLinked') !== '1' ? at(nf, 'formatCode') : null, grid: !!kid(ax, 'majorGridlines')
    };
  }
  const palette = (i) => { const a = (tc.colors || {})[`accent${(i % 6) + 1}`] || ACCENTS[i % 6]; const r = Math.floor(i / 6); return r ? mixHex(a, r % 2 ? '000000' : 'FFFFFF', 0.3) : a; };
  const groups = []; let idx = 0;
  for (const g of plot.children) {
    const n = g.localName;
    const kind = BAR_T.includes(n) ? 'bar' : LINE_T.includes(n) ? 'line' : AREA_T.includes(n) ? 'area' : PIE_T.includes(n) ? 'pie' : n === 'doughnutChart' ? 'doughnut'
      : n === 'scatterChart' ? 'scatter' : n === 'bubbleChart' ? 'bubble' : n === 'radarChart' ? 'radar' : null;
    if (!kind) continue;
    const grp = { kind, dir: val(kid(g, 'barDir'), 'col'), grouping: val(kid(g, 'grouping'), 'standard'), axIds: kids(g, 'axId').map((a) => val(a)),
      gap: Number(val(kid(g, 'gapWidth'), 150)), hole: Number(val(kid(g, 'holeSize'), 50)), style: val(kid(g, 'scatterStyle'), 'lineMarker'), labels: labelsOf(kid(g, 'dLbls')), series: [] };
    const isLine = kind === 'line' || kind === 'scatter' || kind === 'radar';
    const gMarker = on(kid(g, 'marker'), true);
    for (const s of kids(g, 'ser')) {
      if (grp.series.length >= CHART_SERIES) break;
      const tx = kid(s, 'tx'); const d0 = tx && data(tx);
      const name = tx ? (kid(tx, 'v') ? kid(tx, 'v').textContent : d0 ? d0.pts[0] || '' : '') : '';
      const sp = kid(s, 'spPr'); const lc = chartLine(sp, tc); const fc = chartFill(sp, tc);
      const mk = kid(s, 'marker'); const sym = val(kid(mk, 'symbol'), 'auto'); const mfill = chartFill(kid(mk, 'spPr'), tc);
      let color;
      if (isLine) color = lc || mfill || fc || palette(idx); else color = fc === null ? null : fc || lc || palette(idx);
      const lw = kid(sp, 'ln') && at(kid(sp, 'ln'), 'w');
      const catD = data(kid(s, 'cat') || kid(s, 'xVal')); const valD = data(kid(s, 'val') || kid(s, 'yVal'));
      const vals = nums(valD);
      const ser = { name, color, noLine: isLine && lc === null, w: lw ? Math.max(1, Number(lw) / EMU) : null, smooth: on(kid(s, 'smooth')),
        marker: sym !== 'none' && (kind === 'scatter' || !!mk || gMarker), cats: catD ? catD.pts : [], vals, fmt: valD ? valD.fmt : null,
        xs: kind === 'scatter' || kind === 'bubble' ? nums(data(kid(s, 'xVal'))) : null, size: kind === 'bubble' ? nums(data(kid(s, 'bubbleSize'))) : null,
        labels: kid(s, 'dLbls') ? labelsOf(kid(s, 'dLbls')) : undefined, dpt: {} };
      for (const dp of kids(s, 'dPt')) { const c = chartFill(kid(dp, 'spPr'), tc); if (c) ser.dpt[Number(val(kid(dp, 'idx'), 0))] = c; }
      if (kind === 'pie' || kind === 'doughnut') ser.pcolors = vals.map((_, i) => ser.dpt[i] || palette(i));
      grp.series.push(ser); idx++;
    }
    if (grp.series.length) groups.push(grp);
  }
  if (!groups.length) return null;
  const t = kid(chart, 'title'); const deleted = on(kid(chart, 'autoTitleDeleted'));
  const lg = kid(chart, 'legend');
  return { title: deleted ? '' : textOf(t), autoTitle: !!t && !deleted && !textOf(t), legend: lg && !on(kid(lg, 'delete')) ? val(kid(lg, 'legendPos'), 'r') : null, axes, groups };
}
