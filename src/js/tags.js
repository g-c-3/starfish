// Tags (Decisions 587 to 592): the one tag control used by every capture and edit, the saved-tags dialog, the Tags
// Management page and the storage operations behind them. Names are plain strings; an entry holds up to MAX_TAGS.
// Main-scope tags are the ones used by entries outside the Vault (live or in the Trash) plus the ones added on the
// Tags Management page. Vault tags are never listed here and never changed from here.
export const MAX_TAGS = 3;
export const MAX_TAG_LENGTH = 30;
const KEY_SUGGEST = 'tag_suggestions'; // 'off' turns suggestions off; anything else (or nothing) is on
const KEY_SAVED = 'tags_saved'; // JSON array: tags added on the Tags Management page, so an unused one stays listed

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lower = (s) => String(s ?? '').trim().toLowerCase();
const fold = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const CHEVRON = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// Saved tags that start with what was typed, not already chosen, in the order given (most used first). "G" lists Global, Gokul
// and Google; "Go" lists Gokul and Google; "Goo" lists Google.
export function suggestTags(known, typed, chosen = []) {
  const q = fold(typed).trim();
  if (!q) return [];
  const taken = new Set(chosen.map(fold));
  const seen = new Set();
  const out = [];
  for (const k of known) {
    const f = fold(k);
    if (f.startsWith(q) && !taken.has(f) && !seen.has(f)) { seen.add(f); out.push(k); }
  }
  return out;
}

// A name as stored: trimmed, inner spaces collapsed, cut to MAX_TAG_LENGTH.
export function cleanTagName(s) { return String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TAG_LENGTH); }

let ctx = null; // { getDb, metaGet, metaSet, toast, askText, askYesNo, onState, refresh }
let suggestOn = true;

export async function initTags(c) {
  ctx = c;
  try { suggestOn = (await ctx.metaGet(KEY_SUGGEST)) !== 'off'; } catch { suggestOn = true; }
}
export const suggestionsOn = () => suggestOn;
async function setSuggestions(on) { suggestOn = !!on; try { await ctx.metaSet(KEY_SUGGEST, on ? 'on' : 'off'); } catch { /* the choice stays for this run */ } }

// ---- storage
async function savedExtras() {
  try { const v = JSON.parse((await ctx.metaGet(KEY_SAVED)) || '[]'); return Array.isArray(v) ? v.map(cleanTagName).filter(Boolean) : []; } catch { return []; }
}
async function setExtras(list) {
  const seen = new Set(); const out = [];
  for (const t of list) { const n = cleanTagName(t); if (n && !seen.has(lower(n))) { seen.add(lower(n)); out.push(n); } }
  try { await ctx.metaSet(KEY_SAVED, JSON.stringify(out)); } catch { /* not saved */ }
}

// Tags offered when saving: the scope's tags used by live entries, most used first; Home also lists the ones added on the page.
export async function listKnownTags(db, listTagsForScope, isVault) {
  let used = [];
  try { used = await listTagsForScope(db, isVault); } catch { used = []; }
  if (isVault) return used;
  const seen = new Set(used.map(lower));
  const extra = (await savedExtras()).filter((t) => !seen.has(lower(t))).sort((a, b) => a.localeCompare(b));
  return [...used, ...extra];
}

