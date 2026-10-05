// Money entries (Decision 124). Pure functions only: no database, no DOM, no network.
// Amounts are whole numbers of the smallest unit (two decimals). Status is derived, never stored.

export const KINDS = ['spent', 'lent', 'received', 'borrowed'];
export const LOAN_KINDS = ['lent', 'borrowed'];
export const KIND_LABELS = { spent: 'Spent', lent: 'Lent', received: 'Received', borrowed: 'Borrowed' };
export const DEFAULT_SYMBOL = '₹';
export const MAX_MINOR = 1e13;

export const CURRENCIES = [
  { symbol: '₹', name: 'Indian rupee' }, { symbol: '$', name: 'Dollar' }, { symbol: '€', name: 'Euro' },
  { symbol: '£', name: 'Pound' }, { symbol: '¥', name: 'Yen / Yuan' }, { symbol: '₩', name: 'Won' },
  { symbol: '₽', name: 'Ruble' }, { symbol: '₺', name: 'Lira' }, { symbol: '₪', name: 'Shekel' },
  { symbol: '₫', name: 'Dong' }, { symbol: '฿', name: 'Baht' }, { symbol: '₱', name: 'Peso' },
  { symbol: '₦', name: 'Naira' }, { symbol: 'R$', name: 'Real' }, { symbol: 'Rs', name: 'Rupee (text)' }
];

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const isTime = (v) => Number.isFinite(v) && v > 0;

export function parseAmount(input) {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return { ok: false, error: 'Not a valid amount.' };
    input = String(input);
  }
  const s = String(input ?? '').replace(/[\s,]/g, '');
  if (!s) return { ok: false, error: 'Enter an amount.' };
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return { ok: false, error: 'Use digits with at most two decimals.' };
  const [whole, frac = ''] = s.split('.');
  const minor = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  if (minor <= 0) return { ok: false, error: 'Amount must be above zero.' };
  if (minor > MAX_MINOR) return { ok: false, error: 'Amount is too large.' };
  return { ok: true, minor };
}

