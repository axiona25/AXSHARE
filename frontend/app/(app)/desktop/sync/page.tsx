'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { isRunningInTauri } from '@/lib/tauri'
import { useSyncDesktop } from '@/hooks/useSyncDesktop'

const INTERVAL_OPTIONS = [5, 15, 30, 60] as const

export default function DesktopSyncPage() {
  const {
    syncState,
    lastSync,
    syncedFiles,
    progress,
    syncNow,
    startAutoSync,
    stopAutoSync,
    autoSyncEnabled,
    autoSyncIntervalMinutes,
    setAutoSyncIntervalMinutes,
  } = useSyncDesktop()

  const [intervalSelect, setIntervalSelect] = useState<number>(15)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const s = localStorage.getItem('axshare_sync_interval')
    if (s) {
      const n = parseInt(s, 10)
      if ((INTERVAL_OPTIONS as readonly number[]).includes(n)) setIntervalSelect(n)
    }
  }, [])

  if (!isRunningInTauri()) {
    return (
      <main data-testid="sync-panel">
        <p data-testid="desktop-only">
          Questa pagina è disponibile solo nel client desktop.
        </p>
        <p>
          <Link href="/dashboard" data-testid="back-dashboard">
            Torna alla Dashboard
          </Link>
        </p>
      </main>
    )
  }

  const statusLabel =
    syncState === 'syncing'
      ? 'In corso...'
      : syncState === 'success' && lastSync
        ? `Sincronizzato il ${lastSync.toLocaleString('it')}`
        : syncState === 'error'
          ? 'Errore durante la sincronizzazione'
          : 'Mai sincronizzato'

  const handleIntervalChange = (minutes: number) => {
    setIntervalSelect(minutes)
    if (autoSyncEnabled) {
      startAutoSync(minutes)
    }
  }

  const toggleAutoSync = (on: boolean) => {
    if (on) {
      startAutoSync(intervalSelect)
    } else {
      stopAutoSync()
    }
  }

  return (
    <main data-testid="sync-panel" style={{ padding: '1.5rem', maxWidth: 720 }}>
      <h1>Sincronizzazione desktop</h1>
      <p>
        <Link href="/dashboard">← Dashboard</Link>
      </p>

      <section style={{ marginTop: '1.5rem' }}>
        <h2>Stato</h2>
        <p data-testid="sync-state">{statusLabel}</p>
        {syncState === 'syncing' && (
          <div
            style={{
              marginTop: 8,
              height: 8,
              background: '#2a4a6a',
              borderRadius: 4,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${progress}%`,
                background: '#1974CA',
                transition: 'width 0.2s',
              }}
            />
          </div>
        )}
        <button
          type="button"
          data-testid="sync-now"
          onClick={() => syncNow()}
          disabled={syncState === 'syncing'}
          style={{
            marginTop: 12,
            padding: '0.5rem 1rem',
            cursor: syncState === 'syncing' ? 'not-allowed' : 'pointer',
          }}
        >
          {syncState === 'syncing' ? 'Sincronizzazione...' : 'Sincronizza ora'}
        </button>
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2>File sincronizzati ({syncedFiles.length})</h2>
        {syncedFiles.length === 0 ? (
          <p data-testid="no-synced-files">
            Nessun file in root. Esegui &quot;Sincronizza ora&quot; per aggiornare
            la lista.
          </p>
        ) : (
          <ul
            data-testid="synced-files-list"
            style={{ listStyle: 'none', padding: 0, margin: 0 }}
          >
            {syncedFiles.map((f) => (
              <li
                key={f.id}
                style={{
                  padding: '0.5rem 0',
                  borderBottom: '1px solid #2a4a6a',
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <span title={f.synced ? 'Nome decifrato' : 'Nome cifrato'}>
                  {f.name}
                  {!f.synced && ' (cifrato)'}
                </span>
                <span style={{ color: '#8ab4d0', fontSize: '0.9rem' }}>
                  {(f.size / 1024).toFixed(1)} KB
                  {f.updatedAt &&
                    ` · ${new Date(f.updatedAt).toLocaleDateString('it')}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2>Auto-sync</h2>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={autoSyncEnabled}
            onChange={(e) => toggleAutoSync(e.target.checked)}
            data-testid="auto-sync-toggle"
          />
          Abilita auto-sync
        </label>
        <div style={{ marginTop: 12 }}>
          <label>
            Intervallo (minuti):{' '}
            <select
              value={intervalSelect}
              onChange={(e) =>
                handleIntervalChange(Number(e.target.value) as 5 | 15 | 30 | 60)
              }
              data-testid="sync-interval"
              disabled={!autoSyncEnabled}
            >
              {INTERVAL_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m} min
                </option>
              ))}
            </select>
          </label>
        </div>
        {autoSyncEnabled && autoSyncIntervalMinutes != null && (
          <p style={{ marginTop: 8, color: '#8ab4d0', fontSize: '0.9rem' }}>
            Prossima sincronizzazione automatica tra {autoSyncIntervalMinutes}{' '}
            minuti.
          </p>
        )}
      </section>
    </main>
  )
}
