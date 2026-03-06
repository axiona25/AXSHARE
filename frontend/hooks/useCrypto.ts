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
} from '@/lib/crypto'
import { keyManager } from '@/lib/keyManager'
import type { UploadMetadata } from '@/types'

interface UploadOptions {
  file: File
  folderId?: string
  passphrase: string
}

interface UploadResult {
  fileId: string
  fileKeyHex: string
}

interface UseCryptoReturn {
  isLoading: boolean
  error: string | null
  uploadFile: (options: UploadOptions) => Promise<UploadResult | null>
  downloadAndDecrypt: (
    fileId: string,
    passphrase: string
  ) => Promise<Blob | null>
  shareFile: (
    fileId: string,
    recipientUserId: string,
    fileKeyHex: string
  ) => Promise<boolean>
  clearError: () => void
}

export function useCrypto(): UseCryptoReturn {
  const { user } = useAuthContext()
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
        const { file, folderId, passphrase } = options
        const plaintext = new Uint8Array(await file.arrayBuffer())

        const fileKey = await generateKey()
        const fileKeyHex = bytesToHex(fileKey)

        const fileIdAad = `${user.id}_${Date.now()}`
        const encrypted = await encryptFileChunked(
          plaintext,
          fileKey,
          fileIdAad
        )

        const nameKey = await generateKey()
        const nameEncrypted = await encryptFileChunked(
          new TextEncoder().encode(file.name),
          nameKey,
          user.id
        )
        const mimeEncrypted = await encryptFileChunked(
          new TextEncoder().encode(
            file.type || 'application/octet-stream'
          ),
          nameKey,
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

        const metadata: UploadMetadata = {
          name_encrypted: bytesToBase64(new Uint8Array(nameEncrypted)),
          mime_type_encrypted: bytesToBase64(new Uint8Array(mimeEncrypted)),
          file_key_encrypted: fileKeyEncrypted,
          encryption_iv: bytesToBase64(nonce),
          size: encrypted.byteLength,
          folder_id: folderId,
        }

        const blob = new Blob([encrypted as BlobPart], {
          type: 'application/octet-stream',
        })
        const { data } = await filesApi.upload(blob, metadata)

        return { fileId: data.file_id, fileKeyHex }
      } catch (err: unknown) {
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

  const downloadAndDecrypt = useCallback(
    async (
      fileId: string,
      passphrase: string
    ): Promise<Blob | null> => {
      if (!user) {
        setError('Non autenticato')
        return null
      }
      setIsLoading(true)
      setError(null)
      try {
        const [downloadResp, keyResp] = await Promise.all([
          filesApi.download(fileId),
          filesApi.getKey(fileId),
        ])

        const privateKey = await keyManager.getPrivateKey(
          user.id,
          passphrase
        )
        if (!privateKey)
          throw new Error('Chiave privata non disponibile')

        const fileKey = await decryptFileKeyWithRSA(
          keyResp.data.file_key_encrypted,
          privateKey
        )

        const encrypted = new Uint8Array(
          downloadResp.data as ArrayBuffer
        )
        const decrypted = await decryptFileChunked(
          encrypted,
          fileKey,
          fileId
        )

        return new Blob([decrypted as BlobPart])
      } catch (err: unknown) {
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
    [user]
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

  return {
    isLoading,
    error,
    uploadFile,
    downloadAndDecrypt,
    shareFile,
    clearError,
  }
}
