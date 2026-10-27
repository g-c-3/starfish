// codeeditor.js — the text editor of the File explorer (Decision 288): line numbers, syntax colours, undo/redo, find and replace,
// go to line, wrap and size switches, a draggable scroll handle. CodeMirror 6, bundled into the app (no network); this module is
// loaded only when a text file or a note opens. kind 'file' (File explorer) or 'note' (Home and Vault notes, Decision 292: plain
// text, no numbers or colours, spell check on). Wrap and size choices last until the app closes, one set per kind.
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, lineNumbers, highlightActiveLine, highlightActiveLineGutter, keymap, placeholder, gutter, GutterMarker } from '@codemirror/view';
import { history, historyKeymap, defaultKeymap, insertNewline, undo, redo, undoDepth, redoDepth } from '@codemirror/commands';
import { syntaxHighlighting, HighlightStyle, bracketMatching, indentOnInput, StreamLanguage } from '@codemirror/language';
import { search, searchKeymap, openSearchPanel, closeSearchPanel, searchPanelOpen, highlightSelectionMatches } from '@codemirror/search';
import { tags as t } from '@lezer/highlight';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { markdown } from '@codemirror/lang-markdown';
import { xml } from '@codemirror/lang-xml';
import { yaml } from '@codemirror/lang-yaml';
import { java } from '@codemirror/lang-java';
import { python } from '@codemirror/lang-python';
import { cpp } from '@codemirror/lang-cpp';
import { go } from '@codemirror/lang-go';
import { rust } from '@codemirror/lang-rust';
import { php } from '@codemirror/lang-php';
import { sql } from '@codemirror/lang-sql';
import { sass } from '@codemirror/lang-sass';
import { less } from '@codemirror/lang-less';
// languages without a Lezer grammar: the CodeMirror 5 style modes (Decision 294)
import { csharp, kotlin, scala, dart } from '@codemirror/legacy-modes/mode/clike';
import { ruby } from '@codemirror/legacy-modes/mode/ruby';
import { swift } from '@codemirror/legacy-modes/mode/swift';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { perl } from '@codemirror/legacy-modes/mode/perl';
import { r } from '@codemirror/legacy-modes/mode/r';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { powerShell } from '@codemirror/legacy-modes/mode/powershell';
import { properties } from '@codemirror/legacy-modes/mode/properties';
import { diff } from '@codemirror/legacy-modes/mode/diff';
import { cmake } from '@codemirror/legacy-modes/mode/cmake';
import { groovy } from '@codemirror/legacy-modes/mode/groovy';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import { gas } from '@codemirror/legacy-modes/mode/gas';
const legacy = (mode) => () => StreamLanguage.define(mode);

// extension -> language; anything else stays plain text
const LANGS = {
  js: () => javascript(), mjs: () => javascript(), cjs: () => javascript(), jsx: () => javascript({ jsx: true }),
  ts: () => javascript({ typescript: true }), tsx: () => javascript({ typescript: true, jsx: true }),
  json: () => json(), html: () => html(), htm: () => html(), css: () => css(), md: () => markdown(), markdown: () => markdown(),
  xml: () => xml(), svg: () => xml(), xhtml: () => xml(), plist: () => xml(), yml: () => yaml(), yaml: () => yaml(),
  java: () => java(), py: () => python(),
  c: () => cpp(), h: () => cpp(), cpp: () => cpp(), cc: () => cpp(), cxx: () => cpp(), hpp: () => cpp(), hh: () => cpp(), hxx: () => cpp(),
  go: () => go(), rs: () => rust(), php: () => php(), sql: () => sql(), scss: () => sass(), sass: () => sass({ indented: true }), less: () => less(),
  vue: () => html(), svelte: () => html(),
  cs: legacy(csharp), kt: legacy(kotlin), kts: legacy(kotlin), scala: legacy(scala), dart: legacy(dart),
  rb: legacy(ruby), swift: legacy(swift), lua: legacy(lua), pl: legacy(perl), r: legacy(r),
  sh: legacy(shell), bash: legacy(shell), mk: legacy(shell), toml: legacy(toml), ps1: legacy(powerShell),
  properties: legacy(properties), env: legacy(properties), diff: legacy(diff), patch: legacy(diff),
  cmake: legacy(cmake), gradle: legacy(groovy), tex: legacy(stex), asm: legacy(gas)
};
export const languageFor = (name) => { const m = /\.([a-z0-9]+)$/i.exec(name || ''); const f = m && LANGS[m[1].toLowerCase()]; return f ? f() : []; };

