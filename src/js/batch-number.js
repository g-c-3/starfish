// batch-number.js — where a numbered batch continues from (Decision 174).
// The Vault keeps no plaintext label history (labels are encrypted), so the next number is read from the labels already in the
// in-memory Vault index: the highest N among "<baseName> N" of the same type, 0 if there is none.
export function nextBatchStart(entries, type, baseName) {
  const prefix = `${baseName} `;
  let max = 0;
  for (const e of entries || []) {
    if (e.type !== type || typeof e.label !== 'string' || !e.label.startsWith(prefix)) continue;
    const tail = e.label.slice(prefix.length);
    if (!/^[1-9]\d{0,8}$/.test(tail)) continue;
    const n = Number(tail);
    if (n > max) max = n;
  }
  return max;
}
