'use client'

import { useState, useCallback, useEffect } from 'react'
import { signingKeyManager } from '@/lib/signingKeys'
import { usersApi } from '@/lib/api'
import { useAuthContext } from '@/context/AuthContext'

/**
 * Hook per setup iniziale keypair firma.
 * Usato nella schermata Profilo > Sicurezza.
 */
export function useSigningSetup() {
  const { user } = useAuthContext()
  const [hasSigningKey, setHasSigningKey] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    Promise.all([
      signingKeyManager.hasKeys(user.id),
      usersApi
        .getSigningKeyStatus()
        .then((r) => r.data.has_signing_key)
        .catch(() => false),
    ])
      .then(([local, server]) => {
        setHasSigningKey(local && server)
      })
      .finally(() => setIsLoading(false))
  }, [user])

  const setupSigningKey = useCallback(
    async (passphrase: string): Promise<boolean> => {
      if (!user) return false
      setIsGenerating(true)
      setError(null)
      try {
        const publicKeyPem = await signingKeyManager.generateAndStore(
          user.id,
          passphrase
        )
        await usersApi.registerSigningKey(publicKeyPem)
        setHasSigningKey(true)
        return true
      } catch (e: unknown) {
        const msg =
          e && typeof e === 'object' && 'message' in e
            ? String((e as { message: unknown }).message)
            : 'Errore generazione chiave firma'
        setError(msg)
        return false
      } finally {
        setIsGenerating(false)
      }
    },
    [user]
  )

  return { hasSigningKey, isLoading, isGenerating, error, setupSigningKey }
}
