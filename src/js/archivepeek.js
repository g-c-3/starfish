// archivepeek.js — a temporary decrypted copy of a stored archive, so the native archive reader can list it (Decision 447).
// The copy lives in the app's private cache, in one folder, and is removed when the archive view closes; any leftover (a crash, a kill)
// is swept at the next start and before the next copy. Nothing leaves the phone.
import { Filesystem, Directory } from '@capacitor/filesystem';

const DIR = 'arkly-peek';
export const PEEK_MAX = 256 * 1024 * 1024; // the whole file is held in memory while the copy is written
const SLICE = 3 * 1024 * 1024; // a multiple of 3, so every slice encodes to base64 without padding in the middle

const b64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
const safe = (name) => String(name || 'archive').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120) || 'archive';

export const sweepPeek = () => Filesystem.rmdir({ path: DIR, directory: Directory.Cache, recursive: true }).catch(() => {});

// parts: Uint8Array, ArrayBuffer or Blob pieces in order. Resolves { path, remove() }; path is a plain file path for the archive reader.
export async function makePeekCopy(name, parts) {
  await sweepPeek();
  const rel = `${DIR}/${Date.now()}/${safe(name)}`;
  let first = true;
  const put = async (bytes) => {
    const data = b64(bytes);
    if (first) { await Filesystem.writeFile({ path: rel, directory: Directory.Cache, data, recursive: true }); first = false; }
    else await Filesystem.appendFile({ path: rel, directory: Directory.Cache, data });
  };
  try {
    for (const p of parts) {
      const bytes = p instanceof Uint8Array ? p : new Uint8Array(p instanceof Blob ? await p.arrayBuffer() : p);
      for (let i = 0; i < bytes.length; i += SLICE) await put(bytes.subarray(i, i + SLICE));
    }
    if (first) await put(new Uint8Array(0));
    const { uri } = await Filesystem.getUri({ path: rel, directory: Directory.Cache });
    return { path: decodeURIComponent(uri.replace(/^file:\/\//, '')), remove: sweepPeek };
  } catch (err) { await sweepPeek(); throw err; }
}
