// fileopen.js — hands a saved file to the phone's matching app (Decision 118).
// Home files open from their stored path. Vault files are written decrypted to cache/open/ first;
// that folder is emptied on launch, on resume and before every open.

import { Filesystem, Directory } from '@capacitor/filesystem';
import { FileOpener } from '@capacitor-community/file-opener';
import { readParts, withKey } from './files.js';

const OPEN_DIR = 'open';

const MIME_BY_EXT = {
  txt: 'text/plain', csv: 'text/csv', json: 'application/json', xml: 'text/xml', html: 'text/html',
  md: 'text/plain', rtf: 'application/rtf', pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  zip: 'application/zip', gz: 'application/gzip', tar: 'application/x-tar', '7z': 'application/x-7z-compressed',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  bmp: 'image/bmp', ico: 'image/x-icon', avif: 'image/avif', heic: 'image/heic', heif: 'image/heif', tif: 'image/tiff', tiff: 'image/tiff',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac',
  mp4: 'video/mp4', m4v: 'video/x-m4v', mkv: 'video/x-matroska', webm: 'video/webm', mov: 'video/quicktime', '3gp': 'video/3gpp', '3g2': 'video/3gpp2',
  avi: 'video/x-msvideo', wmv: 'video/x-ms-wmv', flv: 'video/x-flv', mpg: 'video/mpeg', mpeg: 'video/mpeg', ogv: 'video/ogg', mts: 'video/mp2t', m2ts: 'video/mp2t',
  epub: 'application/epub+zip', apk: 'application/vnd.android.package-archive', vcf: 'text/x-vcard', ics: 'text/calendar'
};

// Video extensions of the Gallery (Decision 306). Decides the poster frame and the player; the phone's own app takes over when the
// WebView cannot decode the codec.
const VIDEO_EXTS = new Set(['mp4', 'm4v', 'mkv', 'webm', 'mov', '3gp', '3g2', 'avi', 'wmv', 'flv', 'mpg', 'mpeg', 'ogv', 'mts', 'm2ts']);
function isVideoExt(ext) { return VIDEO_EXTS.has(String(ext || '').replace(/^\./, '').toLowerCase()); }

// Unknown or missing extension gives '*/*': Android then lists every app that accepts a file.
function mimeForExtension(ext) {
  const key = String(ext || '').replace(/^\./, '').toLowerCase();
  return MIME_BY_EXT[key] || '*/*';
}

function friendlyError(err) {
  const code = String(err?.code ?? '');
  if (code === '8') return 'No app on this phone can open this file type.';
  if (code === '9') return 'The file could not be found on this phone.';
  return `Could not open the file: ${err?.message || err}`;
}

async function launch(uri, ext) {
  try {
    await FileOpener.open({ filePath: uri, contentType: mimeForExtension(ext), openWithDefault: true });
  } catch (err) {
    throw new Error(friendlyError(err));
  }
}

// Plain bytes into cache/open/ in slices of about 4 MiB, each sent to the file plugin on its own (Decision 332). One message holding a
// whole large file as base64 ran the phone out of memory. `parts` is a list of Uint8Array; each is released once written.
const OPEN_BATCH = 4 * 1024 * 1024;
const blobBase64 = (blob) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(',')[1] || '');
  r.onerror = () => rej(r.error || new Error('Could not read the file.'));
  r.readAsDataURL(blob);
});
async function writeParts(path, parts) {
  let batch = [], size = 0, first = true;
  const flush = async () => {
    if (!size) return;
    const data = await blobBase64(new Blob(batch));
    batch = []; size = 0;
    if (first) { await Filesystem.writeFile({ path, directory: Directory.Cache, data, recursive: true }); first = false; }
    else await Filesystem.appendFile({ path, directory: Directory.Cache, data });
  };
  for (let i = 0; i < parts.length; i++) {
    batch.push(parts[i]); size += parts[i].length; parts[i] = null;
    if (size >= OPEN_BATCH) await flush();
  }
  await flush();
  if (first) await Filesystem.writeFile({ path, directory: Directory.Cache, data: '', recursive: true }); // an empty file
}

async function purgeOpenCopies() {
  try { await Filesystem.rmdir({ path: OPEN_DIR, directory: Directory.Cache, recursive: true }); }
  catch { /* nothing to remove */ }
}

// URI another app can read. A plain file is read in place; an encrypted Home file is decrypted into cache/open/,
// purged like the Vault copies (Decision 161).
async function plainUriFor(entryRow) {
  if (!entryRow.file_path) throw new Error('This entry has no stored file.');
  const row = await withKey(entryRow);
  if (!row.file_key) return (await Filesystem.getUri({ path: row.file_path, directory: Directory.Data })).uri;
  await purgeOpenCopies();
  const ext = row.extension ? `.${String(row.extension).replace(/^\./, '')}` : '';
  const path = `${OPEN_DIR}/${row.id}${ext}`;
  await writeParts(path, await readParts(row));
  return (await Filesystem.getUri({ path, directory: Directory.Cache })).uri;
}

// row: entries row with id, file_path, file_key and extension.
async function openStoredFile(row) {
  await launch(await plainUriFor(row), row.extension);
}

// Vault file: base64 bytes already decrypted in memory. The copy stays until the next purge so the
// other app can read it while this one is in the background.
async function openDecryptedFile(id, extension, base64) {
  await purgeOpenCopies();
  const ext = extension ? `.${String(extension).replace(/^\./, '')}` : '';
  const path = `${OPEN_DIR}/${id}${ext}`;
  // Slices of 4 Mi characters (a multiple of 4), each decoded on its own, so no single message carries the whole file (Decision 332).
  const STEP = 4 * 1024 * 1024;
  for (let off = 0; off === 0 || off < base64.length; off += STEP) {
    const data = base64.slice(off, off + STEP);
    if (off === 0) await Filesystem.writeFile({ path, directory: Directory.Cache, data, recursive: true });
    else await Filesystem.appendFile({ path, directory: Directory.Cache, data });
  }
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
  await launch(uri, extension);
}

export { mimeForExtension, isVideoExt, openStoredFile, openDecryptedFile, plainUriFor, purgeOpenCopies };