// Main-scope tags with the number of files using each (Trash included), most used first, then by name.
async function listMainTags(db) {
  const rows = (await db.query(
    `SELECT t.id AS id, t.name AS name, COUNT(DISTINCT et.entry_id) AS n
     FROM tags t JOIN entry_tags et ON et.tag_id = t.id JOIN entries e ON e.id = et.entry_id
     WHERE e.is_private = 0 GROUP BY t.id`)).values || [];
  const byName = new Map(rows.map((r) => [lower(r.name), { name: r.name, count: r.n }]));
  for (const t of await savedExtras()) if (!byName.has(lower(t))) byName.set(lower(t), { name: t, count: 0 });
  return [...byName.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
async function tagId(db, name) {
  await db.run(`INSERT OR IGNORE INTO tags (name) VALUES (?)`, [name]);
  return ((await db.query(`SELECT id FROM tags WHERE name = ?`, [name])).values || [])[0]?.id;
}
async function mainEntriesOf(db, id) {
  return ((await db.query(
    `SELECT et.entry_id AS entry_id FROM entry_tags et JOIN entries e ON e.id = et.entry_id WHERE et.tag_id = ? AND e.is_private = 0`, [id])).values || []).map((r) => r.entry_id);
}
async function dropIfUnused(db, id) {
  const left = ((await db.query(`SELECT COUNT(*) AS n FROM entry_tags WHERE tag_id = ?`, [id])).values || [])[0]?.n || 0;
  if (!left) await db.run(`DELETE FROM tags WHERE id = ?`, [id]);
}

// Replaces oldName with newName on every file outside the Vault. A name already saved (any case) takes the files in its own spelling.
async function renameMainTag(db, oldName, newName, known) {
  const target = known.find((k) => lower(k) === lower(newName) && k !== oldName) || newName;
  const oldRow = ((await db.query(`SELECT id FROM tags WHERE name = ?`, [oldName])).values || [])[0];
  if (oldRow) {
    const newId = await tagId(db, target);
    for (const entryId of await mainEntriesOf(db, oldRow.id)) {
      await db.run(`INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?,?)`, [entryId, newId]);
      await db.run(`DELETE FROM entry_tags WHERE entry_id = ? AND tag_id = ?`, [entryId, oldRow.id]);
    }
    await dropIfUnused(db, oldRow.id);
  }
  const extras = await savedExtras();
  if (extras.some((t) => lower(t) === lower(oldName))) await setExtras([...extras.filter((t) => lower(t) !== lower(oldName)), target]);
}
async function deleteMainTag(db, name) {
  const row = ((await db.query(`SELECT id FROM tags WHERE name = ?`, [name])).values || [])[0];
  if (row) {
    await db.run(`DELETE FROM entry_tags WHERE tag_id = ? AND entry_id IN (SELECT id FROM entries WHERE is_private = 0)`, [row.id]);
    await dropIfUnused(db, row.id);
  }
  await setExtras((await savedExtras()).filter((t) => lower(t) !== lower(name)));
}

// ---- the tag control
// host receives the control: chosen tags (tap one to remove it), the input with + and the saved-tags button, and the suggestions.
// get() returns the chosen names; typed() the unadded text; commitTyped() adds that text when there is room.
export function createTagControl(host, { max = MAX_TAGS, selected = [], getKnown = () => [], onChange = () => {}, toast = () => {} } = {}) {
  const root = document.createElement('div');
  root.className = 'tag-control';
  root.innerHTML = `
    <div class="field-row"><span class="field-label">Tags</span><span class="tc-count field-hint"></span></div>
    <div class="tc-selected tag-chips"></div>
    <div class="tag-add">
      <input class="tc-input" type="text" placeholder="New tag" autocomplete="off" maxlength="${MAX_TAG_LENGTH}" aria-label="New tag" />
      <button type="button" class="secondary-btn tc-plus" aria-label="Add tag">+</button>
      <button type="button" class="secondary-btn tc-drop" aria-label="Saved tags">${CHEVRON}</button>
    </div>
    <div class="tag-suggest hidden" role="listbox" aria-label="Saved tags that match"></div>`;
  host.replaceChildren(root);
  const q = (s) => root.querySelector(s);
  const input = q('.tc-input'), plus = q('.tc-plus'), drop = q('.tc-drop'), chips = q('.tc-selected'), count = q('.tc-count'), panel = q('.tag-suggest');
  let sel = [];
  for (const t of selected) { const n = cleanTagName(t); if (n && !sel.some((x) => lower(x) === lower(n)) && sel.length < max) sel.push(n); }
  const full = () => sel.length >= max;

  // The list is as tall as the room below the input down to the keyboard or the bottom of the screen, and scrolls.
  const fit = () => {
    if (panel.classList.contains('hidden')) return;
    const vv = window.visualViewport;
    const bottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
    const room = bottom - panel.getBoundingClientRect().top - 12;
    panel.style.maxHeight = `${Math.max(88, Math.floor(room))}px`;
  };
  const renderSuggest = () => {
    const list = !full() && suggestOn ? suggestTags(getKnown(), input.value, sel) : [];
    panel.classList.toggle('hidden', !list.length);
    panel.innerHTML = list.map((t) => `<button type="button" role="option" data-tag="${esc(t)}">${esc(t)}</button>`).join('');
    if (list.length) { fit(); panel.scrollTop = 0; }
  };
  const render = () => {
    chips.innerHTML = sel.map((t) => `<button type="button" class="selected" data-tag="${esc(t)}" aria-label="Remove tag ${esc(t)}">${esc(t)}<span class="tc-x" aria-hidden="true">×</span></button>`).join('');
    count.textContent = `${sel.length} / ${max}`;
    const off = full();
    input.disabled = plus.disabled = drop.disabled = off;
    input.placeholder = off ? 'Tag limit reached' : 'New tag';
    renderSuggest();
  };
  const add = (name) => {
    const t = cleanTagName(name);
    if (!t) return true;
    if (sel.some((x) => lower(x) === lower(t))) { input.value = ''; render(); return true; }
    if (full()) { toast(`Up to ${max} tags`); return false; }
    sel.push(getKnown().find((k) => lower(k) === lower(t)) || t);
    input.value = '';
    render();
    onChange();
    return true;
  };
  chips.onclick = (e) => {
    const b = e.target.closest('button[data-tag]');
    if (!b) return;
    sel = sel.filter((x) => x !== b.dataset.tag);
    render();
    onChange();
  };
  panel.onclick = (e) => { const b = e.target.closest('button[data-tag]'); if (b) add(b.dataset.tag); };
  plus.onclick = () => add(input.value);
  input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); add(input.value); } };
  input.oninput = () => { renderSuggest(); onChange(); };
  drop.onclick = async () => {
    const t = await openTagPicker({ known: getKnown(), chosen: sel });
    if (t) add(t);
  };
  if (window.visualViewport) { window.visualViewport.addEventListener('resize', fit); window.visualViewport.addEventListener('scroll', fit); }
  render();
  return {
    get: () => sel.slice(),
    typed: () => input.value,
    setTyped: (v) => { input.value = v || ''; renderSuggest(); },
    commitTyped: () => add(input.value),
    refresh: render
  };
}

