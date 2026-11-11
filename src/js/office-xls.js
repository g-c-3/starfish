// office-xls.js — view-only reader for xls, the Excel 97 to 2003 format (Decision 455). The workbook stream of an OLE2 file is
// a list of records; cells, formats, styles, merges and sizes become the same model as readXlsx, so office-render.js draws it
// unchanged. Formula cells show the value stored in the file; nothing is recalculated. Older Excel 5 and 95 files are refused.

import { OfficeError, formatValue, SHEET_ROW_MAX, SHEET_COL_MAX } from './office-read.js';
import { readOle2, isOle2 } from './ole2.js';

const PX_PT = 4 / 3;
const PALETTE = ['000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF', '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
  '800000', '008000', '000080', '808000', '800080', '008080', 'C0C0C0', '808080', '9999FF', '993366', 'FFFFCC', 'CCFFFF', '660066', 'FF8080', '0066CC', 'CCCCFF',
  '000080', 'FF00FF', 'FFFF00', '00FFFF', '800080', '800000', '008080', '0000FF', '00CCFF', 'CCFFFF', 'CCFFCC', 'FFFF99', '99CCFF', 'FF99CC', 'CC99FF', 'FFCC99',
  '3366FF', '33CCCC', '99CC00', 'FFCC00', 'FF9900', 'FF6600', '666699', '969696', '003366', '339966', '003300', '333300', '993300', '993366', '333399', '333333'];
const BUILTIN = { 0: 'General', 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%', 11: '0.00E+00', 12: '# ?/?', 13: '# ??/??', 14: 'yyyy-mm-dd', 15: 'd-mmm-yy', 16: 'd-mmm', 17: 'mmm-yy', 18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM', 20: 'h:mm', 21: 'h:mm:ss', 22: 'yyyy-mm-dd h:mm', 37: '#,##0;(#,##0)', 38: '#,##0;[Red](#,##0)', 39: '#,##0.00;(#,##0.00)', 40: '#,##0.00;[Red](#,##0.00)', 45: 'mm:ss', 46: '[h]:mm:ss', 47: 'mm:ss.0', 48: '##0.0E+0', 49: '@' };
const ERRORS = { 0: '#NULL!', 7: '#DIV/0!', 15: '#VALUE!', 23: '#REF!', 29: '#NAME?', 36: '#NUM!', 42: '#N/A' };
const isDateCode = (code) => { const c = String(code).replace(/"[^"]*"|\\.|\[[^\]]*\]|_.|\*./g, ''); return /[ymdhs]/i.test(c) && !/^general$/i.test(code); };

// ---- text from a record ----
const latin = (b, o, n) => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(b[o + i]); return s; };
const utf16 = (b, o, n) => { let s = ''; for (let i = 0; i + 1 < n * 2; i += 2) s += String.fromCharCode(b[o + i] | (b[o + i + 1] << 8)); return s; };

// an XLUnicodeString inside one record: length u16 (or u8), flags, characters; returns { text, end }
function ustr(b, o, lenBytes = 2) {
  const n = lenBytes === 2 ? b[o] | (b[o + 1] << 8) : b[o];
  const flags = b[o + lenBytes];
  let p = o + lenBytes + 1;
  let runs = 0; let ext = 0;
  if (flags & 0x08) { runs = b[p] | (b[p + 1] << 8); p += 2; }
  if (flags & 0x04) { ext = b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24); p += 4; }
  const wide = flags & 1;
  const text = wide ? utf16(b, p, n) : latin(b, p, n);
  return { text, end: p + (wide ? n * 2 : n) + runs * 4 + ext };
}

