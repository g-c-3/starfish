// office-doc.js — view-only reader for doc, the Word 97 to 2003 format (Decisions 451, 456, 507). Reads the piece table of the
// WordDocument stream, the style sheet, the paragraph formatting (PAPX) and the character formatting runs (CHPX), and returns the body
// as the same Word model as readDocx: text with bold, italic, underline, strike, caps, size, font, colour, highlight, super and
// subscript, and paragraphs with alignment, indents, spacing and heading level, from the styles and from the paragraph itself.
// No tables, lists, pictures, headers or footers yet: the model carries a notice that says so. Older Word 6 and 95 files and password-protected
// files are refused.

import { OfficeError, DOC_BLOCK_MAX } from './office-read.js';
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
    if (len === -1) { if (d >= end) return; len = b[d]; d += 1; }
    if (d + len > end) return;
    fn(op, d); o = d + len;
  }
}
const flag = (v) => (v === 0 ? false : v === 1 ? true : undefined); // 0x80 and 0x81 depend on the style, which is not read yet
const s16 = (b, d) => ((b[d] | (b[d + 1] << 8)) << 16) >> 16;
const u16b = (b, d) => b[d] | (b[d + 1] << 8);
// one paragraph property modifier applied to a paragraph property object (twips become pixels, one pixel is 15 twips)
function applyPap(pr, op, d, b) {
  switch (op) {
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
          if (stk === 1 && k === 0) eachSprm(table, dd + 2, en, (op, d) => applyPap(pap, op, d, table));
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
            if (size >= 2 && a + size <= off + 512) { istd = wd[a] | (wd[a + 1] << 8); eachSprm(wd, a + 2, a + size, (op, d) => applyPap(dp, op, d, wd)); }
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
  const ch = []; const pi = []; const qa = []; const stack = [];
  for (let k = 0; k < raw.length; k++) {
    const c = raw[k];
    if (c === '\x13') { stack.push({ shown: false }); continue; }
    if (c === '\x14') { if (stack.length) stack[stack.length - 1].shown = true; continue; }
    if (c === '\x15') { stack.pop(); continue; }
    if (stack.length && !stack[stack.length - 1].shown) continue;
    ch.push(c); pi.push(chpAt[k]); qa.push(papAt[k]);
  }
  // 0x07 ends a table cell, and twice in a row ends a table row: cells become tab stops, rows become lines
  const oc = []; const op = []; const oq = [];
  for (let k = 0; k < ch.length; k++) {
    const c = ch[k]; const n0 = oc.length;
    if (c === '\x07') { if (ch[k + 1] === '\x07') { oc.push('\r'); k++; } else oc.push('\t'); }
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
    v = { ...styleOf(istd).chp, ...(cs ? styleOf(cs).chp : {}), ...direct }; effective.set(key, v); return v;
  };
  const paraPr = (q) => { const pp = q >= 0 ? pprops[q] : null; const st = styleOf(pp ? pp.istd : 0).pap; return { ...st, ...(pp ? pp.dp : {}) }; };
  const endPara = (q) => { const pr = paraPr(q); blocks.push({ t: 'p', level: pr.outline || 0, list: null, pr, runs, sectEnd: undefined }); runs = []; cur = null; curP = -2; };
  for (let k = 0; k < oc.length; k++) {
    if (blocks.length >= DOC_BLOCK_MAX) { truncated = true; break; }
    const c = oc[k];
    if (c === '\r') { endPara(oq[k]); continue; }
    curQ = oq[k];
    if (c === '\n') { runs.push({ br: true }); cur = null; curP = -2; continue; }
    if (op[k] !== curP || !cur) { const pp = curQ >= 0 ? pprops[curQ] : null; cur = { ...base, ...runProps(pp ? pp.istd : 0, op[k]), text: '' }; runs.push(cur); curP = op[k]; }
    cur.text += c;
  }
  if (!truncated && oc.length && oc[oc.length - 1] !== '\r') endPara(curQ);
  const page = { w: 816, h: 1056, t: 96, r: 96, b: 96, l: 96, hd: 48, ft: 48 };
  const none = { default: undefined, first: undefined, even: undefined };
  return {
    kind: 'docx', blocks, media: {}, truncated, page, header: [], footer: [], footnotes: [], embedded: [],
    sections: [{ page, type: 'nextPage', titlePg: false, pgStart: null, pgFmt: null, hdr: { ...none }, ftr: { ...none } }],
    evenOdd: false, storedPages: 0, timing: { unzip: 0, parse: 0, read: 0 },
    notice: 'Text, character and paragraph formatting only: tables, lists, pictures, headers, footers and page layout of this old Word file are not shown.'
  };
}
