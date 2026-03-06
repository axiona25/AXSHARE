/**
 * Hook per profilo utente e setup chiavi.
 */

'use client'

import useSWR, { mutate } from 'swr'
import { useCallback, useState } from 'react'
import { usersApi } from '@/lib/api'
import { keyManager } from '@/lib/keyManager'
import { signingKeyManager } from '@/lib/signingKeys'
import { useAuthContext } from '@/context/AuthContext'
import type { User } from '@/types'

export function useUser() {
  const { user: authUser } = useAuthContext()
  const { data, error, isLoading } = useSWR<User>(
    authUser ? '/users/me' : null
  )
  return { user: data ?? authUser, isLoading, error }
}

export function useKeySetup() {
  const { user } = useAuthContext()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /**
   * Setup completo chiavi per nuovo utente:
   * 1. Genera keypair RSA-OAEP in IndexedDB + upload al server
   * 2. Genera keypair RSA-PSS per firma in IndexedDB + registrazione chiave firma al server
   */
  const setupKeys = useCallback(
    async (passphrase: string): Promise<boolean> => {
      if (!user) return false
      setIsLoading(true)
      setError(null)
      try {
        const publicKeyPem = await keyManager.generateAndStore(
          user.id,
          passphrase
        )
        await usersApi.uploadPublicKey(publicKeyPem)
        const signingPem = await signingKeyManager.generateAndStore(
          user.id,
          passphrase
        )
        await usersApi.registerSigningKey(signingPem)
        await mutate('/users/me')
        return true
      } catch (err: unknown) {
        const detail =
          err && typeof err === 'object' && 'detail' in err
            ? String((err as { detail: unknown }).detail)
            : err instanceof Error
              ? err.message
              : 'Setup chiavi fallito'
        setError(detail)
        return false
      } finally {
        setIsLoading(false)
      }
    },
    [user]
  )

  const hasKeys = useCallback(async (): Promise<boolean> => {
    if (!user) return false
    const hasOaep = await keyManager.hasKeys(user.id)
    const hasPss = await signingKeyManager.hasKeys(user.id)
    return hasOaep && hasPss
  }, [user])

  return { setupKeys, hasKeys, isLoading, error }
}
