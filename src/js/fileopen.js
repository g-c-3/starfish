// fileopen.js — hands a saved file to the phone's matching app (Decision 118).
// Home files open from their stored path. Vault files are written decrypted to cache/open/ first;
// that folder is emptied on launch, on resume and before every open.

import { Filesystem, Directory } from '@capacitor/filesystem';
import { FileOpener } from '@capacitor-community/file-opener';

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
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac',
  mp4: 'video/mp4', mkv: 'video/x-matroska', webm: 'video/webm', mov: 'video/quicktime', '3gp': 'video/3gpp',
  epub: 'application/epub+zip', apk: 'application/vnd.android.package-archive', vcf: 'text/x-vcard', ics: 'text/calendar'
};

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

async function purgeOpenCopies() {
  try { await Filesystem.rmdir({ path: OPEN_DIR, directory: Directory.Cache, recursive: true }); }
  catch { /* nothing to remove */ }
}

// row: entries row with file_path and extension.
async function openStoredFile(row) {
  if (!row.file_path) throw new Error('This entry has no stored file.');
  const { uri } = await Filesystem.getUri({ path: row.file_path, directory: Directory.Data });
  await launch(uri, row.extension);
}

// Vault file: base64 bytes already decrypted in memory. The copy stays until the next purge so the
// other app can read it while this one is in the background.
async function openDecryptedFile(id, extension, base64) {
  await purgeOpenCopies();
  const ext = extension ? `.${String(extension).replace(/^\./, '')}` : '';
  const path = `${OPEN_DIR}/${id}${ext}`;
  await Filesystem.writeFile({ path, directory: Directory.Cache, data: base64, recursive: true });
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
  await launch(uri, extension);
}

export { mimeForExtension, openStoredFile, openDecryptedFile, purgeOpenCopies };
