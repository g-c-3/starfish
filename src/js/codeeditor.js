// codeeditor.js — the text editor of the File explorer (Decision 288): line numbers, syntax colours, undo/redo, find and replace,
// go to line, wrap and size switches, a draggable scroll handle. CodeMirror 6, bundled into the app (no network); this module is
// loaded only when a text file or a note opens. kind 'file' (File explorer) or 'note' (Home and Vault notes, Decision 292: plain
// text, no numbers or colours, spell check on). Wrap and size choices last until the app closes, one set per kind.
import { EditorState, Compartment, RangeSetBuilder } from '@codemirror/state';
import '../css/notetools.css';
import { EditorView, lineNumbers, highlightActiveLine, highlightActiveLineGutter, keymap, placeholder, gutter, GutterMarker, Decoration, ViewPlugin } from '@codemirror/view';
import { history, historyKeymap, defaultKeymap, insertNewline, undo, redo, undoDepth, redoDepth } from '@codemirror/commands';
import { syntaxHighlighting, HighlightStyle, bracketMatching, indentOnInput, StreamLanguage } from '@codemirror/language';
import { search, searchKeymap, openSearchPanel, closeSearchPanel, searchPanelOpen } from '@codemirror/search';
import { tags as t } from '@lezer/highlight';
import { noteStyle } from './notestyle-cm.js';
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
const MIN_SIZE = 10, MAX_SIZE = 42;

// The Find and Replace panel's words, each word capitalised (Decision 415).
const PHRASES = { next: 'Next', previous: 'Previous', all: 'All', 'match case': 'Match Case', regexp: 'Regexp', 'by word': 'By Word', replace: 'Replace', 'replace all': 'Replace All', Find: 'Find', Replace: 'Replace' };

// Lists (Decision 414): a marker and a space at the start of each non-blank line of the selection. Applying another style replaces the
// marker; applying the style the lines already have, or 'none', takes it off. Numbers count the non-blank lines only.
const LIST_MARK = { dot: '\u2022', circle: '\u25CB', square: '\u25AA', arrow: '\u2192', dash: '\u2013', check: '\u2713' };
const roman = (n) => { if (n >= 40) return String(n); let s = ''; for (const [v, r] of [[10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]) while (n >= v) { s += r; n -= v; } return s; };
const letters = (n) => { let s = ''; while (n > 0) { n -= 1; s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26); } return s; };
const markerFor = (kind, n) => LIST_MARK[kind] || ({ num: `${n}.`, romanS: `${roman(n)}.`, romanB: `${roman(n).toUpperCase()}.`, alphaS: `${letters(n)}.`, alphaB: `${letters(n).toUpperCase()}.` })[kind];
const MARK_RE = /^(\s*)(?:[\u2022\u25CB\u25AA\u2192\u2013\u2713]|\d+\.|[a-zA-Z]\.|(?=[ivx])x{0,3}(?:ix|iv|v?i{0,3})\.|(?=[IVX])X{0,3}(?:IX|IV|V?I{0,3})\.)\s/;

// List indentation (Decision 421). Both kinds are 2 em wide and are told apart by the character, so the choice is kept in the text:
// origin = four en spaces, only the first row of a point is indented; full = two em spaces, and the wrapped rows of the point are
// held at the same indent (a line decoration: padding of n em, first row pulled back by n em, so the marker stays where the spaces end).
const IND = { origin: '\u2002'.repeat(4), full: '\u2003'.repeat(2), none: '' };
const OUR_SPACES = /[\u2002\u2003]/g;
const hanging = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = this.build(view); }
  update(u) { if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view); }
  build(view) {
    const b = new RangeSetBuilder();
    let last = -1;
    for (const { from, to } of view.visibleRanges) {
      for (let pos = from; pos <= to;) {
        const line = view.state.doc.lineAt(pos);
        pos = line.to + 1;
        if (line.from <= last) continue;
        last = line.from;
        const m = /^\u2003+/.exec(line.text);
        if (m && MARK_RE.test(line.text)) b.add(line.from, line.from, Decoration.line({ attributes: { style: `padding-left: calc(10px + ${m[0].length}em); text-indent: -${m[0].length}em` } }));
      }
    }
    return b.finish();
  }
}, { decorations: (v) => v.decorations });

// Tab (Decision 422): four spaces.
const TAB = '    ';

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

