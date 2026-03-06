'use client'

import { useState, useCallback } from 'react'
import useSWR from 'swr'
import { guestApi, type GuestSessionData } from '@/lib/api'

export function useGuestSessions() {
  const [isInviting, setIsInviting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data, isLoading, mutate } = useSWR(
    '/guest/sessions',
    () => guestApi.listSessions().then((r) => r.data),
    { revalidateOnFocus: false }
  )

  const inviteGuest = useCallback(
    async (params: {
      guestEmail: string
      fileIds: string[]
      fileKeysEncrypted?: string[]
      expiresInHours?: number
      label?: string
      canDownload?: boolean
      canPreview?: boolean
    }): Promise<(GuestSessionData & { invite_token?: string }) | null> => {
      setIsInviting(true)
      setError(null)
      try {
        const resp = await guestApi.createInvite({
          guest_email: params.guestEmail,
          file_ids: params.fileIds,
          file_keys_encrypted: params.fileKeysEncrypted,
          expires_in_hours: params.expiresInHours ?? 48,
          label: params.label,
          can_download: params.canDownload ?? true,
          can_preview: params.canPreview ?? true,
        })
        await mutate()
        return resp.data
      } catch (e: unknown) {
        const err = e as { response?: { data?: { detail?: string } }; detail?: string; message?: string }
        setError(err?.response?.data?.detail ?? err?.detail ?? (err?.message as string) ?? 'Errore invito guest')
        return null
      } finally {
        setIsInviting(false)
      }
    },
    [mutate]
  )

  const revokeSession = useCallback(
    async (sessionId: string): Promise<boolean> => {
      try {
        await guestApi.revokeSession(sessionId)
        await mutate()
        return true
      } catch (e: unknown) {
        const err = e as { message?: string }
        setError(err?.message ?? 'Errore revoca sessione')
        return false
      }
    },
    [mutate]
  )

  const sessions = data ?? []
  const activeSessions = sessions.filter(
    (s: GuestSessionData) => s.is_active && new Date(s.expires_at) > new Date()
  )
  const expiredSessions = sessions.filter(
    (s: GuestSessionData) => !s.is_active || new Date(s.expires_at) <= new Date()
  )

  return {
    sessions,
    activeSessions,
    expiredSessions,
    isLoading,
    isInviting,
    error,
    inviteGuest,
    revokeSession,
    clearError: () => setError(null),
  }
}
