'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthContext } from '@/context/AuthContext'
import { useKeySetup } from '@/hooks/useUser'
import { useSigningSetup } from '@/hooks/useSigningSetup'
import { PasskeyManager } from '@/components/PasskeyManager'
import { TOTPSetup } from '@/components/TOTPSetup'
import PinSetup from '@/components/PinSetup'
import { usersApi } from '@/lib/api'
import { keyManager } from '@/lib/keyManager'

export default function SecuritySettingsPage() {
  const router = useRouter()
  const { user, refreshUser, setSessionKey } = useAuthContext()
  const { setupKeys, hasKeys, isLoading: keysLoading, error: keysError } = useKeySetup()
  const { setupSigningKey, hasSigningKey, isGenerating, error: signError } = useSigningSetup()

  const [encPassphrase, setEncPassphrase] = useState('')
  const [encConfirm, setEncConfirm] = useState('')
  const [signPassphrase, setSignPassphrase] = useState('')
  const [statusMsg, setStatusMsg] = useState('')
  const [showChangePinForm, setShowChangePinForm] = useState(false)
  const [regenerating, setRegenerating] = useState(false)

  async function handlePinSetup(pin: string) {
    if (!user?.email || !user?.id) throw new Error('Utente non trovato')
    await keyManager.generateAndStoreWithPin(user.id, user.email, pin)
    const { authApi } = await import('@/lib/api')
    await authApi.setPin(pin)
    const resp = await usersApi.getPrivateKey()
    const bundle = resp.data?.encrypted_private_key
    if (!bundle) throw new Error('Chiave privata non trovata')
    const privateKey = await keyManager.unlockWithPin(user.email, pin, bundle)
    setSessionKey(privateKey)
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem('axshare_session_pin', pin)
    }

    let retries = 3
    while (retries > 0) {
      try {
        await refreshUser()
        break
      } catch {
        retries--
        if (retries === 0) throw new Error('Impossibile aggiornare utente')
        await new Promise((r) => setTimeout(r, 2000))
      }
    }
  }

  async function handleRegenerateKeys() {
    if (!user) return
    setRegenerating(true)
    setStatusMsg('')
    try {
      await usersApi.deleteKeys()
      await keyManager.clearAll()
      await refreshUser()
      setStatusMsg('Chiavi eliminate. Configura di nuovo il PIN qui sotto.')
      setShowChangePinForm(false)
    } catch (e) {
      console.error('[SECURITY] Rigenera chiavi:', e)
      setStatusMsg('Errore durante il reset delle chiavi.')
    } finally {
      setRegenerating(false)
    }
  }

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

      <section data-testid="pin-security-section">
        <h2>🔐 PIN di sicurezza</h2>
        <p style={{ marginBottom: 16 }}>
          Il PIN protegge le tue chiavi crittografiche. È un secondo fattore dopo il login con email e password.
        </p>

        {!user?.has_public_key || showChangePinForm ? (
          <div>
            <p>Configura un PIN di 8 caratteri (lettere, numeri e simboli) per proteggere i tuoi file.</p>
            <PinSetup
              mode="setup"
              email={user?.email ?? ''}
              onComplete={async (pin) => {
                await handlePinSetup(pin)
                setShowChangePinForm(false)
              }}
            />
          </div>
        ) : (
          <div>
            <p>✅ PIN configurato</p>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button
                type="button"
                onClick={() => setShowChangePinForm(true)}
                data-testid="change-pin-button"
              >
                Cambia PIN
              </button>
              <button
                type="button"
                onClick={handleRegenerateKeys}
                disabled={regenerating}
                data-testid="regenerate-keys-button"
              >
                {regenerating ? 'Reset in corso...' : 'Rigenera chiavi'}
              </button>
            </div>
          </div>
        )}
      </section>

      <hr />

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
