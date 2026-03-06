'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useKeySetup } from '@/hooks/useUser'
import { useSigningSetup } from '@/hooks/useSigningSetup'
import {
  unlockVault,
  mountVirtualDiskWithPassphrase,
  isDesktop,
} from '@/lib/tauri'

type Step = 'welcome' | 'enc-keys' | 'sign-key' | 'vault' | 'done'

export default function DesktopOnboardingPage() {
  const router = useRouter()
  const { setupKeys, isLoading: keysLoading } = useKeySetup()
  const { setupSigningKey, isGenerating } = useSigningSetup()

  const [step, setStep] = useState<Step>('welcome')
  const [encPassphrase, setEnc] = useState('')
  const [encConfirm, setEncConfirm] = useState('')
  const [signPassphrase, setSign] = useState('')
  const [vaultPassphrase, setVault] = useState('')
  const [error, setError] = useState('')
  const [mountDisk, setMountDisk] = useState(false)

  async function handleEncKeys(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (encPassphrase !== encConfirm) {
      setError('Le passphrase non coincidono.')
      return
    }
    const ok = await setupKeys(encPassphrase)
    if (ok) setStep('sign-key')
    else setError('Errore generazione chiavi.')
  }

  async function handleSignKey(e: React.FormEvent) {
    e.preventDefault()
    await setupSigningKey(signPassphrase)
    setStep('vault')
  }

  async function handleVault(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (isDesktop()) {
      await unlockVault(vaultPassphrase)
      if (mountDisk) {
        try {
          await mountVirtualDiskWithPassphrase(vaultPassphrase)
        } catch {
          setError('Mount disco non riuscito. Verifica di essere autenticato.')
          return
        }
      }
    }
    setStep('done')
  }

  function handleDone() {
    if (typeof window !== 'undefined') {
      localStorage.setItem('desktop_onboarding_done', '1')
    }
    router.push('/dashboard')
  }

  return (
    <main data-testid="desktop-onboarding">
      <h1>Benvenuto in AXSHARE Desktop</h1>

      <nav data-testid="onboarding-steps">
        <span data-active={step === 'welcome'}>1. Benvenuto</span>
        {' → '}
        <span data-active={step === 'enc-keys'}>2. Chiavi cifratura</span>
        {' → '}
        <span data-active={step === 'sign-key'}>3. Chiave firma</span>
        {' → '}
        <span data-active={step === 'vault'}>4. Vault</span>
        {' → '}
        <span data-active={step === 'done'}>5. Completato</span>
      </nav>

      <hr />

      {error && (
        <p data-testid="onboarding-error" role="alert">
          {error}
        </p>
      )}

      {step === 'welcome' && (
        <section data-testid="step-welcome">
          <h2>Configurazione iniziale</h2>
          <p>AXSHARE Desktop usa crittografia end-to-end. Dovrai configurare:</p>
          <ol>
            <li>Chiavi di cifratura file (RSA-OAEP)</li>
            <li>Chiave di firma digitale (RSA-PSS)</li>
            <li>Vault locale per le chiavi</li>
          </ol>
          <p>
            <strong>
              Conserva le passphrase in un posto sicuro. Se le perdi non puoi
              recuperare i tuoi file.
            </strong>
          </p>
          <button
            type="button"
            data-testid="start-onboarding-button"
            onClick={() => setStep('enc-keys')}
          >
            Inizia configurazione
          </button>
        </section>
      )}

      {step === 'enc-keys' && (
        <section data-testid="step-enc-keys">
          <h2>Chiavi di cifratura</h2>
          <p>Usate per cifrare e decifrare i tuoi file.</p>
          <form onSubmit={handleEncKeys} data-testid="enc-keys-form">
            <div>
              <label htmlFor="enc-passphrase">Passphrase cifratura</label>
              <input
                id="enc-passphrase"
                data-testid="enc-passphrase-input"
                type="password"
                value={encPassphrase}
                onChange={(e) => setEnc(e.target.value)}
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
              data-testid="enc-keys-button"
              disabled={keysLoading}
            >
              {keysLoading ? 'Generazione...' : 'Genera chiavi cifratura'}
            </button>
          </form>
        </section>
      )}

      {step === 'sign-key' && (
        <section data-testid="step-sign-key">
          <h2>Chiave di firma digitale</h2>
          <p>Usata per firmare e verificare l&apos;autenticità dei file.</p>
          <form onSubmit={handleSignKey} data-testid="sign-key-form">
            <div>
              <label htmlFor="sign-passphrase">
                Passphrase firma (può essere la stessa)
              </label>
              <input
                id="sign-passphrase"
                data-testid="sign-passphrase-input"
                type="password"
                value={signPassphrase}
                onChange={(e) => setSign(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>
            <button
              type="submit"
              data-testid="sign-key-button"
              disabled={isGenerating}
            >
              {isGenerating ? 'Generazione...' : 'Genera chiave firma'}
            </button>
          </form>
        </section>
      )}

      {step === 'vault' && (
        <section data-testid="step-vault">
          <h2>Vault locale</h2>
          <p>Il vault cifra le tue chiavi sul disco locale.</p>
          <form onSubmit={handleVault} data-testid="vault-form">
            <div>
              <label htmlFor="vault-passphrase">Passphrase vault</label>
              <input
                id="vault-passphrase"
                data-testid="vault-passphrase-input"
                type="password"
                value={vaultPassphrase}
                onChange={(e) => setVault(e.target.value)}
                required
                autoComplete="new-password"
              />
            </div>
            {isDesktop() && (
              <div>
                <label htmlFor="mount-disk-checkbox">
                  <input
                    id="mount-disk-checkbox"
                    data-testid="mount-disk-checkbox"
                    type="checkbox"
                    checked={mountDisk}
                    onChange={(e) => setMountDisk(e.target.checked)}
                  />{' '}
                  Monta disco virtuale cifrato all&apos;avvio
                </label>
              </div>
            )}
            <button type="submit" data-testid="vault-button">
              Configura vault e continua
            </button>
          </form>
        </section>
      )}

      {step === 'done' && (
        <section data-testid="step-done">
          <h2>Configurazione completata!</h2>
          <p>AXSHARE Desktop è pronto all&apos;uso.</p>
          <ul>
            <li>Chiavi di cifratura generate</li>
            <li>Chiave di firma generata</li>
            <li>Vault configurato</li>
            {mountDisk && <li>Disco virtuale montato</li>}
          </ul>
          <button
            type="button"
            data-testid="go-to-dashboard-button"
            onClick={handleDone}
          >
            Vai alla Dashboard
          </button>
        </section>
      )}
    </main>
  )
}