// Line numbers for notes (Decisions 304 and 415): a line is one line however many rows it wraps to. Its number sits beside its first
// row; the rows it wraps onto carry none, and the next line takes the next number. A row is one line height: a block's row count is
// its height divided by the line height.
export function rowSpan(top, height, lh) {
  const h = lh > 0 ? lh : 20;
  return { start: Math.round(top / h) + 1, rows: Math.max(1, Math.round(height / h)) };
}
class RowMarker extends GutterMarker {
  constructor(num, rows, lh) { super(); this.num = num; this.rows = rows; this.lh = lh; }
  eq(o) { return o.num === this.num && o.rows === this.rows && Math.abs(o.lh - this.lh) < 0.5; }
  toDOM() {
    const d = document.createElement('div');
    d.className = 'ev-rn';
    for (let i = 0; i < this.rows; i++) {
      const r = document.createElement('span'); // inherits the text's font size: its baseline is the text's baseline
      r.style.height = r.style.lineHeight = `${this.lh}px`;
      if (i === 0) { const n = document.createElement('i'); n.textContent = String(this.num); r.appendChild(n); } // the digits sit on that baseline, smaller
      d.appendChild(r);
    }
    return d;
  }
}
const lineH = (view) => view.defaultLineHeight || 20;
// Ruled lines for notes (Decisions 417 and 418): the CSS draws one thin line per row from these two numbers (style.css, .ev-ruled). The
// class and the numbers live on the element that holds the editor, not on the editor's root: the editor rewrites the root's class
// attribute whenever its theme changes, which a text size change does, and that removed the lines.
const paintRule = (view, host) => {
  const lh = `${lineH(view)}px`, pt = `${parseFloat(getComputedStyle(view.contentDOM).paddingTop) || 0}px`;
  if (host.style.getPropertyValue('--ev-lh') !== lh) host.style.setProperty('--ev-lh', lh);
  if (host.style.getPropertyValue('--ev-pt') !== pt) host.style.setProperty('--ev-pt', pt);
};
const spacerFor = (view) => new RowMarker(10 ** Math.max(2, String(view.state.doc.lines).length) - 1, 1, lineH(view)); // sets the width
const rowGutter = () => gutter({
  class: 'cm-lineNumbers ev-rows',
  lineMarker: (view, line) => new RowMarker(view.state.doc.lineAt(line.from).number, rowSpan(line.top, line.height, lineH(view)).rows, lineH(view)),
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
// spans: the styles of a note (notestyle.js); onSelect(info) when the selection or its styles change (notes only).
export function createCodeEditor({ parent, text, name, kind = 'file', editable = true, ui, spans = [], onChange = () => {}, onFind = () => {}, onRows = () => {}, onSelect = () => {} }) {
  const note = kind === 'note', prefs = PREFS[note ? 'note' : 'file'];
  parent.classList.remove('ev-ruled'); // the holder is reused from note to note: lines only when this editor switches them on
  const ns = note ? noteStyle(spans) : null;
  const wrapC = new Compartment(), sizeC = new Compartment(), editC = new Compartment();
  const sizeTheme = () => EditorView.theme({ '&': { fontSize: `${prefs.size}px` } });
  const editExt = (on) => [EditorState.readOnly.of(!on), EditorView.editable.of(on)];
  let on = false;
  const state = EditorState.create({
    doc: text,
    extensions: [
      ...(note ? [placeholder('Start typing\u2026'), rowGutter()] : [lineNumbers(), highlightActiveLine(), highlightActiveLineGutter(), bracketMatching(), indentOnInput()]),
      history(), ...(ns ? [ns.extension, hanging] : []), EditorState.phrases.of(PHRASES), search({ top: true }), syntaxHighlighting(highlight), baseTheme, ...(note ? [noteTheme] : []), // noteTheme after baseTheme: later wins
      keymap.of([...(note ? [{ key: 'Enter', run: insertNewline }] : []), ...defaultKeymap, ...historyKeymap, ...searchKeymap]), // note: Enter copies no indent
      languageFor(note ? '' : name),
      wrapC.of(prefs.wrap ? EditorView.lineWrapping : []), sizeC.of(sizeTheme()), editC.of(editExt(false)),
      EditorView.contentAttributes.of(note
        ? { spellcheck: 'true', autocapitalize: 'sentences', autocorrect: 'on', 'aria-label': 'Note text' }
        : { spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off', 'aria-label': name || 'text' }),
      EditorView.updateListener.of((u) => {
        const styled = ns && ns.touched(u);
        if (u.docChanged || styled) onChange();
        if (ns && (u.selectionSet || u.docChanged || styled)) onSelect(ns.info(u.state));
        if (u.docChanged || u.heightChanged || u.geometryChanged) onRows(); // the number of rows can change without the text changing
        if (note && (u.geometryChanged || u.heightChanged || u.transactions.some((t) => t.reconfigured))) paintRule(u.view, parent);
        const open = searchPanelOpen(u.state);
        if (open !== findOpen) {
          findOpen = open; onFind(open);
          // The panel pushes the text down by its height: the text slides there with the panel's fade instead of jumping (Decision 438).
          if (open) requestAnimationFrame(() => { const pn = view.dom.querySelector('.cm-panels-top'); if (pn) slideText(-pn.offsetHeight); });
        }
      })
    ]
  });
  const view = new EditorView({ state, parent });
  let base = view.state.doc;
  const fmtKey = (s = ns ? ns.spansOf(view.state) : []) => JSON.stringify(s);
  let baseKey = fmtKey();
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

  let findOpen = false, leaving = null;
  const reduced = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
  // transform only, the duration and curve of the arriving page (motion.css tokens)
  const slideText = (from) => {
    if (!from || reduced()) return;
    try { view.scrollDOM.animate([{ transform: `translateY(${from}px)` }, { transform: 'none' }], { duration: 300, easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)' }); } catch { /* no animation support: it just moves */ }
  };
  const api = {
    view,
    getValue: () => view.state.doc.toString(),
    isDirty: () => !view.state.doc.eq(base) || fmtKey() !== baseKey,
    markClean: (doc = view.state.doc, fmt) => { base = doc; baseKey = fmt ? fmtKey(fmt) : fmtKey(); }, // doc, fmt: what was saved, when more was done meanwhile
    getFormat: () => (ns ? ns.spansOf(view.state) : []),
    toggleStyle: (kind, value) => (ns ? ns.toggle(view, kind, value) : false), // colour 'r' 'g' 'b', or 'b' 'i' 'u'; false when nothing is selected
    styleInfo: () => (ns ? ns.info(view.state) : { has: false, c: null, b: false, i: false, u: false }),
    rowCount: () => view.state.doc.lines, // lines: a wrapped line is one line (Decision 415)
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
      if (searchPanelOpen(view.state)) { api.closeFind(); return false; }
      if (leaving) return false; // still closing
      openSearchPanel(view);
      return true;
    },
    // The panel fades out (0.17 s), then goes, and the text slides up to its place (Decision 438). Instant under reduced motion.
    closeFind() {
      if (!searchPanelOpen(view.state) || leaving) return;
      const pn = view.dom.querySelector('.cm-panels-top .cm-panel.cm-search');
      if (!pn || reduced()) { closeSearchPanel(view); return; }
      const h = view.dom.querySelector('.cm-panels-top').offsetHeight || 0;
      pn.classList.add('mx-leaving');
      leaving = setTimeout(() => {
        leaving = null;
        try { if (searchPanelOpen(view.state)) { closeSearchPanel(view); slideText(h); } } catch { /* the editor is gone */ }
      }, 170);
    },
    isFindOpen: () => searchPanelOpen(view.state),
    async goTo() {
      const n = view.state.doc.lines;
      const v = await ui.askText({ title: 'Go to line', text: `1 to ${n}`, placeholder: 'Line number', ok: 'Go' });
      const k = parseInt(v, 10);
      if (!Number.isFinite(k)) return;
      const line = view.state.doc.line(Math.min(n, Math.max(1, k)));
      view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'center' }) });
    },
    toggleWrap() { prefs.wrap = !prefs.wrap; view.dispatch({ effects: wrapC.reconfigure(prefs.wrap ? EditorView.lineWrapping : []) }); return prefs.wrap; },
    isWrapped: () => prefs.wrap,
    getSize: () => ({ size: prefs.size, min: MIN_SIZE, max: MAX_SIZE }),
    setRuled(on) { parent.classList.toggle('ev-ruled', !!on); paintRule(view, parent); return !!on; },
    isRuled: () => parent.classList.contains('ev-ruled'),
    setSize(n) { prefs.size = Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(n))); view.dispatch({ effects: sizeC.reconfigure(sizeTheme()) }); if (note) requestAnimationFrame(() => paintRule(view, parent)); return prefs.size; },
    // The non-blank lines of the selection (a selection ending at a line start leaves that line out).
    listLines() {
      const st = view.state, sel = st.selection.main;
      const a = st.doc.lineAt(sel.from);
      let b = st.doc.lineAt(sel.to);
      if (sel.to > sel.from && sel.to === b.from && b.number > a.number) b = st.doc.line(b.number - 1);
      const lines = [];
      for (let i = a.number; i <= b.number; i++) { const l = st.doc.line(i); if (l.text.trim()) lines.push(l); }
      return lines;
    },
    // kind: dot, circle, square, arrow, dash, check, num, romanS, romanB, alphaS, alphaB, or 'none'. indent: 'origin', 'full' or 'none'
    // (Decision 421): our indent is set to that and any indent of the person's own is kept. Taking a list off takes our indent off too.
    // Returns the number of lines changed.
    applyList(kind, indent = 'none') {
      const lines = api.listLines();
      if (!lines.length) return 0;
      let remove = kind === 'none';
      if (!remove) {
        remove = lines.every((l, i) => { const m = /^\s*/.exec(l.text)[0]; return l.text.startsWith(`${markerFor(kind, i + 1)} `, m.length); });
      }
      const changes = [];
      lines.forEach((l, i) => {
        const m = MARK_RE.exec(l.text);
        const ws = m ? m[1] : /^\s*/.exec(l.text)[0];
        const cut = m ? m[0].length - m[1].length : 0;
        const keep = ws.replace(OUR_SPACES, '');
        const next = (remove ? '' : IND[indent] || '') + keep + (remove ? '' : `${markerFor(kind, i + 1)} `);
        if (l.text.slice(0, ws.length + cut) !== next) changes.push({ from: l.from, to: l.from + ws.length + cut, insert: next });
      });
      if (!changes.length) return 0;
      view.dispatch({ changes, userEvent: 'input' });
      return changes.length;
    },
    // Re-indent the lines of the selection that already are list points. Returns the number of lines changed.
    applyIndent(indent) {
      const changes = [];
      for (const l of api.listLines()) {
        const m = MARK_RE.exec(l.text);
        if (!m) continue;
        const next = (IND[indent] || '') + m[1].replace(OUR_SPACES, '');
        if (m[1] !== next) changes.push({ from: l.from, to: l.from + m[1].length, insert: next });
      }
      if (!changes.length) return 0;
      view.dispatch({ changes, userEvent: 'input' });
      return changes.length;
    },
    // Tab (Decision 422): four spaces at the cursor; with a selection, in front of it, and over several lines at the start of each of
    // them. Nothing is deleted, and the selection stays on the same text. Each tap is one more step.
    insertTab() {
      const st = view.state, sel = st.selection.main;
      const a = st.doc.lineAt(sel.from);
      let b = st.doc.lineAt(sel.to);
      if (sel.to > sel.from && sel.to === b.from && b.number > a.number) b = st.doc.line(b.number - 1);
      if (a.number === b.number) {
        view.dispatch({ changes: { from: sel.from, insert: TAB }, selection: { anchor: sel.anchor + TAB.length, head: sel.head + TAB.length }, scrollIntoView: true, userEvent: 'input.type' });
        return 1;
      }
      const changes = [];
      for (let i = a.number; i <= b.number; i++) { const l = st.doc.line(i); if (l.text.trim()) changes.push({ from: l.from, insert: TAB }); }
      if (!changes.length) return 0;
      view.dispatch({ changes, userEvent: 'input.type' });
      return changes.length;
    },
    bumpSize(d) { prefs.size = Math.min(MAX_SIZE, Math.max(MIN_SIZE, prefs.size + d)); view.dispatch({ effects: sizeC.reconfigure(sizeTheme()) }); },
    destroy() { panelWatch.disconnect(); clearTimeout(hideT); sc.removeEventListener('scroll', onScroll); thumb.remove(); view.destroy(); parent.classList.remove('ev-ruled'); parent.style.removeProperty('--ev-lh'); parent.style.removeProperty('--ev-pt'); }
  };
  return api;
}
