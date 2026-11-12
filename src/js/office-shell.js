// office-shell.js — the tool shell of the Office viewers (Decisions 451, 454). Every file opens view only; Edit turns the tools on.
// Compact width: one Tools button opens the grouped panel (a sheet). Wide width: a tab-style ribbon, one tab per group. The width is
// followed live, so unfolding switches without reopening. A tool appears only when the editor behind it exists: with no editor
// registered for a kind there is no shell, no Edit button, nothing.
// Enter and exit: the bar, the panes and the sheet fade by the one recipe (opacity only, as the editor panels, Decision 438).
import { openSheet } from './sheet.js';
import '../css/office-shell.css';

const editors = new Map(); // kind -> () => Promise of the editor module (loaded on the first Edit, Decision 453)
export function registerEditor(kind, load) { editors.set(kind, load); }
export const hasEditor = (kind) => editors.has(kind);
export function loadEditor(kind) { const f = editors.get(kind); return f ? f() : Promise.reject(new Error('No editor for this type.')); }

const WIDE = '(min-width: 720px)';
const GROUP_MAX = 6;
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const btn = (cls, text, label) => { const b = el('button', cls, text); b.type = 'button'; if (label) b.setAttribute('aria-label', label); return b; };
// leave: hidden plus mx-out keeps the old one painted while it fades; arrive: after the gap when something is leaving
const fade = (n) => { if (n.classList.contains('hidden')) return; n.classList.add('hidden', 'mx-out'); setTimeout(() => n.classList.remove('mx-out'), 200); };
const show = (n, after) => { n.classList.toggle('mx-after', !!after); n.classList.remove('hidden', 'mx-out'); };
const svg = (inner) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const IC_TOOLS = svg('<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>');
const IC_EDIT = svg('<path d="M4 20h4L19 9l-4-4L4 16z"/>');

// groups: [{ id, title, tools: [{ id, label, icon (svg inner markup), run(), on() (lit), disabled(), keep (panel stays open) }] }]
function clean(groups) {
  const out = [];
  for (const g of groups || []) {
    const tools = (g.tools || []).filter((t) => t && typeof t.run === 'function' && t.label);
    if (tools.length && out.length < GROUP_MAX) out.push({ id: g.id || `g${out.length}`, title: g.title || '', tools });
  }
  return out;
}

