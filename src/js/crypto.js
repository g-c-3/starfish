// crypto.js — all local, no network calls. Uses Web Crypto API (available in Capacitor's WebView).

const ENC = new TextEncoder();
const DEC = new TextDecoder();

function toBase64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
function fromBase64(b64) {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer;
}
function randomBytes(len) {
  return crypto.getRandomValues(new Uint8Array(len));
}

// ---- Password hashing (for app-open password & private-notes PIN) ----
// Not reversible; used only to verify a match on unlock.
async function hashPassword(password, saltB64 = null) {
  const salt = saltB64 ? fromBase64(saltB64) : randomBytes(16);
  const keyMaterial = await crypto.subtle.importKey('raw', ENC.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 210000, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return { hash: toBase64(bits), salt: toBase64(salt) };
}

async function verifyPassword(password, storedHashB64, storedSaltB64) {
  const { hash } = await hashPassword(password, storedSaltB64);
  return constantTimeEqual(hash, storedHashB64);
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
// Backup file format (conceptually): { version, salt, kdfIterations, hintPlain, iv, cipher }
// salt + hint are the ONLY unencrypted fields — neither reveals the passkey itself.
async function encryptBackup(passphrase, plainBytes, hintPlain = '') {
  const { key, salt } = await deriveAesKey(passphrase, null, 300000);
  const { cipher, iv } = await encryptBytes(key, plainBytes);
  return {
    version: 1,
    salt,
    kdfIterations: 300000,
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
  hashPassword, verifyPassword, deriveAesKey,
  encryptBytes, decryptBytes,
  encryptPrivateNote, decryptPrivateNote,
  encryptBackup, decryptBackup
};
