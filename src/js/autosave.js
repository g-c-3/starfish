// Autosave of Reminder, Location and Money forms (Decisions 189, 190) and of the details edit of Voice, Image, PDF and File (Decision 268). Pure: no DOM, no database.
// A draft is { v, kind, parts, entry? }; parts hold the raw fields of each dialog the form passed through; entry
// ({ id, label }) marks the edit of an existing entry. resolveFormDraft turns a draft into a complete entry (or, for an
// edit, the fields to write onto the entry) when its required fields are valid, else into an Autosave note listing what
// was filled in.
import { parseAmount, normalize, KIND_LABELS } from './money.js';
import { parseCoordinates } from './geoparse.js';

const MAX_TAGS = 2; // Decision 90
const str = (v) => String(v ?? '').trim();

export function parseFormDraft(raw) {
  try {
    const d = JSON.parse(raw);
    return d && d.v === 1 && d.parts && typeof d.parts === 'object' ? d : null;
  } catch { return null; }
}

// Fields of the Save dialog shared by all three kinds.
function common(save) {
  const s = save || {};
  const tags = [];
  for (const t of [...(Array.isArray(s.tags) ? s.tags : []), s.newTag]) {
    const name = str(t);
    if (name && !tags.some((x) => x.toLowerCase() === name.toLowerCase())) tags.push(name);
  }
  return { name: str(s.name), description: str(s.description), tags: tags.slice(0, MAX_TAGS) };
}

function listText(title, rows, entryLabel = '') {
  const lines = [];
  if (str(entryLabel)) lines.push(`Entry: ${str(entryLabel)}`);
  for (const [k, v] of rows) if (str(v)) lines.push(`${k}: ${str(v)}`);
  return lines.length && (lines.length > 1 || !str(entryLabel)) ? `${title}\n${lines.join('\n')}` : null;
}
const commonRows = (c) => [['Name', c.name], ['Note', c.description], ['Tags', c.tags.join(', ')]];

// The filled-in fields of a draft as listed rows. Only fields the person filled in appear.
function rowsOf(kind, parts, c, edit) {
  if (DETAIL_KINDS[kind]) return commonRows(c);
  if (kind === 'reminder') return [...commonRows(c), ['When', parts.save && parts.save.when], ['Repeat', parts.save && parts.save.repeat]];
  if (kind === 'location') return [...(edit ? [] : [['Pasted', parts.coords && parts.coords.text]]), ...commonRows(c)];
  const f = parts.form || {};
  const reps = Array.isArray(f.reps) ? f.reps.length : 0;
  return [['Kind', KIND_LABELS[f.kind] || f.kind], ['Amount', f.amount], ['Category', f.category], ['Method', f.method],
    ['When', f.when], ['Person', f.person], ['Due', f.due], ['Repayments', reps ? String(reps) : ''], ...commonRows(c)];
}
// Voice, Image, PDF and File have no form of their own: only the details dialog of an edit (name, note, tags).
const DETAIL_KINDS = { voice: 'Voice', image: 'Image', pdf: 'PDF', file: 'File' };
const TITLES = { reminder: 'Reminder', location: 'Location', money: 'Money entry', ...DETAIL_KINDS };
function noteOf(kind, parts, o, why) {
  const c = common(parts.save);
  const title = `${TITLES[kind]}${o.edit ? ' edit' : ''} (${why})`;
  const text = listText(title, rowsOf(kind, parts, c, o.edit), o.edit ? o.entryLabel : '');
  return text ? { type: 'note', label: o.noteName, description: '', tags: [], text } : null;
}

function reminder(parts, o) {
  const s = parts.save;
  if (!s) return null;
  const c = common(s);
  const at = new Date(s.when).getTime();
  if (Number.isFinite(at)) {
    return { type: 'reminder', edit: !!o.edit, label: c.name || o.fallbackName, description: c.description, tags: c.tags, fire_at: at, repeat_rule: s.repeat || null };
  }
  return noteOf('reminder', parts, o, 'not finished');
}

function location(parts, o) {
  const c = common(parts.save);
  if (o.edit) { // coordinates are not editable: the details dialog is the whole form
    return parts.save ? { type: 'location', edit: true, label: c.name || o.fallbackName, description: c.description, tags: c.tags } : null;
  }
  const fix = parts.fix;
  let lat = null, lng = null;
  if (fix && Number.isFinite(fix.lat) && Number.isFinite(fix.lng)) ({ lat, lng } = { lat: fix.lat, lng: fix.lng });
  else {
    const pasted = parts.coords && str(parts.coords.text) ? parseCoordinates(parts.coords.text) : null;
    if (pasted && pasted.ok) ({ lat, lng } = { lat: pasted.lat, lng: pasted.lng });
  }
  if (lat !== null) {
    return { type: 'location', edit: false, label: c.name || o.fallbackName, description: c.description, tags: c.tags, latitude: lat, longitude: lng };
  }
  return noteOf('location', parts, o, 'not finished');
}

function details(kind, parts, o) {
  if (!o.edit || !parts.save) return null;
  const c = common(parts.save);
  return { type: kind, edit: true, label: c.name || o.fallbackName, description: c.description, tags: c.tags };
}

function money(parts, o) {
  const f = parts.form;
  if (!f) return null;
  const c = common(parts.save);
  const a = parseAmount(f.amount);
  const at = new Date(f.when).getTime();
  if (a.ok && Number.isFinite(at)) {
    const input = { kind: f.kind, amount: a.minor, category: f.category, method: f.method, at };
    if (f.kind === 'lent' || f.kind === 'borrowed') {
      input.person = f.person;
      input.due = f.due ? new Date(`${f.due}T00:00:00`).getTime() : null;
      input.repayments = Array.isArray(f.reps) ? f.reps : [];
    }
    const r = normalize(input);
    if (r.ok) return { type: 'money', edit: !!o.edit, label: c.name || o.fallbackName, description: c.description, tags: c.tags, details: r.value };
  }
  return noteOf('money', parts, o, 'not finished');
}

// New entry (default): { type: 'reminder' | 'location' | 'money', label, description, tags, ... } for a complete form,
// { type: 'note', label, description, tags, text } for an incomplete one, null when nothing was filled in.
// fallbackName names an entry the person had not named; noteName names an Autosave note (default fallbackName).
// edit: true is the edit of an existing entry; a complete form returns the fields to write onto it (edit: true, label ''
// when the name was cleared, so the entry keeps its own). forceNote: true keeps even a complete form as a note, for an
// entry that no longer exists. entryLabel names the entry in a note.
export function resolveFormDraft(kind, parts, { fallbackName = 'Autosave', noteName, edit = false, forceNote = false, entryLabel = '' } = {}) {
  if (!parts) return null;
  const o = { fallbackName, noteName: noteName ?? fallbackName, edit, entryLabel };
  if (forceNote) return TITLES[kind] ? noteOf(kind, parts, o, edit ? 'entry not found' : 'not finished') : null;
  if (kind === 'reminder') return reminder(parts, o);
  if (kind === 'location') return location(parts, o);
  if (kind === 'money') return money(parts, o);
  if (DETAIL_KINDS[kind]) return details(kind, parts, o);
  return null;
}
