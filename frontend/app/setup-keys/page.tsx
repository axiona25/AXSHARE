'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useKeySetup } from '@/hooks/useUser'
import { useAuthContext } from '@/context/AuthContext'

export default function SetupKeysPage() {
  const router = useRouter()
  const { user } = useAuthContext()
  const { setupKeys, hasKeys, isLoading, error } = useKeySetup()

  const [passphrase, setPassphrase] = useState('')
  const [confirm, setConfirm] = useState('')
  const [localError, setLocalError] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!user) return
    hasKeys().then((has) => {
      if (has) router.replace('/dashboard')
    })
  }, [user, hasKeys, router])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLocalError('')

    if (passphrase.length < 8) {
      setLocalError('La passphrase deve essere almeno 8 caratteri.')
      return
    }
    if (passphrase !== confirm) {
      setLocalError('Le passphrase non coincidono.')
      return
    }

    const ok = await setupKeys(passphrase)
    if (ok) {
      setDone(true)
      setTimeout(() => router.push('/dashboard'), 1500)
    }
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

  return (
    <main>
      <h1>AXSHARE</h1>
      <h2>Configura le tue chiavi crittografiche</h2>

      <p>
        AXSHARE usa crittografia end-to-end. I tuoi file vengono cifrati
        nel browser prima di essere caricati. Nessuno, nemmeno noi,
        può leggere i tuoi file.
      </p>
      <p>
        <strong>
          Scegli una passphrase sicura — se la perdi non potrai recuperare i tuoi file.
        </strong>
      </p>

      {displayError && (
        <p data-testid="error-message" role="alert">
          {displayError}
        </p>
      )}

      <form onSubmit={handleSubmit} data-testid="setup-keys-form">
        <div>
          <label htmlFor="passphrase">Passphrase</label>
          <input
            id="passphrase"
            data-testid="passphrase-input"
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
            placeholder="Scegli una passphrase sicura"
          />
        </div>

        <div>
          <label htmlFor="confirm-passphrase">Conferma passphrase</label>
          <input
            id="confirm-passphrase"
            data-testid="confirm-passphrase-input"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            autoComplete="new-password"
          />
        </div>

        <button
          type="submit"
          data-testid="setup-keys-button"
          disabled={isLoading}
        >
          {isLoading ? 'Generazione chiavi...' : 'Genera chiavi e continua'}
        </button>
      </form>
    </main>
  )
}
