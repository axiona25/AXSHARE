/**
 * Client-side crypto — AES-256-GCM E2E (compatibile con backend).
 * Chiavi e plaintext non lasciano mai il client (zero-knowledge).
 */

const AES_KEY_BYTES = 32;
const AES_NONCE_BYTES = 12;

export function hexToBytes(hex: string): Uint8Array {
  const len = hex.length / 2;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Genera una DEK AES-256 (32 bytes) per uso client. */
export async function generateKey(): Promise<Uint8Array> {
  return crypto.getRandomValues(new Uint8Array(AES_KEY_BYTES));
}

/**
 * Cifra con AES-256-GCM; formato: [12 bytes nonce][ciphertext+tag].
 * AAD opzionale (es. file_id) per legare il ciphertext al contesto.
 */
export async function encryptFileChunked(
  plaintext: Uint8Array,
  key: Uint8Array,
  fileId: string,
): Promise<Uint8Array> {
  if (key.length !== AES_KEY_BYTES) throw new Error('Chiave deve essere 32 bytes');
  const nonce = crypto.getRandomValues(new Uint8Array(AES_NONCE_BYTES));
  const aad = new TextEncoder().encode(fileId);
  const keyObj = await crypto.subtle.importKey(
    'raw',
    key as unknown as ArrayBuffer,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: aad, tagLength: 128 },
    keyObj,
    plaintext as BufferSource,
  );
  const out = new Uint8Array(nonce.length + ciphertext.byteLength);
  out.set(nonce, 0);
  out.set(new Uint8Array(ciphertext), nonce.length);
  return out;
}

/**
 * Decifra formato [12 bytes nonce][ciphertext+tag] con AES-256-GCM.
 * AAD opzionale (es. file_id) deve coincidere con quello usato in encrypt.
 */
export async function decryptFileChunked(
  encrypted: Uint8Array,
  key: Uint8Array,
  fileId?: string,
): Promise<Uint8Array> {
  if (key.length !== AES_KEY_BYTES) throw new Error('Chiave deve essere 32 bytes');
  if (encrypted.length < AES_NONCE_BYTES + 16) throw new Error('Dati cifrati troppo corti');
  const nonce = encrypted.slice(0, AES_NONCE_BYTES);
  const ciphertext = encrypted.slice(AES_NONCE_BYTES);
  const aad = fileId != null ? new TextEncoder().encode(fileId) : undefined;
  const keyObj = await crypto.subtle.importKey(
    'raw',
    key as unknown as ArrayBuffer,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: nonce,
      additionalData: aad,
      tagLength: 128,
    },
    keyObj,
    ciphertext,
  );
  return new Uint8Array(plaintext);
}

// ─── RSA Operations (Web Crypto) ─────────────────────────────────────────────

export function spkiToPem(spki: ArrayBuffer | Uint8Array): string {
  const bytes = spki instanceof Uint8Array ? spki : new Uint8Array(spki);
  const b64 = btoa(
    String.fromCharCode.apply(null, Array.from(bytes))
  );
  const lines = b64.match(/.{1,64}/g) || [];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----`;
}

export function pemToSpki(pem: string): ArrayBuffer {
  const b64 = pem.replace(
    /-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\n/g,
    ''
  );
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++)
    bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/**
 * Genera keypair RSA-OAEP 2048 bit con Web Crypto.
 * Restituisce chiavi esportabili in formato JWK e PEM.
 */
export async function generateRSAKeyPair(): Promise<{
  publicKey: CryptoKey
  privateKey: CryptoKey
  publicKeyJwk: JsonWebKey
  publicKeyPem: string
}> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['encrypt', 'decrypt']
  );

  const publicKeyJwk = await crypto.subtle.exportKey(
    'jwk',
    keyPair.publicKey
  );
  const spki = await crypto.subtle.exportKey('spki', keyPair.publicKey);
  const publicKeyPem = spkiToPem(spki);

  return {
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey,
    publicKeyJwk: publicKeyJwk as JsonWebKey,
    publicKeyPem,
  };
}

/**
 * Cifra una file key (32 bytes) con chiave pubblica RSA-OAEP.
 * Restituisce base64 del ciphertext.
 */
export async function encryptFileKeyWithRSA(
  fileKey: Uint8Array,
  publicKeyPem: string
): Promise<string> {
  const spki = pemToSpki(publicKeyPem);
  const publicKey = await crypto.subtle.importKey(
    'spki',
    spki,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt']
  );
  const encrypted = await crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    publicKey,
    fileKey as BufferSource
  );
  return bytesToBase64(new Uint8Array(encrypted));
}

/**
 * Decifra una file key con chiave privata RSA-OAEP.
 */
export async function decryptFileKeyWithRSA(
  encryptedKeyB64: string,
  privateKey: CryptoKey
): Promise<Uint8Array> {
  const ciphertext = base64ToBytes(encryptedKeyB64);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'RSA-OAEP' },
    privateKey,
    ciphertext as BufferSource
  );
  return new Uint8Array(decrypted);
}

// ─── Key Encryption Key (KEK) ─────────────────────────────────────────────────

/**
 * Deriva una KEK da passphrase con PBKDF2-SHA256.
 */
export async function deriveKEKFromPassphrase(
  passphrase: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase) as unknown as ArrayBuffer,
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: 600000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Cifra la chiave privata RSA con AES-GCM (KEK).
 * Restituisce base64(salt + nonce + ciphertext).
 */
export async function encryptPrivateKeyWithKEK(
  privateKey: CryptoKey,
  passphrase: string
): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const kek = await deriveKEKFromPassphrase(passphrase, salt);
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', privateKey);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    kek,
    pkcs8 as BufferSource
  );
  const result = new Uint8Array(32 + 12 + encrypted.byteLength);
  result.set(salt, 0);
  result.set(nonce, 32);
  result.set(new Uint8Array(encrypted), 44);
  return bytesToBase64(result);
}

/**
 * Decifra chiave privata RSA da storage.
 * @param algorithm - 'RSA-OAEP' per cifratura (default), 'RSA-PSS' per firma
 */
export async function decryptPrivateKeyWithKEK(
  encryptedB64: string,
  passphrase: string,
  algorithm: 'RSA-OAEP' | 'RSA-PSS' = 'RSA-OAEP'
): Promise<CryptoKey> {
  const data = base64ToBytes(encryptedB64);
  const salt = data.slice(0, 32);
  const nonce = data.slice(32, 44);
  const ciphertext = data.slice(44);
  const kek = await deriveKEKFromPassphrase(passphrase, salt);
  const pkcs8 = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce },
    kek,
    ciphertext as BufferSource
  );
  const isPss = algorithm === 'RSA-PSS';
  return crypto.subtle.importKey(
    'pkcs8',
    pkcs8,
    { name: algorithm, hash: 'SHA-256' },
    true,
    isPss ? ['sign'] : ['decrypt']
  );
}

// ─── Utility ─────────────────────────────────────────────────────────────────

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk))
    );
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
