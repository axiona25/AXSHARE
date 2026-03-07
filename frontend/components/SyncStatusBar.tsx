'use client'

import { useState, useEffect } from 'react'
import {
  isRunningInTauri,
  getSyncStatus,
  pauseSync,
  resumeSync,
} from '@/lib/tauri'
import type { SyncProgress } from '@/lib/tauri'

export function SyncStatusBar() {
  const [sync, setSync] = useState<SyncProgress | null>(null)

  useEffect(() => {
    if (!isRunningInTauri()) return

    async function refresh() {
      const s = await getSyncStatus()
      if (s && s.status !== 'unavailable') setSync(s)
    }

    refresh()
    const interval = setInterval(refresh, 5000)
    return () => clearInterval(interval)
  }, [])

  if (!isRunningInTauri() || !sync) return null

  const pending = Math.max(0, (sync.total ?? 0) - (sync.done ?? 0))
  const statusLabel: Record<string, string> = {
    idle: 'Sincronizzato',
    syncing: 'Sincronizzazione...',
    paused: 'In pausa',
    error: 'Errore sync',
    unavailable: 'Non disponibile',
  }
  const label = statusLabel[sync.status] ?? sync.status

  const lastSyncStr =
    sync.last_sync > 0
      ? new Date(sync.last_sync * 1000).toLocaleTimeString('it')
      : null

  async function handlePause() {
    await pauseSync()
    setSync((s) => (s ? { ...s, status: 'paused' } : s))
  }

  async function handleResume() {
    await resumeSync()
    setSync((s) => (s ? { ...s, status: 'idle' } : s))
  }

  return (
    <div data-testid="sync-status-bar" style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '4px 20px 4px 240px',
      background: 'var(--ax-surface-1)',
      borderBottom: '1px solid var(--ax-border)',
      fontSize: 11, color: 'var(--ax-muted)', fontWeight: 500,
    }}>
      <span data-testid="sync-status-label">{label}</span>
      {pending > 0 && (
        <span data-testid="sync-pending"> ({pending} in coda)</span>
      )}
      {lastSyncStr && (
        <span data-testid="sync-last"> — ultimo: {lastSyncStr}</span>
      )}
      {sync.status === 'syncing' && (
        <button
          type="button"
          data-testid="pause-sync-button"
          onClick={handlePause}
        >
          Pausa
        </button>
      )}
      {sync.status === 'paused' && (
        <button
          type="button"
          data-testid="resume-sync-button"
          onClick={handleResume}
        >
          Riprendi
        </button>
      )}
    </div>
  )
}
