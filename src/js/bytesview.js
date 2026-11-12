// bytesview.js — the byte view for a file with no viewer, or one that is not text (Decision 467): its size, a guess at the type from the
// first bytes, and a hex dump of the start. Read only; nothing leaves the phone. Needs only the head of the file.
import '../css/bytesview.css';

export const HEAD_MAX = 256 * 1024; // the most of the start that is read and shown
export const BYTES_MAX = 64 * 1024 * 1024; // a whole file read into memory (the Files viewer) stops here; the explorer reads only the head
const STEP = 4096;
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const ascii = (b, o, n) => { let s = ''; for (let i = 0; i < n && o + i < b.length; i++) s += String.fromCharCode(b[o + i]); return s; };
const startsWith = (b, sig, o = 0) => sig.every((v, i) => b[o + i] === v);
const size = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(2)} GB`);

const SIGS = [ // [bytes, label, offset]
  [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'PNG image'], [[0xff, 0xd8, 0xff], 'JPEG image'], [[0x47, 0x49, 0x46, 0x38], 'GIF image'],
  [[0x42, 0x4d], 'BMP image (maybe)'], [[0x49, 0x49, 0x2a, 0x00], 'TIFF image'], [[0x4d, 0x4d, 0x00, 0x2a], 'TIFF image'], [[0x00, 0x00, 0x01, 0x00], 'Windows icon'],
  [[0x25, 0x50, 0x44, 0x46], 'PDF document'], [[0x25, 0x21], 'PostScript'], [[0x7b, 0x5c, 0x72, 0x74, 0x66], 'Rich Text (RTF) document'],
  [[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 'Old Office file (doc, xls, ppt) or installer package'],
  [[0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], '7-Zip archive'], [[0x52, 0x61, 0x72, 0x21, 0x1a, 0x07], 'RAR archive'], [[0x1f, 0x8b], 'Gzip compressed data'],
  [[0x42, 0x5a, 0x68], 'Bzip2 compressed data'], [[0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00], 'XZ compressed data'], [[0x28, 0xb5, 0x2f, 0xfd], 'Zstandard compressed data'],
  [[0x75, 0x73, 0x74, 0x61, 0x72], 'Tar archive', 257],
  [[0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, 0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00], 'SQLite database'],
  [[0x49, 0x44, 0x33], 'MP3 audio (with tags)'], [[0xff, 0xfb], 'MP3 audio'], [[0x4f, 0x67, 0x67, 0x53], 'Ogg audio or video'], [[0x66, 0x4c, 0x61, 0x43], 'FLAC audio'],
  [[0x4d, 0x54, 0x68, 0x64], 'MIDI music'], [[0x1a, 0x45, 0xdf, 0xa3], 'Matroska or WebM video'], [[0x46, 0x4c, 0x56, 0x01], 'Flash video'],
  [[0x7f, 0x45, 0x4c, 0x46], 'Executable (ELF)'], [[0x4d, 0x5a], 'Windows program (EXE or DLL)'], [[0xca, 0xfe, 0xba, 0xbe], 'Java class or universal Mac program'],
  [[0x64, 0x65, 0x78, 0x0a], 'Android program code (DEX)'], [[0x77, 0x4f, 0x46, 0x46], 'WOFF font'], [[0x77, 0x4f, 0x46, 0x32], 'WOFF2 font'],
  [[0x00, 0x01, 0x00, 0x00, 0x00], 'TrueType font'], [[0x4f, 0x54, 0x54, 0x4f], 'OpenType font'], [[0x3c, 0x3f, 0x78, 0x6d, 0x6c], 'XML text'],
  [[0x42, 0x45, 0x47, 0x49, 0x4e, 0x3a, 0x56, 0x43], 'vCard contact'], [[0x23, 0x21], 'Script (starts with #!)']
];
const BRANDS = { heic: 'HEIC image', heix: 'HEIC image', mif1: 'HEIF image', msf1: 'HEIF image', avif: 'AVIF image', 'M4A ': 'M4A audio', 'M4B ': 'M4B audiobook', 'qt  ': 'QuickTime video', 'M4V ': 'M4V video', isom: 'MP4 video', iso2: 'MP4 video', mp41: 'MP4 video', mp42: 'MP4 video', avc1: 'MP4 video' };

// the first entry of a zip says what it holds
function zipKind(b) {
  const n = b[26] | (b[27] << 8), x = b[28] | (b[29] << 8), name = ascii(b, 30, Math.min(n, 120));
  if (name === 'mimetype') {
    const mime = ascii(b, 30 + n + x, 80);
    if (mime.startsWith('application/epub+zip')) return 'EPUB book (zip)';
    if (mime.startsWith('application/vnd.oasis.opendocument.text')) return 'OpenDocument text (odt)';
    if (mime.startsWith('application/vnd.oasis.opendocument.spreadsheet')) return 'OpenDocument spreadsheet (ods)';
    if (mime.startsWith('application/vnd.oasis.opendocument.presentation')) return 'OpenDocument presentation (odp)';
    return 'OpenDocument file (zip)';
  }
  if (name === '[Content_Types].xml') return 'Office document (docx, xlsx or pptx; a zip)';
  if (name.startsWith('META-INF/')) return 'Java archive or Android package (zip)';
  if (name === 'AndroidManifest.xml') return 'Android package (zip)';
  return 'Zip archive';
}
// the text check: valid UTF-8, almost all printable, or a UTF-16 mark
function textKind(b) {
  if (b.length >= 2 && ((b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff))) return 'Text (UTF-16)';
  const n = Math.min(b.length, 8192); if (!n) return null;
  let s; try { s = new TextDecoder('utf-8', { fatal: true }).decode(b.subarray(0, n)); } catch { if (n === b.length) return null; try { s = new TextDecoder('utf-8', { fatal: true }).decode(b.subarray(0, n - 3)); } catch { return null; } }
  let bad = 0; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c < 32 && c !== 9 && c !== 10 && c !== 13 && c !== 12) bad++; }
  return bad / s.length < 0.02 ? 'Text (UTF-8)' : null;
}
export function guessType(b) {
  if (!b || !b.length) return 'Empty file';
  if (startsWith(b, [0x50, 0x4b, 0x03, 0x04])) return zipKind(b);
  if (startsWith(b, [0x50, 0x4b, 0x05, 0x06])) return 'Zip archive (empty)';
  if (b.length > 12 && ascii(b, 4, 4) === 'ftyp') return BRANDS[ascii(b, 8, 4)] || '3GPP or other MP4-family media';
  if (b.length > 12 && ascii(b, 0, 4) === 'RIFF') { const k = ascii(b, 8, 4); return k === 'WEBP' ? 'WebP image' : k === 'WAVE' ? 'WAV audio' : k === 'AVI ' ? 'AVI video' : 'RIFF container'; }
  for (const [sig, label, off = 0] of SIGS) if (b.length >= off + sig.length && startsWith(b, sig, off)) return label;
  const t = textKind(b); if (t) { const h = ascii(b, 0, 64).trimStart().toLowerCase(); return h.startsWith('<!doctype html') || h.startsWith('<html') ? 'HTML text' : h.startsWith('{') || h.startsWith('[') ? `${t}, maybe JSON` : t; }
  return 'Unknown binary data';
}
// 00000000  89 50 4e 47 0d 0a 1a 0a  00 00 00 0d 49 48 44 52  |.PNG........IHDR|
export function hexLines(b, from, to) {
  const out = []; to = Math.min(to, b.length);
  for (let o = from; o < to; o += 16) {
    const end = Math.min(o + 16, to); let hx = ''; let as = '';
    for (let i = o; i < o + 16; i++) {
      if (i === o + 8) hx += ' ';
      if (i < end) { const v = b[i]; hx += `${v.toString(16).padStart(2, '0')} `; as += v >= 32 && v < 127 ? String.fromCharCode(v) : '.'; } else hx += '   ';
    }
    out.push(`${o.toString(16).padStart(8, '0')}  ${hx} |${as}|`);
  }
  return out.join('\n');
}

// opts: { name, size (bytes of the whole file), head (Uint8Array: the start, at most HEAD_MAX), ui }
export function mountBytes(body, opts) {
  const { name, head, ui } = opts; const total = Number.isFinite(opts.size) ? opts.size : head.length;
  const shown = Math.min(head.length, HEAD_MAX);
  body.replaceChildren();
  const root = el('div', 'bv'); const guess = guessType(head.subarray(0, shown));
  const ext = (/\.([^./]+)$/.exec(name || '') || [])[1];
  const dl = el('dl', 'bv-info');
  const row = (k, v) => { dl.append(el('dt', '', k), el('dd', '', v)); };
  row('Name', name || 'file'); row('Size', total < 1024 ? `${total} bytes` : `${size(total)} (${total.toLocaleString('en-US')} bytes)`); row('Looks like', guess);
  if (ext) row('Extension', `.${ext.toLowerCase()}`);
  root.appendChild(dl);
  root.appendChild(el('p', 'bv-note', 'Guessed from the first bytes only: a guide, not a promise.'));
  const h = el('h4', 'bv-h', 'First bytes'); root.appendChild(h);
  const pre = el('pre', 'bv-hex'); root.appendChild(pre);
  const more = el('button', 'secondary-btn bv-more', 'Show more'); more.type = 'button'; const cap = el('p', 'bv-note');
  root.append(more, cap); body.appendChild(root);
  let upto = 0;
  const draw = () => {
    const to = Math.min(upto + STEP, shown); pre.textContent += (upto ? '\n' : '') + hexLines(head, upto, to); upto = to;
    const all = upto >= total; const limit = upto >= shown;
    more.classList.toggle('hidden', limit); cap.textContent = total === 0 ? '' : all ? 'The whole file is shown.' : `Showing the first ${size(upto)} of ${size(total)}.`;
  };
  more.onclick = () => { if (ui && ui.onActivity) ui.onActivity(); draw(); };
  if (shown) draw(); else { pre.classList.add('hidden'); h.classList.add('hidden'); more.classList.add('hidden'); }
  return { destroy() { pre.textContent = ''; body.replaceChildren(); } };
}
