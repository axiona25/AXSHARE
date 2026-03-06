'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { usePublicShare } from '@/hooks/usePublicShare'

export default function SharePage() {
  const params = useParams<{ token: string }>()
  const token = (Array.isArray(params.token) ? params.token[0] : params.token) ?? ''
  const { info, status, isLoading, isDownloading, download } = usePublicShare(token)

  const [password, setPassword] = useState('')
  const [downloadError, setDownloadError] = useState('')

  async function handleDownload(e: React.FormEvent) {
    e.preventDefault()
    setDownloadError('')
    try {
      const result = await download(info?.is_password_protected ? password : undefined)
      if (result) {
        setDownloadError('')
      } else {
        setDownloadError('Password errata o link non valido.')
      }
    } catch {
      setDownloadError('Password errata o link non valido.')
    }
  }

  if (isLoading) {
    return <p data-testid="share-loading">Caricamento link...</p>
  }

  if (status === 'not_found') {
    return (
      <main data-testid="share-not-found">
        <h1>Link non trovato</h1>
        <p>Il link di condivisione non esiste.</p>
      </main>
    )
  }

  if (status === 'expired') {
    return (
      <main data-testid="share-expired">
        <h1>Link scaduto</h1>
        <p>Questo link di condivisione è scaduto.</p>
      </main>
    )
  }

  if (status === 'revoked') {
    return (
      <main data-testid="share-revoked">
        <h1>Link revocato</h1>
        <p>Questo link è stato revocato dal proprietario.</p>
      </main>
    )
  }

  return (
    <main data-testid="share-page">
      <h1>AXSHARE — Download file</h1>

      <section>
        <h2>Informazioni file</h2>
        <dl>
          {info?.label && (
            <>
              <dt>Etichetta</dt>
              <dd data-testid="share-label">{info.label}</dd>
            </>
          )}
          {info?.expires_at && (
            <>
              <dt>Scade il</dt>
              <dd>{new Date(info.expires_at).toLocaleString('it')}</dd>
            </>
          )}
          {info?.max_downloads != null && (
            <>
              <dt>Download rimanenti</dt>
              <dd>{info.max_downloads - (info.download_count ?? 0)}</dd>
            </>
          )}
        </dl>
      </section>

      {downloadError && (
        <p data-testid="download-error" role="alert">{downloadError}</p>
      )}

      <form onSubmit={handleDownload} data-testid="download-form">
        {info?.is_password_protected && (
          <div>
            <label htmlFor="share-password">
              Questo file è protetto da password
            </label>
            <input
              id="share-password"
              data-testid="password-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="Inserisci la password"
            />
          </div>
        )}

        <button
          type="submit"
          data-testid="download-button"
          disabled={isDownloading}
        >
          {isDownloading ? 'Download in corso...' : 'Scarica file'}
        </button>
      </form>

      <hr />
      <p>
        <small>
          File condiviso tramite AXSHARE — piattaforma di condivisione
          file con cifratura end-to-end.
        </small>
      </p>
    </main>
  )
}
