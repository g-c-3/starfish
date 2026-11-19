// office-blip.js — reads one picture block (JPEG, PNG or bitmap) of an Office drawing store (Decisions 511, 517, 520). The block
// is a record header, a picture id (16 bytes, 32 when the instance says two ids), a tag byte and the data. Metafile and other
// formats are not read. A bitmap without its file header gets one in front.

export function blipAt(buf, o) {
  if (!buf || o < 0 || o + 8 > buf.length) return null;
  const bv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const inst = bv.getUint16(o, true) >> 4; const type = bv.getUint16(o + 2, true); const len = bv.getUint32(o + 4, true);
  if (o + 8 + len > buf.length) return null;
  const two = { 0xf01d: [0x46b, 0x6e3], 0xf01e: [0x6e1], 0xf01f: [0x7a9] }[type]; if (!two) return null;
  const at = o + 8 + (two.includes(inst) ? 32 : 16) + 1; const end = o + 8 + len; if (at >= end) return null;
  const data = buf.subarray(at, end);
  if (type === 0xf01d) return { bytes: data, mime: 'image/jpeg', ext: 'jpg' };
  if (type === 0xf01e) return { bytes: data, mime: 'image/png', ext: 'png' };
  if (data.length < 40) return null;
  const d2 = new DataView(data.buffer, data.byteOffset, data.byteLength); const hs = d2.getUint32(0, true); const bpp = d2.getUint16(14, true);
  const used = d2.getUint32(32, true); const pal = bpp <= 8 ? (used || 1 << bpp) * 4 : (d2.getUint32(16, true) === 3 && hs === 40 ? 12 : 0);
  const out = new Uint8Array(14 + data.length); const ov = new DataView(out.buffer);
  out[0] = 0x42; out[1] = 0x4d; ov.setUint32(2, out.length, true); ov.setUint32(10, 14 + hs + pal, true); out.set(data, 14);
  return { bytes: out, mime: 'image/bmp', ext: 'bmp' };
}
