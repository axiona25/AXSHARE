/**
 * Gestione keypair RSA-PSS per firma digitale.
 * Separato dal keypair OAEP (cifratura) in keyManager.ts.
 * Le chiavi sono salvate in IndexedDB con store 'signing_keypairs'.
 */

import {
  deriveKEKFromPassphrase,
  encryptPrivateKeyWithKEK,
  decryptPrivateKeyWithKEK,
  spkiToPem,
} from '@/lib/crypto'

const DB_NAME = 'axshare_keys'
const STORE_NAME = 'signing_keypairs'
const DB_VERSION = 2

async function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains('keypairs')) {
        db.createObjectStore('keypairs', { keyPath: 'userId' })
      }
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'userId' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export const signingKeyManager = {
  async generateAndStore(
    userId: string,
    passphrase: string
  ): Promise<string> {
    const keyPair = await crypto.subtle.generateKey(
      {
        name: 'RSA-PSS',
        modulusLength: 4096,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify']
    )

    const spki = await crypto.subtle.exportKey('spki', keyPair.publicKey)
    const publicKeyPem = spkiToPem(new Uint8Array(spki))

    const privateKeyEncrypted = await encryptPrivateKeyWithKEK(
      keyPair.privateKey,
      passphrase
    )

    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).put({
        userId,
        publicKeyPem,
        privateKeyEncrypted,
        algorithm: 'RSA-PSS',
        createdAt: Date.now(),
      })
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })

    return publicKeyPem
  },

  async getPrivateKey(
    userId: string,
    passphrase: string
  ): Promise<CryptoKey | null> {
    const db = await openDB()
    const record = await new Promise<{
      privateKeyEncrypted?: string
    } | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const req = tx.objectStore(STORE_NAME).get(userId)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    if (!record?.privateKeyEncrypted) return null
    return decryptPrivateKeyWithKEK(
      record.privateKeyEncrypted,
      passphrase,
      'RSA-PSS'
    )
  },

  async getPublicKeyPem(userId: string): Promise<string | null> {
    const db = await openDB()
    const record = await new Promise<{ publicKeyPem?: string } | undefined>(
      (resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly')
        const req = tx.objectStore(STORE_NAME).get(userId)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      }
    )
    return record?.publicKeyPem ?? null
  },

  async hasKeys(userId: string): Promise<boolean> {
    const pem = await this.getPublicKeyPem(userId)
    return !!pem
  },
}
