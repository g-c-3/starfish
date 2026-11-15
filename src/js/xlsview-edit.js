// xlsview-edit.js — the xlsx editor view (Phase 120 step 2, Decision 489). Registered in office-render.js, loaded on the first Edit.
// While editing, a tap on a cell opens a sheet to type its value. xlsxedit.js writes the file; the grid shows what the file now holds.
import { openXlsx } from './xlsxedit.js';
import { openSheet } from './sheet.js';
import { formatValue, colName } from './office-read.js';

const IC_EDIT = '<path d="M4 20h4L19 9l-4-4L4 16z"/>';
const IC_CLEAR = '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>';
const TYPED = /^\s*([-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?|true|false)\s*$/i;

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };

// zoomer: the element that holds the sheet table; host: the viewer; model: the reader's workbook (xfs, is1904); sheet(): the sheet on view;
// onShown(fn): fn(index) runs after a sheet is drawn; onDirty(): the shell is told to refresh its buttons
export function mountEditor({ zoomer, host, model, sheet, onShown, bytes, toast = () => {}, onActivity = () => {}, onDirty = () => {} }) {
  const eng = openXlsx(bytes); // throws an office error for a file that is not a valid workbook
  let editing = false; let isDirty = false; let was = false; let sel = null; let dlg = null; let told = false;
  const patches = new Map(); // sheet index -> Map('row,col' -> what the cell shows); the viewer redraws a sheet from the original file

  const xf = (i) => model.xfs[i] || model.xfs[0];
  const shown = (c) => { // what the cell shows, from what the file now holds
    if (c.kind === 'empty') return { text: '', k: 's', h: 'left' };
    const x = xf(c.style);
    if (c.kind === 'number') return { text: formatValue(c.raw, x.code, model.is1904), k: 'n', h: x.h };
    if (c.kind === 'bool' || c.kind === 'error') return { text: c.raw, k: 'b', h: x.h };
    return { text: c.raw, k: 's', h: x.h };
  };
  const paint = (td, v) => {
    td.textContent = v.text;
    td.classList.remove('eo-r', 'eo-ctr');
    if (v.k === 'n' && v.h === 'general') td.classList.add('eo-r'); else if (v.k === 'b' && v.h === 'general') td.classList.add('eo-ctr');
    if (v.text === '') delete td.dataset.c; else td.dataset.c = td.dataset.col; // the viewer's cell bar reads data-c
  };
  const tdAt = (r, c) => zoomer.querySelector(`tr[data-r="${r}"] td[data-col="${c}"]`);
  const where = (td) => ({ r: Number(td.parentElement.dataset.r), c: Number(td.dataset.col) });
  const dirty = () => { isDirty = true; was = true; onDirty(); };

  const select = (td) => {
    for (const n of zoomer.querySelectorAll('.eo-sel')) n.classList.remove('eo-sel');
    sel = td; if (td) td.classList.add('eo-sel');
    onDirty(); // refreshes the tool buttons (Edit cell, Clear cell need a cell)
  };

  // a change is written to the file, then drawn from the file
  const write = (td, input) => {
    const si = sheet(); const { r, c } = where(td);
    try { eng.setCell(si, r, c, input); } catch (e) { toast(e && e.message ? e.message : 'This cell cannot be changed.'); return false; }
    const v = shown(eng.cell(si, r, c));
    if (!patches.has(si)) patches.set(si, new Map());
    patches.get(si).set(`${r},${c}`, v);
    paint(td, v);
    const t = host.querySelector('.eo-cbtext'); const b = host.querySelector('.eo-cellbar');
    if (t && b && !b.hidden) t.textContent = v.text;
    dirty(); return true;
  };

  const closeDlg = () => { if (dlg && !dlg.closed) dlg.close(); dlg = null; };
  const openEdit = () => {
    if (!editing || !sel || !sel.isConnected || (dlg && !dlg.closed)) return;
    const td = sel; const si = sheet(); const { r, c } = where(td);
    const why = eng.locked(si, r, c); if (why) { toast(why); return; }
    const cur = eng.cell(si, r, c);
    // a text that would be read back as a number, TRUE or FALSE, or a formula keeps its leading apostrophe
    const start = cur.kind === 'text' && (TYPED.test(cur.raw) || /^\s*=|^'/.test(cur.raw)) ? `'${cur.raw}` : cur.raw;
    dlg = openSheet({
      title: `${colName(c)}${r + 1}`,
      build: (h, close) => {
        if (cur.formula) h.appendChild(el('p', 'eo-cell-note', `This cell holds a formula (=${cur.formula}). A value typed here replaces it.`));
        const ta = el('textarea', 'eo-cell-in'); ta.rows = 3; ta.value = start; ta.setAttribute('aria-label', 'Cell value'); ta.autocapitalize = 'off'; ta.spellcheck = false;
        const row = el('div', 'eo-leave-row');
        const mk = (text, cls, fn) => { const b = el('button', `eo-sh-btn ${cls}`.trim(), text); b.type = 'button'; b.onclick = () => { onActivity(); fn(); }; row.appendChild(b); };
        mk('Set', 'eo-sh-primary', () => { if (ta.value === start || write(td, ta.value)) close(); });
        mk('Clear', '', () => { if (write(td, '')) close(); });
        mk('Cancel', '', () => close());
        h.append(ta, row);
        setTimeout(() => { if (ta.isConnected) ta.focus(); }, 80);
      },
      onClose: () => { dlg = null; }
    });
  };
  const clearCell = () => {
    if (!sel || !sel.isConnected) { toast('Tap a cell first.'); return; }
    const { r, c } = where(sel); const why = eng.locked(sheet(), r, c); if (why) { toast(why); return; }
    write(sel, '');
  };

  const onClick = (e) => {
    if (!editing) return;
    const td = e.target.closest && e.target.closest('td[data-col]'); if (!td || !zoomer.contains(td)) return;
    onActivity(); select(td); openEdit();
  };
  zoomer.addEventListener('click', onClick);

  // the viewer draws a sheet from the file as it was opened: what was changed is put back
  onShown((i) => {
    sel = null; closeDlg();
    const m = patches.get(i); if (!m) return;
    for (const [k, v] of m) { const [r, c] = k.split(',').map(Number); const td = tdAt(r, c); if (td) paint(td, v); }
  });

  const groups = [{ id: 'cell', title: 'Cell', tools: [
    { id: 'edit', label: 'Edit cell', icon: IC_EDIT, run: openEdit, disabled: () => !sel },
    { id: 'clear', label: 'Clear cell', icon: IC_CLEAR, run: clearCell, disabled: () => !sel }
  ] }];

  return {
    groups,
    get count() { return zoomer.querySelectorAll('td[data-col]').length; },
    setEditable(on) {
      editing = on; zoomer.classList.toggle('eo-editing', on);
      if (!on) { select(null); closeDlg(); } else if (!told) { told = true; toast('Tap a cell to change it.'); }
    },
    dirty: () => isDirty, touched: () => was,
    markClean() { isDirty = false; onDirty(); },
    bytes: () => eng.toBytes(),
    destroy() {
      zoomer.removeEventListener('click', onClick); onShown(null); closeDlg();
      zoomer.classList.remove('eo-editing'); for (const n of zoomer.querySelectorAll('.eo-sel')) n.classList.remove('eo-sel');
      patches.clear();
    }
  };
}
