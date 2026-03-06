'use client'

import { useState, useCallback } from 'react'
import useSWR from 'swr'
import { shareLinksApi, type ShareLinkData } from '@/lib/api'
import { encryptFileKeyWithRSA, hexToBytes } from '@/lib/crypto'

export interface CreateShareLinkOptions {
  password?: string
  expiresAt?: Date
  maxDownloads?: number
  label?: string
  fileKeyHex?: string
  recipientPublicKeyPem?: string
}

export function useShareLinks(fileId: string) {
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data, isLoading, mutate } = useSWR(
    fileId ? `/files/${fileId}/share-links` : null,
    () => shareLinksApi.list(fileId).then((r) => r.data),
    { revalidateOnFocus: false }
  )

  const createLink = useCallback(
    async (options: CreateShareLinkOptions = {}): Promise<ShareLinkData | null> => {
      setIsCreating(true)
      setError(null)
      try {
        let fileKeyEncryptedForLink: string | undefined

        if (options.fileKeyHex && options.recipientPublicKeyPem) {
          const keyBytes = hexToBytes(options.fileKeyHex)
          fileKeyEncryptedForLink = await encryptFileKeyWithRSA(
            keyBytes,
            options.recipientPublicKeyPem
          )
        }

        const resp = await shareLinksApi.create(fileId, {
          file_key_encrypted_for_link: fileKeyEncryptedForLink,
          password: options.password,
          expires_at: options.expiresAt?.toISOString(),
          max_downloads: options.maxDownloads,
          label: options.label,
        })

        await mutate()
        return resp.data
      } catch (e: unknown) {
        const err = e as { response?: { data?: { detail?: string } }; detail?: string; message?: string }
        setError(err?.response?.data?.detail ?? err?.detail ?? (err?.message as string) ?? 'Errore creazione link')
        return null
      } finally {
        setIsCreating(false)
      }
    },
    [fileId, mutate]
  )

  const revokeLink = useCallback(
    async (linkId: string): Promise<boolean> => {
      try {
        await shareLinksApi.revoke(linkId)
        await mutate()
        return true
      } catch (e: unknown) {
        const err = e as { message?: string }
        setError(err?.message ?? 'Errore revoca link')
        return false
      }
    },
    [mutate]
  )

  const copyLinkToClipboard = useCallback(async (shareUrl: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(shareUrl)
      return true
    } catch {
      return false
    }
  }, [])

  return {
    links: data ?? [],
    isLoading,
    isCreating,
    error,
    createLink,
    revokeLink,
    copyLinkToClipboard,
    clearError: () => setError(null),
  }
}
