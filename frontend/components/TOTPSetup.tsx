'use client'

import { useState } from 'react'
import { useAuth } from '@/hooks/useAuth'

export function TOTPSetup() {
  const { setupTOTP, verifyTOTP, isLoading, error, clearError } = useAuth()
  const [step, setStep] = useState<'idle' | 'setup' | 'verify' | 'done'>('idle')
  const [qrCode, setQrCode] = useState('')
  const [secret, setSecret] = useState('')
  const [code, setCode] = useState('')
  const [statusMsg, setStatusMsg] = useState('')

  async function handleSetup() {
    clearError?.()
    const result = await setupTOTP()
    if (result?.qr_uri) {
      setQrCode(result.qr_uri)
      setSecret(result.secret ?? '')
      setStep('setup')
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault()
    const ok = await verifyTOTP(code)
    if (ok) {
      setStep('done')
      setStatusMsg('Autenticazione a due fattori attivata.')
    }
  }

  return (
    <div data-testid="totp-setup">
      <h3>Autenticazione a due fattori (TOTP)</h3>

      {statusMsg && <p data-testid="totp-status">{statusMsg}</p>}
      {error && <p data-testid="totp-error" role="alert">{error}</p>}

      {step === 'idle' && (
        <div>
          <p>
            Attiva il secondo fattore con un&apos;app autenticatore
            (Google Authenticator, Authy, 1Password).
          </p>
          <button
            type="button"
            data-testid="setup-totp-button"
            onClick={handleSetup}
            disabled={isLoading}
          >
            Configura TOTP
          </button>
        </div>
      )}

      {step === 'setup' && qrCode && (
        <div data-testid="totp-qr-section">
          <p>Scansiona il QR code con la tua app autenticatore:</p>
          <img
            data-testid="totp-qr-code"
            src={qrCode}
            alt="QR code TOTP"
            width={200}
            height={200}
          />
          {secret && (
            <details>
              <summary>Mostra codice manuale</summary>
              <code data-testid="totp-secret">{secret}</code>
            </details>
          )}
          <form onSubmit={handleVerify} data-testid="verify-totp-form">
            <div>
              <label htmlFor="totp-verify">
                Inserisci il codice a 6 cifre per confermare
              </label>
              <input
                id="totp-verify"
                data-testid="totp-verify-input"
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                maxLength={6}
                pattern="[0-9]{6}"
                placeholder="000000"
                autoComplete="one-time-code"
              />
            </div>
            <button
              type="submit"
              data-testid="verify-totp-button"
              disabled={isLoading}
            >
              Verifica e attiva
            </button>
          </form>
        </div>
      )}

      {step === 'done' && (
        <p data-testid="totp-done">
          TOTP attivo. Usa l&apos;app autenticatore al prossimo login.
        </p>
      )}
    </div>
  )
}