// colours come from --cm-* variables (style.css), set for both themes
const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.operatorKeyword, t.controlKeyword], color: 'var(--cm-keyword)' },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--cm-string)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--cm-number)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--cm-comment)', fontStyle: 'italic' },
  { tag: [t.typeName, t.className, t.tagName, t.namespace], color: 'var(--cm-type)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.propertyName, t.attributeName], color: 'var(--cm-prop)' },
  { tag: [t.heading], color: 'var(--cm-keyword)', fontWeight: '700' },
  { tag: [t.link, t.url], color: 'var(--cm-prop)', textDecoration: 'underline' },
  { tag: [t.meta, t.processingInstruction, t.punctuation], color: 'var(--cm-muted)' },
  { tag: [t.inserted], color: 'var(--cm-string)' },
  { tag: [t.deleted], color: 'var(--cm-invalid)' },
  { tag: [t.definition(t.variableName), t.labelName, t.standard(t.variableName), t.special(t.variableName)], color: 'var(--cm-prop)' },
  { tag: [t.standard(t.typeName), t.standard(t.name), t.macroName], color: 'var(--cm-type)' },
  { tag: [t.operator, t.derefOperator], color: 'var(--cm-muted)' },
  { tag: t.invalid, color: 'var(--cm-invalid)' }
]);

const PREFS = { file: { wrap: true, size: 14 }, note: { wrap: true, size: 17 } };
const MIN_SIZE = 10, MAX_SIZE = 24;

const baseTheme = EditorView.theme({
  '&': { height: '100%', color: 'var(--fg)', backgroundColor: 'transparent' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'ui-monospace, Menlo, Consolas, monospace', lineHeight: '1.55', overflow: 'auto', scrollbarWidth: 'none' },
  '.cm-scroller::-webkit-scrollbar': { display: 'none' },
  '.cm-content': { padding: '8px 0 calc(40px + env(safe-area-inset-bottom, 0px))', caretColor: 'var(--brand)' },
  '.cm-line': { padding: '0 12px 0 8px' },
  '.cm-gutters': { backgroundColor: 'var(--surface-2)', color: 'var(--muted)', border: 'none', borderRight: '1px solid var(--border)' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 10px', minWidth: '28px' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--brand) 8%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'color-mix(in srgb, var(--brand) 14%, var(--surface-2))', color: 'var(--fg)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: 'color-mix(in srgb, var(--brand) 30%, transparent)' },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--brand) 25%, transparent)', outline: '1px solid var(--brand)' },
  '.cm-searchMatch-selected': { backgroundColor: 'color-mix(in srgb, var(--brand) 55%, transparent)' },
  '.cm-matchingBracket': { backgroundColor: 'color-mix(in srgb, var(--brand) 22%, transparent)', outline: '1px solid var(--brand)' },
  '.cm-panels': { backgroundColor: 'var(--surface)', color: 'var(--fg)', borderBottom: '1px solid var(--border)' }
});

// note text: the page font, wider side padding, no gutter
const noteTheme = EditorView.theme({
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: '1.65' },
  '.cm-content': { padding: '14px 0 calc(40px + env(safe-area-inset-bottom, 0px))' },
  '.cm-placeholder': { color: 'var(--muted)' },
  '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: 'var(--muted)', opacity: '0.7' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 0 0 12px', minWidth: '0' },
  '.ev-rn': { textAlign: 'right', fontVariantNumeric: 'tabular-nums', userSelect: 'none' },
  '.ev-rn span': { display: 'block' },
  '.ev-rn i': { fontStyle: 'normal', fontSize: '0.62em' },
  '.cm-line': { padding: '0 18px 0 10px' }
});