// ---- the saved-tags dialog (a dialog over the sheet: motion.js animates .modal-overlay)
let picker = null;
export const tagPickerOpen = () => !!picker;
export function closeTagPicker() { if (picker) picker.finish(null); }
export function openTagPicker({ known = [], chosen = [] } = {}) {
  if (picker) return Promise.resolve(null);
  return new Promise((resolve) => {
    const dlg = $('tag-picker-dialog'), search = $('tpk-search'), list = $('tpk-list'), empty = $('tpk-empty');
    const taken = new Set(chosen.map(lower));
    const names = known.filter((k) => !taken.has(lower(k)));
    const draw = () => {
      const term = fold(search.value).trim();
      const shown = names.filter((n) => !term || fold(n).includes(term));
      list.innerHTML = shown.map((n) => `<button type="button" data-tag="${esc(n)}">${esc(n)}</button>`).join('');
      empty.classList.toggle('hidden', shown.length > 0);
      empty.textContent = names.length ? 'No saved tag matches.' : 'No saved tags yet. Type a new one and tap +.';
    };
    const finish = (v) => {
      if (!picker) return;
      picker = null;
      dlg.classList.add('hidden');
      search.value = '';
      document.activeElement?.blur?.();
      if (ctx && ctx.onState) ctx.onState();
      resolve(v);
    };
    search.value = '';
    search.oninput = draw;
    list.onclick = (e) => { const b = e.target.closest('button[data-tag]'); if (b) finish(b.dataset.tag); };
    $('tpk-close-btn').onclick = () => finish(null);
    picker = { finish };
    draw();
    dlg.classList.remove('hidden');
    if (ctx && ctx.onState) ctx.onState();
  });
}

