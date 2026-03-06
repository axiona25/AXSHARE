/**
 * Test crypto client-side — TASK 6.2
 * Eseguire con: npx vitest run crypto.test
 */

import { describe, it, expect } from 'vitest'
import {
  generateKey,
  encryptFileChunked,
  decryptFileChunked,
  generateRSAKeyPair,
  encryptFileKeyWithRSA,
  decryptFileKeyWithRSA,
  encryptPrivateKeyWithKEK,
  decryptPrivateKeyWithKEK,
  bytesToBase64,
  base64ToBytes,
  bytesToHex,
  hexToBytes,
} from '@/lib/crypto'

describe('AES-GCM client-side', () => {
  it('encrypt/decrypt roundtrip', async () => {
    const key = await generateKey()
    const plaintext = new TextEncoder().encode(
      'contenuto segreto AXSHARE'
    )
    const encrypted = await encryptFileChunked(
      plaintext,
      key,
      'test-id'
    )
    const decrypted = await decryptFileChunked(
      encrypted,
      key,
      'test-id'
    )
    expect(new TextDecoder().decode(decrypted)).toBe(
      'contenuto segreto AXSHARE'
    )
  })

  it('wrong key fails', async () => {
    const key = await generateKey()
    const wrongKey = await generateKey()
    const encrypted = await encryptFileChunked(
      new Uint8Array([1, 2, 3]),
      key,
      'id'
    )
    await expect(
      decryptFileChunked(encrypted, wrongKey, 'id')
    ).rejects.toThrow()
  })
})

describe('RSA-OAEP key wrapping', () => {
  it('encrypt/decrypt file key roundtrip', async () => {
    const { publicKeyPem, privateKey } = await generateRSAKeyPair()
    const fileKey = await generateKey()
    const encrypted = await encryptFileKeyWithRSA(fileKey, publicKeyPem)
    const decrypted = await decryptFileKeyWithRSA(encrypted, privateKey)
    expect(decrypted).toEqual(fileKey)
  })
})

describe('KEK private key protection', () => {
  it('encrypt/decrypt private key with passphrase', async () => {
    const { privateKey } = await generateRSAKeyPair()
    const passphrase = 'test-passphrase-sicura'
    const encrypted = await encryptPrivateKeyWithKEK(
      privateKey,
      passphrase
    )
    const decrypted = await decryptPrivateKeyWithKEK(
      encrypted,
      passphrase
    )
    expect(decrypted).toBeTruthy()
    expect(decrypted.type).toBe('private')
  })

  it('wrong passphrase fails', async () => {
    const { privateKey } = await generateRSAKeyPair()
    const encrypted = await encryptPrivateKeyWithKEK(privateKey, 'correct')
    await expect(
      decryptPrivateKeyWithKEK(encrypted, 'wrong')
    ).rejects.toThrow()
  })
})

describe('utility functions', () => {
  it('bytesToBase64 / base64ToBytes roundtrip', () => {
    const bytes = new Uint8Array([1, 2, 3, 255, 128])
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes)
  })

  it('bytesToHex / hexToBytes roundtrip', () => {
    const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef])
    expect(hexToBytes(bytesToHex(bytes))).toEqual(bytes)
  })
})
