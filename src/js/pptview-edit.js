// pptview-edit.js — the pptx and odp editor view (Phase 121 steps 2 and 3, Decisions 498 and 499). Registered in office-render.js, loaded on the first Edit.
// While editing, a tap on a text shape of the slide opens a sheet to change its text; the Tools list the shapes (an empty placeholder too),
// edit the notes, change the text of a table cell (Decision 501), add a text box (Decision 502), add a picture from the phone (Decision 503), move and resize a shape or picture by touch (Decision 504), and add, duplicate, move and delete slides. pptxedit.js writes the file; after each change the viewer reads the changed
// file again and draws the slide.
import { openPptx } from './pptxedit.js';
import { openOdp } from './odpedit.js';
import { openSheet } from './sheet.js';
import { pickFromPhone } from './docview-edit.js';
import { readPptx } from './office-read.js';
import { readOdp, odfKind } from './office-odf.js';

const IC_TEXT = '<path d="M5 6h14M12 6v13M9 19h6"/>';
const IC_LIST = '<path d="M5 7h2M10 7h9M5 12h2M10 12h9M5 17h2M10 17h9"/>';
const IC_TABLE = '<path d="M4 5h16v14H4zM4 10h16M4 15h16M10 5v14M15 5v14"/>';
const IC_BOX = '<path d="M4 6h16v12H4zM9 11h6M12 11v4"/>';
const IC_PIC = '<path d="M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01"/>';
const IC_MOVE = '<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>';
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
export function mountEditor({ stage, host, model: model0, cur, setModel, bytes, toast = () => {}, onActivity = () => {}, onDirty = () => {}, pickImage = null }) {
  const pick = pickImage || pickFromPhone;
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
  // a table cell: pick the table, then the cell (a grid of buttons), then change its text
  const editCell = (si, tid, tname, r, c, start) => {
    sheet(`${tname || 'Table'}: row ${r + 1}, column ${c + 1}`, (h, close) => {
      const ta = el('textarea', 'eo-cell-in'); ta.rows = 4; ta.value = start; ta.setAttribute('aria-label', 'Text of the cell'); ta.spellcheck = true;
      h.appendChild(ta);
      buttons(h, [
        ['Set', 'eo-sh-primary', () => { if (ta.value === start || redraw(() => eng.setCell(si, tid, r, c, ta.value), () => si)) close(); }],
        ['Cancel', '', () => close()]
      ]);
      setTimeout(() => { if (ta.isConnected) ta.focus(); }, 80);
    });
  };
  const pickCell = (si, t) => {
    sheet(t.name || 'Table', (h, close) => {
      h.appendChild(el('p', 'eo-cell-note', 'Tap a cell to change its text.'));
      const wrap = el('div', 'eo-pick');
      t.rows.forEach((row, r) => row.forEach((cell, c) => {
        if (cell.covered) return;
        const b = el('button', 'eo-sh-btn', `R${r + 1} C${c + 1}: ${snippet(cell.text)}`); b.type = 'button';
        b.onclick = () => { onActivity(); close(); editCell(si, t.id, t.name, r, c, cell.text); };
        wrap.appendChild(b);
      }));
      h.appendChild(wrap);
    });
  };
  const listTables = () => {
    if (!editing) return;
    const si = cur(); let list; try { list = eng.tables(si); } catch (e) { toast(e.message); return; }
    if (!list.length) { toast('This slide has no table.'); return; }
    if (list.length === 1) { pickCell(si, list[0]); return; }
    sheet('Tables on this slide', (h, close) => {
      const col = el('div', 'eo-pick');
      list.forEach((t, i) => { const b = el('button', 'eo-sh-btn', `${t.name || `Table ${i + 1}`}: ${t.rows.length} rows`); b.type = 'button'; b.onclick = () => { onActivity(); close(); pickCell(si, t); }; col.appendChild(b); });
      h.appendChild(col);
    });
  };
  const addBox = () => {
    if (!editing) return;
    const si = cur();
    sheet('Add a text box', (h, close) => {
      h.appendChild(el('p', 'eo-cell-note', 'The box goes in the middle of this slide; move and resize it with Position and size.'));
      const ta = el('textarea', 'eo-cell-in'); ta.rows = 4; ta.setAttribute('aria-label', 'Text of the new box'); ta.spellcheck = true; h.appendChild(ta);
      buttons(h, [
        ['Add', 'eo-sh-primary', () => { if (ta.value.trim() === '') { toast('Type some text for the text box.'); return; } if (redraw(() => eng.addTextBox(si, ta.value), () => si)) close(); }],
        ['Cancel', '', () => close()]
      ]);
      setTimeout(() => { if (ta.isConnected) ta.focus(); }, 80);
    });
  };
  const addPic = async () => {
    if (!editing) return;
    const si = cur(); let img;
    try { img = await pick(); } catch (e) { toast(e && e.message ? e.message : 'That picture could not be read.'); return; }
    if (!img || !editing) return;
    redraw(() => eng.addPicture(si, img), () => si);
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

  const isText = (si, id) => { try { return eng.shapes(si).some((x) => x.id === String(id)); } catch { return false; } };

  // ---- move and resize by touch (Decision 504): a frame with four corner handles over the shape; the change is written on release ----
  const reduceMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const frame = el('div', 'eo-sel hidden'); for (const h of ['nw', 'ne', 'sw', 'se']) { const d = el('div', 'eo-h'); d.dataset.h = h; frame.appendChild(d); }
  let arrange = false; let selId = null; let drag = null; let hideT = 0;
  const scaleOf = (n) => { const w = n.offsetWidth; return w ? n.getBoundingClientRect().width / w || 1 : 1; };
  const placeFrame = (b) => { const st = frame.style; st.left = `${b.x}px`; st.top = `${b.y}px`; st.width = `${b.w}px`; st.height = `${b.h}px`; };
  const showFrame = (par, k, fresh) => {
    clearTimeout(hideT); par.appendChild(frame); frame.style.setProperty('--eo-k', String(k)); frame.style.setProperty('--eo-hs', `${28 / k}px`);
    frame.classList.remove('hidden', 'eo-sel-out');
    if (fresh) { frame.classList.remove('eo-sel-in'); void frame.offsetWidth; frame.classList.add('eo-sel-in'); }
  };
  const hideFrame = () => {
    selId = null; if (frame.classList.contains('hidden')) return;
    frame.classList.remove('eo-sel-in'); frame.classList.add('eo-sel-out'); clearTimeout(hideT);
    hideT = setTimeout(() => { frame.classList.add('hidden'); frame.classList.remove('eo-sel-out'); }, reduceMotion() ? 0 : 180);
  };
  const select = (n) => {
    if (/rotate/.test(n.style.transform || '')) { toast('This shape is rotated; use Position and size.'); return; }
    const par = n.parentNode; const st = n.style;
    const fresh = !frame.isConnected || frame.classList.contains('hidden') || frame.classList.contains('eo-sel-out');
    placeFrame({ x: parseFloat(st.left) || 0, y: parseFloat(st.top) || 0, w: parseFloat(st.width) || 0, h: parseFloat(st.height) || 0 });
    frame.style.transform = st.transform || ''; selId = n.dataset.sid; showFrame(par, scaleOf(par), fresh);
  };
  const reselect = (id) => { const n = stage.querySelector(`[data-sid="${id}"]`); if (n) select(n); else hideFrame(); };
  const toggleArrange = () => {
    if (!editing) return;
    arrange = !arrange; stage.classList.toggle('eo-parr', arrange);
    if (arrange) toast('Tap a shape, then drag it or a corner.'); else hideFrame();
    onDirty();
  };
  const nbOf = (d, dx, dy) => {
    const { x, y, w, h } = d.o; const m = 8;
    if (d.h === 'move') return { x: x + dx, y: y + dy, w, h };
    let nx = x; let ny = y; let nw = w; let nh = h;
    if (d.h.includes('e')) nw = Math.max(m, w + dx);
    if (d.h.includes('w')) { nw = Math.max(m, w - dx); nx = x + w - nw; }
    if (d.h.includes('s')) nh = Math.max(m, h + dy);
    if (d.h.includes('n')) { nh = Math.max(m, h - dy); ny = y + h - nh; }
    if (d.pic) { // a picture keeps its proportions: the larger change leads
      const sw = nw / w; const sh = nh / h; const k = Math.abs(sw - 1) >= Math.abs(sh - 1) ? sw : sh;
      nw = Math.max(m, w * k); nh = Math.max(m, nw * h / w);
      if (d.h.includes('w')) nx = x + w - nw; if (d.h.includes('n')) ny = y + h - nh;
    }
    return { x: nx, y: ny, w: nw, h: nh };
  };
  const r1 = (v) => Math.round(v * 10) / 10;
  frame.addEventListener('pointerdown', (e) => {
    if (!editing || !arrange || !selId || drag) return;
    const si = cur(); let o; try { o = eng.box(si, selId); } catch (er) { toast(er.message); return; }
    if (!o) { toast('This shape has no place of its own to change.'); return; }
    e.preventDefault(); try { frame.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    onActivity(); drag = { id: selId, si, o, h: (e.target.dataset && e.target.dataset.h) || 'move', k: scaleOf(frame.parentNode), x0: e.clientX, y0: e.clientY, moved: false, pic: !isText(si, selId) };
  });
  frame.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const sx = e.clientX - drag.x0; const sy = e.clientY - drag.y0;
    if (!drag.moved && Math.hypot(sx, sy) < 4) return;
    drag.moved = true; drag.nb = nbOf(drag, sx / drag.k, sy / drag.k); placeFrame(drag.nb);
  });
  const endDrag = (commit) => {
    const d = drag; drag = null; if (!d) return;
    if (!commit || !d.moved || !d.nb) { if (d.moved) placeFrame(d.o); return; }
    const nb = { x: r1(d.nb.x), y: r1(d.nb.y), w: r1(d.nb.w), h: r1(d.nb.h) };
    const ok = redraw(() => eng.setBox(d.si, d.id, nb), () => d.si);
    if (ok) reselect(d.id); else placeFrame(d.o);
  };
  frame.addEventListener('pointerup', () => endDrag(true));
  frame.addEventListener('pointercancel', () => endDrag(false));

  const onClick = (e) => {
    if (!editing || (dlg && !dlg.closed)) return;
    if (e.target.closest && e.target.closest('.eo-sel')) return;
    const n = e.target.closest ? e.target.closest('[data-sid]') : null;
    if (!n || !stage.contains(n)) { if (arrange) hideFrame(); return; }
    onActivity();
    if (arrange) { select(n); return; }
    const si = cur(); if (isText(si, n.dataset.sid)) editText(si, n.dataset.sid); else editBox(si, n.dataset.sid, ''); // a picture: its place
  };
  stage.addEventListener('click', onClick);

  const groups = [
    { id: 'text', title: 'Text', tools: [
      { id: 'shapes', label: 'Edit text', icon: IC_LIST, run: listShapes },
      { id: 'box', label: 'Add text box', icon: IC_BOX, run: addBox },
      { id: 'pic', label: 'Add picture', icon: IC_PIC, run: addPic },
      { id: 'arrange', label: 'Move and resize', icon: IC_MOVE, run: toggleArrange, on: () => arrange },
      { id: 'table', label: 'Table cell', icon: IC_TABLE, run: listTables },
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
      if (!on) { closeDlg(); arrange = false; stage.classList.remove('eo-parr'); hideFrame(); } else if (!told) { told = true; toast('Tap a text to change it.'); }
    },
    dirty: () => isDirty, touched: () => was,
    markClean() { isDirty = false; onDirty(); },
    bytes: () => eng.toBytes(),
    destroy() { stage.removeEventListener('click', onClick); clearTimeout(hideT); closeDlg(); stage.classList.remove('eo-pedit', 'eo-parr'); frame.remove(); }
  };
}
