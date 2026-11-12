// office-doc.js — view-only text reader for doc, the Word 97 to 2003 format (Decisions 451, 456). Reads the piece table of the
// WordDocument stream and returns the body text as the same Word model as readDocx. No layout, tables, pictures, headers or
// footers: the model carries a notice that says so. Older Word 6 and 95 files and password-protected files are refused.

import { OfficeError, DOC_BLOCK_MAX } from './office-read.js';
import { readOle2, isOle2 } from './ole2.js';

export function isDoc(bytes) { return isOle2(bytes); }

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
    } else {
      const off = fcRaw;
      if (off + len * 2 > wd.length) throw new OfficeError('This file is protected or damaged.');
      for (let k = 0; k < len; k++) s += String.fromCharCode(wd[off + k * 2] | (wd[off + k * 2 + 1] << 8));
    }
    parts.push(s); got += len;
  }
  let text = parts.join('');

  // fields: keep the shown result, drop the instruction (0x13 begin, 0x14 separator, 0x15 end)
  if (text.indexOf('\x13') >= 0) {
    let out = ''; const stack = [];
    for (const ch of text) {
      if (ch === '\x13') stack.push({ shown: false });
      else if (ch === '\x14') { if (stack.length) stack[stack.length - 1].shown = true; }
      else if (ch === '\x15') stack.pop();
      else if (!stack.length || stack[stack.length - 1].shown) out += ch;
    }
    text = out;
  }
  // 0x07 ends a table cell, and twice in a row ends a table row: cells become tab stops, rows become lines
  text = text.replace(/\x07\x07/g, '\r').replace(/\x07/g, '\t')
    .replace(/[\x01\x02\x05\x08]/g, '').replace(/\x1e/g, '-').replace(/\x1f/g, '').replace(/\x0b/g, '\n');

  const lines = text.split('\r');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  let truncated = false;
  const blocks = [];
  const base = { font: 'Calibri', size: 15 };
  for (const line of lines) {
    if (blocks.length >= DOC_BLOCK_MAX) { truncated = true; break; }
    const runs = [];
    line.split('\n').forEach((part, k) => { if (k) runs.push({ br: true }); if (part) runs.push({ ...base, text: part }); });
    blocks.push({ t: 'p', level: 0, list: null, pr: {}, runs, sectEnd: undefined });
  }
  const page = { w: 816, h: 1056, t: 96, r: 96, b: 96, l: 96, hd: 48, ft: 48 };
  const none = { default: undefined, first: undefined, even: undefined };
  return {
    kind: 'docx', blocks, media: {}, truncated, page, header: [], footer: [], footnotes: [], embedded: [],
    sections: [{ page, type: 'nextPage', titlePg: false, pgStart: null, pgFmt: null, hdr: { ...none }, ftr: { ...none } }],
    evenOdd: false, storedPages: 0, timing: { unzip: 0, parse: 0, read: 0 },
    notice: 'Text only: layout, tables, pictures, headers and footers of this old Word file are not shown.'
  };
}
