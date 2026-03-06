/**
 * Hook per autenticazione WebAuthn + TOTP.
 * Gestisce il flusso completo di login/registrazione.
 * NON contiene UI — restituisce stato e handlers.
 */

'use client'

import { useState, useCallback } from 'react'
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser'
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser'
import { authApi } from '@/lib/api'
import { useAuthContext } from '@/context/AuthContext'

export interface PasskeyCredential {
  id: string
  display_name: string
  created_at?: string
  last_used_at?: string | null
  aaguid?: string
}

interface UseAuthReturn {
  isLoading: boolean
  error: string | null
  requiresTOTP: boolean
  pendingEmail: string | null
  startRegistration: (email: string) => Promise<boolean>
  startLogin: (email: string) => Promise<boolean>
  registerPasskey: (displayName?: string) => Promise<boolean>
  loginWithPasskey: (email: string) => Promise<boolean>
  getPasskeys: () => Promise<PasskeyCredential[]>
  removePasskey: (credentialId: string) => Promise<boolean>
  setupTOTP: () => Promise<{ secret: string; qr_uri: string } | null>
  verifyTOTP: (code: string) => Promise<boolean>
  logout: () => void
  clearError: () => void
}

export function useAuth(): UseAuthReturn {
  const { user, login, logout: ctxLogout, refreshUser } = useAuthContext()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [requiresTOTP, setRequiresTOTP] = useState(false)
  const [pendingEmail, setPendingEmail] = useState<string | null>(null)

  const clearError = useCallback(() => setError(null), [])

  const startRegistration = useCallback(async (email: string): Promise<boolean> => {
    setIsLoading(true)
    setError(null)
    try {
      const { data: options } = await authApi.webauthnRegisterBegin(email)
      const { startRegistration: browserStartReg } = await import(
        '@simplewebauthn/browser'
      )
      const credential = await browserStartReg({
        optionsJSON: options as PublicKeyCredentialCreationOptionsJSON,
      })
      await authApi.webauthnRegisterComplete(email, credential)
      return true
    } catch (err: unknown) {
      const detail =
        err && typeof err === 'object' && 'detail' in err
          ? String((err as { detail: unknown }).detail)
          : err instanceof Error
            ? err.message
            : 'Registrazione fallita'
      setError(detail)
      return false
    } finally {
      setIsLoading(false)
    }
  }, [])

  const startLogin = useCallback(
    async (email: string): Promise<boolean> => {
      setIsLoading(true)
      setError(null)
      setPendingEmail(email)
      try {
        const { data: options } = await authApi.webauthnAuthBegin(email)
        const { startAuthentication } = await import('@simplewebauthn/browser')
        const credential = await startAuthentication({
          optionsJSON: options as PublicKeyCredentialRequestOptionsJSON,
        })
        const { data: tokens } = await authApi.webauthnAuthComplete(
          email,
          credential
        )
        await login(tokens.access_token)
        setPendingEmail(null)
        return true
      } catch (err: unknown) {
        const detail =
          err && typeof err === 'object' && 'detail' in err
            ? String((err as { detail: unknown }).detail)
            : ''
        if (typeof detail === 'string' && detail.includes('TOTP')) {
          setRequiresTOTP(true)
          return false
        }
        setError(
          detail ||
            (err instanceof Error ? err.message : 'Login fallito')
        )
        return false
      } finally {
        setIsLoading(false)
      }
    },
    [login]
  )

  const setupTOTP = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const { data } = await authApi.totpSetup()
      return data
    } catch (err: unknown) {
      const detail =
        err && typeof err === 'object' && 'detail' in err
          ? String((err as { detail: unknown }).detail)
          : 'Setup TOTP fallito'
      setError(detail)
      return null
    } finally {
      setIsLoading(false)
    }
  }, [])

  const verifyTOTP = useCallback(async (code: string): Promise<boolean> => {
    setIsLoading(true)
    setError(null)
    try {
      await authApi.totpVerify(code)
      setRequiresTOTP(false)
      return true
    } catch (err: unknown) {
      const detail =
        err && typeof err === 'object' && 'detail' in err
          ? String((err as { detail: unknown }).detail)
          : 'Codice TOTP non valido'
      setError(detail)
      return false
    } finally {
      setIsLoading(false)
    }
  }, [])

  const registerPasskey = useCallback(async (displayName?: string): Promise<boolean> => {
    if (!user?.email) {
      setError('Devi essere autenticato per aggiungere una passkey')
      return false
    }
    setIsLoading(true)
    setError(null)
    try {
      const { data: options } = await authApi.webauthnRegisterBegin(user.email, displayName)
      const { startRegistration } = await import('@simplewebauthn/browser')
      const credential = await startRegistration({
        optionsJSON: options as PublicKeyCredentialCreationOptionsJSON,
      })
      await authApi.webauthnRegisterComplete(user.email, credential)
      return true
    } catch (err: unknown) {
      const detail =
        err && typeof err === 'object' && 'detail' in err
          ? String((err as { detail: unknown }).detail)
          : err instanceof Error ? err.message : 'Registrazione passkey fallita'
      setError(detail)
      return false
    } finally {
      setIsLoading(false)
    }
  }, [user?.email])

  const loginWithPasskey = useCallback(
    async (email: string): Promise<boolean> => {
      setIsLoading(true)
      setError(null)
      setPendingEmail(email)
      try {
        const { data: options } = await authApi.webauthnAuthBegin(email)
        const { startAuthentication } = await import('@simplewebauthn/browser')
        const credential = await startAuthentication({
          optionsJSON: options as PublicKeyCredentialRequestOptionsJSON,
        })
        const { data } = await authApi.webauthnAuthComplete(email, credential)
        const token = (data as { access_token?: string })?.access_token
        if (token) {
          await login(token)
          await refreshUser()
          setPendingEmail(null)
          return true
        }
        return false
      } catch (err: unknown) {
        const detail =
          err && typeof err === 'object' && 'detail' in err
            ? String((err as { detail: unknown }).detail)
            : ''
        if (typeof detail === 'string' && detail.includes('TOTP')) {
          setRequiresTOTP(true)
          return false
        }
        setError(detail || (err instanceof Error ? err.message : 'Login con passkey fallito'))
        return false
      } finally {
        setIsLoading(false)
      }
    },
    [login, refreshUser]
  )

  const getPasskeys = useCallback(async (): Promise<PasskeyCredential[]> => {
    try {
      const { data } = await authApi.getWebAuthnCredentials()
      return data?.credentials ?? []
    } catch {
      return []
    }
  }, [])

  const removePasskey = useCallback(async (credentialId: string): Promise<boolean> => {
    try {
      await authApi.deleteWebAuthnCredential(credentialId)
      return true
    } catch {
      return false
    }
  }, [])

  const logout = useCallback(() => {
    ctxLogout()
    setPendingEmail(null)
    setRequiresTOTP(false)
    setError(null)
  }, [ctxLogout])

  return {
    isLoading,
    error,
    requiresTOTP,
    pendingEmail,
    startRegistration,
    startLogin,
    registerPasskey,
    loginWithPasskey,
    getPasskeys,
    removePasskey,
    setupTOTP,
    verifyTOTP,
    logout,
    clearError,
  }
}