// the shared string table, whose strings may continue across CONTINUE records
function readSst(chunks) {
  const out = [];
  let ci = 0; let pos = 8; // the first 8 bytes are the two counts
  const cur = () => chunks[ci];
  const next = () => { ci++; pos = 0; return ci < chunks.length; };
  const u8 = () => { while (ci < chunks.length && pos >= cur().length) next(); if (ci >= chunks.length) return 0; return cur()[pos++]; };
  const total = chunks[0][4] | (chunks[0][5] << 8) | (chunks[0][6] << 16) | (chunks[0][7] << 24);
  const skip = (n) => { while (n > 0 && ci < chunks.length) { const take = Math.min(n, cur().length - pos); pos += take; n -= take; if (pos >= cur().length) next(); } };
  while (out.length < total && ci < chunks.length) {
    if (pos >= cur().length && !next()) break;
    const n = u8() | (u8() << 8);
    const flags = u8();
    let runs = 0; let ext = 0;
    if (flags & 0x08) runs = u8() | (u8() << 8);
    if (flags & 0x04) ext = u8() | (u8() << 8) | (u8() << 16) | (u8() << 24);
    let wide = flags & 1; let s = '';
    let left = n;
    while (left > 0 && ci < chunks.length) {
      if (pos >= cur().length) { if (!next()) break; wide = cur()[pos++] & 1; continue; } // a new chunk restates the width
      const size = wide ? 2 : 1;
      const avail = Math.floor((cur().length - pos) / size);
      const take = Math.min(left, avail);
      if (take <= 0) { pos = cur().length; continue; }
      s += wide ? utf16(cur(), pos, take) : latin(cur(), pos, take);
      pos += take * size; left -= take;
    }
    skip(runs * 4 + ext);
    out.push(s);
  }
  return out;
}

function rkValue(rk) {
  let v;
  if (rk & 2) v = rk >> 2;
  else { const b = new DataView(new ArrayBuffer(8)); b.setUint32(4, rk & 0xfffffffc, true); v = b.getFloat64(0, true); }
  return rk & 1 ? v / 100 : v;
}

export function isXls(bytes) { return isOle2(bytes); }

