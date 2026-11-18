// office-doc.js — view-only reader for doc, the Word 97 to 2003 format (Decisions 451, 456, 507). Reads the piece table of the
// WordDocument stream, the style sheet, the paragraph formatting (PAPX) and the character formatting runs (CHPX), and returns the body
// as the same Word model as readDocx: text with bold, italic, underline, strike, caps, size, font, colour, highlight, super and
// subscript, and paragraphs with alignment, indents, spacing and heading level, from the styles and from the paragraph itself.
// Tables (cells, widths, merges, borders, shading) come from the paragraph marks of the cells and rows. Lists (Decision 510) come from
// the list definitions and list overrides of the Table stream, inline pictures (Decision 511) from the Data stream, floating pictures (Decision 512) from the shape table. No headers or footers yet: the model carries a notice that says so. Older Word 6 and 95 files and password-protected
// files are refused.

import { OfficeError, DOC_BLOCK_MAX, formatNum } from './office-read.js';
import { readOle2, isOle2 } from './ole2.js';

export function isDoc(bytes) { return isOle2(bytes); }

const PX_PT = 4 / 3; // 1 pt = 4/3 px at 96 dpi
// the 16 colours of a Word colour index (1 to 16); 0 is automatic
const ICO = [null, '000000', '0000FF', '00FFFF', '00FF00', 'FF00FF', 'FF0000', 'FFFF00', 'FFFFFF', '000080', '008080', '008000', '800080', '800000', '808000', '808080', 'C0C0C0'];
const SPRA = [1, 1, 2, 4, 2, 2, -1, 3]; // operand size of a property modifier by its size code; -1: a length byte comes first
// calls fn(opcode, operandStart) for every property modifier in b[o, end)
function eachSprm(b, o, end, fn) {
  while (o + 2 <= end) {
    const op = b[o] | (b[o + 1] << 8); let d = o + 2; let len = SPRA[op >> 13];
    if (op === 0xd608) { if (d + 2 > end) return; len = (b[d] | (b[d + 1] << 8)) - 1; d += 2; } // the table definition has a two-byte length
    else if (len === -1) { if (d >= end) return; len = b[d]; d += 1; }
    if (len < 0 || d + len > end) return;
    fn(op, d, len); o = d + len;
  }
}
const flag = (v) => (v === 0 ? false : v === 1 ? true : undefined); // 0x80 and 0x81 depend on the style, which is not read yet
const s16 = (b, d) => ((b[d] | (b[d + 1] << 8)) << 16) >> 16;
const u16b = (b, d) => b[d] | (b[d + 1] << 8);
// a border of a table: line width in eighths of a point, kind, colour (null: automatic)
function brcSpec(dpt, type, color) {
  if (!type || type === 255 || !dpt) return undefined;
  const style = type === 3 ? 'double' : type === 6 ? 'dotted' : type === 7 || type === 8 || type === 9 || type === 22 ? 'dashed' : 'solid';
  return { w: Math.max(1, Math.round((dpt / 8) * PX_PT)), style, color: color || null };
}
const rgbHex = (b, d) => (b[d + 3] === 0xff ? null : [b[d], b[d + 1], b[d + 2]].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase());
const brc80 = (b, d) => brcSpec(b[d], b[d + 1], ICO[b[d + 2]] || null);
const brc97 = (b, d) => brcSpec(b[d + 4], b[d + 5], rgbHex(b, d));
// one paragraph property modifier applied to a paragraph property object (twips become pixels, one pixel is 15 twips)
function applyPap(pr, op, d, b, len = 0) {
  switch (op) {
    case 0x2416: pr.inTable = b[d] === 1; break;
    case 0x460b: pr.ilfo = b[d] | (b[d + 1] << 8); break; // the list override (1 based; 0 and the values above 2000 mean none)
    case 0x260a: pr.ilvl = b[d]; break;
    case 0x2417: pr.ttp = b[d] === 1; break;
    case 0xd608: { // the cells of a row: n columns, n + 1 boundaries, then a 20-byte description of each cell (merge flags, vertical alignment, four borders)
      const n = b[d]; if (!n || 1 + (n + 1) * 2 > len) break;
      const centers = []; for (let i = 0; i <= n; i++) centers.push(s16(b, d + 1 + i * 2));
      const t0 = d + 1 + (n + 1) * 2; const tcs = [];
      for (let i = 0; i < n && t0 + (i + 1) * 20 <= d + len; i++) { const q = t0 + i * 20; tcs.push({ grf: u16b(b, q), borders: { t: brc80(b, q + 4), l: brc80(b, q + 8), b: brc80(b, q + 12), r: brc80(b, q + 16) } }); }
      pr.tdef = { n, centers, tcs }; break;
    }
    case 0xd605: pr.tb = { t: brc80(b, d), l: brc80(b, d + 4), b: brc80(b, d + 8), r: brc80(b, d + 12), h: brc80(b, d + 16), v: brc80(b, d + 20) }; break;
    case 0xd613: pr.tb = { t: brc97(b, d), l: brc97(b, d + 8), b: brc97(b, d + 16), r: brc97(b, d + 24), h: brc97(b, d + 32), v: brc97(b, d + 40) }; break;
    case 0xd612: { const out = []; for (let q = d; q + 10 <= d + len; q += 10) { const pat = u16b(b, q + 8); const c = pat === 1 ? rgbHex(b, q) : rgbHex(b, q + 4); out.push(pat === 0 || pat === 1 || c ? c : null); } pr.tshd = out; break; }
    case 0xd609: { const out = []; for (let q = d; q + 2 <= d + len; q += 2) { const w = u16b(b, q); const ipat = w >> 10; out.push(ICO[ipat === 1 ? w & 31 : (w >> 5) & 31] || null); } if (!pr.tshd) pr.tshd = out; break; }
    case 0x2461: case 0x2403: pr.align = ['left', 'center', 'right', 'justify'][b[d]] || (b[d] === 4 ? 'justify' : undefined); break;
    case 0x845e: case 0x840f: pr.l = s16(b, d) / 15; break;
    case 0x8460: case 0x8411: pr.first = s16(b, d) / 15; break;
    case 0x845d: case 0x840e: pr.r = s16(b, d) / 15; break;
    case 0xa413: pr.sb = u16b(b, d) / 15; break;
    case 0xa414: pr.sa = u16b(b, d) / 15; break;
    case 0x6412: { const dya = s16(b, d); if (u16b(b, d + 2) === 1) { if (dya > 0) pr.line = { mult: dya / 240 }; } else if (dya > 0) pr.line = { px: dya / 15, atLeast: true }; else if (dya < 0) pr.line = { px: -dya / 15, atLeast: false }; break; }
    case 0x2640: if (b[d] < 9) pr.outline = b[d] + 1; break;
    default: break;
  }
}
// one character property modifier applied to a property object
function applyChp(pr, op, d, b, fonts) {
  switch (op) {
    case 0x0835: { const v = flag(b[d]); if (v !== undefined) pr.b = v; break; }
    case 0x0836: { const v = flag(b[d]); if (v !== undefined) pr.i = v; break; }
    case 0x0837: { const v = flag(b[d]); if (v !== undefined) pr.s = v; break; }
    case 0x083a: { const v = flag(b[d]); if (v !== undefined) pr.sc = v; break; }
    case 0x083b: { const v = flag(b[d]); if (v !== undefined) pr.caps = v; break; }
    case 0x2a3e: pr.u = b[d] !== 0; break;
    case 0x4a43: { const hp = b[d] | (b[d + 1] << 8); if (hp > 0) pr.size = (hp / 2) * PX_PT; break; }
    case 0x4a4f: { const f = fonts[b[d] | (b[d + 1] << 8)]; if (f) pr.font = f; break; }
    case 0x2a42: { const c = ICO[b[d]]; if (c) pr.color = c; else if (b[d] === 0) delete pr.color; break; }
    case 0x6870: if (b[d + 3] === 0xff) delete pr.color; else pr.color = [b[d], b[d + 1], b[d + 2]].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase(); break;
    case 0x2a48: pr.sup = b[d] === 1; pr.sub = b[d] === 2; break;
    case 0x2a0c: { const c = ICO[b[d]]; if (c) pr.bg = c; else delete pr.bg; break; }
    case 0x4a30: pr.cs = b[d] | (b[d + 1] << 8); break; // a character style, resolved with the style sheet
    case 0x0855: pr.spec = b[d] === 1; break; // a special character: the picture mark 0x01 is one
    case 0x6a03: pr.pic = b[d] | (b[d + 1] << 8) | (b[d + 2] << 16) | (b[d + 3] * 0x1000000); break; // where the picture sits in the Data stream
    case 0x080a: pr.ole = b[d] === 1; break; // an embedded object, not a picture
    case 0x0806: pr.fdata = b[d] === 1; break; // form field data, not a picture
    default: break;
  }
}

