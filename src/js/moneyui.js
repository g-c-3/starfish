// Money form and repayment dialogs (Decision 126). DOM only; saving and reading rows stays in app.js.
// hooks.open(finish) registers the dialog so a lock can close it; hooks.close() clears that.
import { LOAN_KINDS, parseAmount, normalize, addRepayment, remaining, formatAmount, recentValues } from './money.js';

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const toLocalInput = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const toDateInput = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const plainInput = (minor) => (minor / 100).toFixed(2).replace(/\.00$/, '');
const DEFAULT_METHODS = ['Cash', 'UPI', 'Card'];
const sameMinute = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.floor(a / 60000) === Math.floor(b / 60000);

function fillChips(box, input, values) {
  box.innerHTML = values.map((v) => `<button type="button" data-v="${esc(v)}">${esc(v)}</button>`).join('');
  box.querySelectorAll('button').forEach((b) => { b.onclick = () => { input.value = b.dataset.v; }; });
}

// Resolves a normalized details object, or null (cancelled). details prefills an edit.
// Once repayments exist the kind is fixed: switching it would change what the repayments mean.
export function openMoneyForm({ details = null, items = [], symbol = '₹', heading = 'New money entry', hooks = {} } = {}) {
  return new Promise((resolve) => {
    const dlg = $('money-dialog'), status = $('mf-status');
    const amountEl = $('mf-amount'), catEl = $('mf-category'), methodEl = $('mf-method');
    const whenEl = $('mf-when'), personEl = $('mf-person'), dueEl = $('mf-due');
    const fixedKind = !!(details && details.repayments && details.repayments.length);
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
    status.textContent = fixedKind ? 'The kind is fixed once repayments exist.' : '';

    fillChips($('mf-cat-chips'), catEl, recentValues(items, 'category'));
    const methods = recentValues(items, 'method');
    for (const m of DEFAULT_METHODS) if (!methods.some((x) => x.toLowerCase() === m.toLowerCase())) methods.push(m);
    fillChips($('mf-method-chips'), methodEl, methods.slice(0, 8));

    const kindEl = $('mf-kind');
    const applyKind = () => {
      kindEl.querySelectorAll('button').forEach((b) => {
        b.classList.toggle('active', b.dataset.kind === kind);
        b.disabled = fixedKind && b.dataset.kind !== kind;
      });
      $('mf-loan').classList.toggle('hidden', !LOAN_KINDS.includes(kind));
    };
    kindEl.querySelectorAll('button').forEach((b) => { b.onclick = () => { if (!fixedKind) { kind = b.dataset.kind; applyKind(); } }; });
    applyKind();

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
      const input = { kind, amount: a.minor, category: catEl.value, method: methodEl.value, at };
      if (LOAN_KINDS.includes(kind)) {
        input.person = personEl.value;
        input.due = dueEl.value ? new Date(`${dueEl.value}T00:00:00`).getTime() : null;
        input.repayments = details && details.repayments ? details.repayments : [];
      }
      const r = normalize(input);
      if (!r.ok) { status.textContent = r.error; return; }
      finish(r.value);
    };
    $('mf-cancel-btn').onclick = () => finish(null);
    dlg.classList.remove('hidden');
    if (hooks.open) hooks.open(finish);
  });
}

// Resolves the details object with the repayment added, or null. The amount is pre-filled with what remains.
export function openRepayDialog({ details, symbol = '₹', hooks = {} } = {}) {
  return new Promise((resolve) => {
    const dlg = $('repay-dialog'), status = $('rp-status');
    const amountEl = $('rp-amount'), whenEl = $('rp-when'), noteEl = $('rp-note');
    let done = false;
    amountEl.value = plainInput(remaining(details));
    whenEl.value = toLocalInput(Date.now());
    noteEl.value = '';
    status.textContent = '';
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
      const r = addRepayment(details, { amount: amountEl.value, at: Number.isNaN(at) ? undefined : at, note: noteEl.value });
      if (!r.ok) { status.textContent = r.error; return; }
      finish(r.value);
    };
    $('rp-cancel-btn').onclick = () => finish(null);
    dlg.classList.remove('hidden');
    if (hooks.open) hooks.open(finish);
  });
}