export function readXls(bytes) {
  const ole = readOle2(bytes);
  const wb = ole.stream('Workbook') || ole.stream('Book');
  if (!wb) throw new OfficeError('This is not a valid file of this type.');
  const dv = new DataView(wb.buffer, wb.byteOffset, wb.byteLength);
  const u16 = (o) => dv.getUint16(o, true);
  const u32 = (o) => dv.getUint32(o, true);
  const f64 = (o) => dv.getFloat64(o, true);

  // records of one stream from `from` until the matching EOF
  function* records(from, until) {
    let o = from;
    while (o + 4 <= wb.length && (until === undefined || o < until)) {
      const id = u16(o); const len = u16(o + 2);
      yield { id, o: o + 4, len, data: wb.subarray(o + 4, o + 4 + len) };
      o += 4 + len;
    }
  }

  // ---- workbook globals ----
  let is1904 = false; let encrypted = false;
  const palette = PALETTE.slice();
  const fonts = []; const formats = {}; const xfRaw = []; const sheets = []; let sst = [];
  let version = 0;
  {
    let sstChunks = null; let first = true;
    for (const r of records(0)) {
      if (r.id === 0x809) { if (first) version = u16(r.o); first = false; if (version !== 0x600) throw new OfficeError('This old Excel version is not supported here.'); }
      else if (r.id === 0x2f) encrypted = true;
      else if (r.id === 0x22) is1904 = u16(r.o) === 1;
      else if (r.id === 0x92) { const n = u16(r.o); for (let i = 0; i < n && i < 56; i++) { const p = r.o + 2 + i * 4; palette[8 + i] = [wb[p], wb[p + 1], wb[p + 2]].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase(); } }
      else if (r.id === 0x31) {
        const d = r.data; const name = ustr(d, 14, 1).text;
        fonts.push({ name: name || 'Arial', size: (d[0] | (d[1] << 8)) / 20, i: !!(d[2] & 2), s: !!(d[2] & 8), color: u16(r.o + 4), b: u16(r.o + 6) >= 700, u: d[10] > 0 });
        if (fonts.length === 4) fonts.push(fonts[0]); // font index 4 is never used
      } else if (r.id === 0x41e) formats[u16(r.o)] = ustr(r.data, 2, 2).text;
      else if (r.id === 0xe0) xfRaw.push({ font: u16(r.o), fmt: u16(r.o + 2), d: r.data });
      else if (r.id === 0x85) {
        const state = wb[r.o + 4]; const type = wb[r.o + 5];
        sheets.push({ off: u32(r.o), hidden: state !== 0, type, name: ustr(r.data, 6, 1).text });
      } else if (r.id === 0xfc) sstChunks = [r.data];
      else if (r.id === 0x3c && sstChunks) sstChunks.push(r.data);
      else if (r.id === 0x0a) { if (sstChunks) sst = readSst(sstChunks); break; }
      else if (sstChunks && r.id !== 0x3c) { sst = readSst(sstChunks); sstChunks = null; }
    }
  }
  if (encrypted) throw new OfficeError('This file is protected or damaged.');
  const visible = sheets.filter((s) => !s.hidden && s.type === 0);
  if (!visible.length) throw new OfficeError('This workbook has no sheets to show.');

  const col = (i) => (i === 64 || i === 0x7fff ? '000000' : i === 65 ? 'FFFFFF' : palette[i] || null);
  const SIDE = { 1: 'thin', 2: 'medium', 3: 'dashed', 4: 'dotted', 5: 'medium', 6: 'double', 7: 'thin', 8: 'medium', 9: 'dashed', 10: 'medium', 11: 'dashed', 12: 'medium', 13: 'dashed' };
  const xfs = xfRaw.map((x) => {
    const d = x.d; const code = formats[x.fmt] !== undefined ? formats[x.fmt] : BUILTIN[x.fmt] || 'General';
    const f = fonts[x.font] || fonts[0] || { name: 'Arial', size: 10, b: false, i: false, u: false, s: false, color: 64 };
    const al = d[6]; const bits = (d[10] | (d[11] << 8) | (d[12] << 16) | (d[13] << 24)) >>> 0;
    const bits2 = (d[14] | (d[15] << 8) | (d[16] << 16) | (d[17] << 24)) >>> 0;
    const fill = ((bits2 >>> 26) & 0x3f) > 0 ? col((d[18] | (d[19] << 8)) & 0x7f) : null;
    const side = (st, ci) => (st && SIDE[st] ? { style: SIDE[st], color: col(ci) || '000000' } : null);
    const l = side(bits & 15, (bits >>> 16) & 0x7f); const r = side((bits >>> 4) & 15, (bits >>> 23) & 0x7f);
    const t = side((bits >>> 8) & 15, bits2 & 0x7f); const b = side((bits >>> 12) & 15, (bits2 >>> 7) & 0x7f);
    return {
      code, date: isDateCode(code), font: { name: f.name, size: f.size, b: f.b, i: f.i, u: f.u, s: f.s, color: f.color === 64 || f.color === 0x7fff ? null : col(f.color) },
      fill: fill === 'FFFFFF' ? null : fill, border: l || r || t || b ? { l, r, t, b } : null,
      h: ['general', 'left', 'center', 'right', 'left', 'justify', 'center', 'justify'][al & 7], v: ['top', 'center', 'bottom', 'top', 'top'][(al >> 4) & 7] || 'bottom',
      wrap: !!(al & 8), indent: d[8] & 15
    };
  });
  if (!xfs.length) xfs.push({ code: 'General', date: false, font: { name: 'Arial', size: 10, b: false, i: false, u: false, s: false, color: null }, fill: null, border: null, h: 'general', v: 'bottom', wrap: false, indent: 0 });

  const colPx = (w) => Math.round((w / 256) * 7 + 5);
  function load(i) {
    const sh = visible[i];
    if (!sh) throw new OfficeError('This sheet could not be read.');
    const rows = []; const colW = {}; const rowH = {}; const merges = [];
    let ncols = 0; let truncated = false; let cellCount = 0; let hasDrawing = false; let grid = true; let freeze = { rows: 0, cols: 0 }; let pane = null; let freezeOn = false;
    let depth = 0; let pendingFormula = null;
    const put = (r, c, text, xf, kind) => {
      if (r >= SHEET_ROW_MAX || cellCount > 100000) { truncated = true; return; }
      if (c >= SHEET_COL_MAX) { truncated = true; return; }
      const x = xfs[xf] || xfs[0];
      if (text === '' && !xf) return;
      (rows[r] = rows[r] || [])[c] = { v: text, s: xf < xfs.length ? xf : 0, k: kind }; cellCount++;
      if (text !== '' || x.fill || x.border) if (c + 1 > ncols) ncols = c + 1;
    };
    const num = (v, xf) => formatValue(String(v), (xfs[xf] || xfs[0]).code, is1904);
    for (const r of records(sh.off)) {
      if (r.id === 0x809) { depth++; continue; }
      if (r.id === 0x0a) { depth--; if (depth <= 0) break; continue; }
      if (depth !== 1) continue; // a chart or other nested stream
      const row = r.len >= 2 ? u16(r.o) : 0; const c0 = r.len >= 4 ? u16(r.o + 2) : 0; const xf = r.len >= 6 ? u16(r.o + 4) : 0;
      switch (r.id) {
        case 0x203: put(row, c0, num(f64(r.o + 6), xf), xf, 'n'); break;
        case 0x27e: put(row, c0, num(rkValue(u32(r.o + 6)), xf), xf, 'n'); break;
        case 0xbd: { const last = u16(r.o + r.len - 2); for (let c = c0, p = r.o + 4; c <= last && p + 6 <= r.o + r.len - 2; c++, p += 6) put(row, c, num(rkValue(u32(p + 2)), u16(p)), u16(p), 'n'); break; }
        case 0xfd: put(row, c0, sst[u32(r.o + 6)] ?? '', xf, 's'); break;
        case 0x204: put(row, c0, ustr(r.data, 6, 2).text, xf, 's'); break;
        case 0x205: put(row, c0, wb[r.o + 7] ? ERRORS[wb[r.o + 6]] || '#ERR' : wb[r.o + 6] ? 'TRUE' : 'FALSE', xf, 'b'); break;
        case 0x201: put(row, c0, '', xf, 's'); break;
        case 0xbe: { const last = u16(r.o + r.len - 2); for (let c = c0, p = r.o + 4; c <= last && p + 2 <= r.o + r.len - 2; c++, p += 2) put(row, c, '', u16(p), 's'); break; }
        case 0x06: { // the stored result; a text result follows in a STRING record
          if (u16(r.o + 12) === 0xffff) {
            const ty = wb[r.o + 6];
            if (ty === 0) pendingFormula = { row, c: c0, xf };
            else if (ty === 1) put(row, c0, wb[r.o + 8] ? 'TRUE' : 'FALSE', xf, 'b');
            else if (ty === 2) put(row, c0, ERRORS[wb[r.o + 8]] || '#ERR', xf, 'b');
          } else put(row, c0, num(f64(r.o + 6), xf), xf, 'n');
          break;
        }
        case 0x207: if (pendingFormula) { put(pendingFormula.row, pendingFormula.c, ustr(r.data, 0, 2).text, pendingFormula.xf, 's'); pendingFormula = null; } break;
        case 0xe5: { const n = u16(r.o); for (let k = 0; k < n && k < 5000; k++) { const p = r.o + 2 + k * 8; const r1 = u16(p); const r2 = u16(p + 2); const c1 = u16(p + 4); const c2 = u16(p + 6); if (r1 < SHEET_ROW_MAX && c1 < SHEET_COL_MAX) merges.push({ r: r1, c: c1, rs: r2 - r1 + 1, cs: Math.min(c2, SHEET_COL_MAX - 1) - c1 + 1 }); } break; }
        case 0x7d: { const a = u16(r.o); const z = u16(r.o + 2); const w = u16(r.o + 4); const hid = u16(r.o + 8) & 1; for (let c = a; c <= Math.min(z, SHEET_COL_MAX - 1); c++) colW[c] = hid ? 0 : colPx(w); break; }
        case 0x208: { const h = u16(r.o + 6); const opt = u32(r.o + 12); if (opt & 0x20) rowH[row] = 0; else if ((opt & 0x40) && h) rowH[row] = Math.round(((h & 0x7fff) / 20) * PX_PT); break; }
        case 0x23e: grid = !!(u16(r.o) & 0x02); freezeOn = !!(u16(r.o) & 0x08); break;
        case 0x41: pane = { x: u16(r.o), y: u16(r.o + 2) }; break;
        case 0xec: hasDrawing = true; break;
        default: break;
      }
    }
    if (freezeOn && pane) freeze = { rows: Math.min(pane.y, 20), cols: Math.min(pane.x, 10) };
    for (let k = 0; k < rows.length; k++) rows[k] = Array.from(rows[k] || []);
    return { rows, ncols, truncated, colW, defCol: 64, rowH, defRow: 20, merges, freeze, grid, objects: [], media: {}, hasDrawing };
  }
  return { kind: 'xlsx', names: visible.map((s) => s.name), load, xfs };
}
