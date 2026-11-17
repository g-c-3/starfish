// pptview-edit.js — the pptx and odp editor view (Phase 121 steps 2 and 3, Decisions 498 and 499). Registered in office-render.js, loaded on the first Edit.
// While editing, a tap on a text shape of the slide opens a sheet to change its text; the Tools list the shapes (an empty placeholder too),
// edit the notes, and add, duplicate, move and delete slides. pptxedit.js writes the file; after each change the viewer reads the changed
// file again and draws the slide.
import { openPptx } from './pptxedit.js';
import { openOdp } from './odpedit.js';
import { openSheet } from './sheet.js';
import { readPptx } from './office-read.js';
import { readOdp, odfKind } from './office-odf.js';

const IC_TEXT = '<path d="M5 6h14M12 6v13M9 19h6"/>';
const IC_LIST = '<path d="M5 7h2M10 7h9M5 12h2M10 12h9M5 17h2M10 17h9"/>';
const IC_NOTE = '<path d="M6 4h9l3 3v13H6zM9 11h6M9 15h6"/>';
const IC_ADD = '<path d="M5 5h14v14H5zM12 9v6M9 12h6"/>';
const IC_COPY = '<path d="M8 8h11v11H8zM5 16V5h11"/>';
const IC_UP = '<path d="M12 19V6M7 11l5-5 5 5"/>';
const IC_DOWN = '<path d="M12 5v13M7 13l5 5 5-5"/>';
const IC_DEL = '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>';

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const snippet = (t) => { const s = String(t).replace(/\s+/g, ' ').trim(); return s.length > 44 ? `${s.slice(0, 43)}…` : s || 'empty'; };