// Row numbers for notes (Decision 304): every row on screen is numbered in turn, so a line that wraps takes several numbers and the
// next line carries on from them; zoom or the Wrap switch changes the count. A row is one line height: the first row of a block
// is its top divided by the line height, its row count is its height divided by the line height.
export function rowSpan(top, height, lh) {
  const h = lh > 0 ? lh : 20;
  return { start: Math.round(top / h) + 1, rows: Math.max(1, Math.round(height / h)) };
}
class RowMarker extends GutterMarker {
  constructor(start, rows, lh) { super(); this.start = start; this.rows = rows; this.lh = lh; }
  eq(o) { return o.start === this.start && o.rows === this.rows && Math.abs(o.lh - this.lh) < 0.5; }
  toDOM() {
    const d = document.createElement('div');
    d.className = 'ev-rn';
    for (let i = 0; i < this.rows; i++) {
      const r = document.createElement('span'); // inherits the text's font size: its baseline is the text's baseline
      const n = document.createElement('i');    // the digits sit on that baseline, smaller
      n.textContent = String(this.start + i);
      r.style.height = r.style.lineHeight = `${this.lh}px`;
      r.appendChild(n); d.appendChild(r);
    }
    return d;
  }
}
const lineH = (view) => view.defaultLineHeight || 20;
const totalRows = (view) => { const b = view.lineBlockAt(view.state.doc.length); return Math.max(1, Math.round((b.top + b.height) / lineH(view))); }; // the document alone, without its padding
const spacerFor = (view) => new RowMarker(10 ** Math.max(2, String(totalRows(view)).length) - 1, 1, lineH(view)); // sets the width
const rowGutter = () => gutter({
  class: 'cm-lineNumbers ev-rows',
  lineMarker: (view, line) => { const { start, rows } = rowSpan(line.top, line.height, lineH(view)); return new RowMarker(start, rows, lineH(view)); },
  lineMarkerChange: (u) => u.docChanged || u.heightChanged || u.geometryChanged || u.viewportChanged || u.transactions.some((t) => t.reconfigured),
  initialSpacer: (view) => spacerFor(view),
  updateSpacer: (_sp, u) => spacerFor(u.view)
});

// The Find and Replace panel: a clear button inside each field, and no close button (the Find tool toggles the panel).
function tidySearchPanel(panel) {
  if (panel.dataset.tidy) return;
  panel.dataset.tidy = '1';
  for (const [name, label] of [['search', 'Clear find'], ['replace', 'Clear replace']]) {
    const input = panel.querySelector(`input[name="${name}"]`);
    if (!input) continue;
    const wrap = document.createElement('span');
    wrap.className = 'ev-fw';
    input.replaceWith(wrap);
    wrap.appendChild(input);
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'ev-clear';
    b.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7"/></svg>';
    b.setAttribute('aria-label', label); b.title = label;
    b.onmousedown = (e) => e.preventDefault();
    b.onclick = () => { input.value = ''; input.dispatchEvent(new Event('change', { bubbles: true })); input.dispatchEvent(new Event('input', { bubbles: true })); input.focus(); };
    wrap.appendChild(b);
  }
}

