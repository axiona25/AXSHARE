'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/hooks/useAuth'
import { useKeySetup } from '@/hooks/useUser'

export default function LoginPage() {
  const router = useRouter()
  const { startLogin, loginWithPasskey, verifyTOTP, isLoading, error, clearError, requiresTOTP, pendingEmail } = useAuth()
  const { hasKeys } = useKeySetup()

  const [email, setEmail] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [step, setStep] = useState<'credentials' | 'totp'>('credentials')

  useEffect(() => {
    if (requiresTOTP) setStep('totp')
  }, [requiresTOTP])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    clearError()

    const success = await startLogin(email)

    if (success) {
      const has = await hasKeys()
      router.push(has ? '/dashboard' : '/setup-keys')
    }
  }

  async function handleTotpSubmit(e: React.FormEvent) {
    e.preventDefault()
    clearError()
    const ok = await verifyTOTP(totpCode)
    if (ok) {
      const has = await hasKeys()
      router.push(has ? '/dashboard' : '/setup-keys')
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
              const has = await hasKeys()
              router.push(has ? '/dashboard' : '/setup-keys')
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
    </main>
  )
}
