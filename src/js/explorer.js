// explorer.js — the File explorer screen (Decisions 206, 207, 211). Browses the phone's own storage, internal and removable
// (SD card, USB drive), like a file manager. Nothing here is encrypted or copied anywhere: it lists and opens what is on the
// phone. Needs "All files access", granted once in Android's own settings (native bridge: scripts/patch-explorer.js).

import { Filesystem, Encoding } from '@capacitor/filesystem';
import { FileOpener } from '@capacitor-community/file-opener';
import { openFileViewer, VIEW_KINDS } from './explorer-view.js';
import * as manage from './explorer-manage.js';

const KIND_EXT = {
  text: ['txt', 'md', 'log', 'csv', 'tsv', 'json', 'xml', 'html', 'htm', 'css', 'js', 'ts', 'yml', 'yaml', 'ini', 'cfg', 'conf', 'java', 'kt', 'py', 'sh', 'sql', 'rtf', 'srt', 'vcf', 'ics'],
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'avif', 'heic'],
  pdf: ['pdf'],
  audio: ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'opus', 'flac', 'amr', 'mid', 'midi'],
  video: ['mp4', 'webm', 'mkv', '3gp', 'mov', 'avi', 'm4v'],
  docx: ['docx'], xlsx: ['xlsx'], pptx: ['pptx'],
  archive: ['zip', 'gz', 'tar', '7z', 'rar'],
};
const MIME = {
  txt: 'text/plain', md: 'text/plain', csv: 'text/csv', json: 'application/json', xml: 'text/xml', html: 'text/html', rtf: 'application/rtf', pdf: 'application/pdf',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet', odp: 'application/vnd.oasis.opendocument.presentation',
  zip: 'application/zip', gz: 'application/gzip', tar: 'application/x-tar', '7z': 'application/x-7z-compressed',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac',
  mp4: 'video/mp4', mkv: 'video/x-matroska', webm: 'video/webm', mov: 'video/quicktime', '3gp': 'video/3gpp',
  epub: 'application/epub+zip', apk: 'application/vnd.android.package-archive', vcf: 'text/x-vcard', ics: 'text/calendar',
};
const SHORTCUTS = ['Download', 'DCIM', 'Documents', 'Pictures', 'Music', 'Movies'];

export function extOf(name) {
  const i = name.lastIndexOf('.');
  return i > 0 && i < name.length - 1 ? name.slice(i + 1).toLowerCase() : '';
}
export function kindOf(name) {
  const e = extOf(name);
  for (const [kind, list] of Object.entries(KIND_EXT)) if (list.includes(e)) return kind;
  return 'other';
}
export const mimeOf = (name) => MIME[extOf(name)] || '*/*'; // '*/*' lets Android list every app that takes a file

