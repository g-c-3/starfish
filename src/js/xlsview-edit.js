// xlsview-edit.js — the xlsx editor view (Phase 120 steps 2 to 5a, Decisions 489 to 493). Registered in office-render.js, loaded on the first Edit.
// While editing, a tap on a cell opens a sheet to type its value; a tap on a row or column number selects it for the Tools. xlsxedit.js writes
// the file; the grid shows what the file now holds. A change of rows, columns or sheets reads the changed file again and redraws behind a fade.
import { openXlsx } from './xlsxedit.js';
import { openOds } from './odsedit.js';
import { openSheet } from './sheet.js';
import { formatValue, colName, readXlsx } from './office-read.js';
import { odfKind, readOds } from './office-odf.js';

const IC_EDIT = '<path d="M4 20h4L19 9l-4-4L4 16z"/>';
const IC_CLEAR = '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>';
const IC_ROW_IN = '<path d="M4 7h16v4H4zM4 15h16M12 3v2M11 4h2"/>';
const IC_ROW_DEL = '<path d="M4 7h16v4H4zM4 15h16M9 18l6 4M15 18l-6 4"/>';
const IC_COL_IN = '<path d="M7 4v16h4V4zM15 4v16M3 12h2M4 11v2"/>';
const IC_COL_DEL = '<path d="M7 4v16h4V4zM15 4v16M18 9l4 6M22 9l-4 6"/>';
const IC_FMT = '<path d="M5 5h14v14H5zM9 15l2-6 2 6M9.8 13h2.4M15 9v6"/>';
const IC_SHEET = '<path d="M5 4h10l4 4v12H5zM14 4v5h5M9 14h6"/>';
const TYPED = /^\s*([-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?|true|false)\s*$/i;

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };

