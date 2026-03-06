'use client'

import { useState, useEffect } from 'react'
import { PassphraseModal } from '@/components/PassphraseModal'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'

export default function GuestDashboardPage() {
  const [files, setFiles] = useState<string[]>([])
  const [modal, setModal] = useState<{ fileId: string } | null>(null)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('guest_files')
      if (stored) setFiles(JSON.parse(stored))
    }
  }, [])

  async function handleDownload(passphrase: string) {
    if (!modal) return
    setModal(null)
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('guest_token') : null
      if (!token) {
        alert('Sessione guest non trovata.')
        return
      }
      const resp = await fetch(`${API_BASE}/files/${modal.fileId}/download`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!resp.ok) throw new Error('Download fallito')
      const blob = await resp.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = modal.fileId
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      alert('Errore durante il download.')
    }
  }

  return (
    <main data-testid="guest-dashboard">
      <h1>AXSHARE — Accesso Guest</h1>
      <p>Hai accesso temporaneo ai seguenti file:</p>

      {files.length === 0 && (
        <p data-testid="guest-empty">Nessun file accessibile.</p>
      )}

      <ul data-testid="guest-file-list">
        {files.map((fileId) => (
          <li key={fileId} data-testid="guest-file-item">
            <span>File: {fileId}</span>
            <button
              type="button"
              data-testid={`guest-download-${fileId}`}
              onClick={() => setModal({ fileId })}
            >
              Scarica
            </button>
          </li>
        ))}
      </ul>

      {modal && (
        <PassphraseModal
          title="Passphrase per decifrare"
          onConfirm={handleDownload}
          onCancel={() => setModal(null)}
        />
      )}
    </main>
  )
}
