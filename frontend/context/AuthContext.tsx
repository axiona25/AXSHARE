/**
 * Context globale per stato autenticazione.
 * Fornisce: user, isLoading, login, logout, refreshUser.
 * NON contiene UI — solo stato e logica.
 */

'use client'

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react'
import type { User } from '@/types'
import { usersApi } from '@/lib/api'
import { keyManager } from '@/lib/keyManager'
import { initSentry } from '@/lib/sentry'
import {
  getAccessTokenSecure,
  isTokenExpired,
  saveTokensSecure,
  clearTokensSecure,
} from '@/lib/auth'
import { isRunningInTauri } from '@/lib/tauri'

interface AuthContextValue {
  user: User | null
  isLoading: boolean
  isAuth: boolean
  sessionPrivateKey: CryptoKey | null
  hasSessionKey: boolean
  unlockPrivateKey: (passphrase: string) => Promise<boolean>
  /** Imposta la chiave di sessione (es. dopo sblocco con PIN). */
  setSessionKey: (key: CryptoKey | null) => void
  /** Chiude solo la sessione chiave (senza logout). Per "Blocca sessione" dal tray. */
  clearSessionKey: () => void
  login: (accessToken: string, refreshToken?: string) => Promise<void>
  logout: () => void
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [sessionPrivateKey, setSessionPrivateKey] = useState<CryptoKey | null>(null)

  const refreshUser = useCallback(async () => {
    console.log('[AUTH] refreshUser start')
    try {
      const token = await getAccessTokenSecure()
      console.log('[AUTH] token presente:', !!token)

      if (!token) {
        console.log('[AUTH] Nessun token, set user null')
        setUser(null)
        setIsLoading(false)
        return
      }

      const expired = isTokenExpired(token)
      console.log('[AUTH] isTokenExpired:', expired)

      if (expired) {
        console.log('[AUTH] Token scaduto, esco')
        setUser(null)
        setIsLoading(false)
        return
      }

      console.log('[AUTH] Chiamo getMe()...')
      const getMeWithTimeout = Promise.race([
        usersApi.getMe(),
        new Promise<never>((_, reject) =>
          setTimeout(() => {
            console.warn('[AUTH] getMe timeout (30s)')
            reject(new Error('getMe timeout'))
          }, 30000)
        ),
      ])

      const response = await getMeWithTimeout
      console.log('[AUTH] getMe risposta:', response.data?.email)
      setUser(response.data)
    } catch (err: unknown) {
      console.error('[AUTH] refreshUser error:', err)
      const status = (err as { response?: { status?: number } })?.response?.status
      setUser(null)
      if (status === 401) {
        // Token rifiutato dal backend; non cancellare token (es. dev monouso)
      } else {
        await clearTokensSecure()
      }
    } finally {
      console.log('[AUTH] setIsLoading(false)')
      setIsLoading(false)
    }
  }, [])

  const login = useCallback(
    async (accessToken: string, refreshToken?: string) => {
      await saveTokensSecure(accessToken, refreshToken)
      await refreshUser()
    },
    [refreshUser]
  )

  const unlockPrivateKey = useCallback(
    async (passphrase: string): Promise<boolean> => {
      if (!user) return false
      try {
        const key = await keyManager.getPrivateKey(user.id, passphrase)
        if (!key) return false
        setSessionPrivateKey(key)
        return true
      } catch {
        return false
      }
    },
    [user]
  )

  const hasSessionKey = sessionPrivateKey !== null

  const setSessionKey = useCallback((key: CryptoKey | null) => {
    setSessionPrivateKey(key)
  }, [])

  const clearSessionKey = useCallback(() => {
    setSessionPrivateKey(null)
  }, [])

  const logout = useCallback(async () => {
    if (isRunningInTauri()) {
      try {
        console.log('[LOGOUT] Chiamo unmount_virtual_disk...')
        const { invoke } = await import('@tauri-apps/api/core')
        await invoke('unmount_virtual_disk')
        console.log('[LOGOUT] unmount_virtual_disk completato')
      } catch {
        /* ignora */
      }
    }
    await clearTokensSecure()
    setUser(null)
    setSessionPrivateKey(null)
  }, [])

  useEffect(() => {
    refreshUser()
  }, [refreshUser])

  useEffect(() => {
    initSentry()
  }, [])

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuth: !!user,
        sessionPrivateKey,
        hasSessionKey,
        unlockPrivateKey,
        setSessionKey,
        clearSessionKey,
        login,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuthContext deve essere usato dentro AuthProvider')
  return ctx
}