// spec: { groups, save(), saveCopy(), canSaveCopy, onEdit(on) } — save and saveCopy return a promise; onActivity keeps the auto-lock timer fed
export function createShell(host, spec) {
  let groups = [];
  const act = spec.onActivity || (() => {});
  const root = el('div', 'eo-shell');
  const viewRow = el('div', 'eo-sh-view eo-fade');
  const editRow = el('div', 'eo-sh-edit eo-fade hidden');
  const bEdit = btn('eo-sh-btn eo-sh-primary', '', 'Edit this file'); bEdit.innerHTML = `${IC_EDIT}<span>Edit</span>`;
  viewRow.appendChild(bEdit);
  const top = el('div', 'eo-sh-top');
  const bTools = btn('eo-sh-btn eo-sh-tools', '', 'Open the tools'); bTools.innerHTML = `${IC_TOOLS}<span>Tools</span>`;
  const ribbon = el('div', 'eo-ribbon'); const tabs = el('div', 'eo-tabs'); tabs.setAttribute('role', 'tablist'); const body = el('div', 'eo-rbody');
  ribbon.append(tabs, body);
  const acts = el('div', 'eo-sh-acts');
  const bSave = btn('eo-sh-btn eo-sh-primary', 'Save', 'Save and replace this file');
  const bCopy = btn('eo-sh-btn', 'Save as copy', 'Save as a new file'); bCopy.classList.toggle('hidden', !spec.saveCopy);
  const bDone = btn('eo-sh-btn', 'Done', 'Stop editing');
  acts.append(bSave, bCopy, bDone);
  top.append(bTools, acts);
  editRow.append(top, ribbon);
  root.append(viewRow, editRow);
  host.appendChild(root);

  let editing = false; let tab = 0; let sheet = null; let busy = false; let gone = false;
  let lit = []; // [button, tool]
  const syncLit = () => { for (const [b, t] of lit) { b.classList.toggle('on', !!(t.on && t.on())); b.disabled = !!(t.disabled && t.disabled()); } };
  const toolBtn = (t, after) => {
    const b = btn('eo-tool', '', t.label); b.innerHTML = `${t.icon ? svg(t.icon) : ''}<span>${t.label.replace(/</g, '&lt;')}</span>`;
    b.onclick = () => { act(); try { t.run(); } catch { /* a tool must not break the shell */ } syncLit(); if (after) after(t); };
    lit.push([b, t]); return b;
  };

  // ribbon: one tab per group; the pane of the old tab fades, the new one arrives after it
  let panes = [];
  const build = () => {
    tabs.replaceChildren(); body.replaceChildren(); panes = []; lit = []; tab = 0;
    groups.forEach((g, i) => {
      const tb = btn('eo-tab', g.title || `Tools ${i + 1}`); tb.setAttribute('role', 'tab'); tb.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
      const pane = el('div', `eo-pane eo-fade${i ? ' hidden' : ''}`); pane.setAttribute('role', 'tabpanel');
      for (const t of g.tools) pane.appendChild(toolBtn(t));
      tb.onclick = () => {
        if (i === tab) return; act();
        fade(panes[tab]); tabs.children[tab].setAttribute('aria-selected', 'false'); tabs.children[tab].classList.remove('on');
        tab = i; tb.setAttribute('aria-selected', 'true'); tb.classList.add('on'); show(pane, true);
      };
      if (i === 0) tb.classList.add('on');
      tabs.appendChild(tb); body.appendChild(pane); panes.push(pane);
    });
  };

  // compact: the same groups as sections of one panel
  const openPanel = () => {
    if (sheet && !sheet.closed) return; act();
    sheet = openSheet({
      title: 'Tools',
      build: (h, close) => {
        const ov = h.closest('.modal-overlay'); if (ov) ov.classList.add('eo-panel-ov');
        for (const g of groups) {
          const sec = el('section', 'eo-psec'); if (g.title) sec.appendChild(el('h4', 'eo-ph', g.title));
          const grid = el('div', 'eo-pgrid');
          for (const t of g.tools) grid.appendChild(toolBtn(t, (x) => { if (!x.keep) close(); }));
          sec.appendChild(grid); h.appendChild(sec);
        }
        syncLit();
      },
      onClose: () => { lit = lit.filter(([b]) => b.isConnected); }
    });
  };
  bTools.onclick = openPanel;

  // the window width, followed live: nothing is reopened
  const mq = window.matchMedia ? window.matchMedia(WIDE) : null;
  const layout = () => {
    const wide = !!(mq && mq.matches) && groups.length > 0;
    root.classList.toggle('eo-wide', wide); root.classList.toggle('eo-compact', !wide);
    if (wide && sheet && !sheet.closed) sheet.close();
  };
  layout();
  if (mq && mq.addEventListener) mq.addEventListener('change', layout);
  const setGroups = (g) => {
    if (sheet && !sheet.closed) sheet.close();
    groups = clean(g); build(); layout();
    bTools.classList.toggle('hidden', !groups.length); ribbon.classList.toggle('hidden', !groups.length); syncLit();
  };
  setGroups(spec.groups);

  const setEditing = (on) => {
    if (gone || on === editing) return;
    editing = on; act();
    if (on) { fade(viewRow); show(editRow, true); syncLit(); } else { if (sheet && !sheet.closed) sheet.close(); fade(editRow); show(viewRow, true); }
    if (spec.onEdit) spec.onEdit(on);
  };
  bEdit.onclick = () => setEditing(true);
  bDone.onclick = () => { if (spec.onDone) spec.onDone(); else setEditing(false); };
  // a save in progress blocks a second tap; its result is the caller's to show
  const fns = { save: spec.save, saveCopy: spec.saveCopy };
  const run = (key, b) => async () => {
    const fn = fns[key];
    if (busy || !fn) return; busy = true; b.disabled = true; act();
    try { await fn(); } finally { busy = false; if (!gone) b.disabled = false; }
  };
  bSave.onclick = run('save', bSave);
  bCopy.onclick = run('saveCopy', bCopy);

  return {
    root, get editing() { return editing; }, setEditing, sync: syncLit, setGroups,
    // the editor loads on the first Edit and hands over its tools and its saves
    setActions(a) { fns.save = a.save; fns.saveCopy = a.saveCopy; bCopy.classList.toggle('hidden', !a.saveCopy); },
    // asked when leaving with unsaved changes: 'save', 'discard' or 'keep' (closing the sheet keeps editing)
    confirmLeave() {
      return new Promise((resolve) => {
        let value = 'keep';
        openSheet({
          title: 'Unsaved changes',
          build: (h, close) => {
            h.appendChild(el('p', 'eo-leave-t', 'Save the changes to this file before leaving?'));
            const row = el('div', 'eo-leave-row');
            for (const [k, text, cls] of [['save', 'Save', 'eo-sh-primary'], ['discard', 'Discard', ''], ['keep', 'Keep editing', '']]) {
              const b = btn(`eo-sh-btn ${cls}`.trim(), text); b.onclick = () => { value = k; close(k); }; row.appendChild(b);
            }
            h.appendChild(row);
          },
          onClose: () => resolve(value)
        });
      });
    },
    destroy() { gone = true; if (mq && mq.removeEventListener) mq.removeEventListener('change', layout); if (sheet && !sheet.closed) sheet.close(); root.remove(); }
  };
}
