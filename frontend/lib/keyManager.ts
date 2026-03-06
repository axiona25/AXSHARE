/**
 * Gestione lifecycle delle chiavi crittografiche nel browser.
 * - Genera e salva keypair RSA nella IndexedDB (non in localStorage)
 * - La chiave privata cifrata viene sincronizzata sul backend per uso da altri client (es. desktop)
 * - getPrivateKey: se non in IndexedDB, scarica dal backend e salva in locale
 */

import {
  generateRSAKeyPair,
  encryptPrivateKeyWithKEK,
  decryptPrivateKeyWithKEK,
  deriveKeyFromPin,
  generatePinSalt,
} from '@/lib/crypto'
import { usersApi } from '@/lib/api'

function toBase64(buf: ArrayBuffer | Uint8Array): string {
  const arr = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  return btoa(String.fromCharCode(...arr))
}

function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

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
    try {
      await usersApi.savePrivateKey(encryptedPrivateKey)
    } catch {
      // Backend non disponibile o errore: chiavi restano solo in IndexedDB
    }
    return publicKeyPem
  },

  /**
   * Recupera la chiave privata (IndexedDB o backend) e la decifra in memoria.
   * Se IndexedDB fallisce (es. WebView Tauri con restrizioni), usa direttamente il backend.
   */
  async getPrivateKey(
    userId: string,
    passphrase: string
  ): Promise<CryptoKey | null> {
    let encryptedPrivateKey: string | null = null

    try {
      const record = await idbGet(userId)
      if (record?.encryptedPrivateKey) {
        encryptedPrivateKey = record.encryptedPrivateKey
      }
    } catch {
      console.warn('[KEY MANAGER] IndexedDB non disponibile, uso backend direttamente')
    }

    if (!encryptedPrivateKey) {
      try {
        const resp = await usersApi.getPrivateKey()
        if (resp.data?.encrypted_private_key) {
          encryptedPrivateKey = resp.data.encrypted_private_key
          try {
            await idbPut({
              userId,
              publicKeyPem: resp.data.public_key_pem ?? '',
              encryptedPrivateKey,
              createdAt: Date.now(),
            })
          } catch {
            // IndexedDB non disponibile (es. Tauri): ignora, la chiave è già in memoria
          }
        }
      } catch (e) {
        console.error('[KEY MANAGER] Errore download chiave dal backend:', e)
        return null
      }
    }

    if (!encryptedPrivateKey) return null

    try {
      return await decryptPrivateKeyWithKEK(encryptedPrivateKey, passphrase)
    } catch (e) {
      console.error('[KEY MANAGER] Errore decifratura chiave privata:', e)
      return null
    }
  },

  /** Recupera la chiave pubblica PEM (IndexedDB o, se non disponibile, backend). */
  async getPublicKeyPem(userId: string): Promise<string | null> {
    try {
      const record = await idbGet(userId)
      if (record?.publicKeyPem) return record.publicKeyPem
    } catch {
      // IndexedDB non disponibile
    }
    try {
      const resp = await usersApi.getPrivateKey()
      return resp.data?.public_key_pem ?? null
    } catch {
      return null
    }
  },

  /** Verifica se l'utente ha già un keypair in IndexedDB. Non chiama il backend. */
  async hasKeys(userId: string): Promise<boolean> {
    try {
      const record = await idbGet(userId)
      if (record?.encryptedPrivateKey) return true
    } catch {
      // IndexedDB non disponibile (es. WebView Tauri)
    }
    return false
  },

  /**
   * Genera e salva chiavi RSA cifrate con PIN (8 caratteri: lettere, numeri, simboli).
   * La chiave privata è cifrata con AES-GCM derivato da PBKDF2(email:PIN, salt).
   */
  async generateAndStoreWithPin(
    userId: string,
    email: string,
    pin: string
  ): Promise<void> {
    console.log('[KEY MANAGER] generateAndStoreWithPin start')
    const keyPair = await generateRSAKeyPair()

    const privateKeyBuffer = await window.crypto.subtle.exportKey(
      'pkcs8',
      keyPair.privateKey
    )

    const salt = generatePinSalt()
    const aesKey = await deriveKeyFromPin(email, pin, salt)

    const iv = window.crypto.getRandomValues(new Uint8Array(12))
    const encryptedPrivateKey = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      aesKey,
      privateKeyBuffer
    )

    const encryptedPrivateKeyB64 = toBase64(encryptedPrivateKey)
    const saltB64 = toBase64(salt)
    const ivB64 = toBase64(iv)

    const encryptedBundle = `${ivB64}.${saltB64}.${encryptedPrivateKeyB64}`

    console.log('[KEY MANAGER] publicKeyPem length:', keyPair.publicKeyPem.length)
    console.log('[KEY MANAGER] publicKeyPem preview:', keyPair.publicKeyPem.substring(0, 80))
    await usersApi.uploadPublicKey(keyPair.publicKeyPem)
    console.log('[KEY MANAGER] uploadPublicKey completato')

    await usersApi.savePrivateKey(encryptedBundle)
    console.log('[KEY MANAGER] savePrivateKey completato')

    try {
      await idbPut({
        userId,
        publicKeyPem: keyPair.publicKeyPem,
        encryptedPrivateKey: encryptedBundle,
        createdAt: Date.now(),
      })
    } catch {
      // IndexedDB non disponibile (es. Tauri)
    }

    console.log('[KEY MANAGER] Chiavi generate e salvate con PIN')
  },

  /**
   * Sblocca chiave privata con PIN (bundle = iv.salt.encrypted da backend).
   */
  async unlockWithPin(
    email: string,
    pin: string,
    encryptedBundle: string
  ): Promise<CryptoKey> {
    console.log('[KEY MANAGER] unlockWithPin start')
    const parts = encryptedBundle.split('.')
    if (parts.length !== 3) {
      throw new Error(
        'Formato chiave non supportato. Vai su Setup chiavi e usa "Rigenera chiavi" per passare al PIN.'
      )
    }

    const iv = fromBase64(parts[0])
    const salt = fromBase64(parts[1])
    const encryptedPrivateKey = fromBase64(parts[2])

    const aesKey = await deriveKeyFromPin(email, pin, salt)

    let privateKeyBuffer: ArrayBuffer
    try {
      privateKeyBuffer = await window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        aesKey,
        encryptedPrivateKey
      )
    } catch {
      throw new Error('PIN non corretto')
    }

    const privateKey = await window.crypto.subtle.importKey(
      'pkcs8',
      privateKeyBuffer,
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      true,
      ['decrypt']
    )

    console.log('[KEY MANAGER] Chiave privata sbloccata con PIN')
    return privateKey
  },

  /** Svuota IndexedDB delle chiavi (per rigenerazione RSA-4096). */
  async clearAll(): Promise<void> {
    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_NAME, 'signing_keypairs'], 'readwrite')
      tx.objectStore(STORE_NAME).clear()
      tx.objectStore('signing_keypairs').clear()
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  },
}
