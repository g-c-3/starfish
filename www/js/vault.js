// vault.js — Private Vault: Text/Voice/Image/PDF/Files, all under is_private=1, all under the
// vault's own PIN (independent of the app-open password and the backup passkey — three credentials,
// still independent, per ARCHITECTURE.md §3). Nothing here ever writes decrypted bytes back to disk;
// file content only ever exists in memory (a Blob URL, revoked when the caller is done with it).
//
// Reuses crypto.js's existing encryptPrivateNote/decryptPrivateNote unchanged — a note's plaintext
// is still just its text (so pre-vault private notes need zero migration); a file-bearing vault
// entry's plaintext is a small JSON envelope instead. Same key, same AES-GCM call, same everything —
// only what gets encrypted differs by type.

import { insertEntry } from './db.js';
import { encryptPrivateNote, decryptPrivateNote } from './crypto.js';

const VAULT_TYPES = ['note', 'voice', 'image', 'pdf', 'file']; // Text/Voice/Image/PDF/Files — mirrors
// the home screen's capture types minus expense/reminder, which stay out of vault scope (per spec).

// ---------------------------------------------------------------------------
// Content bundling — what actually goes inside encrypted_body, by type.
// ---------------------------------------------------------------------------
function buildVaultPlaintext(type, { text, fileData, ocrText } = {}) {
  if (type === 'note') return text || ''; // unchanged shape — same as pre-vault private notes
  if (type === 'voice' || type === 'file') return JSON.stringify({ fileData });
  if (type === 'image' || type === 'pdf') return JSON.stringify({ fileData, ocrText: ocrText || '' });
  throw new Error(`Type not supported in Private Vault: ${type}`);
}

function parseVaultPlaintext(type, plaintext) {
  if (type === 'note') return { text: plaintext };
  return JSON.parse(plaintext); // {fileData} or {fileData, ocrText}
}

// ---------------------------------------------------------------------------
// Save — file_path always NULL for vault entries; bytes live only inside encrypted_body.
// ---------------------------------------------------------------------------
async function saveVaultEntry(db, privateSessionKey, { type, label, tags = [], extension = null, autoCategory = null, ...content }) {
  if (!VAULT_TYPES.includes(type)) throw new Error(`Type not supported in Private Vault: ${type}`);
  const plaintext = buildVaultPlaintext(type, content);
  const encryptedBody = await encryptPrivateNote(privateSessionKey, plaintext);
  const id = crypto.randomUUID();

  // insertEntry() already skips entries_fts/label_history for is_private=1 (db.js) — that's the
  // point: a vault item's existence/label must never surface in ordinary, no-PIN search or
  // autocomplete. Vault's own search/autocomplete comes from the in-memory index below instead.
  await insertEntry(db, {
    id, type, label, body_text: null, is_private: 1, encrypted_body: encryptedBody,
    file_path: null, extension, auto_category: autoCategory
  });

  for (const tagName of tags) {
    await db.run(`INSERT OR IGNORE INTO tags (name) VALUES (?)`, [tagName]);
    const tagRow = (await db.query(`SELECT id FROM tags WHERE name=?`, [tagName])).values[0];
    await db.run(`INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?,?)`, [id, tagRow.id]);
  }
  return id;
}

// ---------------------------------------------------------------------------
// Load — decrypt on demand, never cache decrypted content beyond the in-memory index below.
// ---------------------------------------------------------------------------
async function loadVaultEntryContent(db, privateSessionKey, entryId) {
  const row = (await db.query(`SELECT * FROM entries WHERE id=? AND is_private=1`, [entryId])).values[0];
  if (!row) throw new Error('Vault entry not found');
  const plaintext = await decryptPrivateNote(privateSessionKey, row.encrypted_body);
  return { row, content: parseVaultPlaintext(row.type, plaintext) };
}

// Caller must URL.revokeObjectURL() the result when done — this Blob only ever exists in memory.
function base64ToBlobUrl(base64, mimeType) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: mimeType }));
}

// ---------------------------------------------------------------------------
// In-memory search index — built fresh on vault unlock, discarded on vault lock. Never persisted,
// never written to disk even encrypted (Decision: simplicity + zero index-drift risk beats the
// performance a persistent index would buy at this scale — see conversation/DECISIONS.md).
// Also powers: vault-only label autocomplete (deliberately not the shared label_history table,
// which would leak vault labels into the main app's non-vault suggestions) and per-item size for
// the multi-select screen.
// ---------------------------------------------------------------------------
let vaultIndexCache = null;

async function buildVaultIndex(db, privateSessionKey) {
  const rows = (await db.query(`SELECT * FROM entries WHERE is_private=1 AND deleted_at IS NULL`)).values || [];
  const index = [];
  for (const row of rows) {
    const tagRows = (await db.query(
      `SELECT t.name FROM tags t JOIN entry_tags et ON et.tag_id=t.id WHERE et.entry_id=?`, [row.id]
    )).values || [];
    const tags = tagRows.map((t) => t.name);
    let searchableText = '', sizeBytes = 0;
    try {
      const plaintext = await decryptPrivateNote(privateSessionKey, row.encrypted_body);
      if (row.type === 'note') {
        searchableText = plaintext;
        sizeBytes = new Blob([plaintext]).size;
      } else {
        const content = parseVaultPlaintext(row.type, plaintext);
        searchableText = content.ocrText || '';
        sizeBytes = content.fileData ? Math.ceil(content.fileData.length * 0.75) : 0; // base64 → raw byte estimate
      }
    } catch {
      searchableText = ''; // corrupted/undecryptable entry — still listed (so it can be deleted), just not searchable
    }
    index.push({ id: row.id, type: row.type, label: row.label, tags, searchableText, sizeBytes, createdAt: row.created_at });
  }
  vaultIndexCache = index;
  return index;
}

function getVaultIndex() {
  return vaultIndexCache;
}

// Called on vault lock (auto-lock timeout or manual) — mirrors privateSessionKey's own clearing.
function clearVaultIndex() {
  vaultIndexCache = null;
}

function searchVaultIndex(term) {
  if (!vaultIndexCache) return [];
  const t = term.toLowerCase();
  return vaultIndexCache.filter((e) =>
    e.label.toLowerCase().includes(t) ||
    e.tags.some((tag) => tag.toLowerCase().includes(t)) ||
    e.searchableText.toLowerCase().includes(t)
  );
}

function vaultLabelSuggestions(type, partial) {
  if (!vaultIndexCache) return [];
  const p = partial.toLowerCase();
  const counts = new Map();
  for (const e of vaultIndexCache) {
    if (e.type === type && e.label.toLowerCase().includes(p)) counts.set(e.label, (counts.get(e.label) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([label]) => label);
}

export {
  VAULT_TYPES, buildVaultPlaintext, parseVaultPlaintext,
  saveVaultEntry, loadVaultEntryContent, base64ToBlobUrl,
  buildVaultIndex, getVaultIndex, clearVaultIndex, searchVaultIndex, vaultLabelSuggestions
};
