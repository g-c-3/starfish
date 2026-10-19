// explorer.js — the File explorer screen (Decisions 206, 207, 211). Browses the phone's own storage, internal and removable
// (SD card, USB drive), like a file manager. Nothing here is encrypted or copied anywhere: it lists and opens what is on the
// phone. Needs "All files access", granted once in Android's own settings (native bridge: scripts/patch-explorer.js).

import { Filesystem, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { FileOpener } from '@capacitor-community/file-opener';
import { openFileViewer, VIEW_KINDS } from './explorer-view.js';
import * as manage from './explorer-manage.js';
import { startOps, destProblem, resultText, findConflicts, canReplace } from './explorer-ops.js';
import { isArchive, startExtract, openBrowse, listFolder, needsPassword, errorText } from './explorer-archive.js';

const KIND_EXT = {
  text: ['txt', 'md', 'log', 'csv', 'tsv', 'json', 'xml', 'html', 'htm', 'css', 'js', 'ts', 'yml', 'yaml', 'ini', 'cfg', 'conf', 'java', 'kt', 'py', 'sh', 'sql', 'rtf', 'srt', 'vcf', 'ics'],
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'avif', 'heic'],
  pdf: ['pdf'],
  audio: ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'opus', 'flac', 'amr', 'mid', 'midi'],
  video: ['mp4', 'webm', 'mkv', '3gp', 'mov', 'avi', 'm4v'],
  docx: ['docx'], xlsx: ['xlsx'], pptx: ['pptx'],
  archive: ['zip', 'gz', 'tar', '7z', 'rar', 'tgz', 'tbz', 'tbz2', 'txz', 'bz2', 'xz', 'cbz', 'cbr', 'jar'],
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
  // The plugin rejects "Directory exists" even with recursive set; for a recursive call an existing folder is success.
  mkdir: async (p, recursive = false) => {
    try { await Filesystem.mkdir({ path: toFileUri(p), recursive }); } catch (err) {
      if (recursive) { try { if ((await fsApi.stat(p)).isDir) return; } catch { /* not there: the original error stands */ } }
      throw err;
    }
  },
  rename: (a, b) => Filesystem.rename({ from: toFileUri(a), to: toFileUri(b) }),
  deleteFile: (p) => Filesystem.deleteFile({ path: toFileUri(p) }),
  rmdir: (p) => Filesystem.rmdir({ path: toFileUri(p), recursive: true }),
  readText: async (p) => (await Filesystem.readFile({ path: toFileUri(p), encoding: Encoding.UTF8 })).data,
  writeText: (p, data) => Filesystem.writeFile({ path: toFileUri(p), data, encoding: Encoding.UTF8 }),
};
const sizeText = (n) => `${formatSize(n)}${n >= 1024 ? ` (${n.toLocaleString()} bytes)` : ''}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
// The first reason a batch gave, for the toast: ": <reason>" or nothing.
const why = (r) => (r.error ? `: ${String(r.error).replace(/\.$/, '')}` : '');
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
  const st = { view: 'gate', volumes: [], volume: null, cwd: null, entries: [], sort: { key: 'name', dir: 1 }, hidden: false, filter: '', gen: 0, sel: new Set(), trash: [], from: null, arc: null, pick: null, resolve: null };
  let closed = false, viewer = null, purged = false, job = null, browse = null;

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const icon = (id) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('class', 'ic'); s.setAttribute('aria-hidden', 'true'); const u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', '#' + id); s.appendChild(u); return s; };
  const hasAccess = () => { try { return !!bridge()?.hasAllFilesAccess(); } catch { return false; } };
  const readVolumes = () => { try { return JSON.parse(bridge().volumes() || '[]'); } catch { return []; } };

  function chrome({ title, folder, archive = false }) {
    clearSel();
    titleEl.textContent = title;
    crumbsEl.classList.toggle('hidden', !(folder || archive));
    toolsEl.classList.toggle('hidden', !(folder || archive));
    $('explorer-extract-btn').classList.toggle('hidden', !archive);
    document.querySelector('#explorer-tools [data-sort="date"]')?.classList.toggle('hidden', archive); // entries carry no date
    $('explorer-hidden-btn').classList.toggle('hidden', !folder);
    $('explorer-new-btn').classList.toggle('hidden', !folder);
    $('explorer-trash-btn').classList.toggle('hidden', !(folder || st.view === 'roots'));
  }

  // ---- Selection (long-press) ----
  const selecting = () => st.sel.size > 0;
  function syncSelUi() {
    const on = selecting() && (st.view === 'folder' || st.view === 'trash' || st.view === 'archive');
    screen.classList.toggle('selecting', on);
    $('explorer-selbar').classList.toggle('hidden', !on);
    $('explorer-head').classList.toggle('hidden', on);
    $('explorer-selbar2').classList.toggle('hidden', !(on && st.view === 'folder'));
    if (!on) return;
    const n = st.sel.size, trash = st.view === 'trash', arc = st.view === 'archive';
    $('explorer-sel-count').textContent = `${n} selected`;
    for (const id of ['explorer-sel-rename', 'explorer-sel-info']) { $(id).classList.toggle('hidden', trash || arc); $(id).disabled = n !== 1; }
    $('explorer-sel-restore').classList.toggle('hidden', !trash);
    $('explorer-sel-delete').classList.toggle('hidden', arc); // an archive is read-only
    $('explorer-sel-share').disabled = arc || trash || selectedEntries().some((e) => e.isDir); // only files can be shared
    const one = n === 1 && !trash && !arc ? selectedEntries()[0] : null;
    $('explorer-sel-extract').classList.toggle('hidden', !(arc || (one && !one.isDir && isArchive(one.name))));
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

  function renderArcCrumbs() {
    crumbsEl.replaceChildren();
    const segs = st.arc.prefix ? st.arc.prefix.split('/') : [];
    const parts = [{ name: st.arc.name, prefix: '' }, ...segs.map((n, i) => ({ name: n, prefix: segs.slice(0, i + 1).join('/') }))];
    parts.forEach((c, i) => {
      if (i) crumbsEl.appendChild(el('span', 'crumb-sep', '›'));
      const b = el('button', 'crumb' + (i === parts.length - 1 ? ' current' : ''), c.name);
      b.addEventListener('click', () => showArchiveDir(c.prefix));
      crumbsEl.appendChild(b);
    });
    crumbsEl.scrollLeft = crumbsEl.scrollWidth;
  }

  // What the list shows now: hidden-file toggle, name filter and sort applied.
  function shownItems() {
    let items = st.view === 'archive' ? st.arc.items : st.entries;
    if (!st.hidden && st.view !== 'archive') items = items.filter((e) => !e.name.startsWith('.'));
    const q = st.filter.trim().toLowerCase();
    if (q) items = items.filter((e) => e.name.toLowerCase().includes(q));
    return sortEntries(items, st.sort);
  }

  function renderList() {
    if (st.view !== 'folder' && st.view !== 'archive') return;
    const q = st.filter.trim().toLowerCase();
    const items = shownItems();
    document.querySelectorAll('#explorer-tools [data-sort]').forEach((b) => {
      const on = b.dataset.sort === st.sort.key;
      b.classList.toggle('active', on);
      b.textContent = b.dataset.label + (on ? (st.sort.dir === 1 ? ' ↑' : ' ↓') : '');
    });
    body.replaceChildren();
    if (!items.length) { message(q ? 'No file or folder matches.' : st.view === 'archive' ? 'This folder of the archive is empty.' : 'This folder is empty.'); return; }
    const list = el('div', 'explorer-list');
    for (const e of items) {
      const row = el('button', 'explorer-row');
      row.appendChild(rowIcon(e.name, e.isDir));
      const text = el('span', 'explorer-text');
      text.appendChild(el('span', 'explorer-name', e.name));
      text.appendChild(el('span', 'explorer-meta', e.isDir ? `Folder${e.mtime ? ' · ' + formatDate(e.mtime) : ''}` : [formatSize(e.size), formatDate(e.mtime)].filter(Boolean).join(' · ')));
      row.appendChild(text);
      bindRow(row, e.path, () => (st.view === 'archive' ? (e.isDir ? showArchiveDir(e.path) : openArcEntry(e)) : (e.isDir ? showFolder(e.path) : openFile(e))));
      list.appendChild(row);
    }
    body.appendChild(list);
    syncSelUi();
  }

  const selectedEntries = () => (st.view === 'archive' ? st.arc.items : st.entries).filter((e) => st.sel.has(e.path));
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
    toast(r.failed ? `${r.done} moved to trash, ${r.failed} could not be moved${why(r)}.` : `${r.done} moved to trash.`);
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
    toast(r.failed ? `${r.done} restored, ${r.failed} could not be restored${why(r)}.` : `${plural(r.done, 'item')} restored.`);
    await showTrash();
  }
  async function actDeleteForever() {
    const items = selectedTrash();
    if (!items.length) return;
    const yes = await ui.askYesNo?.({ title: 'Delete for good?', text: `${items.length === 1 ? `"${items[0].name}"` : plural(items.length, 'item')} will be deleted permanently. This cannot be undone.`, yes: 'Delete for good', no: 'Cancel' });
    if (!yes) return;
    const r = await manage.purgeItems(fsApi, items);
    st.sel.clear();
    toast(r.failed ? `${r.done} deleted, ${r.failed} could not be deleted${why(r)}.` : `${plural(r.done, 'item')} deleted.`);
    await showTrash();
  }
  async function actEmpty() {
    const n = st.trash.length;
    if (!n) return;
    const yes = await ui.askYesNo?.({ title: 'Empty the trash?', text: `All ${plural(n, 'item')} in the trash will be deleted permanently. This cannot be undone.`, yes: 'Empty trash', no: 'Cancel' });
    if (!yes) return;
    const r = await manage.purgeItems(fsApi, st.trash);
    st.sel.clear();
    toast(r.failed ? `${r.done} deleted, ${r.failed} could not be deleted${why(r)}.` : 'Trash emptied.');
    await showTrash();
  }

  // ---- Copy, move and share (Decision 222) ----
  const volumeOf = (path) => st.volumes.filter((v) => path === v.path || path.startsWith(`${v.path}/`)).sort((a, b) => b.path.length - a.path.length)[0] || null;

  function startPick(op) {
    const items = selectedEntries();
    if (!items.length) return;
    st.pick = { op, sources: items.map((e) => ({ path: e.path, name: e.name, isDir: e.isDir, size: e.size || 0, mtime: e.mtime || 0 })), dir: null };
    if (!st.volumes.length) st.volumes = readVolumes();
    st.sel.clear(); syncSelUi();
    showPick(st.cwd);
  }

  // The destination picker: folders only, from the current folder; the storages are the top.
  async function showPick(dir) {
    const pick = st.pick;
    if (!pick) return;
    const gen = ++st.gen;
    st.view = 'pick'; pick.dir = dir;
    const verb = pick.op === 'copy' ? 'Copy' : 'Move';
    chrome({ title: `${verb} to…`, folder: false });
    crumbsEl.classList.remove('hidden');
    crumbsEl.replaceChildren();
    const vol = dir ? volumeOf(dir) : null;
    const crumb = (label, target, current) => {
      if (crumbsEl.childNodes.length) crumbsEl.appendChild(el('span', 'crumb-sep', '›'));
      const b = el('button', `crumb${current ? ' current' : ''}`, label);
      b.addEventListener('click', () => showPick(target));
      crumbsEl.appendChild(b);
    };
    crumb('Storage', null, dir === null);
    if (vol) {
      crumb(vol.name, vol.path, dir === vol.path);
      const segs = dir.slice(vol.path.length).split('/').filter(Boolean);
      segs.forEach((n, i) => crumb(n, `${vol.path}/${segs.slice(0, i + 1).join('/')}`, i === segs.length - 1));
    }
    crumbsEl.scrollLeft = crumbsEl.scrollWidth;
    body.replaceChildren();
    const list = el('div', 'explorer-list');
    if (dir === null) {
      const top = el('div', 'explorer-banner');
      top.appendChild(el('div', '', `Choose where to ${pick.op === 'copy' ? 'copy' : 'move'} ${plural(pick.sources.length, 'item')}.`));
      const topActions = el('div', 'banner-actions');
      const topCancel = el('button', 'secondary-btn', 'Cancel');
      topCancel.addEventListener('click', cancelPick);
      topActions.appendChild(topCancel);
      top.appendChild(topActions);
      body.appendChild(top);
      for (const v of st.volumes) {
        const row = el('button', 'explorer-row');
        row.appendChild(rowIcon(v.name, true));
        const text = el('span', 'explorer-text');
        text.appendChild(el('span', 'explorer-name', v.name));
        row.appendChild(text);
        row.addEventListener('click', () => showPick(v.path));
        list.appendChild(row);
      }
      body.appendChild(list);
      return;
    }
    const problem = destProblem(pick.op, dir, pick.sources);
    const banner = el('div', 'explorer-banner');
    const note = el('div', '', problem || `${verb} ${plural(pick.sources.length, 'item')} into this folder. Nothing is replaced unless you choose Replace.`);
    banner.appendChild(note);
    const actions = el('div', 'banner-actions');
    const go = el('button', '', `${verb} here`);
    go.disabled = !!problem;
    go.addEventListener('click', () => runOps(dir));
    const mk = el('button', 'secondary-btn', 'New folder');
    mk.addEventListener('click', async () => {
      const raw = await ui.askText?.({ title: 'New folder', placeholder: 'Folder name', ok: 'Create', isVault });
      if (raw === null || raw === undefined) return;
      try { await manage.makeFolder(fsApi, dir, raw); toast('Folder created.'); } catch (err) { toast(errText(err)); }
      if (st.view === 'pick' && st.pick === pick && pick.dir === dir) await showPick(dir);
    });
    const cancel = el('button', 'secondary-btn', 'Cancel');
    cancel.addEventListener('click', cancelPick);
    actions.appendChild(go); actions.appendChild(mk); actions.appendChild(cancel);
    banner.appendChild(actions);
    body.appendChild(banner);
    let entries = [];
    try { entries = await fsApi.readdir(dir); } catch { entries = []; }
    if (gen !== st.gen || closed) return;
    // Folders first, then files. Files are shown for reference only: they show what already exists here. A name that matches an
    // item being copied or moved is marked, with the name the new one would get.
    const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    const taken = new Set(entries.map((e) => e.name.toLowerCase()));
    const incoming = new Map(pick.sources.map((x) => [x.name.toLowerCase(), x]));
    const shown = entries.filter((e) => e.name !== '.arkly-trash' && (!e.name.startsWith('.') || incoming.has(e.name.toLowerCase())));
    const folders = shown.filter((e) => e.isDir).sort(byName);
    const files = shown.filter((e) => !e.isDir).sort(byName);
    let clashes = 0;
    const markClash = (row, text, e) => {
      const src = incoming.get(e.name.toLowerCase());
      if (!src || (pick.op === 'move' && problem)) return;
      clashes++;
      row.classList.add('is-conflict');
      text.appendChild(el('span', 'explorer-tag', 'Same name here — you choose what to do next'));
    };
    if (!shown.length) list.appendChild(el('div', 'explorer-meta', 'This folder is empty.'));
    for (const f of folders) {
      const row = el('button', 'explorer-row');
      row.appendChild(rowIcon(f.name, true));
      const text = el('span', 'explorer-text');
      text.appendChild(el('span', 'explorer-name', f.name));
      markClash(row, text, f);
      row.appendChild(text);
      row.addEventListener('click', () => showPick(`${dir === '/' ? '' : dir}/${f.name}`));
      list.appendChild(row);
    }
    for (const f of files) {
      const row = el('div', 'explorer-row is-info');
      row.appendChild(rowIcon(f.name, false));
      const text = el('span', 'explorer-text');
      text.appendChild(el('span', 'explorer-name', f.name));
      text.appendChild(el('span', 'explorer-meta', [formatSize(f.size), f.mtime ? formatDate(f.mtime) : ''].filter(Boolean).join(' · ')));
      markClash(row, text, f);
      row.appendChild(text);
      list.appendChild(row);
    }
    if (clashes) note.textContent = `${problem || `${verb} ${plural(pick.sources.length, 'item')} into this folder.`} ${plural(clashes, 'item')} already ${clashes === 1 ? 'has' : 'have'} the same name here. Next you choose Replace, Skip or Rename for each.`;
    body.appendChild(list);
  }
  function cancelPick() { st.pick = null; returnToFolder(); }
  // The name a copy would get if `name` is taken: name (1).ext, skipping every name in `taken` (lower case); adds it to `taken`.
  function numbered(name, isDir, taken) {
    const dot = name.lastIndexOf('.');
    const stem = !isDir && dot > 0 ? name.slice(0, dot) : name;
    const ext = !isDir && dot > 0 ? name.slice(dot) : '';
    let n = 1, c = `${stem} (${n})${ext}`;
    while (taken.has(c.toLowerCase())) { n++; c = `${stem} (${n})${ext}`; }
    taken.add(c.toLowerCase());
    return c;
  }
  function pickBack() {
    const pick = st.pick;
    const dir = pick?.dir;
    if (!pick || dir === null || dir === undefined) { st.pick = null; returnToFolder(); return; }
    const vol = volumeOf(dir);
    if (!vol || dir === vol.path) showPick(null); else showPick(parentOf(dir));
  }

  const opsApi = () => (typeof window !== 'undefined' ? window.ArklyFileOps : null);

  // Copy or move into `dest`. Items whose name is free go straight through; for the others the user chooses, item by item or for all
  // of them, between Replace, Skip and Rename (Decision 225).
  async function runOps(dest) {
    const api = opsApi();
    if (!api) { toast('Copy and move work in the Android app.'); return; }
    if (job) return;
    const { op, sources } = st.pick, cwd = st.cwd;
    let entries = [];
    try { entries = await fsApi.readdir(dest); } catch { entries = []; }
    st.pick = null;
    const { clashes, clean } = findConflicts(op, dest, sources, entries);
    const verb = op === 'copy' ? 'Copying' : 'Moving';
    if (!clashes.length || clean.length) {
      st.view = 'extract'; st.gen++; // Back cancels, as for an extraction
      chrome({ title: verb, folder: false });
      const batch = clean.length ? clean : sources;
      const line = panel(`${verb} ${plural(batch.length, 'item')}…`, 'Starting…', () => job?.cancel());
      job = startOps(api, op, dest, batch.map((x) => x.path), {
        onProgress: (p) => { ui.onActivity?.(); line.textContent = `${p.items} of ${p.total} · ${formatSize(p.bytes)}${p.bytesTotal ? ` of ${formatSize(p.bytesTotal)}` : ''}${p.current ? ` · ${p.current}` : ''}`; },
      });
      const res = await job.done;
      job = null;
      if (closed) return;
      if (!clashes.length || res.state !== 'done') { toast(resultText(op, res)); if (st.view === 'extract') await showFolder(cwd); return; }
      toast(resultText(op, res));
    }
    if (closed || !clashes.length) return;
    st.resolve = { op, dest, cwd, busy: false, stop: false, names: new Set(entries.map((e) => e.name.toLowerCase())), tally: { replaced: 0, renamed: 0, skipped: 0 }, items: clashes.map((c) => ({ ...c, busy: false, error: '', lineEl: null })) };
    showResolve();
  }

  // ---- Name clashes: Replace, Skip or Rename, per item or for all (Decision 225) ----
  const descOf = (e) => (e.isDir ? 'Folder' : `${sizeText(e.size || 0)}${e.mtime ? ` · ${formatDate(e.mtime)}` : ''}`);
  function showResolve() {
    st.view = 'resolve'; st.gen++;
    chrome({ title: 'Name clashes', folder: false });
    renderResolve();
  }
  function renderResolve() {
    const R = st.resolve;
    if (!R || st.view !== 'resolve') return;
    if (!R.items.length) { endResolve(); return; }
    body.replaceChildren();
    const n = R.items.length;
    const folderName = R.dest.split('/').filter(Boolean).pop() || R.dest;
    const banner = el('div', 'explorer-banner');
    banner.appendChild(el('div', '', `${plural(n, 'item')} already ${n === 1 ? 'exists' : 'exist'} in "${folderName}". Choose what to do with each one, or with all of them. Replace deletes the existing file for good; a folder is never replaced.`));
    const bulk = el('div', 'banner-actions');
    const mkBtn = (label, cls, fn, disabled) => { const b = el('button', cls, label); b.disabled = !!disabled; b.addEventListener('click', fn); return b; };
    const anyReplace = R.items.some((i) => canReplace(i.src, i.existing));
    bulk.appendChild(mkBtn('Replace all', 'danger-btn', () => bulkResolve('replace'), R.busy || !anyReplace));
    bulk.appendChild(mkBtn('Skip all', 'secondary-btn', () => bulkResolve('skip'), R.busy));
    bulk.appendChild(mkBtn('Rename all', 'secondary-btn', () => bulkResolve('rename'), R.busy));
    banner.appendChild(bulk);
    body.appendChild(banner);
    const list = el('div', 'explorer-list');
    const preview = new Set(R.names);
    for (const item of R.items) {
      const row = el('div', 'explorer-row resolve-row');
      row.appendChild(el('span', 'explorer-name', item.src.name));
      row.appendChild(el('span', 'explorer-meta', `Existing: ${descOf(item.existing)}`));
      row.appendChild(el('span', 'explorer-meta', `New: ${descOf(item.src)}`));
      if (item.error) row.appendChild(el('span', 'explorer-tag error', item.error));
      if (item.busy) {
        item.lineEl = el('span', 'explorer-meta', 'Working…');
        row.appendChild(item.lineEl);
      } else {
        const acts = el('div', 'banner-actions');
        if (canReplace(item.src, item.existing)) acts.appendChild(mkBtn('Replace', 'danger-btn', () => resolveItem(item, 'replace'), R.busy));
        acts.appendChild(mkBtn('Skip', 'secondary-btn', () => resolveItem(item, 'skip'), R.busy));
        acts.appendChild(mkBtn('Rename', 'secondary-btn', () => resolveItem(item, 'rename'), R.busy));
        row.appendChild(acts);
        row.appendChild(el('span', 'explorer-meta', `Rename saves the new one as "${numbered(item.src.name, item.src.isDir, preview)}"`));
      }
      list.appendChild(row);
    }
    body.appendChild(list);
  }
  const dropItem = (item) => { const R = st.resolve; R.items = R.items.filter((i) => i !== item); };

  async function resolveItem(item, action) {
    const R = st.resolve;
    if (!R || R.busy) return;
    if (action === 'skip') { R.tally.skipped++; dropItem(item); renderResolve(); return; }
    await runResolve([item], action);
  }
  async function bulkResolve(action) {
    const R = st.resolve;
    if (!R || R.busy) return;
    if (action === 'skip') { R.tally.skipped += R.items.length; R.items = []; renderResolve(); return; }
    const items = action === 'replace' ? R.items.filter((i) => canReplace(i.src, i.existing)) : [...R.items];
    if (!items.length) return;
    if (action === 'replace') {
      const yes = await ui.askYesNo?.({
        title: items.length === 1 ? 'Replace this file?' : `Replace ${items.length} files?`,
        text: `${items.length === 1 ? 'The existing file is' : 'The existing files are'} deleted permanently and cannot be restored. A folder is never replaced.`,
        yes: 'Replace', no: 'Cancel',
      });
      if (!yes || st.resolve !== R) return;
    }
    await runResolve(items, action);
  }
  // One native job per item, in order, so each leaves the list as soon as it is done.
  async function runResolve(items, action) {
    const R = st.resolve, api = opsApi();
    if (!api) { toast('Copy and move work in the Android app.'); return; }
    R.busy = true; R.stop = false;
    for (const item of items) {
      if (closed || st.resolve !== R || R.stop) break;
      item.busy = true; item.error = '';
      renderResolve();
      job = startOps(api, R.op, R.dest, [item.src.path], {
        policy: action === 'replace' ? 'replace' : 'rename',
        onProgress: (p) => { ui.onActivity?.(); if (item.lineEl) item.lineEl.textContent = `${formatSize(p.bytes)}${p.bytesTotal ? ` of ${formatSize(p.bytesTotal)}` : ''}`; },
      });
      const res = await job.done;
      job = null;
      if (closed || st.resolve !== R) return;
      item.busy = false;
      if (res.state === 'done' && !res.failed) { R.tally[action === 'replace' ? 'replaced' : 'renamed']++; dropItem(item); }
      else if (res.state === 'cancelled') R.stop = true;
      else item.error = res.state === 'error' ? resultText(R.op, res) : (res.message || 'It could not be done.');
    }
    R.busy = false;
    if (!closed && st.resolve === R) renderResolve();
  }
  function endResolve(left = 0) {
    const R = st.resolve;
    st.resolve = null;
    if (!R) return;
    const t = R.tally, parts = [];
    if (t.replaced) parts.push(`${t.replaced} replaced`);
    if (t.renamed) parts.push(`${t.renamed} renamed`);
    if (t.skipped) parts.push(`${t.skipped} skipped`);
    if (left) parts.push(`${left} left as they were`);
    toast(parts.length ? `${parts.join(', ')}.` : 'Done.');
    showFolder(R.cwd);
  }
  function resolveBack() {
    const R = st.resolve;
    if (!R) return;
    if (R.busy) { R.stop = true; job?.cancel(); return; }
    endResolve(R.items.length);
  }

  async function actShare() {
    const items = selectedEntries();
    if (!items.length) return;
    if (items.some((e) => e.isDir)) { toast('Folders cannot be shared. Select files only.'); return; }
    if (items.length > 100) { toast('Select at most 100 files to share at once.'); return; }
    ui.onActivity?.();
    try {
      await Share.share({ files: items.map((e) => toFileUri(e.path)), title: items.length === 1 ? items[0].name : plural(items.length, 'file') });
    } catch (err) {
      if (!/cancel|dismiss/i.test(err?.message || '')) toast(`Could not share: ${err?.message || 'this storage cannot be shared from.'}`);
    }
  }

  // ---- Archives (Decisions 220, 221): an archive opens like a folder; extracting writes a new folder beside it ----
  const archiveApi = () => (typeof window !== 'undefined' ? window.ArklyArchive : null);
  const panel = (title, lineText, onCancel) => {
    body.replaceChildren();
    const box = el('div', 'explorer-note');
    box.appendChild(el('p', '', title));
    const line = el('p', 'explorer-meta', lineText);
    box.appendChild(line);
    const cancel = el('button', '', 'Cancel');
    cancel.addEventListener('click', onCancel);
    box.appendChild(cancel);
    body.appendChild(box);
    return line;
  };
  const leaveArchive = () => {
    const api = archiveApi();
    if (st.arc) { try { api?.closeArchive(st.arc.id); api?.clearCache(); } catch { /* nothing left to close */ } }
    st.arc = null;
  };

  async function openArchive(e, password = '') {
    const api = archiveApi();
    if (!api) { toast('Opening archives works in the Android app.'); return; }
    if (job || browse || st.arc) return;
    st.view = 'arcopen'; st.gen++;
    chrome({ title: e.name, folder: false });
    const line = panel(`Reading "${e.name}"…`, 'Starting…', () => browse?.cancel());
    browse = openBrowse(api, e.path, { password, onProgress: (p) => { ui.onActivity?.(); line.textContent = `${plural(p.count, 'item')} found`; } });
    const res = await browse.done;
    browse = null;
    if (closed) { if (res.id) try { api.closeArchive(res.id); } catch { /* closed anyway */ } return; }
    if (res.state === 'ready') { st.arc = { path: e.path, name: e.name, password, id: res.id, prefix: '', items: [] }; await showArchiveDir(''); return; }
    if (needsPassword(res)) {
      const pw = await ui.askText?.({ title: 'Password needed', text: errorText(res, !!password), placeholder: 'Password', password: true, ok: 'Open', isVault });
      if (pw) { await openArchive(e, pw); return; }
    } else if (res.state !== 'cancelled') {
      toast(errorText(res, !!password));
    }
    if (!closed && st.view === 'arcopen') returnToFolder();
  }
  async function showArchiveDir(prefix) {
    if (!st.arc) return;
    st.view = 'archive'; st.gen++;
    st.arc.prefix = prefix; st.filter = ''; filterEl.value = '';
    chrome({ title: prefix ? prefix.split('/').pop() : st.arc.name, folder: false, archive: true });
    renderArcCrumbs();
    st.arc.items = listFolder(archiveApi(), st.arc.id, prefix);
    renderList();
  }
  function closeArchiveView() { leaveArchive(); returnToFolder(); }
  function arcBack() {
    if (st.filter) { st.filter = ''; filterEl.value = ''; renderList(); return; }
    if (st.arc.prefix) showArchiveDir(st.arc.prefix.includes('/') ? st.arc.prefix.slice(0, st.arc.prefix.lastIndexOf('/')) : '');
    else closeArchiveView();
  }

  // One file of the archive: copied to the app's cache, shown in the built-in viewer, read-only, removed when the archive closes.
  async function openArcEntry(e) {
    const arc = st.arc, api = archiveApi();
    if (!arc || job) return;
    if (isArchive(e.name)) { toast('Extract this archive first to open it.'); return; }
    const prefix = arc.prefix;
    st.view = 'extract'; st.gen++;
    chrome({ title: 'Opening', folder: false });
    const line = panel(`Opening "${e.name}"…`, 'Starting…', () => job?.cancel());
    job = startExtract(api, arc.path, { password: arc.password, entry: e.path, onProgress: (p) => { ui.onActivity?.(); line.textContent = formatSize(p.bytes); } });
    const res = await job.done;
    job = null;
    if (closed || st.arc !== arc) return;
    if (res.state === 'done' && res.files) {
      await showArchiveDir(prefix);
      openCached({ name: e.name, path: `${res.dest}/${e.path}`, size: e.size, mtime: 0, isDir: false });
      return;
    }
    if (needsPassword(res)) {
      const pw = await ui.askText?.({ title: 'Password needed', text: errorText(res, !!arc.password), placeholder: 'Password', password: true, ok: 'Open', isVault });
      if (pw) { arc.password = pw; await openArcEntry(e); return; }
    } else if (res.state === 'done') {
      toast('That file is not in the archive.');
    } else if (res.state === 'error') {
      toast(errorText(res, !!arc.password));
    }
    if (!closed && st.arc === arc) await showArchiveDir(prefix);
  }
  function openCached(file) {
    const kind = kindOf(file.name);
    if (viewer || !VIEW_KINDS.includes(kind) || !ui.onActivity) { openExternal(file); return; }
    viewer = openFileViewer(file, {
      kind, siblings: [], toUri: toFileUri, ui, toast, isVault, readOnly: true, external: openExternal,
      onClose: () => { viewer = null; },
    });
  }

  // Extract everything, or only `entries` (paths inside the archive), into a new folder beside the archive.
  async function actExtract(e, password = '', entries = null) {
    const api = archiveApi();
    if (!api) { toast('Extracting works in the Android app.'); return; }
    if (job) return;
    const cwd = st.cwd, arc = st.arc, prefix = arc ? arc.prefix : '';
    st.view = 'extract'; st.gen++;
    chrome({ title: 'Extracting', folder: false });
    const line = panel(`Extracting "${e.name}"…`, 'Starting…', () => job?.cancel());
    job = startExtract(api, e.path, { password, entries, onProgress: (p) => { ui.onActivity?.(); line.textContent = `${plural(p.files, 'file')} · ${formatSize(p.bytes)}${p.current ? ` · ${p.current}` : ''}`; } });
    const res = await job.done;
    job = null;
    if (closed) return;
    if (res.state === 'done') {
      const name = res.dest ? res.dest.split('/').pop() : '';
      toast(res.files ? `Extracted ${plural(res.files, 'file')} to "${name}".${res.skipped ? ` ${plural(res.skipped, 'unsafe entry').replace('entrys', 'entries')} skipped.` : ''}` : 'The archive is empty.');
    } else if (res.state === 'cancelled') {
      toast('Extraction cancelled. Nothing was kept.');
    } else if (needsPassword(res)) {
      const pw = await ui.askText?.({ title: 'Password needed', text: errorText(res, !!password), placeholder: 'Password', password: true, ok: 'Extract', isVault });
      if (pw) { if (arc) arc.password = pw; await actExtract(e, pw, entries); return; }
    } else {
      toast(errorText(res, !!password));
    }
    if (closed || st.view !== 'extract') return;
    if (arc && st.arc === arc) await showArchiveDir(prefix); else await showFolder(cwd);
  }
  function actExtractSel() {
    if (st.view === 'archive') {
      const paths = [...st.sel];
      if (!paths.length) return;
      st.sel.clear(); syncSelUi();
      actExtract({ name: st.arc.name, path: st.arc.path }, st.arc.password, paths);
      return;
    }
    const [e] = selectedEntries();
    if (selectedEntries().length === 1 && e && isArchive(e.name)) { st.sel.clear(); syncSelUi(); actExtract(e); }
  }

  // Text, image, PDF, audio and video open in the built-in viewer; anything else goes to another app (Decision 211).
  function openFile(e) {
    if (isArchive(e.name)) { openArchive(e); return undefined; }
    const kind = kindOf(e.name);
    if (viewer || !VIEW_KINDS.includes(kind) || !ui.onActivity) return openExternal(e);
    const siblings = kind === 'image' ? shownItems().filter((x) => !x.isDir && kindOf(x.name) === 'image') : [];
    viewer = openFileViewer(e, {
      kind, siblings, toUri: toFileUri, ui, toast, isVault, external: openExternal,
      onClose: ({ changed }) => { viewer = null; if (changed && !closed && st.view === 'folder') showFolder(st.cwd); }
    });
    return undefined;
  }

  async function openExternal(e, chooser = false) { // chooser: always list the apps that can open it
    try {
      leaving();
      await FileOpener.open({ filePath: toFileUri(e.path), contentType: mimeOf(e.name), openWithDefault: !chooser });
    } catch (err) {
      const code = String(err?.code ?? '');
      toast(code === '8' ? 'No app on this phone can open this file type.' : code === '9' ? 'The file could not be found.' : 'Could not open the file.');
    }
  }

  function finish() {
    if (closed) return;
    closed = true;
    if (job) job.cancel(); // the native side removes what it wrote
    st.pick = null; st.resolve = null;
    if (browse) browse.cancel();
    leaveArchive(); // closes the list and removes the copies taken out for viewing
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
    if (st.view === 'extract') { job?.cancel(); return; }
    if (st.view === 'arcopen') { browse?.cancel(); return; }
    if (st.view === 'pick') { pickBack(); return; }
    if (st.view === 'resolve') { resolveBack(); return; }
    if (st.view === 'archive') { arcBack(); return; }
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
  $('explorer-refresh-btn').onclick = () => { if (st.view === 'folder') showFolder(st.cwd); else if (st.view === 'trash') showTrash(); else if (st.view === 'props' || st.view === 'extract' || st.view === 'archive' || st.view === 'arcopen' || st.view === 'pick' || st.view === 'resolve') return; else if (st.view === 'roots') showRoots(); else if (hasAccess()) showRoots(); };
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
  $('explorer-sel-extract').onclick = actExtractSel;
  $('explorer-sel-copy').onclick = () => startPick('copy');
  $('explorer-sel-move').onclick = () => startPick('move');
  $('explorer-sel-share').onclick = actShare;
  $('explorer-extract-btn').onclick = () => { if (st.arc) actExtract({ name: st.arc.name, path: st.arc.path }, st.arc.password); };
  $('explorer-sel-delete').onclick = () => (st.view === 'trash' ? actDeleteForever() : actDelete());
  document.addEventListener('visibilitychange', onVisible);

  $('explorer-hidden-btn').setAttribute('aria-pressed', 'false');
  $('explorer-hidden-btn').querySelector('use').setAttribute('href', '#i-eye');
  screen.classList.remove('hidden');
  if (hasAccess()) showRoots(); else showGate();
  return { finish, back, isVault };
}