function group(intStr, indian) {
  if (!indian || intStr.length <= 3) return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const head = intStr.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${head},${intStr.slice(-3)}`;
}

// Plain number, no symbol. Indian grouping (1,00,000) only when indian is true.
export function formatPlain(minor, indian = false) {
  const neg = minor < 0;
  const abs = Math.abs(Math.round(minor));
  const whole = String(Math.floor(abs / 100));
  const frac = String(abs % 100).padStart(2, '0');
  return `${neg ? '-' : ''}${group(whole, indian)}.${frac}`;
}

export function formatAmount(minor, symbol = DEFAULT_SYMBOL) {
  const sym = cleanSymbol(symbol);
  const body = formatPlain(Math.abs(minor), sym === '₹' || sym === 'Rs');
  return `${minor < 0 ? '-' : ''}${sym}${/[A-Za-z]$/.test(sym) ? ' ' : ''}${body}`;
}

export function cleanSymbol(text) {
  const s = str(text);
  // eslint-disable-next-line no-control-regex
  return s && s.length <= 5 && !/[\u0000-\u001f]/.test(s) ? s : DEFAULT_SYMBOL;
}

export function validateSymbol(text) {
  const s = str(text);
  if (!s) return { ok: false, error: 'Enter a symbol.' };
  if (s.length > 5) return { ok: false, error: 'Use at most five characters.' };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(s)) return { ok: false, error: 'Not a valid symbol.' };
  return { ok: true, symbol: s };
}

export const isLoan = (d) => !!d && LOAN_KINDS.includes(d.kind);

export function repaid(d) {
  return isLoan(d) ? (d.repayments || []).reduce((n, r) => n + r.amount, 0) : 0;
}

export function remaining(d) {
  return isLoan(d) ? d.amount - repaid(d) : 0;
}

// open, partly returned, settled. Null for Spent and Received.
export function status(d) {
  if (!isLoan(d)) return null;
  const rem = remaining(d);
  if (rem <= 0) return 'settled';
  return repaid(d) > 0 ? 'partly returned' : 'open';
}

export const STATUS_LABELS = { open: 'Open', 'partly returned': 'Partly returned', settled: 'Settled' };

function cleanRepayment(r) {
  if (!r || !Number.isInteger(r.amount) || r.amount <= 0 || !isTime(r.at)) return null;
  return { amount: r.amount, at: r.at, method: str(r.method), note: str(r.note) };
}

// Checks and trims a details object. Loan-only fields are dropped for other kinds.
// Repayments that overrun the amount are rejected, not clipped.
export function normalize(input, now = Date.now()) {
  const d = input || {};
  if (!KINDS.includes(d.kind)) return { ok: false, error: 'Pick a kind.' };
  if (!Number.isInteger(d.amount) || d.amount <= 0 || d.amount > MAX_MINOR) {
    return { ok: false, error: 'Amount must be a whole number of the smallest unit, above zero.' };
  }
  const out = {
    kind: d.kind,
    amount: d.amount,
    category: str(d.category),
    method: str(d.method),
    at: isTime(d.at) ? d.at : now
  };
  if (LOAN_KINDS.includes(d.kind)) {
    out.person = str(d.person);
    out.due = isTime(d.due) ? d.due : null;
    out.repayments = [];
    let sum = 0;
    for (const r of Array.isArray(d.repayments) ? d.repayments : []) {
      const c = cleanRepayment(r);
      if (!c) return { ok: false, error: 'A repayment is not valid.' };
      sum += c.amount;
      if (sum > d.amount) return { ok: false, error: 'Repayments exceed the amount.' };
      out.repayments.push(c);
    }
  }
  return { ok: true, value: out };
}

// Returns a new details object. Add repayment pre-fills remaining(d); a full return is one repayment.
export function addRepayment(d, rep, now = Date.now()) {
  if (!isLoan(d)) return { ok: false, error: 'Only Lent and Borrowed take repayments.' };
  const rem = remaining(d);
  if (rem <= 0) return { ok: false, error: 'Already settled.' };
  const a = typeof rep?.amount === 'number' && Number.isInteger(rep.amount) ? { ok: rep.amount > 0, minor: rep.amount } : parseAmount(rep?.amount);
  if (!a.ok) return { ok: false, error: a.error || 'Amount must be above zero.' };
  if (a.minor > rem) return { ok: false, error: 'Repayment cannot exceed the remaining amount.' };
  const entry = { amount: a.minor, at: isTime(rep.at) ? rep.at : now, method: str(rep.method), note: str(rep.note) };
  return { ok: true, value: { ...d, repayments: [...(d.repayments || []), entry] } };
}

export function toJson(d) {
  return JSON.stringify({ v: 1, ...d });
}

export function fromJson(text) {
  try {
    const { v, ...rest } = JSON.parse(text);
    if (v !== 1) return null;
    const r = normalize(rest);
    return r.ok ? r.value : null;
  } catch { return null; }
}

// Readable summary kept in the label and search index. No symbol, so a symbol change only relabels.
export function summary(d) {
  const amt = formatPlain(d.amount);
  const cat = d.category ? ` · ${d.category}` : '';
  if (d.kind === 'lent') return `Lent ${amt}${d.person ? ` to ${d.person}` : ''}${cat}`;
  if (d.kind === 'borrowed') return `Borrowed ${amt}${d.person ? ` from ${d.person}` : ''}${cat}`;
  return `${KIND_LABELS[d.kind]} ${amt}${cat}`;
}

// Entry row to details. Money rows read money_json; legacy expense rows (REAL, major units) count as Spent.
export function fromRow(row) {
  if (!row) return null;
  if (row.type === 'money') return row.money_json ? fromJson(row.money_json) : null;
  if (row.type === 'expense' && Number.isFinite(row.amount) && row.amount > 0) {
    const cat = row.expense_category && row.expense_category !== 'uncategorized' ? row.expense_category : '';
    return { kind: 'spent', amount: Math.round(row.amount * 100), category: cat, method: '', at: row.created_at };
  }
  return null;
}

export function monthRange(year, month) {
  return { start: new Date(year, month, 1).getTime(), end: new Date(year, month + 1, 1).getTime() };
}

// Net = Received - Spent. Loans never enter it. Items are details objects (see fromRow).
export function monthTotals(items, year, month) {
  const { start, end } = monthRange(year, month);
  let spent = 0;
  let received = 0;
  for (const d of items) {
    if (!d || d.at < start || d.at >= end) continue;
    if (d.kind === 'spent') spent += d.amount;
    else if (d.kind === 'received') received += d.amount;
  }
  return { spent, received, net: received - spent };
}

// All time. owedToYou: remaining on Lent. youOwe: remaining on Borrowed.
export function loanTotals(items) {
  let owedToYou = 0;
  let youOwe = 0;
  for (const d of items) {
    if (!isLoan(d)) continue;
    if (d.kind === 'lent') owedToYou += remaining(d);
    else youOwe += remaining(d);
  }
  return { owedToYou, youOwe };
}

// Distinct non-empty values of a field, newest first, case-insensitive. For the category and payment method lists.
export function recentValues(items, field, limit = 8) {
  const seen = new Set();
  const out = [];
  for (const d of [...items].filter(Boolean).sort((a, b) => b.at - a.at)) {
    const v = str(d[field]);
    const k = v.toLowerCase();
    if (!v || seen.has(k)) continue;
    seen.add(k);
    out.push(v);
    if (out.length >= limit) break;
  }
  return out;
}