export function formatSize(n) {
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v >= 100 || i === 0 && v >= 10 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}
export function formatDate(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
export const joinPath = (dir, name) => (dir.endsWith('/') ? dir : dir + '/') + name;
export function parentOf(path) {
  const i = path.replace(/\/+$/, '').lastIndexOf('/');
  return i <= 0 ? '/' : path.slice(0, i);
}
// Percent-encoded per segment: the plugin decodes a file:// URI, so a name holding %, # or ? still resolves to itself.
export const toFileUri = (path) => 'file://' + path.split('/').map(encodeURIComponent).join('/');
// Longest matching volume root, so /storage/ABCD-1234/x belongs to that drive and not to /storage.
export function volumeOf(path, volumes) {
  let best = null;
  for (const v of volumes) if ((path === v.path || path.startsWith(v.path + '/')) && (!best || v.path.length > best.path.length)) best = v;
  return best;
}
export function crumbs(volume, cwd) {
  const out = [{ name: volume.name, path: volume.path }];
  const rest = cwd.slice(volume.path.length).split('/').filter(Boolean);
  let p = volume.path;
  for (const seg of rest) { p = joinPath(p, seg); out.push({ name: seg, path: p }); }
  return out;
}
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
// Folders first; then the chosen key; name breaks ties.
export function sortEntries(list, { key = 'name', dir = 1 } = {}) {
  const cmp = (a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    let r = 0;
    if (key === 'date') r = a.mtime - b.mtime;
    else if (key === 'size') r = a.size - b.size;
    if (r === 0) return collator.compare(a.name, b.name) * (key === 'name' ? dir : 1);
    return r * dir;
  };
  return [...list].sort(cmp);
}

const bridge = () => (typeof window !== 'undefined' ? window.ArklyExplorer : null);

// The filesystem as explorer-manage.js expects it: plain paths in, the plugin underneath.
const fsApi = {
  stat: async (p) => { const r = await Filesystem.stat({ path: toFileUri(p) }); return { isDir: r.type === 'directory', size: r.size || 0, mtime: r.mtime || 0 }; },
  readdir: async (p) => ((await Filesystem.readdir({ path: toFileUri(p) })).files || []).map((f) => ({ name: f.name, isDir: f.type === 'directory', size: f.size || 0, mtime: f.mtime || 0 })),
  mkdir: (p, recursive = false) => Filesystem.mkdir({ path: toFileUri(p), recursive }),
  rename: (a, b) => Filesystem.rename({ from: toFileUri(a), to: toFileUri(b) }),
  deleteFile: (p) => Filesystem.deleteFile({ path: toFileUri(p) }),
  rmdir: (p) => Filesystem.rmdir({ path: toFileUri(p), recursive: true }),
  readText: async (p) => (await Filesystem.readFile({ path: toFileUri(p), encoding: Encoding.UTF8 })).data,
  writeText: (p, data) => Filesystem.writeFile({ path: toFileUri(p), data, encoding: Encoding.UTF8 }),
};
const sizeText = (n) => `${formatSize(n)}${n >= 1024 ? ` (${n.toLocaleString()} bytes)` : ''}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
function errText(err) {
  if (err?.code === 'name' || err?.code === 'exists' || err?.code === 'protected') return err.message;
  return err?.message ? `Failed: ${err.message}` : 'Failed.';
}

// leaving() runs just before the screen hands over to another app or to Android's settings, so the app's lock-on-background
// does not fire for that one pause (the same flag the file pickers set, Decision 73).
// ui carries the app's own dialogs, image zoom and auto-lock timer for the built-in viewers (explorer-view.js).
export function openExplorer({ isVault = false, toast = () => {}, onClose = () => {}, leaving = () => {}, ui = {} } = {}) {
  const $ = (id) => document.getElementById(id);
  const screen = $('explorer-screen'), body = $('explorer-body'), titleEl = $('explorer-title');
  const crumbsEl = $('explorer-crumbs'), toolsEl = $('explorer-tools'), filterEl = $('explorer-filter');
  const st = { view: 'gate', volumes: [], volume: null, cwd: null, entries: [], sort: { key: 'name', dir: 1 }, hidden: false, filter: '', gen: 0, sel: new Set(), trash: [], from: null };
  let closed = false, viewer = null, purged = false;

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const icon = (id) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('class', 'ic'); s.setAttribute('aria-hidden', 'true'); const u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', '#' + id); s.appendChild(u); return s; };
  const hasAccess = () => { try { return !!bridge()?.hasAllFilesAccess(); } catch { return false; } };
  const readVolumes = () => { try { return JSON.parse(bridge().volumes() || '[]'); } catch { return []; } };

  function chrome({ title, folder }) {
    clearSel();
    titleEl.textContent = title;
    crumbsEl.classList.toggle('hidden', !folder);
    toolsEl.classList.toggle('hidden', !folder);
    $('explorer-hidden-btn').classList.toggle('hidden', !folder);
    $('explorer-new-btn').classList.toggle('hidden', !folder);
    $('explorer-trash-btn').classList.toggle('hidden', !(folder || st.view === 'roots'));
  }

  // ---- Selection (long-press) ----
  const selecting = () => st.sel.size > 0;
  function syncSelUi() {
    const on = selecting() && (st.view === 'folder' || st.view === 'trash');
    screen.classList.toggle('selecting', on);
    $('explorer-selbar').classList.toggle('hidden', !on);
    $('explorer-head').classList.toggle('hidden', on);
    if (!on) return;
    const n = st.sel.size, trash = st.view === 'trash';
    $('explorer-sel-count').textContent = `${n} selected`;
    for (const id of ['explorer-sel-rename', 'explorer-sel-info']) { $(id).classList.toggle('hidden', trash); $(id).disabled = n !== 1; }
    $('explorer-sel-restore').classList.toggle('hidden', !trash);
    const del = $('explorer-sel-delete');
    del.setAttribute('aria-label', trash ? 'Delete forever' : 'Delete'); del.title = trash ? 'Delete forever' : 'Delete';
  }
  function markRows() {
    body.querySelectorAll('.explorer-row[data-key]').forEach((r) => r.classList.toggle('is-selected', st.sel.has(r.dataset.key)));
  }
  function clearSel() { if (st.sel.size) st.sel.clear(); syncSelUi(); markRows(); }
  function toggleSel(key) {
    if (st.sel.has(key)) st.sel.delete(key); else st.sel.add(key);
    ui.onActivity?.(); syncSelUi(); markRows();
  }
  // A tap opens (or toggles while selecting, or always in the trash); a long press starts or extends a selection.
  function bindRow(row, key, onTap) {
    row.dataset.key = key;
    let timer = null, x = 0, y = 0, fired = false;
    const stop = () => { clearTimeout(timer); timer = null; };
    row.addEventListener('pointerdown', (ev) => { fired = false; x = ev.clientX; y = ev.clientY; stop(); timer = setTimeout(() => { timer = null; fired = true; toggleSel(key); }, 450); });
    row.addEventListener('pointermove', (ev) => { if (timer && Math.hypot(ev.clientX - x, ev.clientY - y) > 10) stop(); });
    for (const t of ['pointerup', 'pointercancel', 'pointerleave']) row.addEventListener(t, stop);
    row.addEventListener('contextmenu', (ev) => ev.preventDefault());
    row.addEventListener('click', () => { if (fired) { fired = false; return; } if (selecting() || st.view === 'trash') toggleSel(key); else onTap(); });
    if (st.sel.has(key)) row.classList.add('is-selected');
  }
  function rowIcon(name, isDir) {
    const ico = el('span', 'row-icon');
    const ext = isDir ? '' : extOf(name);
    if (!isDir && ext && ext.length <= 4) { ico.classList.add('ext-badge'); ico.dataset.len = String(ext.length); ico.textContent = ext; }
    else ico.appendChild(icon('i-file'));
    return ico;
  }
  function message(text, buttons = []) {
    body.replaceChildren();
    const box = el('div', 'explorer-note');
    box.appendChild(el('p', '', text));
    for (const [label, fn] of buttons) { const b = el('button', '', label); b.addEventListener('click', fn); box.appendChild(b); }
    body.appendChild(box);
  }

  function showGate() {
    st.view = 'gate';
    chrome({ title: 'File explorer', folder: false });
    if (!bridge()) { message('The file explorer works in the Android app.'); return; }
    message('To browse the files on this phone, allow "All files access" for this app in Android\'s settings. Files are only listed and opened here; nothing is sent anywhere.', [
      ['Allow access', () => { try { leaving(); bridge().requestAllFilesAccess(); } catch { toast('Could not open the settings screen.'); } }],
    ]);
  }

  function showRoots() {
    if (!hasAccess()) { showGate(); return; }
    st.view = 'roots';
    st.volumes = readVolumes();
    chrome({ title: 'File explorer', folder: false });
    body.replaceChildren();
    if (!st.volumes.length) { message('No storage was found.', [['Refresh', showRoots]]); return; }
    const list = el('div', 'explorer-list');
    for (const v of st.volumes) {
      const row = el('button', 'explorer-row');
      row.appendChild(el('span', 'row-icon').appendChild(icon('i-storage')).parentNode);
      const text = el('span', 'explorer-text');
      text.appendChild(el('span', 'explorer-name', v.usb ? `${v.name} (USB)` : v.name));
      text.appendChild(el('span', 'explorer-meta', v.total ? `${formatSize(v.free)} free of ${formatSize(v.total)}` : v.path));
      row.appendChild(text);
      row.addEventListener('click', () => showFolder(v.path));
      list.appendChild(row);
    }
    const primary = st.volumes.find((v) => v.primary) || st.volumes[0];
    list.appendChild(el('div', 'explorer-section', 'Quick access'));
    for (const name of SHORTCUTS) {
      const row = el('button', 'explorer-row');
      row.appendChild(el('span', 'row-icon').appendChild(icon('i-file')).parentNode);
      const text = el('span', 'explorer-text');
      text.appendChild(el('span', 'explorer-name', name));
      row.appendChild(text);
      row.addEventListener('click', () => showFolder(joinPath(primary.path, name)));
      list.appendChild(row);
    }
    body.appendChild(list);
    purgeExpired();
  }

  async function showFolder(path) {
    if (!hasAccess()) { showGate(); return; }
    if (!st.volumes.length) st.volumes = readVolumes();
    const volume = volumeOf(path, st.volumes);
    if (!volume) { toast('That folder is not on a known storage.'); return; }
    const gen = ++st.gen;
    st.view = 'folder'; st.volume = volume; st.cwd = path; st.filter = ''; filterEl.value = '';
    chrome({ title: path === volume.path ? volume.name : path.split('/').pop(), folder: true });
    renderCrumbs();
    message('Loading…');
    try {
      const r = await Filesystem.readdir({ path: toFileUri(path) });
      if (gen !== st.gen || closed) return;
      st.entries = (r.files || []).map((f) => ({ name: f.name, isDir: f.type === 'directory', size: f.size || 0, mtime: f.mtime || 0, path: joinPath(path, f.name) }));
      renderList();
    } catch (e) {
      if (gen !== st.gen || closed) return;
      st.entries = [];
      message(`This folder cannot be opened${e?.message ? `: ${e.message}` : '.'}`, [['Back to storage list', showRoots]]);
    }
  }

  function renderCrumbs() {
    crumbsEl.replaceChildren();
    const parts = crumbs(st.volume, st.cwd);
    parts.forEach((c, i) => {
      if (i) crumbsEl.appendChild(el('span', 'crumb-sep', '›'));
      const b = el('button', 'crumb' + (i === parts.length - 1 ? ' current' : ''), c.name);
      b.addEventListener('click', () => showFolder(c.path));
      crumbsEl.appendChild(b);
    });
    crumbsEl.scrollLeft = crumbsEl.scrollWidth;
  }

  // What the list shows now: hidden-file toggle, name filter and sort applied.
  function shownItems() {
    let items = st.entries;
    if (!st.hidden) items = items.filter((e) => !e.name.startsWith('.'));
    const q = st.filter.trim().toLowerCase();
    if (q) items = items.filter((e) => e.name.toLowerCase().includes(q));
    return sortEntries(items, st.sort);
  }

  function renderList() {
    if (st.view !== 'folder') return;
    const q = st.filter.trim().toLowerCase();
    const items = shownItems();
    document.querySelectorAll('#explorer-tools [data-sort]').forEach((b) => {
      const on = b.dataset.sort === st.sort.key;
      b.classList.toggle('active', on);
      b.textContent = b.dataset.label + (on ? (st.sort.dir === 1 ? ' ↑' : ' ↓') : '');
    });
    body.replaceChildren();
    if (!items.length) { message(q ? 'No file or folder matches.' : 'This folder is empty.'); return; }
    const list = el('div', 'explorer-list');
    for (const e of items) {
      const row = el('button', 'explorer-row');
      row.appendChild(rowIcon(e.name, e.isDir));
      const text = el('span', 'explorer-text');
      text.appendChild(el('span', 'explorer-name', e.name));
      text.appendChild(el('span', 'explorer-meta', e.isDir ? `Folder${e.mtime ? ' · ' + formatDate(e.mtime) : ''}` : [formatSize(e.size), formatDate(e.mtime)].filter(Boolean).join(' · ')));
      row.appendChild(text);
      bindRow(row, e.path, () => (e.isDir ? showFolder(e.path) : openFile(e)));
      list.appendChild(row);
    }
    body.appendChild(list);
    syncSelUi();
  }

  const selectedEntries = () => st.entries.filter((e) => st.sel.has(e.path));
  function returnToFolder() {
    st.view = 'folder';
    chrome({ title: st.cwd === st.volume.path ? st.volume.name : st.cwd.split('/').pop(), folder: true });
    renderCrumbs(); renderList();
  }
  // Runs a change in the current folder, then lists it again. A navigation during the dialog drops the follow-up.
  async function afterChange(cwd) { if (!closed && st.view === 'folder' && st.cwd === cwd) await showFolder(cwd); }

  async function actNewFolder() {
    const cwd = st.cwd;
    const raw = await ui.askText?.({ title: 'New folder', placeholder: 'Folder name', ok: 'Create', isVault });
    if (raw === null || raw === undefined) return;
    try { await manage.makeFolder(fsApi, cwd, raw); toast('Folder created.'); } catch (err) { toast(errText(err)); }
    await afterChange(cwd);
  }
  async function actRename() {
    const items = selectedEntries();
    if (items.length !== 1) return;
    const [e] = items, cwd = st.cwd, volume = st.volume;
    const raw = await ui.askText?.({ title: e.isDir ? 'Rename folder' : 'Rename file', initial: e.name, ok: 'Rename', isVault });
    if (raw === null || raw === undefined) return;
    try { await manage.renameEntry(fsApi, e, raw, volume); toast('Renamed.'); } catch (err) { toast(errText(err)); }
    st.sel.clear();
    await afterChange(cwd);
  }
  async function actDelete() {
    const items = selectedEntries();
    if (!items.length) return;
    const cwd = st.cwd, volume = st.volume, n = items.length;
    const yes = await ui.askYesNo?.({
      title: n === 1 ? 'Move to trash?' : `Move ${n} items to trash?`,
      text: `${n === 1 ? `"${items[0].name}" goes` : 'They go'} to the file explorer's trash on the same storage and stay ${manage.TRASH_DAYS} days. The trash is not encrypted.`,
      yes: 'Move to trash', no: 'Cancel',
    });
    if (!yes) return;
    const r = await manage.trashEntries(fsApi, items, volume);
    st.sel.clear();
    toast(r.failed ? `${r.done} moved to trash, ${r.failed} could not be moved.` : `${r.done} moved to trash.`);
    await afterChange(cwd);
  }
  async function showProps(e) {
    const gen = ++st.gen;
    st.view = 'props';
    chrome({ title: 'Properties', folder: false });
    body.replaceChildren();
    const box = el('div', 'explorer-props');
    body.appendChild(box);
    const prop = (label, value) => { const r = el('div', 'prop'); r.appendChild(el('span', 'prop-label', label)); const v = el('span', 'prop-value', value); r.appendChild(v); box.appendChild(r); return v; };
    const stamp = (ms) => (ms ? new Date(ms).toLocaleString() : '—');
    prop('Name', e.name);
    prop('Location', parentOf(e.path));
    prop('Type', e.isDir ? 'Folder' : (extOf(e.name) ? `${extOf(e.name).toUpperCase()} file` : 'File'));
    const size = prop('Size', e.isDir ? 'Calculating…' : sizeText(e.size));
    const mod = prop('Modified', stamp(e.mtime));
    const cont = e.isDir ? prop('Contains', 'Calculating…') : null;
    try {
      const p = await manage.propertiesOf(fsApi, e);
      if (gen !== st.gen || closed) return;
      size.textContent = sizeText(p.size) + (p.partial ? ' or more' : '');
      mod.textContent = stamp(p.mtime || e.mtime);
      if (cont) cont.textContent = `${plural(p.files, 'file')}, ${plural(p.folders, 'folder')}${p.partial ? ' or more (counting stopped in a very large folder)' : ''}`;
    } catch {
      if (gen !== st.gen || closed) return;
      size.textContent = 'Not available';
      if (cont) cont.textContent = 'Not available';
    }
  }
  function actInfo() { const items = selectedEntries(); if (items.length === 1) showProps(items[0]); }

  // ---- Trash (Decision 213): one list for every storage, the same from the Home and the Vault card ----
  async function purgeExpired() {
    if (purged || !hasAccess()) return;
    purged = true;
    try {
      const old = manage.expired(await manage.listTrash(fsApi, st.volumes));
      if (old.length) await manage.purgeItems(fsApi, old);
    } catch { /* best effort; tried again at the next open */ }
  }
  async function showTrash() {
    if (!hasAccess()) { showGate(); return; }
    if (!st.volumes.length) st.volumes = readVolumes();
    const gen = ++st.gen;
    st.from = st.view === 'folder' ? { cwd: st.cwd } : st.view === 'trash' ? st.from : null;
    st.view = 'trash';
    chrome({ title: 'Trash', folder: false });
    message('Loading…');
    try { st.trash = await manage.listTrash(fsApi, st.volumes); } catch { st.trash = []; }
    if (gen !== st.gen || closed) return;
    renderTrash();
  }
  function renderTrash() {
    if (st.view !== 'trash') return;
    for (const k of [...st.sel]) if (!st.trash.some((t) => t.id === k)) st.sel.delete(k);
    syncSelUi();
    if (!st.trash.length) { message('The trash is empty.'); return; }
    body.replaceChildren();
    const banner = el('div', 'explorer-banner');
    banner.appendChild(el('div', '', `Deleted items stay here ${manage.TRASH_DAYS} days, then are removed. The trash is not encrypted and is the same from Home and Vault. Tap items to select them.`));
    const empty = el('button', '', 'Empty trash');
    empty.addEventListener('click', actEmpty);
    banner.appendChild(empty);
    body.appendChild(banner);
    const list = el('div', 'explorer-list');
    for (const t of st.trash) {
      const row = el('button', 'explorer-row');
      row.appendChild(rowIcon(t.name, t.isDir));
      const text = el('span', 'explorer-text');
      text.appendChild(el('span', 'explorer-name', t.name));
      text.appendChild(el('span', 'explorer-meta', [t.isDir ? 'Folder' : formatSize(t.size), `deleted ${formatDate(t.deleted)}`, `from ${parentOf(t.from)}`].filter(Boolean).join(' · ')));
      row.appendChild(text);
      bindRow(row, t.id, () => {});
      list.appendChild(row);
    }
    body.appendChild(list);
  }
  const selectedTrash = () => st.trash.filter((t) => st.sel.has(t.id));
  async function actRestore() {
    const items = selectedTrash();
    if (!items.length) return;
    const r = await manage.restoreItems(fsApi, items);
    st.sel.clear();
    toast(r.failed ? `${r.done} restored, ${r.failed} could not be restored.` : `${plural(r.done, 'item')} restored.`);
    await showTrash();
  }
  async function actDeleteForever() {
    const items = selectedTrash();
    if (!items.length) return;
    const yes = await ui.askYesNo?.({ title: 'Delete for good?', text: `${items.length === 1 ? `"${items[0].name}"` : plural(items.length, 'item')} will be deleted permanently. This cannot be undone.`, yes: 'Delete for good', no: 'Cancel' });
    if (!yes) return;
    const r = await manage.purgeItems(fsApi, items);
    st.sel.clear();
    toast(r.failed ? `${r.done} deleted, ${r.failed} could not be deleted.` : `${plural(r.done, 'item')} deleted.`);
    await showTrash();
  }
  async function actEmpty() {
    const n = st.trash.length;
    if (!n) return;
    const yes = await ui.askYesNo?.({ title: 'Empty the trash?', text: `All ${plural(n, 'item')} in the trash will be deleted permanently. This cannot be undone.`, yes: 'Empty trash', no: 'Cancel' });
    if (!yes) return;
    const r = await manage.purgeItems(fsApi, st.trash);
    st.sel.clear();
    toast(r.failed ? `${r.done} deleted, ${r.failed} could not be deleted.` : 'Trash emptied.');
    await showTrash();
  }

  // Text, image, PDF, audio and video open in the built-in viewer; anything else goes to another app (Decision 211).
  function openFile(e) {
    const kind = kindOf(e.name);
    if (viewer || !VIEW_KINDS.includes(kind) || !ui.onActivity) return openExternal(e);
    const siblings = kind === 'image' ? shownItems().filter((x) => !x.isDir && kindOf(x.name) === 'image') : [];
    viewer = openFileViewer(e, {
      kind, siblings, toUri: toFileUri, ui, toast, isVault, external: openExternal,
      onClose: ({ changed }) => { viewer = null; if (changed && !closed && st.view === 'folder') showFolder(st.cwd); }
    });
    return undefined;
  }

  async function openExternal(e) {
    try {
      leaving();
      await FileOpener.open({ filePath: toFileUri(e.path), contentType: mimeOf(e.name), openWithDefault: true });
    } catch (err) {
      const code = String(err?.code ?? '');
      toast(code === '8' ? 'No app on this phone can open this file type.' : code === '9' ? 'The file could not be found.' : 'Could not open the file.');
    }
  }

  function finish() {
    if (closed) return;
    closed = true;
    if (viewer) viewer.destroy(); // closed is already set, so the folder is not listed again
    document.removeEventListener('visibilitychange', onVisible);
    screen.classList.add('hidden');
    body.replaceChildren(); crumbsEl.replaceChildren(); filterEl.value = '';
    st.entries = []; st.volumes = []; st.trash = []; st.sel.clear(); syncSelUi(); // the listing does not outlive the screen
    onClose();
  }
  function back() {
    if (viewer) { viewer.back(); return; }
    if (selecting()) { clearSel(); return; }
    if (st.view === 'props') { returnToFolder(); return; }
    if (st.view === 'trash') { if (st.from) showFolder(st.from.cwd); else showRoots(); return; }
    if (st.view === 'folder') {
      if (st.filter) { st.filter = ''; filterEl.value = ''; renderList(); return; }
      if (st.cwd === st.volume.path) showRoots(); else showFolder(parentOf(st.cwd));
    } else finish();
  }
  function onVisible() {
    if (document.hidden || closed) return;
    if (st.view === 'gate' && hasAccess()) showRoots(); // returning from Android's settings screen
    else if (st.view === 'roots') showRoots(); // a drive may have been plugged in or removed
  }

  $('explorer-back-btn').onclick = back;
  $('explorer-refresh-btn').onclick = () => { if (st.view === 'folder') showFolder(st.cwd); else if (st.view === 'trash') showTrash(); else if (st.view === 'props') return; else if (st.view === 'roots') showRoots(); else if (hasAccess()) showRoots(); };
  $('explorer-hidden-btn').onclick = () => {
    st.hidden = !st.hidden;
    clearSel();
    $('explorer-hidden-btn').setAttribute('aria-pressed', String(st.hidden));
    $('explorer-hidden-btn').querySelector('use').setAttribute('href', st.hidden ? '#i-eyeoff' : '#i-eye');
    renderList();
  };
  filterEl.oninput = () => { st.filter = filterEl.value; clearSel(); renderList(); };
  document.querySelectorAll('#explorer-tools [data-sort]').forEach((b) => {
    b.onclick = () => { st.sort = st.sort.key === b.dataset.sort ? { key: st.sort.key, dir: -st.sort.dir } : { key: b.dataset.sort, dir: b.dataset.sort === 'name' ? 1 : -1 }; renderList(); };
  });
  $('explorer-new-btn').onclick = actNewFolder;
  $('explorer-trash-btn').onclick = showTrash;
  $('explorer-sel-cancel').onclick = clearSel;
  $('explorer-sel-all').onclick = () => {
    const keys = st.view === 'trash' ? st.trash.map((t) => t.id) : shownItems().map((e) => e.path);
    if (keys.every((k) => st.sel.has(k))) st.sel.clear(); else keys.forEach((k) => st.sel.add(k));
    syncSelUi(); markRows();
  };
  $('explorer-sel-rename').onclick = actRename;
  $('explorer-sel-info').onclick = actInfo;
  $('explorer-sel-restore').onclick = actRestore;
  $('explorer-sel-delete').onclick = () => (st.view === 'trash' ? actDeleteForever() : actDelete());
  document.addEventListener('visibilitychange', onVisible);

  $('explorer-hidden-btn').setAttribute('aria-pressed', 'false');
  $('explorer-hidden-btn').querySelector('use').setAttribute('href', '#i-eye');
  screen.classList.remove('hidden');
  if (hasAccess()) showRoots(); else showGate();
  return { finish, back, isVault };
}
