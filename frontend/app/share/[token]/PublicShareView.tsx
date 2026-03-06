'use client'

import { useState } from 'react'
import { usePublicShare } from '@/hooks/usePublicShare'

export function PublicShareView({ token }: { token: string }) {
  const { info, status, isLoading, isDownloading, error, download } = usePublicShare(token)
  const [password, setPassword] = useState('')

  if (isLoading || !token) {
    return (
      <div className="text-center text-gray-600">
        {token ? 'Caricamento...' : 'Token mancante'}
      </div>
    )
  }

  if (status === 'not_found') {
    return (
      <div className="text-center">
        <h1 className="text-xl font-semibold text-gray-800">Link non trovato</h1>
        <p className="mt-2 text-gray-600">Il link potrebbe essere scaduto o non valido.</p>
      </div>
    )
  }

  if (status === 'expired') {
    return (
      <div className="text-center">
        <h1 className="text-xl font-semibold text-gray-800">Link scaduto</h1>
        <p className="mt-2 text-gray-600">Questo link di condivisione non è più valido.</p>
      </div>
    )
  }

  if (status === 'revoked') {
    return (
      <div className="text-center">
        <h1 className="text-xl font-semibold text-gray-800">Link revocato</h1>
        <p className="mt-2 text-gray-600">L&apos;owner ha revocato l&apos;accesso a questo link.</p>
      </div>
    )
  }

  if (status !== 'ready' || !info) {
    return null
  }

  const handleDownload = () => {
    download(info.is_password_protected ? password : undefined)
  }

  return (
    <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-6 shadow-sm" data-testid="share-page">
      <h1 className="text-xl font-semibold text-gray-800">Download file condiviso</h1>
      {info.label && (
        <p className="mt-1 text-sm text-gray-500">{info.label}</p>
      )}
      {info.is_password_protected && (
        <div className="mt-4" data-testid="password-form">
          <label className="block text-sm font-medium text-gray-700">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            data-testid="password-input"
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            placeholder="Inserisci la password del link"
          />
        </div>
      )}
      {error && (
        <p className="mt-2 text-sm text-red-600">{error}</p>
      )}
      <button
        type="button"
        onClick={handleDownload}
        disabled={isDownloading || (info.is_password_protected && !password)}
        data-testid="download-button"
        className="mt-4 w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {isDownloading ? 'Download in corso...' : 'Scarica file'}
      </button>
    </div>
  )
}
