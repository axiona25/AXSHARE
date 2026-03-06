'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useKeySetup } from '@/hooks/useUser'
import { useAuthContext } from '@/context/AuthContext'
import { usersApi } from '@/lib/api'
import { keyManager } from '@/lib/keyManager'
import PinSetup from '@/components/PinSetup'

export default function SetupKeysPage() {
  const router = useRouter()
  const { user, isLoading, hasSessionKey, refreshUser, setSessionKey } = useAuthContext()
  const { hasKeys, error } = useKeySetup()

  const [localError, setLocalError] = useState('')
  const [done, setDone] = useState(false)
  const [forceShowSetupForm, setForceShowSetupForm] = useState(false)
  const [regenerating, setRegenerating] = useState(false)

  useEffect(() => {
    if (isLoading) return

    // Se non autenticato → redirect login (il PIN si inserisce solo dopo login)
    if (!user) {
      const token =
        typeof window !== 'undefined'
          ? localStorage.getItem('axshare_access_token')
          : null
      if (token) return // token presente ma user non ancora caricato
      router.replace('/login')
      return
    }

    // Se ha già le chiavi e sessione attiva → dashboard (il layout mostrerà il modal PIN se serve)
    if (user.has_public_key && hasSessionKey) {
      router.replace('/dashboard')
      return
    }

    // Se ha già le chiavi sul backend e non stiamo forzando il form → mostra panel rigenera o redirect
    if (user.has_public_key === true && !forceShowSetupForm) {
      return // non redirect: mostriamo il panel "Rigenera chiavi" / "Vai a dashboard"
    }

    // Nessune chiavi (o dopo reset): se le ha in IndexedDB e non forziamo form → redirect
    if (!forceShowSetupForm) {
      hasKeys(user.id).then((has) => {
        if (has) router.replace('/dashboard')
      })
    }
  }, [user, isLoading, hasSessionKey, hasKeys, router, forceShowSetupForm])

  async function handleRegenerateKeys() {
    if (!user) return
    setRegenerating(true)
    setLocalError('')
    try {
      await usersApi.deleteKeys()
      await keyManager.clearAll()
      await refreshUser()
      setForceShowSetupForm(true)
    } catch (e) {
      console.error('[SETUP-KEYS] Rigenera chiavi:', e)
      setLocalError(
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
          'Errore durante il reset delle chiavi.'
      )
    } finally {
      setRegenerating(false)
    }
  }

  async function handlePinSetup(pin: string) {
    if (!user?.email || !user?.id) throw new Error('Utente non trovato')

    await keyManager.generateAndStoreWithPin(user.id, user.email, pin)

    const resp = await usersApi.getPrivateKey()
    const bundle = resp.data?.encrypted_private_key
    if (!bundle) throw new Error('Chiave privata non trovata')

    const privateKey = await keyManager.unlockWithPin(user.email, pin, bundle)
    setSessionKey(privateKey)

    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem('axshare_session_pin', pin)
    }

    setDone(true)
    setTimeout(() => router.push('/dashboard'), 500)
  }

  if (done) {
    return (
      <main>
        <h2>Chiavi generate con successo!</h2>
        <p data-testid="setup-success">
          Le tue chiavi crittografiche sono state generate e salvate localmente.
          Redirect alla dashboard...
        </p>
      </main>
    )
  }

  const displayError = error || localError
  const hasKeysOnBackend = user?.has_public_key === true
  const showRegeneratePanel = hasKeysOnBackend && !forceShowSetupForm

  // Mentre AuthContext carica o abbiamo token ma user non ancora da getMe: non mostrare il form
  const waitingForUser =
    isLoading || (typeof window !== 'undefined' && localStorage.getItem('axshare_access_token') && !user)
  if (waitingForUser) {
    return (
      <main>
        <p data-testid="setup-keys-loading">Caricamento...</p>
      </main>
    )
  }

  // Hai già le chiavi: panel per rigenerare (RSA-4096) o andare in dashboard
  if (showRegeneratePanel) {
    return (
      <main>
        <h1>AXSHARE</h1>
        <h2>Chiavi già configurate</h2>
        <p>Le tue chiavi crittografiche sono già presenti. Per migrare a RSA-4096 (fix OperationError su alcuni client):</p>
        {localError && (
          <p data-testid="error-message" role="alert">
            {localError}
          </p>
        )}
        <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            data-testid="regenerate-keys-button"
            disabled={regenerating}
            onClick={handleRegenerateKeys}
          >
            {regenerating ? 'Reset in corso...' : 'Rigenera chiavi (fix RSA-4096)'}
          </button>
          <button type="button" onClick={() => router.push('/dashboard')}>
            Vai alla dashboard
          </button>
        </div>
      </main>
    )
  }

  return (
    <PinSetup
      mode="setup"
      email={user?.email ?? ''}
      onComplete={handlePinSetup}
    />
  )
}
