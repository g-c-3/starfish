// Money form and repayment dialogs (Decisions 126, 128). DOM only; saving and reading rows stays in app.js.
// hooks.open(finish) registers the dialog so a lock can close it; hooks.close() clears that.
import { LOAN_KINDS, parseAmount, normalize, addRepayment, remaining, formatAmount, recentValues } from './money.js';

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const toLocalInput = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const toDateInput = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const plainInput = (minor) => (minor / 100).toFixed(2).replace(/\.00$/, '');
const shortDate = (ms) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const DEFAULT_METHODS = ['Cash', 'UPI', 'Card', 'IMPS', 'RTGS', 'NEFT'];
const KIND_HINT = 'The kind is fixed once repayments exist.';
const sameMinute = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.floor(a / 60000) === Math.floor(b / 60000);

function fillChips(box, input, values) {
  box.innerHTML = values.map((v) => `<button type="button" data-v="${esc(v)}">${esc(v)}</button>`).join('');
  box.querySelectorAll('button').forEach((b) => { b.onclick = () => { input.value = b.dataset.v; }; });
}

// Recent methods (entries, then repayments), then the defaults not already listed.
function methodChoices(items) {
  const out = recentValues(items, 'method');
  const seen = new Set(out.map((m) => m.toLowerCase()));
  for (const it of items) for (const r of (it.repayments || [])) {
    if (r.method && !seen.has(r.method.toLowerCase())) { seen.add(r.method.toLowerCase()); out.push(r.method); }
  }
  for (const m of DEFAULT_METHODS) if (!seen.has(m.toLowerCase())) { seen.add(m.toLowerCase()); out.push(m); }
  return out.slice(0, 10);
}