// ---- the Tags Management page (a layer over Settings, registered in motion.js LAYERS)
let page = null;
export const tagsPageOpen = () => !!page;
export function closeTagsPage() { if (page) page.finish(); }
export function closeTagsUi() { closeTagPicker(); closeTagsPage(); }
export async function openTagsPage() {
  if (page) return;
  const screen = $('tags-screen'), listEl = $('tg-list'), emptyEl = $('tg-empty'), toggle = $('tg-suggest-toggle');
  const db = ctx.getDb();
  let rows = [];
  const summary = (n) => (n === 1 ? '1 file' : `${n} files`);
  const draw = async () => {
    rows = await listMainTags(db);
    emptyEl.classList.toggle('hidden', rows.length > 0);
    listEl.innerHTML = rows.map((r, i) => `
      <div class="tg-row">
        <div class="tg-info"><b>${esc(r.name)}</b><small>${r.count ? summary(r.count) : 'Not used yet'}</small></div>
        <button type="button" class="secondary-btn tg-edit" data-i="${i}">Edit</button>
        <button type="button" class="secondary-btn tg-del" data-i="${i}">Delete</button>
      </div>`).join('');
  };
  const refreshApp = async () => { try { if (ctx.refresh) await ctx.refresh(); } catch { /* lists redraw on the next visit */ } };
  const known = () => rows.map((r) => r.name);

  $('tg-add-btn').onclick = async () => {
    const v = await ctx.askText({ title: 'New tag', placeholder: 'Tag name', ok: 'Add' });
    if (v == null) return;
    const name = cleanTagName(v);
    if (!name) { ctx.toast('Type a name'); return; }
    if (known().some((k) => lower(k) === lower(name))) { ctx.toast('That tag already exists'); return; }
    await setExtras([...(await savedExtras()), name]);
    await draw();
  };
  listEl.onclick = async (e) => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    const row = rows[Number(b.dataset.i)];
    if (!row) return;
    if (b.classList.contains('tg-edit')) {
      const v = await ctx.askText({ title: 'Edit tag', placeholder: 'Tag name', initial: row.name, ok: 'Next' });
      if (v == null) return;
      const next = cleanTagName(v);
      if (!next) { ctx.toast('Type a name'); return; }
      if (next === row.name) return;
      const text = row.count
        ? `"${row.name}" will be replaced by "${next}" in ${summary(row.count)}. If "${next}" already exists, those files join it.`
        : `"${row.name}" is not used by any file. It will be saved as "${next}".`;
      if (!(await ctx.askYesNo({ title: 'Rename tag?', text, yes: 'Rename', no: 'Cancel' }))) return;
      try { await renameMainTag(db, row.name, next, known()); ctx.toast('Tag renamed'); } catch (err) { ctx.toast(`Could not rename: ${err.message || err}`); }
      await draw();
      await refreshApp();
    } else {
      const text = row.count
        ? `${summary(row.count)} will lose the tag "${row.name}". The files themselves stay.`
        : `"${row.name}" is not used by any file. It will be removed from the saved tags.`;
      if (!(await ctx.askYesNo({ title: 'Delete tag?', text, yes: 'Delete', no: 'Cancel' }))) return;
      try { await deleteMainTag(db, row.name); ctx.toast('Tag deleted'); } catch (err) { ctx.toast(`Could not delete: ${err.message || err}`); }
      await draw();
      await refreshApp();
    }
  };
  toggle.checked = suggestOn;
  toggle.onchange = () => setSuggestions(toggle.checked);
  const finish = () => {
    if (!page) return;
    page = null;
    screen.classList.add('hidden');
    document.activeElement?.blur?.();
    if (ctx.onState) ctx.onState();
  };
  $('tg-back-btn').onclick = finish;
  page = { finish };
  await draw();
  screen.classList.remove('hidden');
  if (ctx.onState) ctx.onState();
}

export { listMainTags, renameMainTag, deleteMainTag };
