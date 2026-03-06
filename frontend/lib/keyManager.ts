/**
 * Gestione lifecycle delle chiavi crittografiche nel browser.
 * - Genera e salva keypair RSA nella IndexedDB (non in localStorage)
 * - Cifra la chiave privata con KEK prima di salvarla
 * - Fornisce accesso alla chiave privata solo in memoria
 *
 * NOTA: le chiavi non lasciano mai il browser.
 */

import {
  generateRSAKeyPair,
  encryptPrivateKeyWithKEK,
  decryptPrivateKeyWithKEK,
} from '@/lib/crypto'

const DB_NAME = 'axshare_keys'
const DB_VERSION = 2
const STORE_NAME = 'keypairs'

interface KeypairRecord {
  userId: string
  publicKeyPem: string
  encryptedPrivateKey: string
  createdAt: number
}

async function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'userId' })
      }
      if (!db.objectStoreNames.contains('signing_keypairs')) {
        db.createObjectStore('signing_keypairs', { keyPath: 'userId' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbGet(userId: string): Promise<KeypairRecord | undefined> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(userId)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbPut(data: KeypairRecord): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const req = tx.objectStore(STORE_NAME).put(data)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

export const keyManager = {
  /**
   * Genera keypair per un nuovo utente e salva in IndexedDB.
   * La chiave privata è cifrata con la passphrase prima di essere salvata.
   * Restituisce la chiave pubblica PEM per upload al server.
   */
  async generateAndStore(
    userId: string,
    passphrase: string
  ): Promise<string> {
    const { publicKey, privateKey, publicKeyPem } =
      await generateRSAKeyPair()
    const encryptedPrivateKey = await encryptPrivateKeyWithKEK(
      privateKey,
      passphrase
    )
    await idbPut({
      userId,
      publicKeyPem,
      encryptedPrivateKey,
      createdAt: Date.now(),
    })
    return publicKeyPem
  },

  /**
   * Recupera la chiave privata dalla IndexedDB e la decifra in memoria.
   */
  async getPrivateKey(
    userId: string,
    passphrase: string
  ): Promise<CryptoKey | null> {
    const record = await idbGet(userId)
    if (!record) return null
    try {
      return await decryptPrivateKeyWithKEK(
        record.encryptedPrivateKey,
        passphrase
      )
    } catch {
      return null
    }
  },

  /** Recupera la chiave pubblica PEM dalla IndexedDB. */
  async getPublicKeyPem(userId: string): Promise<string | null> {
    const record = await idbGet(userId)
    return record?.publicKeyPem ?? null
  },

  /** Verifica se l'utente ha già un keypair salvato. */
  async hasKeys(userId: string): Promise<boolean> {
    const record = await idbGet(userId)
    return !!record
  },
}
