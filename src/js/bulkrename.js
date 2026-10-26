// bulkrename.js — rename several items at once (Decision 303). planRename() is the whole rule set and has no DOM; askBulkRename()
// is the sheet around it: three ways to build the names (Number, Add text, Find and replace), a letter-case choice, a live preview
// and a warning that the old names are not kept. Nothing is stored: the sheet holds the list in memory and is removed on close.

import '../css/bulkrename.css';

export const MAX_NAME = 120; // the Save dialog's own limit

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SEPS = { space: ' ', underscore: '_', dash: '-', none: '' };

function titleCase(s) { return s.toLowerCase().replace(/(^|[\s_\-.(\[])(\p{L})/gu, (_, a, b) => a + b.toUpperCase()); }
function applyCase(s, mode) {
  if (mode === 'lower') return s.toLowerCase();
  if (mode === 'upper') return s.toUpperCase();
  if (mode === 'title') return titleCase(s);
  return s;
}
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// items: [{ id, label }] in list order. opts: { mode: 'number' | 'text' | 'replace', base, start, minDigits, sep, numberAt,
// prefix, suffix, find, replaceWith, matchCase, caseMode, order }.
// Returns [{ id, oldName, newName, problem }] in the order the names are given; problem is '' or a short reason.
export function planRename(items, opts) {
  const o = { mode: 'number', base: '', start: 1, minDigits: 0, sep: 'space', numberAt: 'after', prefix: '', suffix: '', find: '', replaceWith: '', matchCase: false, caseMode: 'keep', order: 'listed', ...opts };
  let list = items.map((it) => ({ id: it.id, oldName: String(it.label ?? '') }));
  if (o.mode === 'number' && o.order === 'name') list = list.slice().sort((a, b) => a.oldName.localeCompare(b.oldName, undefined, { numeric: true, sensitivity: 'base' }));
  const start = Math.max(0, Math.min(999999, Math.trunc(Number(o.start)) || 0));
  const width = Math.max(Number(o.minDigits) || 0, String(start + list.length - 1).length);
  const sep = SEPS[o.sep] ?? ' ';
  let re = null;
  if (o.mode === 'replace' && o.find) re = new RegExp(escRe(o.find), o.matchCase ? 'g' : 'gi');
  return list.map((it, i) => {
    let name;
    if (o.mode === 'number') {
      const num = String(start + i).padStart(width, '0');
      const base = o.base.trim();
      name = !base ? num : (o.numberAt === 'before' ? `${num}${sep}${base}` : `${base}${sep}${num}`);
    } else if (o.mode === 'text') {
      name = `${o.prefix}${it.oldName}${o.suffix}`;
    } else {
      name = re ? it.oldName.replace(re, () => o.replaceWith) : it.oldName;
    }
    name = applyCase(name, o.caseMode).replace(/\s+/g, ' ').trim();
    let problem = '';
    if (!name) problem = 'empty';
    else if (name.length > MAX_NAME) problem = 'too long';
    return { id: it.id, oldName: it.oldName, newName: name, problem };
  });
}

// What the sheet can say about a plan: how many names change, and the first problem.
export function summarize(plan) {
  const changed = plan.filter((p) => p.newName !== p.oldName);
  const bad = plan.find((p) => p.problem);
  return { changed, problem: bad ? `“${bad.oldName || 'An item'}” would get a name that is ${bad.problem}.` : '' };
}

// Resolves [{ id, newName }] for the names that change, or null on Cancel, Back, an outside tap or a lock.
// hooks: { open(finish), close() } let the app route Back and locks to finish(null).
export function askBulkRename({ items, hooks = {} }) {
  return new Promise((resolve) => {
    const n = items.length;
    const el = document.createElement('div');
    el.className = 'modal-overlay bulk-rename';
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Rename items');
    el.innerHTML = `<div class="modal-box br-box">
      <h3>Rename ${n} items</h3>
      <div class="br-modes" role="tablist" aria-label="How to name them">
        <button type="button" class="br-mode on" data-mode="number" role="tab">Number</button>
        <button type="button" class="br-mode" data-mode="text" role="tab">Add text</button>
        <button type="button" class="br-mode" data-mode="replace" role="tab">Find &amp; replace</button>
      </div>
      <div class="br-pane" data-pane="number">
        <label class="br-f">Name<input class="br-base" type="text" autocomplete="off" maxlength="100" placeholder="e.g. Holiday"></label>
        <div class="br-row">
          <label class="br-f">Start at<input class="br-start" type="number" inputmode="numeric" min="0" max="999999" value="1"></label>
          <label class="br-f">Digits<select class="br-digits"><option value="0">Auto</option><option value="2">2</option><option value="3">3</option><option value="4">4</option></select></label>
        </div>
        <div class="br-row">
          <label class="br-f">Number goes<select class="br-at"><option value="after">After the name</option><option value="before">Before the name</option></select></label>
          <label class="br-f">Joined by<select class="br-sep"><option value="space">Space</option><option value="underscore">Underscore _</option><option value="dash">Dash -</option><option value="none">Nothing</option></select></label>
        </div>
        <label class="br-f">Order<select class="br-order"><option value="listed">As listed</option><option value="name">By current name, A to Z</option></select></label>
      </div>
      <div class="br-pane hidden" data-pane="text">
        <label class="br-f">Add before the name<input class="br-prefix" type="text" autocomplete="off" maxlength="60"></label>
        <label class="br-f">Add after the name<input class="br-suffix" type="text" autocomplete="off" maxlength="60"></label>
      </div>
      <div class="br-pane hidden" data-pane="replace">
        <label class="br-f">Find<input class="br-find" type="text" autocomplete="off" maxlength="100"></label>
        <label class="br-f">Replace with<input class="br-with" type="text" autocomplete="off" maxlength="100" placeholder="Leave empty to remove it"></label>
        <label class="br-check"><input class="br-case" type="checkbox"><span>Match upper and lower case</span></label>
      </div>
      <label class="br-f br-lettercase">Letters<select class="br-letters"><option value="keep">Keep as they are</option><option value="lower">all lowercase</option><option value="upper">ALL UPPERCASE</option><option value="title">Title Case</option></select></label>
      <div class="br-preview-h">Preview</div>
      <div class="br-preview" aria-live="polite"></div>
      <div class="br-warn" role="note"><strong>This cannot be undone.</strong> The new names replace the old ones for good; the old names are not kept.</div>
      <div class="sheet-actions"><button type="button" class="br-cancel secondary-btn">Cancel</button><button type="button" class="br-ok" disabled>Rename</button></div>
    </div>`;
    document.body.append(el);
    const q = (s) => el.querySelector(s);
    let mode = 'number', plan = [];
    const read = () => ({
      mode, base: q('.br-base').value, start: q('.br-start').value, minDigits: q('.br-digits').value, sep: q('.br-sep').value, numberAt: q('.br-at').value,
      order: q('.br-order').value, prefix: q('.br-prefix').value, suffix: q('.br-suffix').value, find: q('.br-find').value, replaceWith: q('.br-with').value,
      matchCase: q('.br-case').checked, caseMode: q('.br-letters').value,
    });
    const paint = () => {
      const r = read();
      plan = planRename(items, r);
      const { changed, problem } = summarize(plan);
      const needsName = r.mode === 'number' && !r.base.trim(); // numbers alone would be a slip, not a plan
      const shown = needsName ? [] : plan.slice(0, 5);
      q('.br-preview').innerHTML = (needsName ? '<div class="br-more">Type a name for the numbered items.</div>' : '') + shown.map((p) => `<div class="br-line${p.problem ? ' bad' : ''}"><span class="br-old">${esc(p.oldName)}</span><span class="br-arrow" aria-hidden="true">→</span><span class="br-new">${esc(p.newName || '(empty)')}</span></div>`).join('')
        + (!needsName && plan.length > shown.length ? `<div class="br-more">and ${plan.length - shown.length} more</div>` : '')
        + (needsName ? '' : problem ? `<div class="br-problem">${esc(problem)}</div>` : (changed.length === 0 ? '<div class="br-more">No name would change yet.</div>' : ''));
      const ok = q('.br-ok');
      ok.disabled = needsName || !!problem || changed.length === 0;
      ok.textContent = !ok.disabled ? `Rename ${changed.length} item${changed.length === 1 ? '' : 's'}` : 'Rename';
    };
    const finish = (v) => {
      if (!el.isConnected) return;
      el.remove();
      if (hooks.close) hooks.close();
      resolve(v);
    };
    q('.br-modes').addEventListener('click', (e) => {
      const b = e.target.closest('.br-mode');
      if (!b) return;
      mode = b.dataset.mode;
      el.querySelectorAll('.br-mode').forEach((x) => x.classList.toggle('on', x === b));
      el.querySelectorAll('.br-pane').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== mode));
      paint();
    });
    el.addEventListener('input', paint);
    el.addEventListener('change', paint);
    q('.br-cancel').onclick = () => finish(null);
    q('.br-ok').onclick = () => {
      const { changed, problem } = summarize(plan);
      if (q('.br-ok').disabled || problem || !changed.length) return;
      finish(changed.map((p) => ({ id: p.id, newName: p.newName })));
    };
    paint();
    if (hooks.open) hooks.open(finish);
  });
}
