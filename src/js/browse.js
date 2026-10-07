// browse.js — type filter, period filter and sort shared by Trash, Search and Select (Decision 146).
// browse() and typeCounts() are pure; toolbarHtml() and bindToolbar() draw and wire the one toolbar all three use.

const PERIODS = [['any', 'Any time'], ['today', 'Today'], ['week', 'Last 7 days'], ['month', 'Last 30 days']];

function periodStart(period, now = Date.now()) {
  if (period === 'today') { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime(); }
  if (period === 'week') return now - 7 * 86400000;
  if (period === 'month') return now - 30 * 86400000;
  return null;
}

const byName = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true, sensitivity: 'base' });

// sort: default (input order) | new | old | az | za | type | big | small (big and small need sizeOf).
function browse(rows, { type = 'all', sort = 'default', period = 'any', dateOf, nameOf, typeOf, sizeOf = () => 0, typeOrder = [], now = Date.now() } = {}) {
  const start = periodStart(period, now);
  const out = rows.filter((r) => (type === 'all' || typeOf(r) === type) && (start === null || (dateOf(r) ?? 0) >= start));
  const rank = (r) => { const i = typeOrder.indexOf(typeOf(r)); return i < 0 ? typeOrder.length : i; };
  const cmp = {
    new: (a, b) => (dateOf(b) ?? 0) - (dateOf(a) ?? 0),
    old: (a, b) => (dateOf(a) ?? 0) - (dateOf(b) ?? 0),
    az: (a, b) => byName(nameOf(a), nameOf(b)),
    za: (a, b) => byName(nameOf(b), nameOf(a)),
    type: (a, b) => rank(a) - rank(b) || byName(nameOf(a), nameOf(b)),
    big: (a, b) => sizeOf(b) - sizeOf(a),
    small: (a, b) => sizeOf(a) - sizeOf(b)
  }[sort];
  return cmp ? out.sort(cmp) : out;
}

// Types present in rows with their counts, in typeOrder (unknown types last).
function typeCounts(rows, typeOf, typeOrder = []) {
  const n = new Map();
  for (const r of rows) n.set(typeOf(r), (n.get(typeOf(r)) || 0) + 1);
  const known = typeOrder.filter((t) => n.has(t));
  const rest = [...n.keys()].filter((t) => !typeOrder.includes(t));
  return [...known, ...rest].map((t) => ({ type: t, count: n.get(t) }));
}

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// types: [{ type, count }]; labelOf(type) names a chip; sorts and periods: [[value, label]].
function toolbarHtml({ types, total, type, labelOf, sorts, sort, periods = null, period = 'any' }) {
  const chip = (value, label, count) =>
    `<button type="button" class="bt-chip" data-type="${esc(value)}" aria-pressed="${type === value}">${esc(label)}<span class="bt-count">${count}</span></button>`;
  const select = (key, label, options, current) =>
    `<label class="bt-field"><span>${esc(label)}</span><select class="bt-select" data-key="${key}">${options.map(([v, l]) => `<option value="${esc(v)}"${v === current ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
  return `
    <div class="bt-chips" role="group" aria-label="Filter by type">${chip('all', 'All', total)}${types.map((t) => chip(t.type, labelOf(t.type), t.count)).join('')}</div>
    <div class="bt-selects">${select('sort', 'Sort', sorts, sort)}${periods ? select('period', 'When', periods, period) : ''}</div>`;
}

// One delegated listener per toolbar root; state is mutated in place, then onChange() lets the screen redraw.
function bindToolbar(root, state, onChange) {
  root.addEventListener('click', (e) => {
    const chip = e.target.closest('.bt-chip');
    if (!chip || !root.contains(chip)) return;
    state.type = chip.dataset.type;
    onChange();
  });
  root.addEventListener('change', (e) => {
    const sel = e.target.closest('.bt-select');
    if (!sel) return;
    state[sel.dataset.key] = sel.value;
    onChange();
  });
}

export { PERIODS, periodStart, browse, typeCounts, toolbarHtml, bindToolbar };
