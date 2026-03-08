/**
 * Hook per operazioni crittografiche nel frontend.
 * Gestisce: upload cifrato, download + decrypt, condivisione file.
 * NON contiene UI.
 */

'use client'

import { useState, useCallback } from 'react'
import { useAuthContext } from '@/context/AuthContext'
import {
  filesApi,
  foldersApi,
  usersApi,
  permissionsApi,
} from '@/lib/api'
import {
  generateKey,
  encryptFileChunked,
  decryptFileChunked,
  encryptFileKeyWithRSA,
  decryptFileKeyWithRSA,
  bytesToHex,
  hexToBytes,
  bytesToBase64,
  base64ToBytes,
} from '@/lib/crypto'
import { sha256Hex } from '@/lib/signing'
import { keyManager } from '@/lib/keyManager'
import type { UploadMetadata } from '@/types'

/** Se il backend prepone un header DRM, restituisce { contentOffset }. Altrimenti null. */
function parseDrmHeader(data: Uint8Array): { contentOffset: number } | null {
  // Nessun header DRM attualmente nel backend; hook per uso futuro (es. contentOffset: 134).
  return null
}

interface UploadOptions {
  file: File
  folderId?: string
}

interface UploadResult {
  fileId: string
  fileKeyHex: string
}

interface UseCryptoReturn {
  isLoading: boolean
  error: string | null
  uploadFile: (options: UploadOptions) => Promise<UploadResult | null>
  uploadNewVersion: (
    fileId: string,
    fileOrBlob: File | Blob,
    versionComment?: string
  ) => Promise<{ version: number } | null>
  downloadAndDecrypt: (fileId: string) => Promise<Blob | null>
  downloadVersionAndDecrypt: (
    fileId: string,
    versionNumber: number
  ) => Promise<Blob | null>
  decryptFileNames: (
    files: { id: string; name_encrypted: string }[]
  ) => Promise<Record<string, string>>
  decryptFolderNames: (
    folders: { id: string; name_encrypted: string }[]
  ) => Promise<Record<string, string>>
  /** Nomi decifrati + chiavi AES in base64 (per disco virtuale). */
  decryptFileNamesAndKeys: (
    files: { id: string; name_encrypted: string }[]
  ) => Promise<{ names: Record<string, string>; keysBase64: Record<string, string> }>
  shareFile: (
    fileId: string,
    recipientUserId: string,
    fileKeyHex: string
  ) => Promise<boolean>
  clearError: () => void
}

