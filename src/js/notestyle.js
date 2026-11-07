// notestyle.js — character styles of a note (colour, bold, italic, underline). Pure: no DOM, no database.
// The styles ride at the end of the note text as one last line, so a note carries them through save, draft, Move, backup and
// restore unchanged. Every reader that wants the words only calls plainNoteText.
// Span: [kind, from, to, value]. kind 'c' (value 'r' | 'g' | 'b'), 'b', 'i' or 'u'. from and to are character offsets in the words.
export const STYLE_MARK = '\n\u2063\u2063\u2063'; // a line break and three invisible separators, then the JSON
const KINDS = new Set(['c', 'b', 'i', 'u']);
const COLOURS = new Set(['r', 'g', 'b']);

export function splitNoteStyle(raw) {
  const s = String(raw ?? '');
  const i = s.lastIndexOf(STYLE_MARK);
  if (i < 0) return { text: s, spans: [], title: '', named: false };
  try {
    const o = JSON.parse(s.slice(i + STYLE_MARK.length));
    const text = s.slice(0, i);
    const spans = (Array.isArray(o.s) ? o.s : []).filter((p) => Array.isArray(p) && KINDS.has(p[0])
      && Number.isInteger(p[1]) && Number.isInteger(p[2]) && p[1] >= 0 && p[1] < p[2] && p[2] <= text.length
      && (p[0] !== 'c' || COLOURS.has(p[3])));
    return { text, spans, title: typeof o.t === 'string' ? o.t : '', named: o.n === 1 }; // t: the Title line; n: 1 when the name was set in the Rename dialog (Decision 407)
  } catch { return { text: s, spans: [], title: '', named: false }; }
}

export function joinNoteStyle(text, spans, meta = null) {
  const o = { v: 1, s: spans || [] };
  if (meta && meta.title) o.t = meta.title;
  if (meta && meta.named) o.n = 1;
  return o.s.length || o.t || o.n ? `${text}${STYLE_MARK}${JSON.stringify(o)}` : text;
}

export const plainNoteText = (raw) => splitNoteStyle(raw).text;
