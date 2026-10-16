// explorer-manage.js — file management for the File explorer (Decisions 213, 219): new folder, rename, the shared trash,
// properties. Pure logic over an injected `fs` (plain paths), so it runs the same in the app and in Node checks.
// fs: { stat(p) -> {isDir,size,mtime}, readdir(p) -> [{name,isDir,size,mtime}], mkdir(p, recursive), rename(from, to),
//       deleteFile(p), rmdir(p) (recursive), readText(p), writeText(p, data) }.
// Trash: one folder per storage, `.arkly-trash` at its root. A delete is a rename on the same storage; a `<id>.json` record
// beside each item keeps its original place. Nothing in the trash is encrypted (Decision 213).

export const TRASH_DIR = '.arkly-trash';
export const TRASH_DAYS = 30;
const DAY_MS = 86400000;
const ID_RE = /^[0-9a-f]{12}$/;

const join = (dir, name) => (dir.endsWith('/') ? dir : dir + '/') + name;
const parentOf = (path) => { const i = path.replace(/\/+$/, '').lastIndexOf('/'); return i <= 0 ? '/' : path.slice(0, i); };
const baseOf = (path) => path.replace(/\/+$/, '').split('/').pop();
const fail = (code, message) => Object.assign(new Error(message), { code });

export const trashDirOf = (volume) => join(volume.path, TRASH_DIR);
// The trash folder itself, or anything inside it, is never an item to delete, rename or move.
export const inTrash = (path, volume) => path === trashDirOf(volume) || path.startsWith(trashDirOf(volume) + '/');

// A name for a new or renamed item: trimmed; no separators or NUL; not . or ..; at most 255 bytes. Null when unusable.
export function cleanName(raw) {
  const n = String(raw ?? '').trim();
  if (!n || n === '.' || n === '..') return null;
  if (n.includes('/') || n.includes('\\') || n.includes('\u0000')) return null;
  if (new TextEncoder().encode(n).length > 255) return null;
  return n;
}

const newId = () => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('');
async function exists(fs, path) { try { await fs.stat(path); return true; } catch { return false; } }

// `name (1).ext`, `name (2).ext`, … until free. A folder keeps its whole name.
export async function freeName(fs, dir, name, isDir = false) {
  if (!(await exists(fs, join(dir, name)))) return name;
  const dot = name.lastIndexOf('.');
  const stem = !isDir && dot > 0 ? name.slice(0, dot) : name;
  const ext = !isDir && dot > 0 ? name.slice(dot) : '';
  for (let i = 1; i < 1000; i++) {
    const c = `${stem} (${i})${ext}`;
    if (!(await exists(fs, join(dir, c)))) return c;
  }
  throw fail('exists', 'No free name.');
}

// A clash is any other entry whose name matches ignoring case: storage may or may not tell A and a apart, so both count.
async function clashes(fs, dir, name, selfName) {
  const list = await fs.readdir(dir);
  const low = name.toLowerCase();
  return list.some((e) => e.name !== selfName && e.name.toLowerCase() === low);
}

export async function makeFolder(fs, dir, rawName) {
  const name = cleanName(rawName);
  if (!name) throw fail('name', 'That name is not allowed.');
  if (await clashes(fs, dir, name, null)) throw fail('exists', 'A file or folder with that name already exists.');
  const path = join(dir, name);
  await fs.mkdir(path, false);
  return path;
}

// Returns the new path. A change of letter case only goes through a temporary name: renaming onto "itself" can delete it.
export async function renameEntry(fs, entry, rawName, volume) {
  const name = cleanName(rawName);
  if (!name) throw fail('name', 'That name is not allowed.');
  if (volume && inTrash(entry.path, volume)) throw fail('protected', 'The trash folder cannot be renamed.');
  if (name === entry.name) return entry.path;
  const dir = parentOf(entry.path);
  if (await clashes(fs, dir, name, entry.name)) throw fail('exists', 'A file or folder with that name already exists.');
  const target = join(dir, name);
  if (name.toLowerCase() !== entry.name.toLowerCase()) { await fs.rename(entry.path, target); return target; }
  const temp = join(dir, `.arkly-rename-${newId()}`);
  await fs.rename(entry.path, temp);
  try { await fs.rename(temp, target); } catch (e) { await fs.rename(temp, entry.path).catch(() => {}); throw e; }
  return target;
}

// ---- Trash ----

