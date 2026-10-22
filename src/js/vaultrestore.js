// vaultrestore.js — what the Vault part of a restore needs, decided before anything is changed (Decisions 195, 255).
// No network, no storage of its own. The archive carries the wrapped Vault key (`wrap`); the key itself never leaves the wrapper.

import { unwrapVault, vmkToKey } from './crypto.js';

// The check value inside a wrapper names the Vault key without a PBKDF2. The same value on both sides means the same key.
const kcvOf = (wrap) => { try { return JSON.parse(wrap).kcv || null; } catch { return null; } };

// Resolves { ok: true, kind } or { ok: false, reason, wrap? }.
//   none     no Vault entries in this restore: nothing to do.
//   same     the archive's Vault key is this device's: entries are inserted as they are.
//   rekey    append under another key: entries are re-encrypted under this device's key (`sourceKey` opens them).
//   replace  overwrite under another key: this device's wrapper is replaced by the archive's (`wrap`).
// reasons: vault_old_format (Vault entries but no wrapper), vault_not_set_up (append, no Vault here),
//          vault_pin_needed / vault_pin_wrong (append, other key; `wrap` lets the caller check a typed PIN),
//          vault_locked (PIN given, this device's Vault is locked).
async function planVaultRestore(db, { mode, categories, hasEntries, wrap, sourcePin, currentKey }) {
  if (!categories.includes('private_vault') || !hasEntries) return { ok: true, kind: 'none' };
  if (!wrap) return { ok: false, reason: 'vault_old_format' };
  const cur = ((await db.query(`SELECT vault_wrap FROM credentials WHERE id=1`)).values || [])[0]?.vault_wrap || null;
  const k = kcvOf(wrap);
  const same = !!(cur && k && k === kcvOf(cur));
  if (same) return { ok: true, kind: 'same' };
  if (mode === 'overwrite') return { ok: true, kind: 'replace', wrap };
  if (!cur) return { ok: false, reason: 'vault_not_set_up' };
  if (!sourcePin) return { ok: false, reason: 'vault_pin_needed', wrap };
  if (!currentKey) return { ok: false, reason: 'vault_locked', wrap };
  const u = await unwrapVault(sourcePin, wrap);
  if (!u) return { ok: false, reason: 'vault_pin_wrong', wrap };
  return { ok: true, kind: 'rekey', sourceKey: await vmkToKey(u.vmk) };
}

// Overwrite under another key: after the old rows are gone and before the first entry is written, so no row is ever read under the wrong key.
async function applyVaultPlan(db, plan, summary) {
  if (plan.kind !== 'replace') return;
  await db.run(`UPDATE credentials SET vault_wrap=? WHERE id=1`, [plan.wrap]);
  summary.vaultKeyReplaced = true;
}

export { planVaultRestore, applyVaultPlan };
