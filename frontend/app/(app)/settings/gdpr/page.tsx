'use client'

import { useState } from 'react'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'

interface ConsentItem {
  consent_type: string
  version: number
  granted: boolean
  created_at: string
}

export default function GdprSettingsPage() {
  const [exportStatus, setExportStatus] = useState('')
  const [erasureStatus, setErasureStatus] = useState('')
  const [consentStatus, setConsentStatus] = useState('')
  const [consents, setConsents] = useState<ConsentItem[]>([])

  function getAuthToken(): string {
    if (typeof window === 'undefined') return ''
    return localStorage.getItem('axshare_access_token') ?? ''
  }

  async function handleExport() {
    setExportStatus('Download in corso...')
    try {
      const resp = await fetch(`${API_BASE}/gdpr/export`, {
        headers: {
          Authorization: `Bearer ${getAuthToken()}`,
        },
      })
      const blob = await resp.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'axshare_data_export.json'
      a.click()
      URL.revokeObjectURL(url)
      setExportStatus('Export scaricato.')
    } catch {
      setExportStatus('Errore durante export.')
    }
  }

  async function handleErasureRequest() {
    if (
      !confirm(
        'Sei sicuro? Tutti i tuoi file, chiavi e dati saranno eliminati ' +
          "in modo irreversibile entro 30 giorni."
      )
    )
      return
    setErasureStatus('Invio richiesta...')
    try {
      const resp = await fetch(`${API_BASE}/gdpr/erasure`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${getAuthToken()}`,
          'Content-Type': 'application/json',
        },
      })
      const data = await resp.json().catch(() => ({}))
      if (resp.ok) {
        setErasureStatus(`Richiesta inviata. ID: ${(data as { request_id?: string }).request_id ?? '—'}`)
      } else {
        setErasureStatus((data as { detail?: string }).detail ?? 'Errore.')
      }
    } catch {
      setErasureStatus('Errore durante la richiesta.')
    }
  }

  async function handleLoadConsents() {
    try {
      const resp = await fetch(`${API_BASE}/gdpr/consent/history`, {
        headers: {
          Authorization: `Bearer ${getAuthToken()}`,
        },
      })
      const data = await resp.json()
      setConsents(Array.isArray(data) ? data : [])
      setConsentStatus('')
    } catch {
      setConsentStatus('Errore caricamento storico.')
    }
  }

  return (
    <div>
      <h1>Privacy e GDPR</h1>

      <section data-testid="gdpr-export-section">
        <h2>Esporta i miei dati (Art. 20 GDPR)</h2>
        <p>
          Scarica tutti i tuoi dati in formato JSON: profilo, file,
          link condivisione, log attività.
        </p>
        <button type="button" data-testid="export-button" onClick={handleExport}>
          Scarica i miei dati
        </button>
        {exportStatus && (
          <p data-testid="export-status">{exportStatus}</p>
        )}
      </section>

      <hr />

      <section data-testid="consent-section">
        <h2>Storico consensi</h2>
        <button
          type="button"
          data-testid="load-consents-button"
          onClick={handleLoadConsents}
        >
          Mostra storico consensi
        </button>
        {consents.length > 0 && (
          <ul data-testid="consents-list">
            {consents.map((c, i) => (
              <li key={i} data-testid="consent-item">
                {c.consent_type} — v{c.version} —{' '}
                {c.granted ? 'Accettato' : 'Rifiutato'} —{' '}
                {new Date(c.created_at).toLocaleString('it')}
              </li>
            ))}
          </ul>
        )}
        {consentStatus && <p>{consentStatus}</p>}
      </section>

      <hr />

      <section data-testid="gdpr-erasure-section">
        <h2>Cancella il mio account (Art. 17 GDPR)</h2>
        <p>
          <strong>Attenzione:</strong> questa operazione è irreversibile.
          Tutti i tuoi file cifrati, le chiavi e i dati personali saranno
          eliminati entro 30 giorni.
        </p>
        <button
          type="button"
          data-testid="erasure-button"
          onClick={handleErasureRequest}
        >
          Richiedi cancellazione account
        </button>
        {erasureStatus && (
          <p data-testid="erasure-status" role="alert">{erasureStatus}</p>
        )}
      </section>
    </div>
  )
}
