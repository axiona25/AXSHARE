'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import {
  isTauri,
  getSyncStatus,
  pauseSync,
  resumeSync,
} from '@/lib/tauri'
import { useSync } from '@/hooks/useSync'

export default function DesktopSyncPage() {
  const [syncStatus, setSyncStatus] = useState<{
    status: string
    total: number
    done: number
    last_sync: number
  } | null>(null)
  const { status, progress } = useSync()

  useEffect(() => {
    if (!isTauri()) return
    getSyncStatus().then((s) => {
      if (s && s.status !== 'unavailable')
        setSyncStatus({
          status: s.status,
          total: s.total,
          done: s.done,
          last_sync: s.last_sync,
        })
    })
    const iv = setInterval(() => {
      getSyncStatus().then((s) => {
        if (s && s.status !== 'unavailable')
          setSyncStatus({
            status: s.status,
            total: s.total,
            done: s.done,
            last_sync: s.last_sync,
          })
      })
    }, 3000)
    return () => clearInterval(iv)
  }, [])

  const pendingOperations: Array<{ id: string; type: string; file_name: string; status: string }> = []
  const conflicts: Array<{ id: string; file_name: string }> = []

  if (!isTauri()) {
    return (
      <main data-testid="sync-panel">
        <p data-testid="desktop-only">
          Questa pagina è disponibile solo nel client desktop.
        </p>
        <p>
          <Link href="/dashboard" data-testid="back-dashboard">Torna alla Dashboard</Link>
        </p>
      </main>
    )
  }

  const displayStatus = syncStatus ?? {
    status,
    total: progress.total,
    done: progress.done,
    last_sync: progress.last_sync,
  }

  return (
    <main data-testid="sync-panel">
      <h1>Sincronizzazione</h1>

      <section data-testid="sync-status-section">
        <h2>Stato</h2>
        <dl>
          <dt>Stato</dt>
          <dd data-testid="sync-state">{displayStatus.status}</dd>
          <dt>In coda</dt>
          <dd data-testid="sync-queue">
            {Math.max(0, displayStatus.total - displayStatus.done)}
          </dd>
          <dt>Ultimo sync</dt>
          <dd>
            {displayStatus.last_sync > 0
              ? new Date(displayStatus.last_sync * 1000).toLocaleString('it')
              : 'Mai'}
          </dd>
        </dl>
        <button
          type="button"
          data-testid="pause-sync"
          onClick={async () => {
            await pauseSync()
            setSyncStatus((prev) => (prev ? { ...prev, status: 'paused' } : null))
          }}
          disabled={displayStatus.status !== 'syncing'}
        >
          Pausa sync
        </button>
        <button
          type="button"
          data-testid="resume-sync"
          onClick={async () => {
            await resumeSync()
            const s = await getSyncStatus()
            if (s && s.status !== 'unavailable')
              setSyncStatus({ status: s.status, total: s.total, done: s.done, last_sync: s.last_sync })
          }}
          disabled={displayStatus.status !== 'paused'}
        >
          Riprendi sync
        </button>
      </section>

      <hr />

      <section data-testid="pending-ops-section">
        <h2>Operazioni in coda</h2>
        {pendingOperations.length === 0 && (
          <p data-testid="no-pending">Nessuna operazione in coda.</p>
        )}
        <ul>
          {pendingOperations.map((op) => (
            <li key={op.id} data-testid="pending-op-item">
              {op.type} — {op.file_name} — {op.status}
            </li>
          ))}
        </ul>
      </section>

      <hr />

      <section data-testid="conflicts-section">
        <h2>Conflitti</h2>
        {conflicts.length === 0 && (
          <p data-testid="no-conflicts">Nessun conflitto.</p>
        )}
        <ul>
          {conflicts.map((c) => (
            <li key={c.id} data-testid="conflict-item">
              <span>{c.file_name}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
