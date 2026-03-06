'use client'

import React, { useState, useEffect } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { authApi } from '@/lib/api'

interface PasskeyCredential {
  id: string
  display_name: string
  created_at?: string
  last_used_at?: string | null
  aaguid?: string
}

export function PasskeyManager() {
  const { registerPasskey, isLoading, error, clearError } = useAuth()
  const [credentials, setCredentials] = useState<PasskeyCredential[]>([])
  const [loadingCreds, setLoadingCreds] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [statusMsg, setStatusMsg] = useState('')

  async function loadCredentials() {
    setLoadingCreds(true)
    try {
      const { data } = await authApi.getWebAuthnCredentials()
      setCredentials(data?.credentials ?? [])
    } catch {
      setCredentials([])
    } finally {
      setLoadingCreds(false)
    }
  }

  useEffect(() => {
    loadCredentials()
  }, [])

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault()
    clearError?.()
    setStatusMsg('')
    const ok = await registerPasskey(displayName || undefined)
    if (ok) {
      setStatusMsg('Passkey registrata con successo.')
      setDisplayName('')
      await loadCredentials()
    }
  }

  async function handleRemove(credentialId: string) {
    if (!confirm('Rimuovere questa passkey?')) return
    try {
      await authApi.deleteWebAuthnCredential(credentialId)
      setStatusMsg('Passkey rimossa.')
      await loadCredentials()
    } catch {
      setStatusMsg('Errore durante la rimozione.')
    }
  }

  return (
    <div data-testid="passkey-manager">
      <h3>Passkey e chiavi di sicurezza</h3>
      <p>
        Le passkey ti permettono di accedere senza password usando
        la biometria del tuo dispositivo (FaceID, impronta) o una
        chiave hardware (YubiKey).
      </p>

      {statusMsg && (
        <p data-testid="passkey-status">{statusMsg}</p>
      )}
      {error && (
        <p data-testid="passkey-error" role="alert">{error}</p>
      )}

      <form onSubmit={handleRegister} data-testid="register-passkey-form">
        <div>
          <label htmlFor="passkey-name">
            Nome passkey (opzionale, es. &quot;MacBook Touch ID&quot;)
          </label>
          <input
            id="passkey-name"
            data-testid="passkey-name-input"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="es. MacBook Touch ID"
            maxLength={64}
          />
        </div>
        <button
          type="submit"
          data-testid="register-passkey-button"
          disabled={isLoading}
        >
          {isLoading ? 'Registrazione...' : '+ Aggiungi passkey'}
        </button>
      </form>

      <hr />

      <h4>Passkey registrate</h4>

      {loadingCreds && <p>Caricamento...</p>}

      {!loadingCreds && credentials.length === 0 && (
        <p data-testid="no-passkeys">
          Nessuna passkey registrata. Aggiungi la prima passkey sopra.
        </p>
      )}

      <ul data-testid="passkeys-list">
        {credentials.map((cred) => (
          <li key={cred.id} data-testid="passkey-item">
            <div>
              <strong data-testid={`passkey-name-${cred.id}`}>
                {cred.display_name || 'Passkey senza nome'}
              </strong>
            </div>
            <div>
              <small>
                Aggiunta il {cred.created_at ? new Date(cred.created_at).toLocaleDateString('it') : '—'}
              </small>
              {cred.last_used_at && (
                <small>
                  {' '}— Ultimo uso:{' '}
                  {new Date(cred.last_used_at).toLocaleDateString('it')}
                </small>
              )}
            </div>
            <button
              type="button"
              data-testid={`remove-passkey-${cred.id}`}
              onClick={() => handleRemove(cred.id)}
            >
              Rimuovi
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