// stage: the element that holds the drawn slide; model: the reader's presentation; cur(): the slide on view;
// setModel(model, index): the viewer draws the new model at a slide; onDirty(): the shell is told to refresh its buttons
export function mountEditor({ stage, host, model: model0, cur, setModel, bytes, toast = () => {}, onActivity = () => {}, onDirty = () => {} }) {
  let model = model0;
  const odp = odfKind(bytes) === 'presentation';
  const eng = odp ? openOdp(bytes) : openPptx(bytes); // throws an office error for a file that is not a valid presentation
  const read = odp ? readOdp : readPptx;
  let editing = false; let isDirty = false; let was = false; let dlg = null; let told = false;
  const dirty = () => { isDirty = true; was = true; onDirty(); };

  // a change is written to the file, then drawn from the file; next(result) is the slide to show
  const redraw = (fn, next) => {
    let out;
    try { out = fn(); } catch (e) { toast(e && e.message ? e.message : 'That change could not be made.'); return false; }
    dirty();
    try { model = read(eng.toBytes()); setModel(model, next(out)); } catch (e) { toast('The change was made but cannot be shown; Save or Discard.'); }
    return true;
  };

  const closeDlg = () => { if (dlg && !dlg.closed) dlg.close(); dlg = null; };
  const buttons = (h, list) => {
    const row = el('div', 'eo-leave-row');
    for (const [label, cls, fn] of list) { const b = el('button', `eo-sh-btn ${cls}`.trim(), label); b.type = 'button'; b.onclick = () => { onActivity(); fn(); }; row.appendChild(b); }
    h.appendChild(row);
  };
  const sheet = (title, build) => { if (dlg && !dlg.closed) return; dlg = openSheet({ title, build, onClose: () => { dlg = null; } }); };

  const editText = (si, id) => {
    let sh; try { sh = eng.shapes(si).find((x) => x.id === String(id)); } catch (e) { toast(e.message); return; }
    if (!sh) { toast('That shape is not on the slide.'); return; }
    sheet(sh.name || 'Text', (h, close) => {
      const ta = el('textarea', 'eo-cell-in'); ta.rows = 6; ta.value = sh.text; ta.setAttribute('aria-label', 'Text of the shape'); ta.spellcheck = true;
      h.appendChild(ta);
      buttons(h, [
        ['Set', 'eo-sh-primary', () => { if (ta.value === sh.text || redraw(() => eng.setText(si, id, ta.value), () => si)) close(); }],
        ['Position and size', '', () => { close(); editBox(si, id, sh.name); }],
        ['Cancel', '', () => close()]
      ]);
      setTimeout(() => { if (ta.isConnected) ta.focus(); }, 80);
    });
  };
  // numbers in slide pixels (96 per inch); the slide is model.size wide and high where the file says
  const editBox = (si, id, name) => {
    let b; try { b = eng.box(si, id); } catch (e) { toast(e.message); return; }
    if (!b) { toast('This shape has no place of its own to change.'); return; }
    sheet(name ? `${name}: place` : 'Place and size', (h, close) => {
      if (model.size) h.appendChild(el('p', 'eo-cell-note', `Slide: ${Math.round(model.size.w)} × ${Math.round(model.size.h)} px.`));
      const fields = {};
      for (const [k, label] of [['x', 'Left'], ['y', 'Top'], ['w', 'Width'], ['h', 'Height']]) {
        const lb = el('label', 'eo-cell-note', label); const inp = el('input', 'eo-cell-in'); inp.type = 'number'; inp.inputMode = 'decimal'; inp.step = '1'; inp.value = String(Math.round(b[k])); inp.setAttribute('aria-label', label);
        lb.appendChild(inp); h.appendChild(lb); fields[k] = inp;
      }
      buttons(h, [
        ['Set', 'eo-sh-primary', () => {
          const nb = {}; for (const k of ['x', 'y', 'w', 'h']) { const n = Number(fields[k].value); nb[k] = n === Math.round(b[k]) ? b[k] : n; } // a field left alone keeps the exact value
          if (['x', 'y', 'w', 'h'].every((k) => nb[k] === Math.round(b[k]))) { close(); return; }
          if (redraw(() => eng.setBox(si, id, nb), () => si)) close();
        }],
        ['Cancel', '', () => close()]
      ]);
    });
  };
  const listShapes = () => {
    if (!editing) return;
    const si = cur(); let list; try { list = eng.shapes(si); } catch (e) { toast(e.message); return; }
    if (!list.length) { toast('This slide has no text shape.'); return; }
    sheet('Text on this slide', (h, close) => {
      const col = el('div', 'eo-pick');
      for (const sh of list) { const b = el('button', 'eo-sh-btn', `${sh.name || 'Text'}: ${snippet(sh.text)}`); b.type = 'button'; b.onclick = () => { onActivity(); close(); editText(si, sh.id); }; col.appendChild(b); }
      h.appendChild(col);
    });
  };
  const editNotes = () => {
    if (!editing) return;
    const si = cur(); let start; try { start = eng.notes(si); } catch (e) { toast(e.message); return; }
    sheet('Notes', (h, close) => {
      const ta = el('textarea', 'eo-cell-in'); ta.rows = 6; ta.value = start; ta.setAttribute('aria-label', 'Notes of the slide'); ta.spellcheck = true;
      h.appendChild(ta);
      buttons(h, [
        ['Set', 'eo-sh-primary', () => { if (ta.value === start || redraw(() => eng.setNotes(si, ta.value), () => si)) close(); }],
        ['Cancel', '', () => close()]
      ]);
      setTimeout(() => { if (ta.isConnected) ta.focus(); }, 80);
    });
  };
  const addSlide = () => {
    if (!editing) return;
    const names = eng.layouts(); if (!names.length) { toast(odp ? 'This presentation has no master pages to add a slide from.' : 'This presentation has no layouts to add a slide from.'); return; }
    const si = cur();
    sheet('Add a slide', (h, close) => {
      h.appendChild(el('p', 'eo-cell-note', 'The new slide goes after this one.'));
      const col = el('div', 'eo-pick');
      names.forEach((nm, i) => { const b = el('button', 'eo-sh-btn', nm); b.type = 'button'; b.onclick = () => { onActivity(); close(); redraw(() => eng.addSlide(i, si + 1), (p) => p); }; col.appendChild(b); });
      h.appendChild(col);
    });
  };
  const duplicate = () => { if (editing) redraw(() => eng.duplicateSlide(cur()), (p) => p); };
  const move = (by) => { if (!editing) return; const si = cur(); redraw(() => eng.moveSlide(si, si + by), (p) => p); };
  const remove = () => {
    if (!editing) return;
    const si = cur(); if (model.count < 2) { toast('A presentation needs at least one slide.'); return; }
    sheet('Delete this slide?', (h, close) => {
      h.appendChild(el('p', 'eo-cell-note', 'The slide, its notes and the pictures only it uses are removed from the file when you save.'));
      buttons(h, [
        ['Delete', 'eo-sh-primary', () => { close(); redraw(() => eng.deleteSlide(si), () => Math.min(si, model.count - 1)); }],
        ['Cancel', '', () => close()]
      ]);
    });
  };

  const onClick = (e) => {
    if (!editing || (dlg && !dlg.closed)) return;
    const n = e.target.closest ? e.target.closest('[data-sid]') : null; if (!n || !stage.contains(n)) return;
    onActivity(); editText(cur(), n.dataset.sid);
  };
  stage.addEventListener('click', onClick);

  const groups = [
    { id: 'text', title: 'Text', tools: [
      { id: 'shapes', label: 'Edit text', icon: IC_LIST, run: listShapes },
      { id: 'notes', label: 'Notes', icon: IC_NOTE, run: editNotes }
    ] },
    { id: 'slides', title: 'Slides', tools: [
      { id: 'add', label: 'Add slide', icon: IC_ADD, run: addSlide },
      { id: 'dup', label: 'Duplicate slide', icon: IC_COPY, run: duplicate },
      { id: 'up', label: 'Move earlier', icon: IC_UP, run: () => move(-1), disabled: () => cur() === 0 },
      { id: 'down', label: 'Move later', icon: IC_DOWN, run: () => move(1), disabled: () => cur() >= model.count - 1 },
      { id: 'del', label: 'Delete slide', icon: IC_DEL, run: remove, disabled: () => model.count < 2 }
    ] }
  ];
  void IC_TEXT;

  return {
    groups,
    get count() { return model.count; },
    setEditable(on) {
      editing = on; stage.classList.toggle('eo-pedit', on);
      if (!on) closeDlg(); else if (!told) { told = true; toast('Tap a text to change it.'); }
    },
    dirty: () => isDirty, touched: () => was,
    markClean() { isDirty = false; onDirty(); },
    bytes: () => eng.toBytes(),
    destroy() { stage.removeEventListener('click', onClick); closeDlg(); stage.classList.remove('eo-pedit'); }
  };
}
