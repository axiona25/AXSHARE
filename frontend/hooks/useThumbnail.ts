'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import useSWR from 'swr'
import { useAuthContext } from '@/context/AuthContext'
import { thumbnailApi } from '@/lib/api'
import {
  bytesToHex,
  decryptFileKeyWithRSA,
  encryptFileKeyWithRSA,
  hexToBytes,
} from '@/lib/crypto'
import { decryptThumbnail } from '@/lib/thumbnail'
import { keyManager } from '@/lib/keyManager'

export interface UseThumbnailOptions {
  /** Passphrase per decifrare la chiave privata e mostrare la thumbnail. Se manca, hasThumb è true ma objectUrl resta null. */
  passphrase?: string | null
}

/**
 * Hook per generare e visualizzare thumbnail cifrate.
 * Gestisce: generazione, upload, download, decifratura, object URL.
 */
export function useThumbnail(
  fileId: string,
  options: UseThumbnailOptions = {}
) {
  const { passphrase } = options
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const { user } = useAuthContext()

  const { data: thumbData, error } = useSWR(
    fileId ? `/files/${fileId}/thumbnail` : null,
    () => thumbnailApi.get(fileId).then((r) => r.data).catch(() => null)
  )

  const objectUrlRef = useRef<string | null>(null)

  useEffect(() => {
    if (
      !thumbData?.thumbnail_encrypted ||
      !thumbData?.thumbnail_key_encrypted ||
      !user ||
      passphrase == null ||
      passphrase === ''
    ) {
      return
    }

    let cancelled = false
    ;(async () => {
      try {
        const privateKey = await keyManager.getPrivateKey(user.id, passphrase)
        const encKey = thumbData.thumbnail_key_encrypted
        if (!privateKey || cancelled || !encKey) return
        const keyBytes = await decryptFileKeyWithRSA(encKey, privateKey)
        const keyHex = bytesToHex(keyBytes)
        const url = await decryptThumbnail(
          thumbData.thumbnail_encrypted,
          keyHex
        )
        if (!cancelled) {
          if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
          objectUrlRef.current = url
          setObjectUrl(url)
        } else if (url) {
          URL.revokeObjectURL(url)
        }
      } catch (e) {
        console.error('Thumbnail decrypt error:', e)
      }
    })()

    return () => {
      cancelled = true
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current)
        objectUrlRef.current = null
      }
      setObjectUrl(null)
    }
  }, [thumbData, user, passphrase])

  const generateAndUpload = useCallback(
    async (file: File, userPassphrase: string): Promise<boolean> => {
      if (!user) return false
      setIsGenerating(true)
      try {
        const { generateThumbnail } = await import('@/lib/thumbnail')
        const result = await generateThumbnail(file)
        if (!result) return false

        const publicKeyPem = await keyManager.getPublicKeyPem(user.id)
        if (!publicKeyPem) throw new Error('Chiave pubblica non trovata')

        const thumbKeyBytes = hexToBytes(result.keyHex)
        const thumbKeyEncrypted = await encryptFileKeyWithRSA(
          thumbKeyBytes,
          publicKeyPem
        )

        await thumbnailApi.upload(
          fileId,
          result.encryptedBase64,
          thumbKeyEncrypted
        )
        return true
      } catch (e) {
        console.error('Thumbnail generate/upload error:', e)
        return false
      } finally {
        setIsGenerating(false)
      }
    },
    [fileId, user]
  )

  return {
    objectUrl,
    isGenerating,
    hasThumb: !!thumbData?.thumbnail_encrypted,
    error,
    generateAndUpload,
  }
}