export async function trashEntry(fs, entry, volume, now = Date.now()) {
  if (inTrash(entry.path, volume)) throw fail('protected', 'The trash folder cannot be deleted from here.');
  if (entry.path === volume.path) throw fail('protected', 'A storage cannot be deleted.');
  const dir = trashDirOf(volume);
  await fs.mkdir(dir, true);
  const nomedia = join(dir, '.nomedia'); // keeps trashed pictures and music out of the gallery and music apps
  if (!(await exists(fs, nomedia))) await fs.writeText(nomedia, '').catch(() => {});
  const id = newId();
  const meta = { id, name: entry.name, from: entry.path, isDir: !!entry.isDir, size: entry.size || 0, deleted: now };
  const metaPath = join(dir, id + '.json');
  await fs.writeText(metaPath, JSON.stringify(meta)); // the record first: an item is never in the trash without one
  try { await fs.rename(entry.path, join(dir, id)); } catch (e) { await fs.deleteFile(metaPath).catch(() => {}); throw e; }
  return meta;
}

// Every trashed item on the given storages, newest first. A record whose item is gone is removed; an unreadable one is skipped.
export async function listTrash(fs, volumes) {
  const out = [];
  for (const volume of volumes) {
    const dir = trashDirOf(volume);
    let names;
    try { names = (await fs.readdir(dir)).map((e) => e.name); } catch { continue; }
    const have = new Set(names);
    for (const n of names) {
      if (!n.endsWith('.json')) continue;
      const id = n.slice(0, -5);
      if (!ID_RE.test(id)) continue;
      if (!have.has(id)) { await fs.deleteFile(join(dir, n)).catch(() => {}); continue; }
      try {
        const m = JSON.parse(await fs.readText(join(dir, n)));
        if (m && m.id === id && typeof m.name === 'string' && typeof m.from === 'string') {
          out.push({ id, name: m.name, from: m.from, isDir: !!m.isDir, size: Number(m.size) || 0, deleted: Number(m.deleted) || 0, volume, payload: join(dir, id), record: join(dir, n) });
        }
      } catch { /* unreadable record: left alone */ }
    }
  }
  return out.sort((a, b) => b.deleted - a.deleted);
}

// Back to the original place (made again if missing); a taken name gets a number. Returns the final path.
export async function restoreItem(fs, item) {
  let parent = parentOf(item.from);
  if (!parent.startsWith(item.volume.path) || inTrash(parent, item.volume)) parent = item.volume.path;
  await fs.mkdir(parent, true);
  const name = await freeName(fs, parent, baseOf(item.from) || item.name, item.isDir);
  const target = join(parent, name);
  await fs.rename(item.payload, target);
  await fs.deleteFile(item.record).catch(() => {});
  return target;
}

export async function purgeItem(fs, item) {
  let dir = item.isDir;
  try { dir = (await fs.stat(item.payload)).isDir; } catch { dir = null; } // already gone: only the record is left
  if (dir === true) await fs.rmdir(item.payload);
  else if (dir === false) await fs.deleteFile(item.payload);
  await fs.deleteFile(item.record).catch(() => {});
}

// Runs fn over each item; one failure does not stop the rest. Returns { done, failed }.
async function each(items, fn) {
  let done = 0, failed = 0;
  for (const it of items) { try { await fn(it); done++; } catch { failed++; } }
  return { done, failed };
}
export const purgeItems = (fs, items) => each(items, (it) => purgeItem(fs, it));
export const restoreItems = (fs, items) => each(items, (it) => restoreItem(fs, it));
export const trashEntries = (fs, entries, volume, now) => each(entries, (e) => trashEntry(fs, e, volume, now));
export const expired = (items, now = Date.now()) => items.filter((it) => it.deleted && now - it.deleted > TRASH_DAYS * DAY_MS);

// ---- Properties ----

// A file: its stat. A folder: totals over everything inside, up to `limit` entries (then `partial`).
export async function propertiesOf(fs, entry, limit = 20000) {
  const st = await fs.stat(entry.path);
  if (!st.isDir) return { isDir: false, size: st.size, mtime: st.mtime };
  let files = 0, folders = 0, bytes = 0, seen = 0, partial = false;
  const queue = [entry.path];
  while (queue.length && !partial) {
    const dir = queue.shift();
    let list;
    try { list = await fs.readdir(dir); } catch { partial = true; break; }
    for (const e of list) {
      if (++seen > limit) { partial = true; break; }
      if (e.isDir) { folders++; queue.push(join(dir, e.name)); } else { files++; bytes += e.size || 0; }
    }
  }
  return { isDir: true, size: bytes, mtime: st.mtime, files, folders, partial };
}
