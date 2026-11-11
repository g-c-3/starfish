// ole2.js — reads the streams of an OLE2 compound file (the container of xls, doc and ppt; Decision 455). Read only: nothing
// is written, and a stream is returned as plain bytes for the caller to parse.

import { OfficeError } from './office-read.js';

const SIG = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const FREE = 0xfffffffe;
const MAX_SECTORS = 4 * 1024 * 1024; // guards against a corrupt chain

export function isOle2(bytes) {
  if (!bytes || bytes.length < 512) return false;
  for (let i = 0; i < 8; i++) if (bytes[i] !== SIG[i]) return false;
  return true;
}

// Returns { stream(name) -> Uint8Array | null, names() }. Throws OfficeError when the container is damaged.
export function readOle2(bytes) {
  if (!isOle2(bytes)) throw new OfficeError('This is not a valid file of this type.');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (o) => dv.getUint16(o, true);
  const u32 = (o) => dv.getUint32(o, true);
  const shift = u16(30); const miniShift = u16(32);
  if (shift < 7 || shift > 16 || miniShift > shift) throw new OfficeError('This file is protected or damaged.');
  const ss = 1 << shift; const mss = 1 << miniShift;
  const secOff = (n) => (n + 1) * ss;
  const nFat = u32(44); const dirStart = u32(48); const miniCutoff = u32(56); const miniStart = u32(60); const nMiniFat = u32(64);
  const difStart = u32(68); const nDif = u32(72);

  // sector numbers of the FAT: the first 109 from the header, the rest from the DIFAT chain
  const fatSecs = [];
  for (let i = 0; i < 109 && fatSecs.length < nFat; i++) { const v = u32(76 + i * 4); if (v < FREE) fatSecs.push(v); }
  let d = difStart; let guard = 0;
  while (d < FREE && guard++ < nDif + 1 && secOff(d) + ss <= bytes.length) {
    const base = secOff(d);
    for (let i = 0; i < ss / 4 - 1 && fatSecs.length < nFat; i++) { const v = u32(base + i * 4); if (v < FREE) fatSecs.push(v); }
    d = u32(base + ss - 4);
  }
  const fat = [];
  for (const s of fatSecs) {
    const base = secOff(s);
    if (base + ss > bytes.length) throw new OfficeError('This file is protected or damaged.');
    for (let i = 0; i < ss / 4; i++) fat.push(u32(base + i * 4));
  }
  const chain = (start, table) => {
    const out = []; let s = start;
    while (s < FREE) {
      if (out.length > MAX_SECTORS || s >= table.length) throw new OfficeError('This file is protected or damaged.');
      out.push(s); s = table[s];
    }
    return out;
  };
  const readChain = (start, size) => {
    const secs = chain(start, fat);
    const out = new Uint8Array(secs.length * ss);
    secs.forEach((s, i) => { const o = secOff(s); out.set(bytes.subarray(o, Math.min(o + ss, bytes.length)), i * ss); });
    return size === undefined ? out : out.subarray(0, size);
  };

  // directory
  const dir = readChain(dirStart);
  const ddv = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
  const entries = [];
  for (let o = 0; o + 128 <= dir.length; o += 128) {
    const nl = ddv.getUint16(o + 64, true);
    const type = dir[o + 66];
    if (!type) { entries.push(null); continue; }
    let name = '';
    for (let i = 0; i < Math.max(0, nl / 2 - 1); i++) name += String.fromCharCode(ddv.getUint16(o + i * 2, true));
    entries.push({ name, type, start: ddv.getUint32(o + 116, true), size: ddv.getUint32(o + 120, true) });
  }
  const root = entries[0];
  if (!root) throw new OfficeError('This file is protected or damaged.');

  // streams under the cutoff live in the mini stream
  let mini = null; let miniFat = null;
  const loadMini = () => {
    if (mini) return;
    mini = readChain(root.start, root.size);
    const mf = readChain(miniStart, nMiniFat * ss);
    const dv2 = new DataView(mf.buffer, mf.byteOffset, mf.byteLength);
    miniFat = []; for (let i = 0; i + 4 <= mf.length; i += 4) miniFat.push(dv2.getUint32(i, true));
  };
  function stream(name) {
    const e = entries.find((x) => x && x.type === 2 && x.name === name);
    if (!e) return null;
    if (e.size >= miniCutoff) return readChain(e.start, e.size);
    loadMini();
    const secs = chain(e.start, miniFat);
    const out = new Uint8Array(secs.length * mss);
    secs.forEach((s, i) => out.set(mini.subarray(s * mss, s * mss + mss), i * mss));
    return out.subarray(0, e.size);
  }
  return { stream, names: () => entries.filter((x) => x && x.type === 2).map((x) => x.name) };
}