// Windows-1252 for the bytes 0x80 to 0x9F; the rest of a compressed piece is Latin-1
const CP1252 = [0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d, 0x17d, 0x8f,
  0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178];

// true when the container holds a Word document stream
export function hasWordStream(bytes) {
  try { return !!readOle2(bytes).stream('WordDocument'); } catch { return false; }
}

export function readDoc(bytes) {
  const ole = readOle2(bytes);
  const wd = ole.stream('WordDocument');
  if (!wd || wd.length < 0x1a8) throw new OfficeError('This is not a valid file of this type.');
  const dv = new DataView(wd.buffer, wd.byteOffset, wd.byteLength);
  const u16 = (o) => dv.getUint16(o, true);
  const u32 = (o) => dv.getUint32(o, true);
  if (u16(0) !== 0xa5ec) throw new OfficeError('This is not a valid file of this type.');
  const nFib = u16(2);
  if (nFib < 0xc1) throw new OfficeError('This is an older Word file (Word 95 or earlier). Use Open with app.');
  const flags = u16(10);
  if (flags & 0x0100) throw new OfficeError('This file is password protected. Use Open with app.');
  const table = ole.stream(flags & 0x0200 ? '1Table' : '0Table');
  if (!table) throw new OfficeError('This file is protected or damaged.');

  const ccpText = u32(0x4c);
  const fcClx = u32(0x1a2); const lcbClx = u32(0x1a6);
  if (!lcbClx || fcClx + lcbClx > table.length) throw new OfficeError('This file is protected or damaged.');

  // Clx: skip the Prc entries (0x01), then the Pcdt (0x02) that holds the piece table
  const tdv = new DataView(table.buffer, table.byteOffset, table.byteLength);
  let p = fcClx; const end = fcClx + lcbClx;
  while (p < end && table[p] === 1) p += 3 + tdv.getUint16(p + 1, true);
  if (p >= end || table[p] !== 2) throw new OfficeError('This file is protected or damaged.');
  const plcLen = tdv.getUint32(p + 1, true);
  const plc = p + 5;
  const n = Math.floor((plcLen - 4) / 12); // n + 1 positions of 4 bytes, n descriptors of 8 bytes
  if (n < 1 || plc + plcLen > table.length) throw new OfficeError('This file is protected or damaged.');

  const pieces = []; // { cp, len, fc, uni }: where each stretch of text lies in the file
  const parts = [];
  let got = 0;
  for (let i = 0; i < n && got < ccpText; i++) {
    const cpS = tdv.getUint32(plc + i * 4, true); const cpE = tdv.getUint32(plc + (i + 1) * 4, true);
    const fcRaw = tdv.getUint32(plc + (n + 1) * 4 + i * 8 + 2, true);
    const len = Math.min(cpE - cpS, ccpText - got);
    if (!(len > 0)) continue;
    let s = '';
    if (fcRaw & 0x40000000) {
      const off = (fcRaw & 0x3fffffff) >>> 1;
      if (off + len > wd.length) throw new OfficeError('This file is protected or damaged.');
      for (let k = 0; k < len; k++) { const c = wd[off + k]; s += String.fromCharCode(c >= 0x80 && c < 0xa0 ? CP1252[c - 0x80] : c); }
      pieces.push({ cp: got, len, fc: off, uni: false });
    } else {
      const off = fcRaw;
      if (off + len * 2 > wd.length) throw new OfficeError('This file is protected or damaged.');
      for (let k = 0; k < len; k++) s += String.fromCharCode(wd[off + k * 2] | (wd[off + k * 2 + 1] << 8));
      pieces.push({ cp: got, len, fc: off, uni: true });
    }
    parts.push(s); got += len;
  }
  const raw = parts.join('');

  // font names: the font table of the Table stream (an entry is a length byte, 39 bytes of fixed data, then the name in UTF-16)
  const fonts = [];
  try {
    const fcF = u32(0x112); const lcbF = u32(0x116);
    if (lcbF && fcF + lcbF <= table.length) {
      const cData = tdv.getUint16(fcF, true); let q = fcF + 4;
      for (let k = 0; k < cData && q < fcF + lcbF; k++) {
        const cb = table[q]; let nm = '';
        for (let o = q + 40; o + 1 < q + 1 + cb; o += 2) { const c = table[o] | (table[o + 1] << 8); if (!c) break; nm += String.fromCharCode(c); }
        fonts.push(nm); q += cb + 1;
      }
    }
  } catch { /* the default font is used */ }

  // character formatting: the runs of the CHPX bin table, each a stretch of file positions with property modifiers
  const props = []; const propIx = new Map(); const chpAt = new Int32Array(raw.length).fill(-1);
  const cpRange = (fcA, fcB, id) => {
    for (const pc of pieces) {
      const unit = pc.uni ? 2 : 1; const pS = pc.fc; const pE = pc.fc + pc.len * unit;
      const a = Math.max(fcA, pS); const b = Math.min(fcB, pE); if (a >= b) continue;
      const c0 = pc.cp + Math.floor((a - pS) / unit); const c1 = Math.min(raw.length, pc.cp + Math.ceil((b - pS) / unit));
      for (let c = c0; c < c1; c++) chpAt[c] = id;
    }
  };
  try {
    const fcB = u32(0xfa); const lcbB = u32(0xfe);
    const nB = lcbB >= 12 ? Math.floor((lcbB - 4) / 8) : 0;
    if (nB && fcB + lcbB <= table.length) {
      for (let i = 0; i < nB; i++) {
        const off = (tdv.getUint32(fcB + (nB + 1) * 4 + i * 4, true) & 0x3fffff) * 512;
        if (off + 512 > wd.length) continue;
        const crun = wd[off + 511]; if (crun < 1 || (crun + 1) * 4 + crun > 511) continue;
        for (let r = 0; r < crun; r++) {
          const ofs = wd[off + (crun + 1) * 4 + r]; if (!ofs) continue;
          const cx = off + ofs * 2; if (cx >= off + 511) continue; const cb = wd[cx];
          const pr = {}; eachSprm(wd, cx + 1, Math.min(cx + 1 + cb, off + 511), (op, d) => applyChp(pr, op, d, wd, fonts));
          const key = JSON.stringify(pr); if (key === '{}') continue;
          let id = propIx.get(key); if (id === undefined) { id = props.length; props.push(pr); propIx.set(key, id); }
          const dvk = new DataView(wd.buffer, wd.byteOffset + off, 512);
          cpRange(dvk.getUint32(r * 4, true), dvk.getUint32((r + 1) * 4, true), id);
        }
      }
    }
  } catch { /* the text is shown without formatting */ }

  // the style sheet: each style is a base style, paragraph modifiers and character modifiers; resolved from its base style down
  const styles = [];
  try {
    const fcS = u32(0xa2); const lcbS = u32(0xa6);
    if (lcbS && fcS + lcbS <= table.length) {
      const cbStshi = tdv.getUint16(fcS, true); const cstd = tdv.getUint16(fcS + 2, true); const cbBase = tdv.getUint16(fcS + 4, true);
      let q = fcS + 2 + cbStshi;
      for (let i = 0; i < cstd && q + 2 <= fcS + lcbS; i++) {
        const cb = tdv.getUint16(q, true); q += 2;
        if (!cb || q + cb > fcS + lcbS) { styles.push(null); q += cb; continue; }
        const st = q; const w1 = tdv.getUint16(st + 2, true); const w2 = tdv.getUint16(st + 4, true);
        const stk = w1 & 15; const base = w1 >> 4; const cupx = w2 & 15;
        const cch = tdv.getUint16(st + cbBase, true); let name = '';
        for (let k = 0; k < cch; k++) name += String.fromCharCode(tdv.getUint16(st + cbBase + 2 + k * 2, true));
        let up = st + cbBase + 2 + (cch + 1) * 2; const pap = {}; const chp = {};
        for (let k = 0; k < cupx; k++) {
          if ((up - st) & 1) up++;
          if (up + 2 > st + cb) break;
          const cbU = tdv.getUint16(up, true); const dd = up + 2; const en = Math.min(dd + cbU, st + cb);
          if (stk === 1 && k === 0) eachSprm(table, dd + 2, en, (op, d, ln) => applyPap(pap, op, d, table, ln));
          else if ((stk === 1 && k === 1) || (stk === 2 && k === 0)) eachSprm(table, dd, en, (op, d) => applyChp(chp, op, d, table, fonts));
          up = dd + cbU;
        }
        const hm = /^heading (\d)$/i.exec(name); if (hm && !pap.outline) pap.outline = Number(hm[1]);
        styles.push({ name, base: base === 0xfff || base === i ? -1 : base, pap, chp });
        q = st + cb;
      }
    }
  } catch { /* styles that cannot be read are left out */ }
  const resolved = new Map();
  const styleOf = (i, depth = 0) => {
    if (resolved.has(i)) return resolved.get(i);
    const st = styles[i]; let out = { pap: {}, chp: {} };
    if (st) { const bs = st.base >= 0 && depth < 20 ? styleOf(st.base, depth + 1) : { pap: {}, chp: {} }; out = { pap: { ...bs.pap, ...st.pap }, chp: { ...bs.chp, ...st.chp } }; }
    resolved.set(i, out); return out;
  };

  // lists (Decision 510): PlfLst holds the lists (1 or 9 levels each), PlfLfo the overrides a paragraph points to (its number is ilfo, 1 based)
  const NFC = { 0: 'decimal', 1: 'upperRoman', 2: 'lowerRoman', 3: 'upperLetter', 4: 'lowerLetter', 5: 'decimal', 22: 'decimalZero', 23: 'bullet', 255: 'none' };
  const bulletOf = (t) => { const c = t ? t.charCodeAt(0) : 0; if (!t) return '\u2022'; if (c >= 0xf000 && c <= 0xf0ff) return c === 0xf0a7 ? '\u25aa' : '\u2022'; if (t === 'o') return '\u25e6'; if (t === '\u00a7') return '\u25aa'; return t; };
  const lists = (() => {
    try {
      const fcL = u32(0x2e2); const lcbL = u32(0x2e6); const fcO = u32(0x2ea); const lcbO = u32(0x2ee);
      if (lcbL < 2 || lcbO < 4 || fcL + lcbL > table.length || fcO + lcbO > table.length) return null;
      const lvl = (o) => { // LVLF (28 bytes), the paragraph and character modifiers, then the number text
        if (o + 28 > table.length) return null;
        const nfc = table[o + 4]; const cbC = table[o + 24]; const cbP = table[o + 25]; let q = o + 28;
        const pap = {}; const chp = {};
        eachSprm(table, q, q + cbP, (op, d, ln) => applyPap(pap, op, d, table, ln)); q += cbP;
        eachSprm(table, q, q + cbC, (op, d) => applyChp(chp, op, d, table, fonts)); q += cbC;
        const cch = tdv.getUint16(q, true); q += 2; if (q + cch * 2 > table.length) return null;
        const fmt = NFC[nfc] || 'decimal'; let text = '';
        for (let k = 0; k < cch; k++) { const c = tdv.getUint16(q + k * 2, true); text += fmt !== 'bullet' && c < 9 ? `%${c + 1}` : String.fromCharCode(c); }
        if (fmt === 'bullet') text = bulletOf(text);
        for (const k of ['b', 'i']) if (chp[k] === undefined) delete chp[k];
        if (fmt === 'bullet' && /symbol|wingdings/i.test(chp.font || '')) delete chp.font;
        return { lv: { fmt, start: tdv.getInt32(o, true), l: pap.l, first: pap.first, text, chp }, next: q + cch * 2 };
      };
      const cLst = tdv.getUint16(fcL, true); let q = fcL + 2 + cLst * 28; const byLsid = new Map();
      for (let i = 0; i < cLst && i < 4000; i++) {
        const e = fcL + 2 + i * 28; const n = table[e + 26] & 1 ? 1 : 9; const lv = [];
        for (let k = 0; k < n; k++) { const r = lvl(q); if (!r) break; lv.push(r.lv); q = r.next; }
        byLsid.set(tdv.getInt32(e, true), lv);
      }
      const lfoMac = Math.min(tdv.getUint32(fcO, true), 2000); const lfos = []; let o = fcO + 4;
      for (let i = 0; i < lfoMac; i++) { lfos.push({ lsid: tdv.getInt32(o, true), n: table[o + 12], ov: {} }); o += 16; }
      for (const f of lfos) {
        o += 4;
        for (let j = 0; j < f.n; j++) {
          const st = tdv.getInt32(o, true); const fl = tdv.getUint32(o + 4, true); o += 8; const ov = {};
          if (fl & 16) ov.start = st;
          if (fl & 32) { const r = lvl(o); if (!r) break; ov.lv = r.lv; o = r.next; }
          f.ov[fl & 15] = ov;
        }
      }
      const at = (f, k) => { const base = byLsid.get(f.lsid) || []; const ov = f.ov[k] || {}; const lv = ov.lv || base[Math.min(k, base.length - 1)]; return lv ? { ...lv, start: ov.start !== undefined ? ov.start : lv.start } : null; };
      const counters = {}; const used = {};
      const marker = (ilfo, k) => {
        const f = lfos[ilfo - 1]; if (!f) return null;
        const lv = at(f, k); if (!lv) return null;
        if (!used[ilfo]) { used[ilfo] = []; for (let j = 0; j < 9; j++) { const x = at(f, j); used[ilfo].push(x ? { fmt: x.fmt, text: x.text, start: x.start, l: x.l, first: x.first } : null); } }
        const out = { l: lv.l, first: lv.first, chp: lv.chp, level: k };
        if (lv.fmt === 'bullet') return { ...out, text: lv.text };
        const c = (counters[ilfo] = counters[ilfo] || {});
        c[k] = c[k] === undefined ? lv.start : c[k] + 1;
        for (const x of Object.keys(c)) if (Number(x) > k) delete c[x];
        if (lv.fmt === 'none') return { ...out, text: '' };
        const text = (lv.text || `%${k + 1}.`).replace(/%([1-9])/g, (_, dgt) => { const j = Number(dgt) - 1; const lj = at(f, j) || lv; return formatNum(c[j] === undefined ? lj.start : c[j], lj.fmt); });
        return { ...out, text };
      };
      return { marker, used: () => used };
    } catch { return null; } // paragraphs are shown without their list markers
  })();

  // pictures (Decision 511): an inline picture is the mark 0x01 whose modifiers point into the Data stream, at a header (PICF) followed by
  // the picture's blocks; JPEG, PNG and bitmap are read, other formats are left out
  const dataS = ole.stream('Data'); const media = {}; const picSeen = new Map(); let picBytes = 0;
  const PIC_MAX = 40 * 1024 * 1024;
  const blip = (buf, o) => { // one picture block: header, id (16 bytes, 32 when the instance says two), tag, data
    if (o < 0 || o + 8 > buf.length) return null;
    const bv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const inst = bv.getUint16(o, true) >> 4; const type = bv.getUint16(o + 2, true); const len = bv.getUint32(o + 4, true);
    if (o + 8 + len > buf.length) return null;
    const two = { 0xf01d: [0x46b, 0x6e3], 0xf01e: [0x6e1], 0xf01f: [0x7a9] }[type]; if (!two) return null;
    const at = o + 8 + (two.includes(inst) ? 32 : 16) + 1; const end = o + 8 + len; if (at >= end) return null;
    const data = buf.subarray(at, end);
    if (type === 0xf01d) return { bytes: data, mime: 'image/jpeg', ext: 'jpg' };
    if (type === 0xf01e) return { bytes: data, mime: 'image/png', ext: 'png' };
    if (data.length < 40) return null; // a bitmap without its file header: one is put in front
    const dv2 = new DataView(data.buffer, data.byteOffset, data.byteLength); const hs = dv2.getUint32(0, true); const bpp = dv2.getUint16(14, true);
    const used = dv2.getUint32(32, true); const pal = bpp <= 8 ? (used || 1 << bpp) * 4 : (dv2.getUint32(16, true) === 3 && hs === 40 ? 12 : 0);
    const out = new Uint8Array(14 + data.length); const ov = new DataView(out.buffer);
    out[0] = 0x42; out[1] = 0x4d; ov.setUint32(2, out.length, true); ov.setUint32(10, 14 + hs + pal, true); out.set(data, 14);
    return { bytes: out, mime: 'image/bmp', ext: 'bmp' };
  };
  const readPic = (off) => {
    try {
      if (!dataS || off + 68 > dataS.length) return null;
      if (picSeen.has(off)) return picSeen.get(off); // the same picture again
      picSeen.set(off, null);
      const dd = new DataView(dataS.buffer, dataS.byteOffset, dataS.byteLength);
      const lcb = dd.getUint32(off, true); const cbh = dd.getUint16(off + 4, true); const mm = dd.getUint16(off + 6, true);
      if (lcb < 68 || cbh < 68 || off + lcb > dataS.length) return null;
      const w = Math.round((dd.getInt16(off + 28, true) * dd.getUint16(off + 32, true)) / 1000 / 15); const h = Math.round((dd.getInt16(off + 30, true) * dd.getUint16(off + 34, true)) / 1000 / 15);
      let q = off + cbh; if (mm === 0x66) q += 1 + dataS[q];
      const endp = off + lcb;
      if (q + 8 > endp) return null;
      q += 8 + dd.getUint32(q + 4, true); // the shape container
      let found = null;
      while (!found && q + 8 <= endp) {
        const type = dd.getUint16(q + 2, true); const len = dd.getUint32(q + 4, true);
        if (type === 0xf007) { // a picture store entry: the picture follows its 36 byte header and name, or sits in the WordDocument stream (delay offset)
          const nameLen = dataS[q + 8 + 33]; const emb = q + 8 + 36 + nameLen;
          found = len > 36 + nameLen ? blip(dataS, emb) : blip(wd, dd.getUint32(q + 8 + 28, true));
        } else if (type >= 0xf018 && type <= 0xf117) found = blip(dataS, q);
        q += 8 + len;
      }
      if (!found || picBytes + found.bytes.length > PIC_MAX || w <= 0 || h <= 0) return null;
      picBytes += found.bytes.length;
      const path = `media/pic${off}.${found.ext}`; media[path] = { bytes: found.bytes, mime: found.mime };
      const res = { path, w, h }; picSeen.set(off, res); return res;
    } catch { return null; }
  };

  // floating pictures (Decision 512): the shape table (PlcSpaMom) gives each anchor's position, size and wrap, keyed by the character it sits
  // at; the drawing group (OfficeArtContent) gives each shape's picture index and the picture store; pictures are read as inline ones are
  const spaFloats = new Map();
  try {
    const fcS = u32(0x1da); const lcbS = u32(0x1de); const fcD = u32(0x22a); const lcbD = u32(0x22e);
    if (lcbS >= 34 && lcbD >= 8 && fcS + lcbS <= table.length && fcD + lcbD <= table.length) {
      const walk = (a, e, fn) => {
        let q = a;
        while (q + 8 <= e) {
          const vi = tdv.getUint16(q, true); const type = tdv.getUint16(q + 2, true); const end = q + 8 + tdv.getUint32(q + 4, true);
          if (end > e) break;
          fn(type, vi >> 4, q + 8, end, (vi & 15) === 15); q = end;
        }
      };
      const store = []; const shapes = new Map(); const limit = fcD + lcbD;
      const dggEnd = fcD + 8 + tdv.getUint32(fcD + 4, true);
      walk(fcD, dggEnd, (type, _i, b, end) => {
        if (type !== 0xf000) return;
        walk(b, end, (t2, _j, b2, e2) => {
          if (t2 !== 0xf001) return;
          walk(b2, e2, (t3, _k, b3, e3) => { // a picture store entry: its picture is in the entry or at its delay offset in the WordDocument stream
            if (t3 !== 0xf007) return;
            const nameLen = table[b3 + 33]; const delay = tdv.getUint32(b3 + 28, true);
            store.push(() => (e3 - b3 > 36 + nameLen ? blip(table, b3 + 36 + nameLen) : blip(wd, delay)));
          });
        });
      });
      const scan = (a, e) => walk(a, e, (type, _i, b, end, isC) => {
        if (type === 0xf004) {
          let spid = -1; const pr = {};
          walk(b, end, (t2, inst, b2, e2) => {
            if (t2 === 0xf00a) spid = tdv.getUint32(b2, true);
            else if (t2 === 0xf00b) for (let k = 0; k < inst && b2 + k * 6 + 6 <= e2; k++) pr[tdv.getUint16(b2 + k * 6, true) & 0x3fff] = tdv.getInt32(b2 + k * 6 + 2, true);
          });
          if (spid >= 0) shapes.set(spid, pr);
        } else if (isC) scan(b, end);
      });
      let q = dggEnd; // then one drawing per entry: a label byte and the drawing container
      while (q + 9 <= limit) { q += 1; const end = q + 8 + tdv.getUint32(q + 4, true); if (end > limit) break; scan(q, end); q = end; }
      const n = Math.floor((lcbS - 4) / 30); const first = fcS + 4 * (n + 1);
      for (let i = 0; i < n && i < 2000; i++) {
        const o = first + i * 26; const cp = tdv.getUint32(fcS + i * 4, true); const lid = tdv.getUint32(o, true);
        const xl = tdv.getInt32(o + 4, true); const yt = tdv.getInt32(o + 8, true); const xr = tdv.getInt32(o + 12, true); const yb = tdv.getInt32(o + 16, true); const fl = tdv.getUint16(o + 20, true);
        const pr = shapes.get(lid); if (!pr || !pr[0x104] || xl < -3 || yt < -3) continue; // shapes without a picture, and anchors placed by alignment, are not shown
        const w = (xr - xl) / 15; const h = (yb - yt) / 15; if (!(w > 0 && h > 0)) continue;
        const pic = store[pr[0x104] - 1] ? store[pr[0x104] - 1]() : null; if (!pic || picBytes + pic.bytes.length > PIC_MAX) continue;
        picBytes += pic.bytes.length; const path = `media/shape${lid}.${pic.ext}`; media[path] = { bytes: pic.bytes, mime: pic.mime };
        const cr = (k) => Math.max(0, Math.min(99, (pr[k] || 0) / 655.36)); const emu = (k, d) => (pr[k] !== undefined ? pr[k] : d) / 9525;
        const wr = (fl >> 5) & 15; const crop = { t: cr(0x100), b: cr(0x101), l: cr(0x102), r: cr(0x103) };
        spaFloats.set(cp, {
          item: { t: 'pic', x: 0, y: 0, w, h, rot: 0, path, line: null, crop: crop.t || crop.b || crop.l || crop.r ? crop : null },
          h: { rel: ['margin', 'page', 'column'][(fl >> 1) & 3] || 'column', align: null, off: xl / 15 }, v: { rel: ['margin', 'page', 'paragraph'][(fl >> 3) & 3] || 'paragraph', align: null, off: yt / 15 },
          wrap: wr === 3 ? 'none' : wr === 1 ? 'topandbottom' : 'square', behind: wr === 3 && ((fl >> 14) & 1) === 1,
          dist: { l: emu(0x384, 114300), r: emu(0x386, 114300), t: emu(0x385, 0), b: emu(0x387, 0) }
        });
      }
    }
  } catch { /* floating pictures are left out */ }

  // paragraph formatting: each paragraph has a style and modifiers of its own
  const pprops = []; const ppIx = new Map(); const papAt = new Int32Array(raw.length).fill(-1);
  try {
    const fcP = u32(0x102); const lcbP = u32(0x106);
    const nP = lcbP >= 12 ? Math.floor((lcbP - 4) / 8) : 0;
    if (nP && fcP + lcbP <= table.length) {
      for (let i = 0; i < nP; i++) {
        const off = (tdv.getUint32(fcP + (nP + 1) * 4 + i * 4, true) & 0x3fffff) * 512;
        if (off + 512 > wd.length) continue;
        const crun = wd[off + 511]; if (crun < 1 || (crun + 1) * 4 + crun * 13 > 511) continue;
        const dvk = new DataView(wd.buffer, wd.byteOffset + off, 512);
        for (let r = 0; r < crun; r++) {
          const bo = wd[off + (crun + 1) * 4 + r * 13]; let istd = 0; const dp = {};
          if (bo) {
            const px = off + bo * 2; let cb = wd[px]; let a; let size;
            if (cb === 0) { size = wd[px + 1] * 2; a = px + 2; } else { size = cb * 2 - 1; a = px + 1; }
            if (size >= 2 && a + size <= off + 512) { istd = wd[a] | (wd[a + 1] << 8); eachSprm(wd, a + 2, a + size, (op, d, ln) => applyPap(dp, op, d, wd, ln)); }
          }
          const key = `${istd}|${JSON.stringify(dp)}`;
          let id = ppIx.get(key); if (id === undefined) { id = pprops.length; pprops.push({ istd, dp }); ppIx.set(key, id); }
          const a0 = dvk.getUint32(r * 4, true); const a1 = dvk.getUint32((r + 1) * 4, true);
          for (const pc of pieces) {
            const unit = pc.uni ? 2 : 1; const pS = pc.fc; const pE = pc.fc + pc.len * unit; const lo = Math.max(a0, pS); const hi = Math.min(a1, pE); if (lo >= hi) continue;
            const c0 = pc.cp + Math.floor((lo - pS) / unit); const c1 = Math.min(raw.length, pc.cp + Math.ceil((hi - pS) / unit));
            for (let c = c0; c < c1; c++) papAt[c] = id;
          }
        }
      }
    }
  } catch { /* paragraphs are shown without their formatting */ }

  // fields keep the shown result and drop the instruction (0x13 begin, 0x14 separator, 0x15 end)
  const ch = []; const pi = []; const qa = []; const ri = []; const stack = [];
  for (let k = 0; k < raw.length; k++) {
    const c = raw[k];
    if (c === '\x13') { stack.push({ shown: false }); continue; }
    if (c === '\x14') { if (stack.length) stack[stack.length - 1].shown = true; continue; }
    if (c === '\x15') { stack.pop(); continue; }
    if (stack.length && !stack[stack.length - 1].shown) continue;
    ch.push(c); pi.push(chpAt[k]); qa.push(papAt[k]); ri.push(k);
  }
  // 0x07 ends a table cell, and twice in a row ends a table row: cells become tab stops, rows become lines
  const oc = []; const op = []; const oq = []; const ofl = new Map();
  for (let k = 0; k < ch.length; k++) {
    const c = ch[k]; const n0 = oc.length;
    if (c === '\x07') oc.push('\x07'); // a cell or row mark: told apart below by the paragraph's own formatting
    else if (c === '\x08' && spaFloats.has(ri[k])) { ofl.set(oc.length, spaFloats.get(ri[k])); oc.push('\x08'); } // the anchor of a floating picture
    else if (c === '\x01' && props[pi[k]] && props[pi[k]].spec && props[pi[k]].pic !== undefined && !props[pi[k]].ole && !props[pi[k]].fdata) oc.push('\x01'); // a picture mark
    else if (c === '\x01' || c === '\x02' || c === '\x05' || c === '\x08' || c === '\x1f') continue;
    else if (c === '\x1e') oc.push('-'); else if (c === '\x0b') oc.push('\n'); else oc.push(c);
    if (oc.length > n0) { op.push(pi[k]); oq.push(qa[k]); }
  }

  let truncated = false;
  const blocks = [];
  const base = { font: 'Calibri', size: 15 };
  let runs = []; let cur = null; let curP = -2; let curQ = -1;
  const effective = new Map(); // the run properties of a paragraph style and a run, made once
  const runProps = (istd, ci) => {
    const key = `${istd}|${ci}`; let v = effective.get(key); if (v) return v;
    const direct = ci >= 0 ? { ...props[ci] } : {}; const cs = direct.cs; delete direct.cs;
    v = { ...styleOf(istd).chp, ...(cs ? styleOf(cs).chp : {}), ...direct };
    for (const k of ['spec', 'pic', 'ole', 'fdata']) delete v[k];
    effective.set(key, v); return v;
  };
  const paraPr = (q) => { const pp = q >= 0 ? pprops[q] : null; const st = styleOf(pp ? pp.istd : 0).pap; return { ...st, ...(pp ? pp.dp : {}) }; };
  const TABLE_KEYS = ['inTable', 'ttp', 'tdef', 'tb', 'tshd'];
  const cleanPr = (pr) => { const o = { ...pr }; for (const k of TABLE_KEYS) delete o[k]; return o; };
  // tables: a cell ends with a mark in a paragraph that is "in a table", a row with a mark in a paragraph that ends a row and says how the row is built
  let rows = []; let rowDefs = []; let cells = []; let cellBlocks = [];
  const emptyP = () => ({ t: 'p', level: 0, list: null, pr: {}, runs: [], sectEnd: undefined });
  const buildRow = (def) => {
    const row = []; let ci = 0;
    if (def.tdef && def.tdef.tcs.length) {
      const td = def.tdef;
      for (let i = 0; i < td.tcs.length; i++) {
        const g = td.tcs[i].grf;
        if ((g & 0x0002) && row.length) { row[row.length - 1].x1 = td.centers[i + 1]; continue; } // joined to the cell before it
        const src = cells[ci++] || { blocks: [emptyP()] };
        const va = (g >> 7) & 3;
        row.push({ span: 1, col: row.length, x0: td.centers[i], x1: td.centers[i + 1], vm: g & 0x40 ? 'restart' : g & 0x20 ? 'cont' : null, bg: (def.tshd && def.tshd[i]) || null, borders: td.tcs[i].borders, valign: va === 1 ? 'center' : va === 2 ? 'bottom' : undefined, width: undefined, blocks: src.blocks });
      }
    } else cells.forEach((c, i) => row.push({ span: 1, col: i, vm: null, bg: null, borders: undefined, valign: undefined, width: undefined, blocks: c.blocks }));
    return row;
  };
  const flushTable = () => {
    if (!rows.length) return;
    // one grid for the whole table from every cell boundary; a cell spans the grid columns between its own boundaries
    const xs = []; for (const r of rows) for (const c of r) if (c.x0 !== undefined) xs.push(c.x0, c.x1);
    xs.sort((a, b) => a - b); const bounds = []; for (const x of xs) if (!bounds.length || x - bounds[bounds.length - 1] > 30) bounds.push(x);
    const at = (x) => { let b = 0; for (let i = 0; i < bounds.length; i++) if (Math.abs(bounds[i] - x) < Math.abs(bounds[b] - x)) b = i; return b; };
    for (const r of rows) for (const c of r) if (c.x0 !== undefined) { c.col = at(c.x0); c.span = Math.max(1, at(c.x1) - c.col); }
    for (let ri = 0; ri < rows.length; ri++) for (const cell of rows[ri]) {
      if (cell.vm !== 'restart') continue;
      let n = 1;
      for (let k = ri + 1; k < rows.length; k++) { const nx = rows[k].find((x) => x.col === cell.col); if (nx && nx.vm === 'cont') { nx.skip = true; n++; } else break; }
      cell.rowSpan = n;
    }
    const grid = bounds.length > 1 ? bounds.slice(1).map((x, i) => Math.max(0, (x - bounds[i]) / 15)) : [];
    const tb = (rowDefs.find((d) => d.tb) || {}).tb || {};
    blocks.push({ t: 'table', rows, rowBrk: rows.map(() => false), borders: { t: tb.t, l: tb.l, b: tb.b, r: tb.r, h: tb.h, v: tb.v }, grid, pct: null, pad: { t: 0, l: 7.2, r: 7.2, b: 0 }, align: undefined });
    rows = []; rowDefs = [];
  };
  const endPara = (q) => {
    const pr0 = paraPr(q); const pr = cleanPr(pr0); let list = null;
    const lm = lists && pr0.ilfo > 0 && pr0.ilfo <= 2000 ? lists.marker(pr0.ilfo, Math.min(8, pr0.ilvl || 0)) : null;
    if (lm) { // the list sets the indents, the paragraph's own modifiers win; the marker takes the first run's look, then the list's
      const dp = q >= 0 && pprops[q] ? pprops[q].dp : {};
      if (lm.l !== undefined && dp.l === undefined) pr.l = lm.l;
      if (lm.first !== undefined && dp.first === undefined) pr.first = lm.first;
      const t = runs.find((x) => x.text);
      list = { marker: lm.text, level: lm.level, ilfo: pr0.ilfo, fmt: { ...(t ? { font: t.font, size: t.size, b: t.b, i: t.i, color: t.color } : { font: base.font, size: base.size }), ...lm.chp }, hang: pr.first < 0 ? -pr.first : 0 };
    }
    delete pr.ilfo; delete pr.ilvl;
    const blk = { t: 'p', level: pr.outline || 0, list, pr, runs, sectEnd: undefined };
    if (pr0.inTable) cellBlocks.push(blk); else { flushTable(); blocks.push(blk); }
    runs = []; cur = null; curP = -2;
  };
  const addChar = (c, k) => {
    curQ = oq[k];
    if (c === '\n') { runs.push({ br: true }); cur = null; curP = -2; return; }
    if (op[k] !== curP || !cur) { const pp = curQ >= 0 ? pprops[curQ] : null; cur = { ...base, ...runProps(pp ? pp.istd : 0, op[k]), text: '' }; runs.push(cur); curP = op[k]; }
    cur.text += c;
  };
  for (let k = 0; k < oc.length; k++) {
    if (blocks.length + rows.length >= DOC_BLOCK_MAX) { truncated = true; break; }
    const c = oc[k];
    if (c === '\r') { endPara(oq[k]); continue; }
    if (c === '\x08') { runs.push({ float: ofl.get(k) }); curQ = oq[k]; cur = null; curP = -2; continue; }
    if (c === '\x01') { // a picture: its own run in the line
      const pc = readPic(props[op[k]].pic);
      if (pc) { curQ = oq[k]; runs.push({ img: pc.path, w: pc.w, h: pc.h }); cur = null; curP = -2; }
      continue;
    }
    if (c === '\x07') {
      const pr0 = paraPr(oq[k]);
      if (pr0.ttp) { rows.push(buildRow(pr0)); rowDefs.push(pr0); cells = []; cellBlocks = []; runs = []; cur = null; curP = -2; }
      else if (pr0.inTable) { endPara(oq[k]); cells.push({ blocks: cellBlocks.length ? cellBlocks : [emptyP()] }); cellBlocks = []; }
      else if (oc[k + 1] === '\x07') { endPara(oq[k]); k++; } // a file whose table marks cannot be told apart: a row is a line, a cell a tab stop
      else addChar('\t', k);
      continue;
    }
    addChar(c, k);
  }
  if (!truncated && oc.length && oc[oc.length - 1] !== '\r' && oc[oc.length - 1] !== '\x07') endPara(curQ);
  flushTable();
  const page = { w: 816, h: 1056, t: 96, r: 96, b: 96, l: 96, hd: 48, ft: 48 };
  const none = { default: undefined, first: undefined, even: undefined };
  return {
    kind: 'docx', blocks, numDefs: lists ? lists.used() : {}, media, truncated, page, header: [], footer: [], footnotes: [], embedded: [],
    sections: [{ page, type: 'nextPage', titlePg: false, pgStart: null, pgFmt: null, hdr: { ...none }, ftr: { ...none } }],
    evenOdd: false, storedPages: 0, timing: { unzip: 0, parse: 0, read: 0 },
    notice: 'Text, character and paragraph formatting, tables, lists and JPEG, PNG and bitmap pictures only: other pictures, headers, footers and page layout of this old Word file are not shown.'
  };
}
