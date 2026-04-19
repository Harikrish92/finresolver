/* ============================================================
   crypto.js — AES-GCM encryption for user data
   FinResolver · finresolver.in

   All data stored to localStorage and Firestore is encrypted
   with a key derived from the user's email via PBKDF2-SHA256.

   Encrypted strings use the "ENC1:" prefix so legacy plain-JSON
   data is still readable during migration (transparently
   re-encrypted on next save).

   API:
     encryptForStorage(obj, email)  → Promise<string>  "ENC1:..."
     decryptFromStorage(str, email) → Promise<object|null>
   ============================================================ */

const _cryptoKeyCache = new Map(); // email → CryptoKey

/**
 * Derives (or retrieves cached) AES-GCM-256 key from user email.
 * Returns null when email is falsy (guest / unauthenticated).
 */
async function getEncryptionKey(email) {
  if (!email) return null;
  if (_cryptoKeyCache.has(email)) return _cryptoKeyCache.get(email);

  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(email),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: enc.encode('finresolver-salt-v1'),
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
  _cryptoKeyCache.set(email, key);
  return key;
}

/**
 * Encrypts a JS object for storage.
 * Returns "ENC1:<base64(iv+ciphertext)>" or plain JSON when no email.
 */
async function encryptForStorage(obj, email) {
  const key = await getEncryptionKey(email);
  if (!key) return JSON.stringify(obj);

  const iv       = crypto.getRandomValues(new Uint8Array(12));
  const plain    = new TextEncoder().encode(JSON.stringify(obj));
  const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);

  const combined = new Uint8Array(12 + cipherBuf.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(cipherBuf), 12);
  return 'ENC1:' + btoa(String.fromCharCode(...combined));
}

/**
 * Decrypts a stored string back to a JS object.
 * Strings without the "ENC1:" prefix are treated as legacy plain JSON
 * so existing data continues to work before being re-encrypted.
 */
async function decryptFromStorage(str, email) {
  if (!str) return null;

  if (!str.startsWith('ENC1:')) {
    // Legacy unencrypted data — parse as-is
    try { return JSON.parse(str); } catch (e) { return null; }
  }

  const key = await getEncryptionKey(email);
  if (!key) {
    console.error('[Crypto] Cannot decrypt: no email/key available');
    return null;
  }

  try {
    const combined  = Uint8Array.from(atob(str.slice(5)), c => c.charCodeAt(0));
    const iv        = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const plainBuf  = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return JSON.parse(new TextDecoder().decode(plainBuf));
  } catch (e) {
    console.error('[Crypto] Decryption failed:', e);
    return null;
  }
}
