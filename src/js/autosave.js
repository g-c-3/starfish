// Autosave of Reminder, Location and Money forms (Decision 189). Pure: no DOM, no database.
// A draft is { v, kind, parts }; parts hold the raw fields of each dialog the form passed through.
// resolveFormDraft turns it into a complete entry when its required fields are valid, else into an
// Autosave note listing what was filled in.
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

function listText(title, rows) {
  const lines = rows.filter(([, v]) => str(v)).map(([k, v]) => `${k}: ${str(v)}`);
  return lines.length ? `${title}\n${lines.join('\n')}` : null;
}
const commonRows = (c) => [['Name', c.name], ['Note', c.description], ['Tags', c.tags.join(', ')]];

function reminder(parts, fallbackName) {
  const s = parts.save;
  if (!s) return null;
  const c = common(s);
  const at = new Date(s.when).getTime();
  if (Number.isFinite(at)) {
    return { type: 'reminder', label: c.name || fallbackName, description: c.description, tags: c.tags, fire_at: at, repeat_rule: s.repeat || null };
  }
  const text = listText('Reminder (not finished)', [...commonRows(c), ['Repeat', s.repeat]]);
  return text ? { type: 'note', label: fallbackName, description: '', tags: [], text } : null;
}

function location(parts, fallbackName) {
  const c = common(parts.save);
  const fix = parts.fix;
  let lat = null, lng = null;
  if (fix && Number.isFinite(fix.lat) && Number.isFinite(fix.lng)) ({ lat, lng } = { lat: fix.lat, lng: fix.lng });
  else {
    const pasted = parts.coords && str(parts.coords.text) ? parseCoordinates(parts.coords.text) : null;
    if (pasted && pasted.ok) ({ lat, lng } = { lat: pasted.lat, lng: pasted.lng });
  }
  if (lat !== null) {
    return { type: 'location', label: c.name || fallbackName, description: c.description, tags: c.tags, latitude: lat, longitude: lng };
  }
  const text = listText('Location (not finished)', [['Pasted', parts.coords && parts.coords.text], ...commonRows(c)]);
  return text ? { type: 'note', label: fallbackName, description: '', tags: [], text } : null;
}

function money(parts, fallbackName) {
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
    if (r.ok) return { type: 'money', label: c.name || fallbackName, description: c.description, tags: c.tags, details: r.value };
  }
  const reps = Array.isArray(f.reps) ? f.reps.length : 0;
  const text = listText('Money entry (not finished)', [
    ['Kind', KIND_LABELS[f.kind] || f.kind], ['Amount', f.amount], ['Category', f.category], ['Method', f.method],
    ['When', f.when], ['Person', f.person], ['Due', f.due], ['Repayments', reps ? String(reps) : ''], ...commonRows(c)
  ]);
  return text ? { type: 'note', label: fallbackName, description: '', tags: [], text } : null;
}

// Returns { type: 'reminder' | 'location' | 'money', label, description, tags, ... } for a complete form,
// { type: 'note', label, description, tags, text } for an incomplete one, or null when nothing was filled in.
// fallbackName is used when the person had not named the entry.
export function resolveFormDraft(kind, parts, { fallbackName = 'Autosave' } = {}) {
  if (!parts) return null;
  if (kind === 'reminder') return reminder(parts, fallbackName);
  if (kind === 'location') return location(parts, fallbackName);
  if (kind === 'money') return money(parts, fallbackName);
  return null;
}
