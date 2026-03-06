'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/hooks/useAuth'
import { useAuthContext } from '@/context/AuthContext'
import { authApi } from '@/lib/api'
import { saveTokens, saveTokensSecure } from '@/lib/auth'
import { isRunningInTauri } from '@/lib/tauri'

export default function LoginPage() {
  const router = useRouter()
  const { refreshUser } = useAuthContext()
  const { startLogin, loginWithPasskey, verifyTOTP, isLoading, error, clearError, requiresTOTP, pendingEmail } = useAuth()

  const [email, setEmail] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [step, setStep] = useState<'credentials' | 'totp'>('credentials')

  const [devEmail, setDevEmail] = useState('')
  const [devPassword, setDevPassword] = useState('')
  const [devError, setDevError] = useState('')
  const [devLoading, setDevLoading] = useState(false)
  const isDev = process.env.NODE_ENV === 'development'

  useEffect(() => {
    if (requiresTOTP) setStep('totp')
  }, [requiresTOTP])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    clearError()

    const success = await startLogin(email)

    if (success) {
      await refreshUser()
      router.push('/dashboard')
    }
  }

  async function handleTotpSubmit(e: React.FormEvent) {
    e.preventDefault()
    clearError()
    const ok = await verifyTOTP(totpCode)
    if (ok) {
      await refreshUser()
      router.push('/dashboard')
    }
  }

  async function handleDevLogin(e: React.FormEvent) {
    e.preventDefault()
    setDevError('')
    setDevLoading(true)
    try {
      console.log('[DEV LOGIN] isTauri:', isRunningInTauri())
      console.log('[DEV LOGIN] window.__TAURI__:', typeof window !== 'undefined' ? !!(window as { __TAURI__?: unknown }).__TAURI__ : 'SSR')
      const { data } = await authApi.devLogin(devEmail, devPassword)
      if (!data.access_token) {
        setDevError('Nessun token ricevuto.')
        return
      }
      // Salva token (in Tauri usa lo stesso store che legge getAccessTokenSecure)
      await saveTokensSecure(data.access_token, data.refresh_token)
      console.log('[DEV LOGIN] Token in localStorage:', typeof window !== 'undefined' ? localStorage.getItem('axshare_access_token')?.substring(0, 20) : 'N/A')
      await refreshUser()
      // Redirect a dashboard: il layout reindirizza a /setup-keys se l'utente non ha ancora le chiavi
      router.push('/dashboard')
    } catch (err: unknown) {
      const ex = err as { response?: { data?: { detail?: string } }; message?: string }
      setDevError(ex?.response?.data?.detail ?? ex?.message ?? 'Login fallito.')
    } finally {
      setDevLoading(false)
    }
  }

  return (
    <main>
      <h1>AXSHARE</h1>
      <h2>Accedi al tuo account</h2>

      {error && (
        <p data-testid="error-message" role="alert">
          {error}
        </p>
      )}

      {step === 'credentials' && (
        <form onSubmit={handleSubmit} data-testid="login-form">
          <div>
            <label htmlFor="email">Email</label>
            <input
              id="email"
              data-testid="email-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="email@esempio.com"
            />
          </div>

          <button
            type="submit"
            data-testid="login-button"
            disabled={isLoading}
          >
            {isLoading ? 'Accesso in corso...' : 'Accedi'}
          </button>
        </form>
      )}

      {step === 'totp' && (
        <form onSubmit={handleTotpSubmit} data-testid="totp-form">
          <p>Inserisci il codice dalla tua app autenticatore.</p>
          {pendingEmail && (
            <p data-testid="totp-pending-email">{pendingEmail}</p>
          )}
          <div>
            <label htmlFor="totp">Codice TOTP</label>
            <input
              id="totp"
              data-testid="totp-input"
              type="text"
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value)}
              required
              maxLength={6}
              pattern="[0-9]{6}"
              placeholder="000000"
              autoComplete="one-time-code"
            />
          </div>
          <button type="submit" data-testid="totp-submit" disabled={isLoading}>
            {isLoading ? 'Verifica...' : 'Verifica'}
          </button>
          <button
            type="button"
            onClick={() => setStep('credentials')}
            data-testid="totp-back"
          >
            Torna indietro
          </button>
        </form>
      )}

      <hr />

      <section data-testid="passkey-login-section">
        <h3>Accedi con passkey</h3>
        <p>Usa la tua biometria o chiave di sicurezza hardware.</p>
        <button
          type="button"
          data-testid="passkey-login-button"
          onClick={async () => {
            clearError()
            if (!email.trim()) {
              return
            }
            const ok = await loginWithPasskey(email.trim())
            if (ok) {
              await refreshUser()
              router.push('/dashboard')
            }
          }}
          disabled={isLoading}
        >
          {isLoading ? 'In corso...' : 'Accedi con passkey'}
        </button>
      </section>

      <hr />
      <p>
        Non hai un account?{' '}
        <Link href="/register" data-testid="register-link">
          Registrati
        </Link>
      </p>

      {isDev && (
        <section data-testid="dev-login-section">
          <hr />
          <p>
            <strong>[DEV ONLY]</strong> Login diretto email + password
          </p>

          {devError && (
            <p data-testid="dev-error" role="alert" style={{ color: 'red' }}>
              {devError}
            </p>
          )}

          <form onSubmit={handleDevLogin} data-testid="dev-login-form">
            <div>
              <label htmlFor="dev-email">Email</label>
              <input
                id="dev-email"
                data-testid="dev-email-input"
                type="email"
                value={devEmail}
                onChange={(e) => setDevEmail(e.target.value)}
                required
                placeholder="user@test.com"
              />
            </div>
            <div>
              <label htmlFor="dev-password">Password</label>
              <input
                id="dev-password"
                data-testid="dev-password-input"
                type="password"
                value={devPassword}
                onChange={(e) => setDevPassword(e.target.value)}
                required
                placeholder="Test1234!"
              />
            </div>
            <button
              type="submit"
              data-testid="dev-login-button"
              disabled={devLoading}
            >
              {devLoading ? 'Login...' : '[DEV] Accedi con password'}
            </button>
          </form>

          <p>
            <small>
              Utenti test: user@test.com / Test1234! — admin@test.com / Admin1234!
            </small>
          </p>
        </section>
      )}
    </main>
  )
}
