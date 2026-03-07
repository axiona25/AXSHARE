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
    <main className="ax-login-page">
      <div className="ax-login-bg">
        <div className="ax-login-orb ax-login-orb-1" aria-hidden />
        <div className="ax-login-orb ax-login-orb-2" aria-hidden />
        <div className="ax-login-orb ax-login-orb-3" aria-hidden />
        <div className="ax-login-grid" aria-hidden />
      </div>

      <div className="ax-login-card-wrap">
        <div className="ax-login-logo-area">
          <img
            src="/Logo.png"
            alt="AXSHARE"
            style={{ height: '64px', width: 'auto', objectFit: 'contain' }}
          />
          <div className="ax-login-logo-tagline">
            Condivisione sicura. End-to-end encrypted.
          </div>
        </div>

        <div className="ax-login-card">
          {step === 'credentials' && (
            <>
              <div className="ax-login-form-heading">Bentornato 👋</div>
              <div className="ax-login-form-subheading">
                Accedi al tuo account per continuare.
              </div>

              {isDev ? (
                <>
                  {devError && (
                    <p className="ax-login-error" data-testid="dev-error" role="alert">
                      {devError}
                    </p>
                  )}
                  <form onSubmit={handleDevLogin} data-testid="dev-login-form">
                    <div className="ax-login-field">
                      <label className="ax-login-field-label" htmlFor="dev-email">Email</label>
                      <input
                        id="dev-email"
                        className="ax-login-field-input"
                        data-testid="dev-email-input"
                        type="email"
                        value={devEmail}
                        onChange={(e) => setDevEmail(e.target.value)}
                        required
                        placeholder="nome@azienda.com"
                      />
                    </div>
                    <div className="ax-login-field">
                      <label className="ax-login-field-label" htmlFor="dev-password">Password</label>
                      <input
                        id="dev-password"
                        className="ax-login-field-input"
                        data-testid="dev-password-input"
                        type="password"
                        value={devPassword}
                        onChange={(e) => setDevPassword(e.target.value)}
                        required
                        placeholder="••••••••"
                      />
                    </div>
                    <button
                      type="submit"
                      className="ax-login-btn-primary"
                      data-testid="dev-login-button"
                      disabled={devLoading}
                    >
                      {devLoading ? 'Accesso in corso...' : 'Accedi'}
                    </button>
                  </form>
                </>
              ) : (
                <>
                  {error && (
                    <p className="ax-login-error" data-testid="error-message" role="alert">
                      {error}
                    </p>
                  )}
                  <form onSubmit={handleSubmit} data-testid="login-form">
                    <div className="ax-login-field">
                      <label className="ax-login-field-label" htmlFor="email">Email</label>
                      <input
                        id="email"
                        className="ax-login-field-input"
                        data-testid="email-input"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        autoComplete="email"
                        placeholder="nome@azienda.com"
                      />
                    </div>
                    <button
                      type="submit"
                      className="ax-login-btn-primary"
                      data-testid="login-button"
                      disabled={isLoading}
                    >
                      {isLoading ? 'Accesso in corso...' : 'Accedi'}
                    </button>
                  </form>
                </>
              )}

              <div className="ax-login-divider">
                <div className="ax-login-divider-line" />
                <span className="ax-login-divider-text">oppure continua con</span>
                <div className="ax-login-divider-line" />
              </div>

              <section data-testid="passkey-login-section">
                <p style={{ fontSize: 13, color: 'var(--ax-text-muted)', marginBottom: 12 }}>
                  Usa la tua biometria o chiave di sicurezza hardware.
                </p>
                <button
                  type="button"
                  className="ax-login-btn-social"
                  data-testid="passkey-login-button"
                  onClick={async () => {
                    clearError()
                    if (!email.trim()) return
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
            </>
          )}

          {step === 'totp' && (
            <form onSubmit={handleTotpSubmit} data-testid="totp-form">
              <div className="ax-login-form-heading">Verifica identità</div>
              <div className="ax-login-form-subheading">
                Inserisci il codice dalla tua app autenticatore.
              </div>
              {pendingEmail && (
                <p data-testid="totp-pending-email" style={{ fontSize: 13, color: 'var(--ax-text-muted)', marginBottom: 16 }}>
                  {pendingEmail}
                </p>
              )}
              <div className="ax-login-field">
                <label className="ax-login-field-label" htmlFor="totp">Codice TOTP</label>
                <input
                  id="totp"
                  className="ax-login-field-input"
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
              <button type="submit" className="ax-login-btn-primary" data-testid="totp-submit" disabled={isLoading}>
                {isLoading ? 'Verifica...' : 'Verifica'}
              </button>
              <button
                type="button"
                className="ax-login-btn-social"
                onClick={() => setStep('credentials')}
                data-testid="totp-back"
              >
                Torna indietro
              </button>
            </form>
          )}

          <div className="ax-login-card-footer">
            Non hai un account?{' '}
            <Link href="/register" data-testid="register-link">
              Registrati
            </Link>
          </div>

          <div className="ax-login-encrypt-badge">
            🔒 Crittografia end-to-end
          </div>
        </div>
      </div>
    </main>
  )
}
