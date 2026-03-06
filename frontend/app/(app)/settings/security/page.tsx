'use client'

import { useState } from 'react'
import { useKeySetup } from '@/hooks/useUser'
import { useSigningSetup } from '@/hooks/useSigningSetup'
import { PasskeyManager } from '@/components/PasskeyManager'
import { TOTPSetup } from '@/components/TOTPSetup'

export default function SecuritySettingsPage() {
  const { setupKeys, hasKeys, isLoading: keysLoading, error: keysError } = useKeySetup()
  const { setupSigningKey, hasSigningKey, isGenerating, error: signError } = useSigningSetup()

  const [encPassphrase, setEncPassphrase] = useState('')
  const [encConfirm, setEncConfirm] = useState('')
  const [signPassphrase, setSignPassphrase] = useState('')
  const [statusMsg, setStatusMsg] = useState('')

  async function handleSetupEncKeys(e: React.FormEvent) {
    e.preventDefault()
    if (encPassphrase !== encConfirm) {
      setStatusMsg('Le passphrase non coincidono.')
      return
    }
    const ok = await setupKeys(encPassphrase)
    setStatusMsg(ok ? 'Chiavi di cifratura generate.' : 'Errore.')
    setEncPassphrase('')
    setEncConfirm('')
  }

  async function handleSetupSigningKey(e: React.FormEvent) {
    e.preventDefault()
    const ok = await setupSigningKey(signPassphrase)
    setStatusMsg(ok ? 'Chiave di firma generata.' : 'Errore.')
    setSignPassphrase('')
  }

  return (
    <div>
      <h1>Sicurezza e chiavi</h1>

      {statusMsg && (
        <p data-testid="status-message">{statusMsg}</p>
      )}

      <section data-testid="encryption-keys-section">
        <h2>Chiavi di cifratura (RSA-OAEP)</h2>
        <p>
          Usate per cifrare e decifrare i tuoi file.
          La chiave privata non lascia mai il tuo dispositivo.
        </p>

        {keysError && (
          <p data-testid="keys-error" role="alert">{keysError}</p>
        )}

        <form onSubmit={handleSetupEncKeys} data-testid="setup-enc-keys-form">
          <div>
            <label htmlFor="enc-passphrase">Passphrase</label>
            <input
              id="enc-passphrase"
              data-testid="enc-passphrase-input"
              type="password"
              value={encPassphrase}
              onChange={(e) => setEncPassphrase(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
          </div>
          <div>
            <label htmlFor="enc-confirm">Conferma passphrase</label>
            <input
              id="enc-confirm"
              data-testid="enc-confirm-input"
              type="password"
              value={encConfirm}
              onChange={(e) => setEncConfirm(e.target.value)}
              required
              autoComplete="new-password"
            />
          </div>
          <button
            type="submit"
            data-testid="setup-enc-keys-button"
            disabled={keysLoading}
          >
            {keysLoading ? 'Generazione...' : 'Genera / rigenera chiavi di cifratura'}
          </button>
        </form>
      </section>

      <hr />

      <section data-testid="signing-key-section">
        <h2>Chiave di firma digitale (RSA-PSS)</h2>
        <p>
          Usata per firmare i file. La firma garantisce l&apos;autenticità e
          l&apos;integrità del file.
        </p>
        <p data-testid="signing-key-status">
          Stato: {hasSigningKey ? 'Configurata' : 'Non configurata'}
        </p>

        {signError && (
          <p data-testid="sign-error" role="alert">{signError}</p>
        )}

        <form onSubmit={handleSetupSigningKey} data-testid="setup-signing-form">
          <div>
            <label htmlFor="sign-passphrase">Passphrase per la chiave firma</label>
            <input
              id="sign-passphrase"
              data-testid="sign-passphrase-input"
              type="password"
              value={signPassphrase}
              onChange={(e) => setSignPassphrase(e.target.value)}
              required
              autoComplete="new-password"
            />
          </div>
          <button
            type="submit"
            data-testid="setup-signing-button"
            disabled={isGenerating}
          >
            {isGenerating ? 'Generazione...' : 'Genera chiave firma'}
          </button>
        </form>
      </section>

      <hr />

      <section data-testid="webauthn-section">
        <PasskeyManager />
      </section>

      <hr />

      <section data-testid="totp-section">
        <TOTPSetup />
      </section>
    </div>
  )
}
