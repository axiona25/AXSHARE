'use client'

import { useState, useCallback, useEffect } from 'react'
import { shareLinksApi, type PublicShareInfo } from '@/lib/api'

type PublicShareStatus = 'loading' | 'ready' | 'expired' | 'revoked' | 'not_found'

/**
 * Hook per la pagina pubblica di download (/share/[token]).
 * Non richiede autenticazione.
 */
export function usePublicShare(token: string) {
  const [info, setInfo] = useState<PublicShareInfo | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isDownloading, setIsDownloading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<PublicShareStatus>('loading')

  useEffect(() => {
    if (!token) return
    shareLinksApi
      .getPublicInfo(token)
      .then((r) => {
        setInfo(r.data)
        setStatus('ready')
      })
      .catch((e: unknown) => {
        const err = e as { response?: { status?: number; data?: { detail?: string } }; message?: string }
        const code = err?.response?.status
        if (code === 404) setStatus('not_found')
        else if (code === 410) {
          const detail = err?.response?.data?.detail ?? ''
          if (typeof detail === 'string' && detail.includes('scaduto')) setStatus('expired')
          else setStatus('revoked')
        } else {
          setError(err?.message ?? 'Errore')
          setStatus('not_found')
        }
      })
      .finally(() => setIsLoading(false))
  }, [token])

  const download = useCallback(
    async (
      password?: string
    ): Promise<{
      nameEncrypted: string
      fileKeyEncryptedForLink: string | null
      encryptionIv: string
      sizeBytes: number
    } | null> => {
      setIsDownloading(true)
      setError(null)
      try {
        const resp = await shareLinksApi.downloadViaLink(token, password)
        return {
          nameEncrypted: resp.data.name_encrypted,
          fileKeyEncryptedForLink: resp.data.file_key_encrypted_for_link ?? null,
          encryptionIv: resp.data.encryption_iv,
          sizeBytes: resp.data.size_bytes,
        }
      } catch (e: unknown) {
        const err = e as { response?: { status?: number }; message?: string }
        const code = err?.response?.status
        if (code === 401) setError('Password errata')
        else if (code === 410) setError('Link scaduto o limite raggiunto')
        else setError((err?.message as string) ?? 'Errore download')
        return null
      } finally {
        setIsDownloading(false)
      }
    },
    [token]
  )

  return {
    info,
    status,
    isLoading,
    isDownloading,
    error,
    download,
  }
}