// Resolves a normalized details object, or null (cancelled). details prefills an edit.
// Lent and Borrowed carry a repayments section at the end; the kind is fixed while any repayment is listed,
// because switching it would change what the repayments mean.
export function openMoneyForm({ details = null, items = [], symbol = '₹', heading = 'New money entry', hooks = {} } = {}) {
  return new Promise((resolve) => {
    const dlg = $('money-dialog'), status = $('mf-status');
    const amountEl = $('mf-amount'), catEl = $('mf-category'), methodEl = $('mf-method');
    const whenEl = $('mf-when'), personEl = $('mf-person'), dueEl = $('mf-due');
    const repAmt = $('mf-rep-amount'), repWhen = $('mf-rep-when'), repMethod = $('mf-rep-method'), repNote = $('mf-rep-note');
    const reps = details && details.repayments ? details.repayments.map((r) => ({ ...r })) : [];
    let kind = details ? details.kind : 'spent';
    let done = false;

    $('mf-heading').textContent = heading;
    $('mf-symbol').textContent = symbol;
    amountEl.value = details ? plainInput(details.amount) : '';
    catEl.value = details ? details.category : '';
    methodEl.value = details ? details.method : '';
    whenEl.value = toLocalInput(details ? details.at : Date.now());
    personEl.value = details && details.person ? details.person : '';
    dueEl.value = details && details.due ? toDateInput(details.due) : '';
    status.textContent = '';
    repAmt.value = ''; repMethod.value = ''; repNote.value = '';
    repWhen.value = toLocalInput(Date.now());

    fillChips($('mf-cat-chips'), catEl, recentValues(items, 'category'));
    const methods = methodChoices(items);
    fillChips($('mf-method-chips'), methodEl, methods);
    fillChips($('mf-rep-chips'), repMethod, methods);

    const kindEl = $('mf-kind');
    const applyKind = () => {
      const locked = reps.length > 0;
      kindEl.querySelectorAll('button').forEach((b) => {
        b.classList.toggle('active', b.dataset.kind === kind);
        b.disabled = locked && b.dataset.kind !== kind;
      });
      const loan = LOAN_KINDS.includes(kind);
      $('mf-loan').classList.toggle('hidden', !loan);
      $('mf-repay').classList.toggle('hidden', !loan);
      if (locked) { if (!status.textContent) status.textContent = KIND_HINT; }
      else if (status.textContent === KIND_HINT) status.textContent = '';
    };
    const renderReps = () => {
      const list = $('mf-rep-list');
      list.innerHTML = reps.map((r, i) => `<div class="rep-item"><span>${esc(formatAmount(r.amount, symbol))} · ${esc(shortDate(r.at))}${r.method ? ` · ${esc(r.method)}` : ''}${r.note ? ` · ${esc(r.note)}` : ''}</span><button type="button" class="rep-del" data-i="${i}" aria-label="Remove repayment">×</button></div>`).join('');
      list.querySelectorAll('.rep-del').forEach((b) => { b.onclick = () => { reps.splice(Number(b.dataset.i), 1); renderReps(); applyKind(); }; });
    };
    kindEl.querySelectorAll('button').forEach((b) => { b.onclick = () => { if (!reps.length) { kind = b.dataset.kind; applyKind(); } }; });
    renderReps();
    applyKind();

    // + keeps the repayment in the list; it is saved with the entry on Continue. Partial amounts can be followed by more.
    $('mf-rep-add').onclick = () => {
      const total = parseAmount(amountEl.value);
      if (!total.ok) { status.textContent = 'Enter the amount first.'; return; }
      const a = parseAmount(repAmt.value);
      if (!a.ok) { status.textContent = a.error; return; }
      const left = total.minor - reps.reduce((n, r) => n + r.amount, 0);
      if (a.minor > left) { status.textContent = left > 0 ? `Only ${formatAmount(left, symbol)} is left to repay.` : 'Already fully repaid.'; return; }
      const at = new Date(repWhen.value).getTime();
      if (Number.isNaN(at)) { status.textContent = 'Pick a repayment date.'; return; }
      reps.push({ amount: a.minor, at, method: repMethod.value.trim(), note: repNote.value.trim() });
      reps.sort((x, y) => x.at - y.at);
      repAmt.value = ''; repMethod.value = ''; repNote.value = '';
      repWhen.value = toLocalInput(Date.now());
      status.textContent = '';
      renderReps();
      applyKind();
    };

    const finish = (value) => {
      if (done) return;
      done = true;
      dlg.classList.add('hidden');
      document.activeElement?.blur?.();
      if (hooks.close) hooks.close();
      resolve(value);
    };
    $('mf-continue-btn').onclick = () => {
      const a = parseAmount(amountEl.value);
      if (!a.ok) { status.textContent = a.error; return; }
      let at = new Date(whenEl.value).getTime();
      if (Number.isNaN(at)) { status.textContent = 'Pick a date and time.'; return; }
      if (details && sameMinute(at, details.at)) at = details.at; // the picker holds whole minutes; unchanged means unchanged
      const loan = LOAN_KINDS.includes(kind);
      if (loan && repAmt.value.trim()) { status.textContent = 'Tap + to add the repayment, or clear the amount.'; return; }
      const input = { kind, amount: a.minor, category: catEl.value, method: methodEl.value, at };
      if (loan) {
        input.person = personEl.value;
        input.due = dueEl.value ? new Date(`${dueEl.value}T00:00:00`).getTime() : null;
        input.repayments = reps;
      }
      const r = normalize(input);
      if (!r.ok) { status.textContent = r.error; return; }
      finish(r.value);
    };
    $('mf-cancel-btn').onclick = () => (hooks.leave ? hooks.leave() : finish(null));
    dlg.classList.remove('hidden');
    if (hooks.open) hooks.open(finish);
  });
}

// Resolves the details object with the repayment added, or null. The amount is pre-filled with what remains.
export function openRepayDialog({ details, items = [], symbol = '₹', hooks = {} } = {}) {
  return new Promise((resolve) => {
    const dlg = $('repay-dialog'), status = $('rp-status');
    const amountEl = $('rp-amount'), whenEl = $('rp-when'), methodEl = $('rp-method'), noteEl = $('rp-note');
    let done = false;
    amountEl.value = plainInput(remaining(details));
    whenEl.value = toLocalInput(Date.now());
    methodEl.value = '';
    noteEl.value = '';
    status.textContent = '';
    fillChips($('rp-method-chips'), methodEl, methodChoices(items));
    $('rp-hint').textContent = `Remaining ${formatAmount(remaining(details), symbol)}`;

    const finish = (value) => {
      if (done) return;
      done = true;
      dlg.classList.add('hidden');
      document.activeElement?.blur?.();
      if (hooks.close) hooks.close();
      resolve(value);
    };
    $('rp-add-btn').onclick = () => {
      const at = new Date(whenEl.value).getTime();
      const r = addRepayment(details, { amount: amountEl.value, at: Number.isNaN(at) ? undefined : at, method: methodEl.value, note: noteEl.value });
      if (!r.ok) { status.textContent = r.error; return; }
      finish(r.value);
    };
    $('rp-cancel-btn').onclick = () => (hooks.leave ? hooks.leave() : finish(null));
    dlg.classList.remove('hidden');
    if (hooks.open) hooks.open(finish);
  });
}
