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
function letters(n, upper) {
  let s = ''; let x = n;
  while (x > 0) { x -= 1; s = String.fromCharCode(97 + (x % 26)) + s; x = Math.floor(x / 26); }
  return upper ? s.toUpperCase() : s;
}

export function readDocx(bytes) {
  const files = unpack(bytes, 'word/', 'word/document.xml');
  const main = 'word/document.xml';
  const root = xml(files, main);
  if (!root) throw new OfficeError('This is not a valid file of this type.');
  const rel = rels(files, main);

  // styles: id -> heading level
  const styleLevel = {}; const styleNum = {};
  for (const s of kids(xml(files, 'word/styles.xml'), 'style')) {
    const name = at(kid(s, 'name'), 'val') || '';
    const snp = kid(kid(s, 'pPr'), 'numPr'); // a list style carries its numbering
    if (snp && at(kid(snp, 'numId'), 'val')) styleNum[at(s, 'styleId')] = { id: at(kid(snp, 'numId'), 'val'), lv: at(kid(snp, 'ilvl'), 'val') || '0' };
    const m = HEAD.exec(name);
    if (m) styleLevel[at(s, 'styleId')] = Number(m[1]);
    else if (/^title$/i.test(name)) styleLevel[at(s, 'styleId')] = 1;
  }
  // numbering: numId -> level -> format
  const abstract = {}; const numToAbs = {};
  const numRoot = xml(files, 'word/numbering.xml');
  for (const a of kids(numRoot, 'abstractNum')) {
    const lv = {};
    for (const l of kids(a, 'lvl')) lv[at(l, 'ilvl')] = at(kid(l, 'numFmt'), 'val') || 'decimal';
    abstract[at(a, 'abstractNumId')] = lv;
  }
  for (const n of kids(numRoot, 'num')) numToAbs[at(n, 'numId')] = at(kid(n, 'abstractNumId'), 'val');
  const counters = {};
  const marker = (numId, ilvl) => {
    const fmt = (abstract[numToAbs[numId]] || {})[ilvl] || 'bullet';
    if (fmt === 'bullet' || fmt === 'none') return '\u2022';
    const c = (counters[numId] = counters[numId] || {});
    c[ilvl] = (c[ilvl] || 0) + 1;
    for (const k of Object.keys(c)) if (Number(k) > Number(ilvl)) c[k] = 0;
    if (fmt === 'lowerLetter') return `${letters(c[ilvl], false)}.`;
    if (fmt === 'upperLetter') return `${letters(c[ilvl], true)}.`;
    return `${c[ilvl]}.`;
  };

  const media = {};
  const addMedia = (id) => {
    const r = id && rel[id];
    if (!r) return null;
    const img = image(files, r.path);
    if (!img) return null;
    media[r.path] = img;
    return r.path;
  };

  let count = 0; let truncated = false;
  const runsOf = (node, out, fmt) => {
    for (const c of node.children) {
      const n = c.localName;
      if (n === 'r') {
        const rp = kid(c, 'rPr');
        const f = { ...fmt };
        if (rp) {
          if (kid(rp, 'b')) f.b = flag(kid(rp, 'b'));
          if (kid(rp, 'i')) f.i = flag(kid(rp, 'i'));
          if (kid(rp, 'u')) f.u = flag(kid(rp, 'u'));
          if (kid(rp, 'strike')) f.s = flag(kid(rp, 'strike'));
          const va = at(kid(rp, 'vertAlign'), 'val');
          if (va === 'superscript') f.sup = true; else if (va === 'subscript') f.sub = true;
        }
        let text = '';
        const flush = () => { if (text) { out.push({ ...f, text }); text = ''; } };
        for (const k of c.children) {
          const kn = k.localName;
          if (kn === 't') text += k.textContent;
          else if (kn === 'tab') text += '\t';
          else if (kn === 'noBreakHyphen') text += '-';
          else if (kn === 'br' || kn === 'cr') { if (at(k, 'type') !== 'page') { flush(); out.push({ br: true }); } }
          else if (kn === 'drawing' || kn === 'pict') { flush(); const p = addMedia(blipId(k)); if (p) out.push({ img: p }); }
        }
        flush();
      } else if (['hyperlink', 'ins', 'smartTag', 'fldSimple', 'moveTo'].includes(n)) runsOf(c, out, fmt);
      else if (n === 'sdt') runsOf(kid(c, 'sdtContent') || c, out, fmt);
      else if (n === 'AlternateContent') { const ch = kid(c, 'Choice'); if (ch) runsOf(ch, out, fmt); }
    }
    return out;
  };
  const paragraph = (p) => {
    const pp = kid(p, 'pPr');
    let level = 0;
    const st = at(kid(pp, 'pStyle'), 'val');
    if (st && styleLevel[st]) level = styleLevel[st];
    const ol = at(kid(pp, 'outlineLvl'), 'val');
    if (!level && ol !== null && Number(ol) < 9) level = Number(ol) + 1;
    let list = null;
    const np = kid(pp, 'numPr');
    let id = null; let lv = '0';
    if (np) { id = at(kid(np, 'numId'), 'val'); lv = at(kid(np, 'ilvl'), 'val') || '0'; }
    else if (st && styleNum[st]) ({ id, lv } = styleNum[st]);
    if (id && id !== '0') list = { marker: marker(id, lv), level: Number(lv) };
    const jc = at(kid(pp, 'jc'), 'val');
    return { t: 'p', level: Math.min(level, 6), list, align: ['center', 'right'].includes(jc) ? jc : 'left', runs: runsOf(p, [], {}) };
  };
  const blocksOf = (node, depth) => {
    const out = [];
    for (const c of node.children) {
      if (count >= DOC_BLOCK_MAX) { truncated = true; break; }
      const n = c.localName;
      if (n === 'p') { out.push(paragraph(c)); count++; }
      else if (n === 'tbl' && depth < 4) {
        const rows = kids(c, 'tr').map((tr) => kids(tr, 'tc').map((tc) => ({
          span: Number(at(kid(kid(tc, 'tcPr'), 'gridSpan'), 'val')) || 1,
          blocks: blocksOf(tc, depth + 1)
        })));
        out.push({ t: 'table', rows });
      } else if (n === 'sdt') out.push(...blocksOf(kid(c, 'sdtContent') || c, depth));
    }
    return out;
  };
  const blocks = blocksOf(kid(root, 'body') || root, 0);
  return { kind: 'docx', blocks, media, truncated };
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
