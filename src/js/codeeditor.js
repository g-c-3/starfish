// codeeditor.js — the text editor of the File explorer (Decision 288): line numbers, syntax colours, undo/redo, find and replace,
// go to line, wrap and size switches, a draggable scroll handle. CodeMirror 6, bundled into the app (no network); this module is
// loaded only when a text file opens. Wrap and size choices last until the app closes.
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, lineNumbers, highlightActiveLine, highlightActiveLineGutter, keymap } from '@codemirror/view';
import { history, historyKeymap, defaultKeymap, undo, redo, undoDepth, redoDepth } from '@codemirror/commands';
import { syntaxHighlighting, HighlightStyle, bracketMatching, indentOnInput } from '@codemirror/language';
import { search, searchKeymap, openSearchPanel, closeSearchPanel, highlightSelectionMatches } from '@codemirror/search';
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

// extension -> language; anything else stays plain text
const LANGS = {
  js: () => javascript(), mjs: () => javascript(), cjs: () => javascript(), jsx: () => javascript({ jsx: true }),
  ts: () => javascript({ typescript: true }), tsx: () => javascript({ typescript: true, jsx: true }),
  json: () => json(), html: () => html(), htm: () => html(), css: () => css(), md: () => markdown(), markdown: () => markdown(),
  xml: () => xml(), svg: () => xml(), xhtml: () => xml(), plist: () => xml(), yml: () => yaml(), yaml: () => yaml(),
  java: () => java(), py: () => python()
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
  { tag: t.invalid, color: 'var(--cm-invalid)' }
]);

const prefs = { wrap: true, size: 14 };
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

// parent, text, name, editable (may be switched on), ui { askText }, onChange()
export function createCodeEditor({ parent, text, name, editable = true, ui, onChange = () => {} }) {
  const wrapC = new Compartment(), sizeC = new Compartment(), editC = new Compartment();
  const sizeTheme = () => EditorView.theme({ '&': { fontSize: `${prefs.size}px` } });
  const editExt = (on) => [EditorState.readOnly.of(!on), EditorView.editable.of(on)];
  let on = false;
  const state = EditorState.create({
    doc: text,
    extensions: [
      lineNumbers(), highlightActiveLine(), highlightActiveLineGutter(), history(), bracketMatching(), indentOnInput(),
      highlightSelectionMatches(), search({ top: true }), syntaxHighlighting(highlight), baseTheme,
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
      languageFor(name),
      wrapC.of(prefs.wrap ? EditorView.lineWrapping : []), sizeC.of(sizeTheme()), editC.of(editExt(false)),
      EditorView.contentAttributes.of({ spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off', 'aria-label': name || 'text' }),
      EditorView.updateListener.of((u) => { if (u.docChanged) onChange(); })
    ]
  });
  const view = new EditorView({ state, parent });
  let base = view.state.doc;

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

  const api = {
    view,
    getValue: () => view.state.doc.toString(),
    isDirty: () => !view.state.doc.eq(base),
    markClean: () => { base = view.state.doc; },
    isEditing: () => on,
    canEdit: editable,
    setEditing(v) {
      if (v && !editable) return;
      on = !!v; view.dispatch({ effects: editC.reconfigure(editExt(on)) });
      if (on) view.focus();
    },
    undo: () => undo(view), redo: () => redo(view),
    canUndo: () => undoDepth(view.state) > 0, canRedo: () => redoDepth(view.state) > 0,
    find() { openSearchPanel(view); },
    closeFind() { closeSearchPanel(view); },
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
    bumpSize(d) { prefs.size = Math.min(MAX_SIZE, Math.max(MIN_SIZE, prefs.size + d)); view.dispatch({ effects: sizeC.reconfigure(sizeTheme()) }); },
    destroy() { clearTimeout(hideT); sc.removeEventListener('scroll', onScroll); thumb.remove(); view.destroy(); }
  };
  return api;
}
