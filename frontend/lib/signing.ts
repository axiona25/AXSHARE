/**
 * Firma digitale file con RSA-PSS (TASK 9.1).
 * La firma avviene sul file CIFRATO (non sul plaintext).
 * Input: hash SHA-256 del blob cifrato + file_id + version (come stringa concatenata).
 */

import { bytesToBase64, base64ToBytes, pemToSpki } from '@/lib/crypto'
import { signingKeyManager } from '@/lib/signingKeys'

export interface SignatureResult {
  signatureB64: string
  fileHashSha256: string
  publicKeyPemSnapshot: string
  algorithm: 'RSA-PSS-SHA256'
}

/**
 * Calcola SHA-256 di un buffer e restituisce hex string.
 */
export async function sha256Hex(data: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data as BufferSource)
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Firma il file cifrato con la chiave privata RSA-PSS dell'utente.
 * @param encryptedFileBytes - Il blob cifrato completo (quello caricato su server)
 * @param fileId - UUID del file
 * @param version - Versione del file (default 1)
 * @param userId - ID utente (per recuperare la chiave da IndexedDB)
 * @param passphrase - Passphrase per decifrare la chiave privata da IndexedDB
 */
export async function signFile(
  encryptedFileBytes: Uint8Array,
  fileId: string,
  version: number,
  userId: string,
  passphrase: string
): Promise<SignatureResult> {
  const fileHash = await sha256Hex(encryptedFileBytes)
  const signPayload = new TextEncoder().encode(
    `${fileHash}:${fileId}:${version}`
  )

  const privateKey = await signingKeyManager.getPrivateKey(userId, passphrase)
  if (!privateKey) throw new Error('Chiave firma non trovata')

  const signatureBuffer = await crypto.subtle.sign(
    { name: 'RSA-PSS', saltLength: 32 },
    privateKey,
    signPayload
  )
  const signatureB64 = bytesToBase64(new Uint8Array(signatureBuffer))

  const publicKeyPem = await signingKeyManager.getPublicKeyPem(userId)
  if (!publicKeyPem) throw new Error('Chiave pubblica non trovata')

  return {
    signatureB64,
    fileHashSha256: fileHash,
    publicKeyPemSnapshot: publicKeyPem,
    algorithm: 'RSA-PSS-SHA256',
  }
}

/**
 * Verifica una firma RSA-PSS lato client (opzionale — la verifica ufficiale è server-side).
 */
export async function verifySignatureClient(
  encryptedFileBytes: Uint8Array,
  fileId: string,
  version: number,
  signatureB64: string,
  publicKeyPem: string
): Promise<boolean> {
  try {
    const fileHash = await sha256Hex(encryptedFileBytes)
    const signPayload = new TextEncoder().encode(
      `${fileHash}:${fileId}:${version}`
    )
    const signatureBytes = base64ToBytes(signatureB64)
    const spki = pemToSpki(publicKeyPem)
    const pubKey = await crypto.subtle.importKey(
      'spki',
      spki,
      { name: 'RSA-PSS', hash: 'SHA-256' },
      false,
      ['verify']
    )
    return crypto.subtle.verify(
      { name: 'RSA-PSS', saltLength: 32 },
      pubKey,
      signatureBytes as BufferSource,
      signPayload as BufferSource
    )
  } catch {
    return false
  }
}
