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
import { initSentry } from '@/lib/sentry'
import {
  getAccessTokenSecure,
  isTokenExpired,
  saveTokensSecure,
  clearTokensSecure,
} from '@/lib/auth'

interface AuthContextValue {
  user: User | null
  isLoading: boolean
  isAuth: boolean
  login: (accessToken: string, refreshToken?: string) => Promise<void>
  logout: () => void
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const refreshUser = useCallback(async () => {
    const token = await getAccessTokenSecure()
    if (!token || isTokenExpired(token)) {
      setUser(null)
      setIsLoading(false)
      return
    }
    try {
      const response = await usersApi.getMe()
      setUser(response.data)
    } catch {
      setUser(null)
      await clearTokensSecure()
    } finally {
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

  const logout = useCallback(async () => {
    await clearTokensSecure()
    setUser(null)
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
