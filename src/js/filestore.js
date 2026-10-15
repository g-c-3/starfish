// filestore.js — per-file encryption on disk (Decision 161). Web Crypto only, no network.
// On disk: files/<32 hex>, no extension. Layout: "DZF1" | nonce prefix (8) | chunk size (4, BE) | chunks.
// Chunk i = AES-GCM(plain chunk) under the file key; IV = prefix | i (4, BE); AAD = i (4, BE) | final flag (1).
// The flag and index make truncation, extension and reordering fail to decrypt.
// File key: random 256-bit, wrapped under the master key (AAD = path) and kept in entries.file_key.
// Master key: random 256-bit in the encrypted database (meta table); never in a backup.
// IO is injected: { write(path, bytes), append(path, bytes), read(path) -> Uint8Array, stat(path) -> size, remove(path) }.

import { toBase64, fromBase64 } from './crypto.js';

const MAGIC = [0x44, 0x5a, 0x46, 0x31]; // "DZF1"
const HEADER = 16;
const TAG = 16;
const WRAP_IV = 12;
const DEFAULT_CHUNK = 1024 * 1024;
const MASTER_META_KEY = 'file_master_key';
const FILES_DIR = 'files';

const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const utf8 = (s) => new TextEncoder().encode(s);

function chunkIv(prefix, i) {
  const iv = new Uint8Array(12);
  iv.set(prefix, 0);
  new DataView(iv.buffer).setUint32(8, i);
  return iv;
}
function chunkAad(i, final) {
  const a = new Uint8Array(5);
  new DataView(a.buffer).setUint32(0, i);
  a[4] = final ? 1 : 0;
  return a;
}
function concat(a, b) {
  if (!a.length) return b;
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
const importFileKey = (raw) => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);

// Master key from the meta table: created on first use. get(key) -> string|null, set(key, string).
async function loadMasterKey({ get, set }) {
  let b64 = await get(MASTER_META_KEY);
  if (!b64) {
    b64 = toBase64(rand(32));
    await set(MASTER_META_KEY, b64);
  }
  return importFileKey(new Uint8Array(fromBase64(b64)));
}

// A file key is wrapped under a CryptoKey with the file's path as additional data. Home files use the master key,
// Vault files the Vault key (Decision 212); Move re-wraps the key and leaves the file as it is.
async function wrapKeyWith(masterKey, fileKeyRaw, path) {
  const iv = rand(WRAP_IV);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8(path) }, masterKey, fileKeyRaw));
  const out = new Uint8Array(WRAP_IV + ct.length);
  out.set(iv, 0);
  out.set(ct, WRAP_IV);
  return toBase64(out);
}
async function unwrapKeyWith(masterKey, wrapped, path) {
  const bytes = new Uint8Array(fromBase64(wrapped));
  return new Uint8Array(await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes.subarray(0, WRAP_IV), additionalData: utf8(path) }, masterKey, bytes.subarray(WRAP_IV)));
}
// Same file key, wrapped for another key and path. Throws when `from` is not the key that wrapped it.
async function rewrapFileKey(wrapped, fromPath, toPath, fromKey, toKey) {
  return wrapKeyWith(toKey, await unwrapKeyWith(fromKey, wrapped, fromPath), toPath);
}
async function sameWrappedKey(wrappedA, pathA, keyA, wrappedB, pathB, keyB) {
  const a = await unwrapKeyWith(keyA, wrappedA, pathA), b = await unwrapKeyWith(keyB, wrappedB, pathB);
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
const newFilePath = () => `${FILES_DIR}/${hex(rand(16))}`;

function createFileStore({ io, getMasterKey, chunkSize = DEFAULT_CHUNK }) {
  const wrap = async (fileKeyRaw, path) => wrapKeyWith(await getMasterKey(), fileKeyRaw, path);
  const unwrap = async (wrapped, path) => unwrapKeyWith(await getMasterKey(), wrapped, path);

  // Streaming writer. append() any sizes; finish() writes the last chunk and returns { path, fileKey }.
  async function begin() {
    const path = newFilePath();
    const keyRaw = rand(32);
    const key = await importFileKey(keyRaw);
    const prefix = rand(8);
    const header = new Uint8Array(HEADER);
    header.set(MAGIC, 0);
    header.set(prefix, 4);
    new DataView(header.buffer).setUint32(12, chunkSize);
    await io.write(path, header);
    let pending = new Uint8Array(0);
    let index = 0;
    let done = false;
    const seal = async (plain, final) => {
      const ct = new Uint8Array(await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: chunkIv(prefix, index), additionalData: chunkAad(index, final) }, key, plain));
      index++;
      await io.append(path, ct);
    };
    return {
      path,
      async append(bytes) {
        if (done) throw new Error('File already finished.');
        pending = concat(pending, bytes);
        // Keep at least one byte back: the last chunk must be sealed as final.
        while (pending.length > chunkSize) {
          await seal(pending.subarray(0, chunkSize), false);
          pending = pending.subarray(chunkSize);
        }
      },
      async finish() {
        if (done) throw new Error('File already finished.');
        done = true;
        await seal(pending, true);
        pending = new Uint8Array(0);
        return { path, fileKey: await wrap(keyRaw, path) };
      },
      async abort() { done = true; try { await io.remove(path); } catch { /* nothing written */ } }
    };
  }

  async function write(bytes) {
    const w = await begin();
    try {
      await w.append(bytes);
      return await w.finish();
    } catch (err) { await w.abort(); throw err; }
  }

  async function decryptAll(enc, key) {
    if (enc.length < HEADER + TAG) throw new Error('Stored file is damaged.');
    for (let i = 0; i < 4; i++) if (enc[i] !== MAGIC[i]) throw new Error('Stored file is damaged.');
    const prefix = enc.subarray(4, 12);
    const cs = new DataView(enc.buffer, enc.byteOffset, enc.byteLength).getUint32(12);
    if (!cs) throw new Error('Stored file is damaged.');
    const encLen = cs + TAG;
    const body = enc.length - HEADER;
    const n = Math.ceil(body / encLen);
    if (body - (n - 1) * encLen < TAG) throw new Error('Stored file is damaged.');
    const out = new Uint8Array(body - n * TAG);
    let off = 0;
    for (let i = 0; i < n; i++) {
      const start = HEADER + i * encLen;
      const part = enc.subarray(start, Math.min(start + encLen, enc.length));
      let plain;
      try {
        plain = new Uint8Array(await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: chunkIv(prefix, i), additionalData: chunkAad(i, i === n - 1) }, key, part));
      } catch { throw new Error('Stored file could not be decrypted.'); }
      out.set(plain, off);
      off += plain.length;
    }
    return out;
  }

  // row: { file_path, file_key }. file_key null = file from before this stage, stored plain.
  async function read(row) {
    const raw = await io.read(row.file_path);
    if (!row.file_key) return raw;
    const key = await importFileKey(await unwrap(row.file_key, row.file_path));
    return decryptAll(raw, key);
  }

  const plainSize = (encSize) => {
    const body = encSize - HEADER;
    return body < TAG ? 0 : body - Math.ceil(body / (chunkSize + TAG)) * TAG;
  };
  async function size(row) {
    const s = await io.stat(row.file_path);
    return row.file_key ? plainSize(s) : s;
  }

  return { begin, write, read, size, plainSize, isEncrypted: (row) => !!row.file_key };
}

export { createFileStore, loadMasterKey, rewrapFileKey, sameWrappedKey, newFilePath, FILES_DIR, MASTER_META_KEY, DEFAULT_CHUNK };
