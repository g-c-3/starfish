// explorer.js — the File explorer screen (Decisions 206, 207). Browses the phone's own storage, internal and removable
// (SD card, USB drive), like a file manager. Nothing here is encrypted or copied anywhere: it lists and opens what is on the
// phone. Needs "All files access", granted once in Android's own settings (native bridge: scripts/patch-explorer.js).

import { Filesystem } from '@capacitor/filesystem';
import { FileOpener } from '@capacitor-community/file-opener';

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

// leaving() runs just before the screen hands over to another app or to Android's settings, so the app's lock-on-background
// does not fire for that one pause (the same flag the file pickers set, Decision 73).
export function openExplorer({ isVault = false, toast = () => {}, onClose = () => {}, leaving = () => {} } = {}) {
  const $ = (id) => document.getElementById(id);
  const screen = $('explorer-screen'), body = $('explorer-body'), titleEl = $('explorer-title');
  const crumbsEl = $('explorer-crumbs'), toolsEl = $('explorer-tools'), filterEl = $('explorer-filter');
  const st = { view: 'gate', volumes: [], volume: null, cwd: null, entries: [], sort: { key: 'name', dir: 1 }, hidden: false, filter: '', gen: 0 };
  let closed = false;

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const icon = (id) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('class', 'ic'); s.setAttribute('aria-hidden', 'true'); const u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', '#' + id); s.appendChild(u); return s; };
  const hasAccess = () => { try { return !!bridge()?.hasAllFilesAccess(); } catch { return false; } };
  const readVolumes = () => { try { return JSON.parse(bridge().volumes() || '[]'); } catch { return []; } };

  function chrome({ title, folder }) {
    titleEl.textContent = title;
    crumbsEl.classList.toggle('hidden', !folder);
    toolsEl.classList.toggle('hidden', !folder);
    $('explorer-hidden-btn').classList.toggle('hidden', !folder);
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

  function renderList() {
    if (st.view !== 'folder') return;
    let items = st.entries;
    if (!st.hidden) items = items.filter((e) => !e.name.startsWith('.'));
    const q = st.filter.trim().toLowerCase();
    if (q) items = items.filter((e) => e.name.toLowerCase().includes(q));
    items = sortEntries(items, st.sort);
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
      const ico = el('span', 'row-icon');
      const ext = e.isDir ? '' : extOf(e.name);
      if (e.isDir) ico.appendChild(icon('i-file'));
      else if (ext && ext.length <= 4) { ico.classList.add('ext-badge'); ico.dataset.len = String(ext.length); ico.textContent = ext; }
      else ico.appendChild(icon('i-file'));
      row.appendChild(ico);
      const text = el('span', 'explorer-text');
      text.appendChild(el('span', 'explorer-name', e.name));
      text.appendChild(el('span', 'explorer-meta', e.isDir ? `Folder${e.mtime ? ' · ' + formatDate(e.mtime) : ''}` : [formatSize(e.size), formatDate(e.mtime)].filter(Boolean).join(' · ')));
      row.appendChild(text);
      row.addEventListener('click', () => (e.isDir ? showFolder(e.path) : openFile(e)));
      list.appendChild(row);
    }
    body.appendChild(list);
  }

  async function openFile(e) {
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
    document.removeEventListener('visibilitychange', onVisible);
    screen.classList.add('hidden');
    body.replaceChildren(); crumbsEl.replaceChildren(); filterEl.value = '';
    st.entries = []; st.volumes = []; // the listing does not outlive the screen
    onClose();
  }
  function back() {
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
  $('explorer-refresh-btn').onclick = () => { if (st.view === 'folder') showFolder(st.cwd); else if (st.view === 'roots') showRoots(); else if (hasAccess()) showRoots(); };
  $('explorer-hidden-btn').onclick = () => {
    st.hidden = !st.hidden;
    $('explorer-hidden-btn').setAttribute('aria-pressed', String(st.hidden));
    $('explorer-hidden-btn').querySelector('use').setAttribute('href', st.hidden ? '#i-eyeoff' : '#i-eye');
    renderList();
  };
  filterEl.oninput = () => { st.filter = filterEl.value; renderList(); };
  document.querySelectorAll('#explorer-tools [data-sort]').forEach((b) => {
    b.onclick = () => { st.sort = st.sort.key === b.dataset.sort ? { key: st.sort.key, dir: -st.sort.dir } : { key: b.dataset.sort, dir: b.dataset.sort === 'name' ? 1 : -1 }; renderList(); };
  });
  document.addEventListener('visibilitychange', onVisible);

  $('explorer-hidden-btn').setAttribute('aria-pressed', 'false');
  $('explorer-hidden-btn').querySelector('use').setAttribute('href', '#i-eye');
  screen.classList.remove('hidden');
  if (hasAccess()) showRoots(); else showGate();
  return { finish, back, isVault };
}