// parent, text, name, kind, editable (may be switched on), ui { askText }, onChange()
export function createCodeEditor({ parent, text, name, kind = 'file', editable = true, ui, onChange = () => {}, onFind = () => {}, onRows = () => {} }) {
  const note = kind === 'note', prefs = PREFS[note ? 'note' : 'file'];
  const wrapC = new Compartment(), sizeC = new Compartment(), editC = new Compartment();
  const sizeTheme = () => EditorView.theme({ '&': { fontSize: `${prefs.size}px` } });
  const editExt = (on) => [EditorState.readOnly.of(!on), EditorView.editable.of(on)];
  let on = false;
  const state = EditorState.create({
    doc: text,
    extensions: [
      ...(note ? [placeholder('Start typing\u2026'), rowGutter()] : [lineNumbers(), highlightActiveLine(), highlightActiveLineGutter(), bracketMatching(), indentOnInput()]),
      history(), highlightSelectionMatches(), search({ top: true }), syntaxHighlighting(highlight), baseTheme, ...(note ? [noteTheme] : []), // noteTheme after baseTheme: later wins
      keymap.of([...(note ? [{ key: 'Enter', run: insertNewline }] : []), ...defaultKeymap, ...historyKeymap, ...searchKeymap]), // note: Enter copies no indent
      languageFor(note ? '' : name),
      wrapC.of(prefs.wrap ? EditorView.lineWrapping : []), sizeC.of(sizeTheme()), editC.of(editExt(false)),
      EditorView.contentAttributes.of(note
        ? { spellcheck: 'true', autocapitalize: 'sentences', autocorrect: 'on', 'aria-label': 'Note text' }
        : { spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off', 'aria-label': name || 'text' }),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) onChange();
        if (u.docChanged || u.heightChanged || u.geometryChanged) onRows(); // the number of rows can change without the text changing
        const open = searchPanelOpen(u.state);
        if (open !== findOpen) { findOpen = open; onFind(open); }
      })
    ]
  });
  const view = new EditorView({ state, parent });
  let base = view.state.doc;
  const panelWatch = new MutationObserver(() => { const p = view.dom.querySelector('.cm-search'); if (p) tidySearchPanel(p); });
  panelWatch.observe(view.dom, { childList: true, subtree: true });

  // draggable scroll handle (long files): appears while scrolling, stays while it is dragged
  const sc = view.scrollDOM;
  const thumb = document.createElement('div'); thumb.className = 'cm-thumb';
  parent.appendChild(thumb);
  let hideT = 0, dragging = false;
  const place = () => {
    const max = sc.scrollHeight - sc.clientHeight;
    if (max < sc.clientHeight) { thumb.classList.remove('on'); return; }
    const th = Math.max(44, sc.clientHeight * sc.clientHeight / sc.scrollHeight);
    thumb.style.height = `${th}px`;
    thumb.style.transform = `translateY(${(sc.scrollTop / max) * (sc.clientHeight - th)}px)`;
    thumb.classList.add('on'); clearTimeout(hideT);
    if (!dragging) hideT = setTimeout(() => thumb.classList.remove('on'), 1200);
  };
  const onScroll = () => place();
  sc.addEventListener('scroll', onScroll, { passive: true });
  thumb.addEventListener('pointerdown', (e) => {
    dragging = true; thumb.setPointerCapture(e.pointerId); e.preventDefault();
  });
  thumb.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const r = sc.getBoundingClientRect(), th = thumb.offsetHeight;
    const f = Math.min(1, Math.max(0, (e.clientY - r.top - th / 2) / (r.height - th)));
    sc.scrollTop = f * (sc.scrollHeight - sc.clientHeight);
  });
  const endDrag = () => { dragging = false; place(); };
  thumb.addEventListener('pointerup', endDrag); thumb.addEventListener('pointercancel', endDrag);

  let findOpen = false;
  const api = {
    view,
    getValue: () => view.state.doc.toString(),
    isDirty: () => !view.state.doc.eq(base),
    markClean: (doc = view.state.doc) => { base = doc; }, // doc: the text that was saved, when more was typed meanwhile
    rowCount: () => (note ? totalRows(view) : view.state.doc.lines), // rows as numbered on screen (notes), else lines
    isEditing: () => on,
    canEdit: editable,
    setEditing(v, focus = true) { // focus false: switch on without raising the keyboard
      if (v && !editable) return;
      on = !!v; view.dispatch({ effects: editC.reconfigure(editExt(on)) });
      if (on && focus) view.focus();
    },
    undo: () => undo(view), redo: () => redo(view),
    canUndo: () => undoDepth(view.state) > 0, canRedo: () => redoDepth(view.state) > 0,
    find() { // the Find tool opens the panel and closes it again; returns whether it is open now
      if (searchPanelOpen(view.state)) { closeSearchPanel(view); return false; }
      openSearchPanel(view);
      return true;
    },
    closeFind() { closeSearchPanel(view); },
    async goTo() {
      if (note) { // rows as numbered on screen (Decision 304)
        const lh = lineH(view), total = totalRows(view);
        const v = await ui.askText({ title: 'Go to line', text: `1 to ${total}`, placeholder: 'Line number', ok: 'Go' });
        const k = parseInt(v, 10);
        if (!Number.isFinite(k)) return;
        const row = Math.min(total, Math.max(1, k));
        const block = view.lineBlockAtHeight((row - 1) * lh + lh / 2);
        view.dispatch({ selection: { anchor: block.from }, effects: EditorView.scrollIntoView(block.from, { y: 'center' }) });
        const inside = row - 1 - Math.round(block.top / lh); // a wrapped line: move to the row asked for
        if (inside > 0) {
          requestAnimationFrame(() => {
            const c = view.coordsAtPos(block.from), r = view.contentDOM.getBoundingClientRect();
            const pos = c ? view.posAtCoords({ x: r.left + 30, y: c.top + inside * lh + lh / 2 }) : null;
            if (pos != null) view.dispatch({ selection: { anchor: pos } });
          });
        }
        return;
      }
      const n = view.state.doc.lines;
      const v = await ui.askText({ title: 'Go to line', text: `1 to ${n}`, placeholder: 'Line number', ok: 'Go' });
      const k = parseInt(v, 10);
      if (!Number.isFinite(k)) return;
      const line = view.state.doc.line(Math.min(n, Math.max(1, k)));
      view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'center' }) });
    },
    toggleWrap() { prefs.wrap = !prefs.wrap; view.dispatch({ effects: wrapC.reconfigure(prefs.wrap ? EditorView.lineWrapping : []) }); return prefs.wrap; },
    isWrapped: () => prefs.wrap,
    bumpSize(d) { prefs.size = Math.min(MAX_SIZE, Math.max(MIN_SIZE, prefs.size + d)); view.dispatch({ effects: sizeC.reconfigure(sizeTheme()) }); },
    destroy() { panelWatch.disconnect(); clearTimeout(hideT); sc.removeEventListener('scroll', onScroll); thumb.remove(); view.destroy(); }
  };
  return api;
}