// zoomer: the element that holds the sheet table; host: the viewer; model: the reader's workbook (xfs, is1904); sheet(): the sheet on view;
// onShown(fn): fn(index) runs after a sheet is drawn; onDirty(): the shell is told to refresh its buttons
export function mountEditor({ zoomer, host, model: model0, sheet, onShown, setModel, bytes, toast = () => {}, onActivity = () => {}, onDirty = () => {} }) {
  let model = model0;
  const ods = odfKind(bytes) === 'spreadsheet'; // an ods has its own engine; it edits values only for now (Decision 493)
  const read = (b) => (ods ? readOds(b) : readXlsx(b));
  const eng = ods ? openOds(bytes) : openXlsx(bytes); // throws an office error for a file that is not a valid workbook
  let editing = false; let isDirty = false; let was = false; let sel = null; let dlg = null; let told = false;
  let tgt = { r: null, c: null }; // the row and column the Tools act on: a tapped cell gives both, a tapped number one
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

  const select = (n, to = n && n.tagName === 'TD' ? where(n) : { r: null, c: null }) => {
    for (const x of zoomer.querySelectorAll('.eo-sel')) x.classList.remove('eo-sel');
    sel = n && n.tagName === 'TD' ? n : null; tgt = to; if (n) n.classList.add('eo-sel');
    onDirty(); // refreshes the tool buttons (they need a cell, a row or a column)
  };

  // a change is written to the file, then drawn from the file
  const write = (td, input) => {
    const si = sheet(); const { r, c } = where(td); let list;
    if (ods) return redraw(() => eng.setCell(si, r, c, input), () => si); // the file is read again: its styles are not mapped here
    try { list = eng.setCell(si, r, c, input); } catch (e) { toast(e && e.message ? e.message : 'This cell cannot be changed.'); return false; }
    for (const x of list) { // the cell and every formula that read it
      const w = shown(eng.cell(x.si, x.r, x.c));
      if (!patches.has(x.si)) patches.set(x.si, new Map());
      patches.get(x.si).set(`${x.r},${x.c}`, w);
      if (x.si === si) { const t2 = tdAt(x.r, x.c); if (t2) paint(t2, w); }
    }
    const v = shown(eng.cell(si, r, c));
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
    // a formula is shown as typed; a text that would be read back as a number, TRUE or FALSE, or a formula keeps its leading apostrophe
    const start = cur.formula ? `=${cur.formula}` : cur.kind === 'text' && (TYPED.test(cur.raw) || /^\s*=|^'/.test(cur.raw)) ? `'${cur.raw}` : cur.raw;
    dlg = openSheet({
      title: `${colName(c)}${r + 1}`,
      build: (h, close) => {
        if (cur.formula === '') h.appendChild(el('p', 'eo-cell-note', 'This cell holds a formula. A value or a formula typed here replaces it.'));
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
    if (!editing || !e.target.closest) return;
    const th = e.target.closest('th.eo-row, th.eo-col');
    if (th && zoomer.contains(th)) { onActivity(); select(th, th.classList.contains('eo-row') ? { r: Number(th.parentElement.dataset.r), c: null } : { r: null, c: Number(th.dataset.hcol) }); return; }
    const td = e.target.closest('td[data-col]'); if (!td || !zoomer.contains(td)) return;
    onActivity(); select(td); openEdit();
  };
  zoomer.addEventListener('click', onClick);

  // the viewer draws a sheet from the file as it was opened: what was changed is put back
  onShown((i) => {
    sel = null; closeDlg();
    const m = patches.get(i); if (!m) return;
    for (const [k, v] of m) { const [r, c] = k.split(',').map(Number); const td = tdAt(r, c); if (td) paint(td, v); }
  });

  // ---- rows, columns, sheets (Decision 490) ----
  const redraw = (fn, next) => {
    try { fn(); } catch (e) { toast(e && e.message ? e.message : 'That change could not be made.'); return false; }
    dirty(); patches.clear(); select(null);
    try { model = read(eng.toBytes()); setModel(model, next()); } catch (e) { toast('The change was made but cannot be shown; Save or Discard.'); }
    return true;
  };
  const ask = (title, text, ok, run, input) => {
    if (dlg && !dlg.closed) return;
    dlg = openSheet({
      title,
      build: (h, close) => {
        if (text) h.appendChild(el('p', 'eo-cell-note', text));
        let field = null; if (input !== undefined) { field = el('input', 'eo-cell-in'); field.type = 'text'; field.value = input; field.maxLength = 80; field.setAttribute('aria-label', title); h.appendChild(field); }
        const row = el('div', 'eo-leave-row');
        const mk = (label, cls, fn) => { const b = el('button', `eo-sh-btn ${cls}`.trim(), label); b.type = 'button'; b.onclick = () => { onActivity(); fn(); }; row.appendChild(b); };
        mk(ok, 'eo-sh-primary', () => { if (run(field ? field.value : null) !== false) close(); });
        mk('Cancel', '', () => close());
        h.appendChild(row);
        if (field) setTimeout(() => { if (field.isConnected) { field.focus(); field.select(); } }, 80);
      },
      onClose: () => { dlg = null; }
    });
  };
  const si = () => sheet();
  const rowsAt = (r, below, del) => redraw(() => (del ? eng.deleteRows(si(), r) : eng.insertRows(si(), below ? r + 1 : r)), si);
  const colsAt = (c, right, del) => redraw(() => (del ? eng.deleteCols(si(), c) : eng.insertCols(si(), right ? c + 1 : c)), si);
  const needR = () => { if (tgt.r === null) { toast('Tap a cell or a row number first.'); return false; } return true; };
  const needC = () => { if (tgt.c === null) { toast('Tap a cell or a column number first.'); return false; } return true; };
  const rowTools = [
    { id: 'rowup', label: 'Insert row above', icon: IC_ROW_IN, run: () => needR() && rowsAt(tgt.r, false, false), disabled: () => tgt.r === null },
    { id: 'rowdn', label: 'Insert row below', icon: IC_ROW_IN, run: () => needR() && rowsAt(tgt.r, true, false), disabled: () => tgt.r === null },
    { id: 'rowdel', label: 'Delete row', icon: IC_ROW_DEL, run: () => needR() && ask(`Delete row ${tgt.r + 1}?`, 'The row is removed and the rows below move up. Nothing is saved until Save.', 'Delete', () => rowsAt(tgt.r, false, true)), disabled: () => tgt.r === null },
    { id: 'colleft', label: 'Insert column left', icon: IC_COL_IN, run: () => needC() && colsAt(tgt.c, false, false), disabled: () => tgt.c === null },
    { id: 'colright', label: 'Insert column right', icon: IC_COL_IN, run: () => needC() && colsAt(tgt.c, true, false), disabled: () => tgt.c === null },
    { id: 'coldel', label: 'Delete column', icon: IC_COL_DEL, run: () => needC() && ask(`Delete column ${colName(tgt.c)}?`, 'The column is removed and the columns to its right move left. Nothing is saved until Save.', 'Delete', () => colsAt(tgt.c, false, true)), disabled: () => tgt.c === null }
  ];
  const sheetTools = [
    { id: 'shren', label: 'Rename sheet', icon: IC_SHEET, run: () => ask('Rename sheet', '', 'Rename', (v) => redraw(() => eng.renameSheet(si(), v), si), eng.names()[si()]) },
    { id: 'shadd', label: 'Add sheet', icon: IC_SHEET, run: () => ask('Add sheet', '', 'Add', (v) => redraw(() => eng.addSheet(v), () => eng.names().length - 1), `Sheet${eng.names().length + 1}`) },
    { id: 'shdel', label: 'Delete sheet', icon: IC_SHEET, run: () => ask(`Delete ${eng.names()[si()]}?`, 'The sheet and everything on it is removed. Formulas that read it show #REF!. Nothing is saved until Save.', 'Delete', () => { const k = si(); return redraw(() => eng.deleteSheet(k), () => Math.min(k, eng.names().length - 1)); }) }
  ];

  // ---- number formats (Decision 492) ----
  const PRESETS = [['General', 'General'], ['Number', '0.00'], ['Whole number', '0'], ['Thousands', '#,##0.00'], ['Percent', '0.00%'], ['Date', 'yyyy-mm-dd'], ['Time', 'hh:mm'], ['Text', '@']];
  const needCell = () => { if (!sel) { toast('Tap a cell first.'); return false; } return true; };
  const fmtTo = (code) => { if (!needCell()) return; const { r, c } = where(sel); const s = si(); redraw(() => eng.setFormat(s, r, c, code), () => s); };
  const fmtTools = [
    ...PRESETS.map(([label, code]) => ({ id: `fmt-${label}`, label, icon: IC_FMT, run: () => fmtTo(code), disabled: () => !sel })),
    { id: 'fmt-custom', label: 'Custom format', icon: IC_FMT, disabled: () => !sel, run: () => {
      if (!needCell()) return; const { r, c } = where(sel); const s = si(); const cur = eng.format(s, r, c);
      ask('Custom format', 'A format code, such as 0.0 or dd/mm/yyyy. It changes how the number shows, not the number.', 'Apply', (v) => redraw(() => eng.setFormat(s, r, c, v), () => s), cur);
    } }
  ];

  const groups = [{ id: 'cell', title: 'Cell', tools: [
    { id: 'edit', label: 'Edit cell', icon: IC_EDIT, run: openEdit, disabled: () => !sel },
    { id: 'clear', label: 'Clear cell', icon: IC_CLEAR, run: clearCell, disabled: () => !sel }
  ] }, ...(eng.setFormat ? [{ id: 'fmt', title: 'Format', tools: fmtTools }] : []), ...(eng.insertRows ? [{ id: 'rc', title: 'Rows and columns', tools: rowTools }, { id: 'sheets', title: 'Sheets', tools: sheetTools }] : [])];

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
