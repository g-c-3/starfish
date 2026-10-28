// notestyle-cm.js — the editor side of note styles (Decision 309): marks over the text, undo and redo, selection coverage.
// Spans are [kind, from, to, value] as in notestyle.js. Styles move with the text as it is edited and do not grow when typing
// at their edge.
import { StateField, StateEffect, RangeSet } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';
import { invertedEffects } from '@codemirror/commands';

const CLASS = { b: 'ns-bold', i: 'ns-ital', u: 'ns-und', cr: 'ns-c-r', cg: 'ns-c-g', cb: 'ns-c-b' };
const mark = (kind, value) => Decoration.mark({ class: kind === 'c' ? CLASS[`c${value}`] : CLASS[kind], kind, value: kind === 'c' ? value : 1 });
const styleEffect = StateEffect.define(); // { kind, value (null clears), from, to }
const resetEffect = StateEffect.define(); // a whole set: what undo and redo bring back

function fromSpans(spans) {
  const sorted = spans.slice().sort((a, b) => a[1] - b[1] || a[2] - b[2]);
  return RangeSet.of(sorted.map(([k, f, t, v]) => mark(k, v).range(f, t)), true);
}
// The kind removed over [from, to); the parts of a range outside it stay.
function clear(set, kind, from, to) {
  const add = [];
  let hit = false;
  set.between(from, to, (f, t, d) => {
    if (d.spec.kind !== kind || !(f < to && t > from)) return;
    hit = true;
    if (f < from) add.push(d.range(f, from));
    if (t > to) add.push(d.range(to, t));
  });
  if (!hit) return set;
  return set.update({ filter: (f, t, d) => !(d.spec.kind === kind && f < to && t > from), add, sort: true });
}
const apply = (set, { kind, value, from, to }) => {
  const s = clear(set, kind, from, to);
  return value == null ? s : s.update({ add: [mark(kind, value).range(from, to)] });
};

export function noteStyle(initial = []) {
  const field = StateField.define({
    create: () => fromSpans(initial),
    update(set, tr) {
      if (tr.docChanged) set = set.map(tr.changes);
      for (const e of tr.effects) {
        if (e.is(resetEffect)) set = e.value;
        else if (e.is(styleEffect)) set = apply(set, e.value);
      }
      return set;
    },
    provide: (f) => EditorView.decorations.from(f)
  });
  // Undo and redo bring back the styles as they were before the change (also when deleted text returns).
  const undoable = invertedEffects.of((tr) => {
    const had = tr.startState.field(field);
    const changed = tr.docChanged ? had.size > 0 : tr.effects.some((e) => e.is(styleEffect) || e.is(resetEffect));
    return changed ? [resetEffect.of(had)] : [];
  });

  const spansOf = (state) => { // normalised: sorted, touching or overlapping ranges of one style joined
    const by = new Map();
    state.field(field).between(0, state.doc.length, (f, t, d) => {
      if (f >= t) return;
      const key = `${d.spec.kind}${d.spec.kind === 'c' ? d.spec.value : ''}`;
      if (!by.has(key)) by.set(key, []);
      by.get(key).push([f, t]);
    });
    const out = [];
    for (const [key, list] of by) {
      list.sort((a, b) => a[0] - b[0]);
      const joined = [];
      for (const [f, t] of list) {
        const last = joined[joined.length - 1];
        if (last && f <= last[1]) last[1] = Math.max(last[1], t);
        else joined.push([f, t]);
      }
      for (const [f, t] of joined) out.push(key[0] === 'c' ? ['c', f, t, key[1]] : [key[0], f, t]);
    }
    return out.sort((a, b) => a[1] - b[1] || a[2] - b[2] || (a[0] < b[0] ? -1 : 1));
  };
  // The value of `kind` that covers all of [from, to): a colour letter, true for b, i, u; else null.
  const coverage = (state, kind, from, to) => {
    if (from >= to) return null;
    const by = new Map();
    state.field(field).between(from, to, (f, t, d) => {
      if (d.spec.kind !== kind) return;
      const v = kind === 'c' ? d.spec.value : true;
      if (!by.has(v)) by.set(v, []);
      by.get(v).push([Math.max(f, from), Math.min(t, to)]);
    });
    for (const [v, list] of by) {
      list.sort((a, b) => a[0] - b[0]);
      let at = from;
      for (const [f, t] of list) { if (f > at) break; at = Math.max(at, t); }
      if (at >= to) return v;
    }
    return null;
  };
  const toggle = (view, kind, value) => { // returns false when nothing is selected
    const { from, to } = view.state.selection.main;
    if (from === to) return false;
    const on = coverage(view.state, kind, from, to) === (kind === 'c' ? value : true);
    view.dispatch({ effects: styleEffect.of({ kind, value: on ? null : (kind === 'c' ? value : 1), from, to }) });
    return true;
  };
  // With a selection: what covers all of it. With only a cursor: what is on the character before it (else after it), for display.
  const info = (state) => {
    const { from, to } = state.selection.main;
    const has = from !== to;
    const at = (k) => (has ? coverage(state, k, from, to) : (coverage(state, k, Math.max(0, from - 1), from) ?? coverage(state, k, from, from + 1)));
    return { has, c: at('c'), b: !!at('b'), i: !!at('i'), u: !!at('u') };
  };
  const touched = (u) => u.transactions.some((tr) => tr.effects.some((e) => e.is(styleEffect) || e.is(resetEffect)));
  return { extension: [field, undoable], spansOf, toggle, info, touched };
}