export function useCrypto(): UseCryptoReturn {
  const { user, sessionPrivateKey } = useAuthContext()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const clearError = useCallback(() => setError(null), [])

  const uploadFile = useCallback(
    async (options: UploadOptions): Promise<UploadResult | null> => {
      if (!user) {
        setError('Non autenticato')
        return null
      }
      setIsLoading(true)
      setError(null)
      try {
        const { file, folderId } = options
        const plaintext = new Uint8Array(await file.arrayBuffer())

        const fileKey = await generateKey()
        const fileKeyHex = bytesToHex(fileKey)

        // AAD vuoto per il contenuto: in download non abbiamo il valore usato in encrypt
        // (prima si usava user.id+timestamp che non viene salvato) → OperationError.
        const encrypted = await encryptFileChunked(plaintext, fileKey, '')

        // Nome e mime cifrati con la stessa fileKey così si possono decifrare
        // in lista dopo aver ottenuto la file key (decifrando file_key_encrypted con chiave privata)
        const nameEncrypted = await encryptFileChunked(
          new TextEncoder().encode(file.name),
          fileKey,
          user.id
        )
        const mimeEncrypted = await encryptFileChunked(
          new TextEncoder().encode(
            file.type || 'application/octet-stream'
          ),
          fileKey,
          user.id
        )

        const publicKeyPem = await keyManager.getPublicKeyPem(user.id)
        if (!publicKeyPem)
          throw new Error(
            'Chiave pubblica non trovata — completare setup'
          )
        const fileKeyEncrypted = await encryptFileKeyWithRSA(
          fileKey,
          publicKeyPem
        )

        const nonce = encrypted.slice(0, 12)
        const contentHash = await sha256Hex(plaintext)

        const metadata: UploadMetadata = {
          name_encrypted: bytesToBase64(new Uint8Array(nameEncrypted)),
          mime_type_encrypted: bytesToBase64(new Uint8Array(mimeEncrypted)),
          file_key_encrypted: fileKeyEncrypted,
          encryption_iv: bytesToBase64(nonce),
          content_hash: contentHash,
          size_original: plaintext.byteLength,
          folder_id: folderId,
        }

        const blob = new Blob([encrypted as BlobPart], {
          type: 'application/octet-stream',
        })
        const { data } = await filesApi.upload(blob, metadata)

        return { fileId: data.file_id, fileKeyHex }
      } catch (err: unknown) {
        const e = err as { response?: { data?: unknown; status?: number } }
        console.error('[UPLOAD] Errore status:', e?.response?.status)
        console.error('[UPLOAD] Errore body:', JSON.stringify(e?.response?.data))
        const detail =
          err && typeof err === 'object' && 'detail' in err
            ? String((err as { detail: unknown }).detail)
            : err instanceof Error
              ? err.message
              : 'Upload fallito'
        setError(detail)
        return null
      } finally {
        setIsLoading(false)
      }
    },
    [user]
  )

  const uploadNewVersion = useCallback(
    async (
      fileId: string,
      fileOrBlob: File | Blob,
      versionComment?: string
    ): Promise<{ version: number } | null> => {
      if (!user?.id) {
        setError('Non autenticato')
        return null
      }
      const file =
        fileOrBlob instanceof File
          ? fileOrBlob
          : new File([fileOrBlob], 'modified', { type: fileOrBlob.type || 'application/octet-stream' })
      setIsLoading(true)
      setError(null)
      try {
        const plaintext = new Uint8Array(await file.arrayBuffer())
        const fileKey = await generateKey()
        const encrypted = await encryptFileChunked(plaintext, fileKey, '')
        const nameEncrypted = await encryptFileChunked(
          new TextEncoder().encode(file.name),
          fileKey,
          user.id
        )
        const mimeEncrypted = await encryptFileChunked(
          new TextEncoder().encode(file.type || 'application/octet-stream'),
          fileKey,
          user.id
        )
        const publicKeyPem = await keyManager.getPublicKeyPem(user.id)
        if (!publicKeyPem) throw new Error('Chiave pubblica non trovata')
        const fileKeyEncrypted = await encryptFileKeyWithRSA(fileKey, publicKeyPem)
        const nonce = encrypted.slice(0, 12)
        const contentHash = await sha256Hex(plaintext)
        const metadata: UploadMetadata = {
          name_encrypted: bytesToBase64(new Uint8Array(nameEncrypted)),
          mime_type_encrypted: bytesToBase64(new Uint8Array(mimeEncrypted)),
          file_key_encrypted: fileKeyEncrypted,
          encryption_iv: bytesToBase64(nonce),
          content_hash: contentHash,
          size_original: plaintext.byteLength,
          version_comment: versionComment ?? undefined,
        }
        const blob = new Blob([encrypted as BlobPart], {
          type: 'application/octet-stream',
        })
        const { data } = await filesApi.uploadVersion(fileId, blob, metadata)
        return { version: data.version }
      } catch (err) {
        const detail =
          err && typeof err === 'object' && 'detail' in err
            ? String((err as { detail: unknown }).detail)
            : err instanceof Error ? err.message : 'Upload versione fallito'
        setError(detail)
        return null
      } finally {
        setIsLoading(false)
      }
    },
    [user?.id]
  )

  const downloadAndDecrypt = useCallback(
    async (fileId: string): Promise<Blob | null> => {
      if (!user) {
        setError('Non autenticato')
        return null
      }
      const privateKey = sessionPrivateKey
      if (!privateKey) {
        setError('Sessione chiave non attiva. Rieffettua il login.')
        return null
      }
      setIsLoading(true)
      setError(null)
      try {
        console.log('[DOWNLOAD] Step 1: fetch file + key dal backend')
        const [downloadResp, keyResp] = await Promise.all([
          filesApi.download(fileId),
          filesApi.getKey(fileId),
        ])
        let encryptedData = new Uint8Array(downloadResp.data as ArrayBuffer)
        const drmInfo = parseDrmHeader(encryptedData)
        console.log('[DOWNLOAD] Total bytes:', encryptedData.length)
        console.log('[DOWNLOAD] DRM header:', drmInfo ? 'trovato' : 'assente')
        console.log('[DOWNLOAD] Content offset:', drmInfo?.contentOffset ?? 0)
        if (drmInfo) {
          encryptedData = encryptedData.slice(drmInfo.contentOffset)
          console.log('[DOWNLOAD] Content bytes dopo strip:', encryptedData.length)
        }
        console.log('[DOWNLOAD] Step 3–4: chiave sessione ok')

        console.log('[DOWNLOAD] Step 5: decifro chiave file (decryptFileKeyWithRSA)...')
        const fileKey = await decryptFileKeyWithRSA(
          keyResp.data.file_key_encrypted,
          privateKey
        )

        console.log('[DOWNLOAD] Step 6: decifro contenuto (decryptFileChunked)...')
        // AAD deve coincidere con upload: usiamo '' (contenuto file cifrato con AAD vuoto)
        const decrypted = await decryptFileChunked(encryptedData, fileKey, '')
        console.log('[DOWNLOAD] Step 6b: decifrato bytes:', decrypted.byteLength)

        let mimeType = 'application/octet-stream'
        try {
          const mimeEnc = keyResp.data.mime_type_encrypted
          if (mimeEnc && mimeEnc.length > 0) {
            const mimeBytes = base64ToBytes(mimeEnc)
            const mimeDec = await decryptFileChunked(mimeBytes, fileKey, user.id)
            mimeType = new TextDecoder().decode(mimeDec)
            console.log('[DOWNLOAD] MIME type decifrato:', mimeType)
          }
        } catch {
          // usa default
        }

        return new Blob([decrypted as BlobPart], { type: mimeType })
      } catch (err: unknown) {
        console.error('[DOWNLOAD] ERRORE:', err)
        console.error('[DOWNLOAD] Messaggio:', (err as Error).message)
        const detail =
          err && typeof err === 'object' && 'detail' in err
            ? String((err as { detail: unknown }).detail)
            : err instanceof Error
              ? err.message
              : 'Download/decrypt fallito'
        setError(detail)
        return null
      } finally {
        setIsLoading(false)
      }
    },
    [user, sessionPrivateKey]
  )

  const downloadVersionAndDecrypt = useCallback(
    async (
      fileId: string,
      versionNumber: number
    ): Promise<Blob | null> => {
      if (!user?.id || !sessionPrivateKey) {
        setError('Sessione chiave non attiva.')
        return null
      }
      setIsLoading(true)
      setError(null)
      try {
        const [downloadResp, keyResp] = await Promise.all([
          filesApi.downloadVersion(fileId, versionNumber),
          filesApi.getVersionKey(fileId, versionNumber),
        ])
        const encryptedData = new Uint8Array(downloadResp.data as ArrayBuffer)
        const fileKey = await decryptFileKeyWithRSA(
          keyResp.data.file_key_encrypted,
          sessionPrivateKey
        )
        const decrypted = await decryptFileChunked(encryptedData, fileKey, '')
        let mimeType = 'application/octet-stream'
        try {
          const mimeEnc = keyResp.data.mime_type_encrypted
          if (mimeEnc?.length) {
            const mimeBytes = base64ToBytes(mimeEnc)
            const mimeDec = await decryptFileChunked(mimeBytes, fileKey, user.id)
            mimeType = new TextDecoder().decode(mimeDec)
          }
        } catch {
          // ignore
        }
        return new Blob([decrypted as BlobPart], { type: mimeType })
      } catch (err) {
        console.error('[DOWNLOAD VERSION]', err)
        setError(
          err instanceof Error ? err.message : 'Download versione fallito'
        )
        return null
      } finally {
        setIsLoading(false)
      }
    },
    [user?.id, sessionPrivateKey]
  )

  const shareFile = useCallback(
    async (
      fileId: string,
      recipientUserId: string,
      fileKeyHex: string
    ): Promise<boolean> => {
      setIsLoading(true)
      setError(null)
      try {
        const { data: keyData } = await usersApi.getPublicKey(
          recipientUserId
        )

        const fileKey = hexToBytes(fileKeyHex)
        const encryptedForRecipient = await encryptFileKeyWithRSA(
          fileKey,
          keyData.public_key_pem
        )

        await permissionsApi.grant({
          subject_user_id: recipientUserId,
          resource_file_id: fileId,
          level: 'read',
          resource_key_encrypted: encryptedForRecipient,
        })
        return true
      } catch (err: unknown) {
        const detail =
          err && typeof err === 'object' && 'detail' in err
            ? String((err as { detail: unknown }).detail)
            : err instanceof Error
              ? err.message
              : 'Condivisione fallita'
        setError(detail)
        return false
      } finally {
        setIsLoading(false)
      }
    },
    []
  )

  /**
   * Decifra i nomi di una lista di file (name_encrypted cifrato con fileKey).
   * Usa la chiave privata in sessione.
   */
  const decryptFileNames = useCallback(
    async (
      files: { id: string; name_encrypted: string }[]
    ): Promise<Record<string, string>> => {
      console.log('[DECRYPT NAMES] sessionPrivateKey:', !!sessionPrivateKey)
      console.log('[DECRYPT NAMES] files count:', files?.length)
      if (!user) return {}
      const privateKey = sessionPrivateKey
      if (!privateKey) {
        console.log('[DECRYPT NAMES] Skip: no session key')
        setError('Sessione chiave non attiva')
        return {}
      }
      const results: Record<string, string> = {}
      for (const file of files) {
        try {
          console.log('[DECRYPT NAME] file.id:', file.id)
          const keyResp = await filesApi.getKey(file.id)
          console.log('[DECRYPT NAME] keyResp:', keyResp.data)

          const fileKey = await decryptFileKeyWithRSA(
            keyResp.data.file_key_encrypted,
            privateKey
          )
          console.log('[DECRYPT NAME] fileKey decifrata OK')

          const nameBytes = base64ToBytes(file.name_encrypted)
          const decrypted = await decryptFileChunked(nameBytes, fileKey, user.id)
          const decoded = new TextDecoder().decode(decrypted)
          console.log('[DECRYPT NAME] nome decifrato:', decoded)

          results[file.id] = decoded
        } catch (err) {
          console.error('[DECRYPT NAME] ERRORE file', file.id, err)
          results[file.id] = `File ${file.id.substring(0, 8)}…`
        }
      }
      return results
    },
    [user, sessionPrivateKey]
  )

  /**
   * Decifra i nomi di una lista di cartelle (name_encrypted cifrato con folderKey).
   * Usa foldersApi.getKey e la chiave privata in sessione.
   */
  const decryptFolderNames = useCallback(
    async (
      folders: { id: string; name_encrypted: string }[]
    ): Promise<Record<string, string>> => {
      if (!user) return {}
      const privateKey = sessionPrivateKey
      if (!privateKey) {
        setError('Sessione chiave non attiva')
        return {}
      }
      const results: Record<string, string> = {}
      for (const folder of folders) {
        try {
          const keyResp = await foldersApi.getKey(folder.id)
          const folderKey = await decryptFileKeyWithRSA(
            keyResp.data.folder_key_encrypted,
            privateKey
          )
          const nameBytes = base64ToBytes(folder.name_encrypted)
          const decrypted = await decryptFileChunked(nameBytes, folderKey, user.id)
          results[folder.id] = new TextDecoder().decode(decrypted)
        } catch (err) {
          console.error('[DECRYPT FOLDER NAME]', folder.id, err)
          results[folder.id] = `Cartella ${folder.id.substring(0, 8)}…`
        }
      }
      return results
    },
    [user, sessionPrivateKey]
  )

  const decryptFileNamesAndKeys = useCallback(
    async (
      files: { id: string; name_encrypted: string }[]
    ): Promise<{ names: Record<string, string>; keysBase64: Record<string, string> }> => {
      if (!user) return { names: {}, keysBase64: {} }
      const privateKey = sessionPrivateKey
      if (!privateKey) return { names: {}, keysBase64: {} }
      const alg = (privateKey as { algorithm?: { modulusLength?: number } }).algorithm
      console.log('[RSA DECRYPT] privateKey.algorithm.modulusLength:', alg?.modulusLength)
      const names: Record<string, string> = {}
      const keysBase64: Record<string, string> = {}
      for (const file of files) {
        try {
          const keyResp = await filesApi.getKey(file.id)
          // decryptFileKeyWithRSA restituisce già i 32 bytes (Uint8Array), non un CryptoKey
          const fileKeyBytes = await decryptFileKeyWithRSA(
            keyResp.data.file_key_encrypted,
            privateKey
          )
          keysBase64[file.id] = bytesToBase64(fileKeyBytes)

          const nameBytes = base64ToBytes(file.name_encrypted)
          const decrypted = await decryptFileChunked(nameBytes, fileKeyBytes, user.id)
          names[file.id] = new TextDecoder().decode(decrypted)
        } catch (e) {
          console.warn('[DECRYPT] decryptFileNamesAndKeys error for', file.id, e)
          names[file.id] = `File ${file.id.substring(0, 8)}…`
          // keysBase64[file.id] già impostato sopra se siamo arrivati a exportKey
        }
      }
      console.log('[DECRYPT] keysBase64 keys:', Object.keys(keysBase64))
      if (Object.keys(keysBase64).length > 0) {
        const [firstId, firstB64] = Object.entries(keysBase64)[0] ?? []
        console.log('[DECRYPT] keysBase64 sample:', firstId, firstB64?.length, 'chars')
      }
      return { names, keysBase64 }
    },
    [user, sessionPrivateKey]
  )

  /** Cifra un nuovo nome file con la DEK del file (per rinomina). Restituisce name_encrypted in base64. */
  const encryptFileNameForRename = useCallback(
    async (fileId: string, newPlainName: string): Promise<string | null> => {
      if (!user?.id || !sessionPrivateKey || !newPlainName.trim()) return null
      try {
        const keyResp = await filesApi.getKey(fileId)
        const fileKey = await decryptFileKeyWithRSA(
          keyResp.data.file_key_encrypted,
          sessionPrivateKey
        )
        const nameEncrypted = await encryptFileChunked(
          new TextEncoder().encode(newPlainName.trim()),
          fileKey,
          user.id
        )
        return bytesToBase64(new Uint8Array(nameEncrypted))
      } catch {
        return null
      }
    },
    [user, sessionPrivateKey]
  )

  return {
    isLoading,
    error,
    uploadFile,
    uploadNewVersion,
    downloadAndDecrypt,
    downloadVersionAndDecrypt,
    decryptFileNames,
    decryptFolderNames,
    decryptFileNamesAndKeys,
    encryptFileNameForRename,
    shareFile,
    clearError,
  }
}
