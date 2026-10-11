// crypto.js — all local, no network calls. Uses Web Crypto API (available in Capacitor's WebView).

const ENC = new TextEncoder();
const DEC = new TextDecoder();

function toBase64(buf) {
  // Chunked: spreading a whole photo into String.fromCharCode overflows the call stack (~100 KB and up).
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
function fromBase64(b64) {
  // Plain index loop: Uint8Array.from with a callback is several times slower on a multi-MB string (backup chunks).
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
function randomBytes(len) {
  return crypto.getRandomValues(new Uint8Array(len));
}

// ---- Password hashing (for app-open password & private-notes PIN) ----
// Not reversible; used only to verify a match on unlock.
// New hashes use PASSWORD_HASH_ITERATIONS (Decision 172). The count is stored beside each hash (`*_iter` columns); a row with no
// count was made at LEGACY_HASH_ITERATIONS and is upgraded after a correct unlock. The Vault key keeps its own fixed count.
const PASSWORD_HASH_ITERATIONS = 600000;
const LEGACY_HASH_ITERATIONS = 210000;
async function hashPassword(password, saltB64 = null, iterations = PASSWORD_HASH_ITERATIONS) {
  const salt = saltB64 ? fromBase64(saltB64) : randomBytes(16);
  const keyMaterial = await crypto.subtle.importKey('raw', ENC.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return { hash: toBase64(bits), salt: toBase64(salt), iterations };
}

// `iterations` is the stored count; null or missing means a hash made before the count was stored.
async function verifyPassword(password, storedHashB64, storedSaltB64, iterations = null) {
  const { hash } = await hashPassword(password, storedSaltB64, iterations || LEGACY_HASH_ITERATIONS);
  return constantTimeEqual(hash, storedHashB64);
}

function needsRehash(iterations) {
  return (iterations || LEGACY_HASH_ITERATIONS) < PASSWORD_HASH_ITERATIONS;
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---- Key derivation for encryption (private notes & backups) ----
// "Mixing" the user's input with a stored/random salt through PBKDF2 IS the mixing —
// this is what makes the derived key unique to that passphrase+salt pair.
async function deriveAesKey(passphrase, saltB64 = null, iterations = 300000) {
  const salt = saltB64 ? fromBase64(saltB64) : randomBytes(16);
  const keyMaterial = await crypto.subtle.importKey('raw', ENC.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
  return { key, salt: toBase64(salt) };
}

// ---- Generic AES-GCM encrypt/decrypt (used for private note bodies AND backup archives) ----
async function encryptBytes(key, plainBytesOrString) {
  const iv = randomBytes(12);
  const data = typeof plainBytesOrString === 'string' ? ENC.encode(plainBytesOrString) : plainBytesOrString;
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  return { cipher: toBase64(cipher), iv: toBase64(iv) };
}

async function decryptBytes(key, cipherB64, ivB64) {
  const cipher = fromBase64(cipherB64);
  const iv = fromBase64(ivB64);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
  return plain; // ArrayBuffer — caller decides text vs binary
}

// ---- Chunk helpers (backup format 2, Decision 159) ----
// One AES-GCM call per chunk. `aad` (the chunk's line number in the file) is authenticated but not stored,
// so a reordered, dropped or swapped line fails to decrypt.
async function encryptChunk(key, bytes, aad) {
  const iv = randomBytes(12);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: ENC.encode(String(aad)) }, key, bytes);
  return { iv: toBase64(iv), c: toBase64(cipher) };
}
async function decryptChunk(key, ivB64, cB64, aad) {
  return crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(ivB64), additionalData: ENC.encode(String(aad)) }, key, fromBase64(cB64)
  ); // ArrayBuffer; throws if the key is wrong or the line was altered or moved
}

// ---- Private note helpers ----
async function encryptPrivateNote(pinDerivedKey, text) {
  const { cipher, iv } = await encryptBytes(pinDerivedKey, text);
  return JSON.stringify({ cipher, iv });
}
async function decryptPrivateNote(pinDerivedKey, blobJson) {
  const { cipher, iv } = JSON.parse(blobJson);
  const plain = await decryptBytes(pinDerivedKey, cipher, iv);
  return DEC.decode(plain);
}

// ---- Backup helpers ----
// New backups derive their key with this many PBKDF2 iterations (Decision 171). The count is written in each backup's header and read
// back on restore, so backups made with an earlier count (300000) still open. The Vault key does not use it (its count is fixed).
const BACKUP_KDF_ITERATIONS = 600000;
// Backup file format (conceptually): { version, salt, kdfIterations, hintPlain, iv, cipher }
// salt + hint are the ONLY unencrypted fields — neither reveals the passkey itself.
async function encryptBackup(passphrase, plainBytes, hintPlain = '') {
  const { key, salt } = await deriveAesKey(passphrase, null, BACKUP_KDF_ITERATIONS);
  const { cipher, iv } = await encryptBytes(key, plainBytes);
  return {
    version: 1,
    salt,
    kdfIterations: BACKUP_KDF_ITERATIONS,
    hint: hintPlain,
    iv,
    cipher
  };
}

async function decryptBackup(passphrase, backupFileObj) {
  const { salt, kdfIterations, iv, cipher } = backupFileObj;
  const { key } = await deriveAesKey(passphrase, salt, kdfIterations);
  return decryptBytes(key, cipher, iv); // throws if passphrase wrong (GCM auth tag fails)
}

export {
  hashPassword, verifyPassword, needsRehash, PASSWORD_HASH_ITERATIONS, LEGACY_HASH_ITERATIONS, deriveAesKey,
  encryptBytes, decryptBytes,
  encryptPrivateNote, decryptPrivateNote,
  encryptBackup, decryptBackup,
  encryptChunk, decryptChunk, toBase64, fromBase64, BACKUP_KDF_ITERATIONS
};
