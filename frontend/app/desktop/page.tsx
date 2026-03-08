'use client'

import { useEffect, useState, useCallback } from 'react'
import Image from 'next/image'
import { useAuthContext } from '@/context/AuthContext'
import { authApi, usersApi } from '@/lib/api'
import { saveTokensSecure } from '@/lib/auth'
import { keyManager } from '@/lib/keyManager'
import {
  isRunningInTauri,
  getVirtualDiskStatus,
  mountVirtualDisk,
  unmountVirtualDisk,
  getDefaultMountPoint,
  getSyncStatus,
  startSync,
  pauseSync,
  isSessionLocked,
  lockSession,
  unlockSession,
  getOfflineFiles,
  onToggleVirtualDisk,
  type SyncProgress,
} from '@/lib/tauri'
import { getAxshareFileIcon } from '@/lib/fileIcons'

const SESSION_PIN_KEY = 'axshare_session_pin'
const BACKEND_HEALTH_URL = 'http://localhost:8000/health'
const POLL_MS = 10_000
const HEALTH_POLL_MS = 30_000

type DesktopStep = 'login' | 'pin' | 'dashboard'

function formatTime(ts: number): string {
  if (!ts) return '—'
  const d = new Date(ts * 1000)
  return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
}

export default function DesktopPage() {
  const { user, hasSessionKey, refreshUser, setSessionKey } = useAuthContext()

  const [desktopStep, setDesktopStep] = useState<DesktopStep>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pin, setPin] = useState('')
  const [loginError, setLoginError] = useState('')
  const [pinError, setPinError] = useState('')
  const [loading, setLoading] = useState(false)

  const [sessionLocked, setSessionLocked] = useState<boolean>(false)
  const [diskMounted, setDiskMounted] = useState<boolean>(false)
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null)
  const [offlineCount, setOfflineCount] = useState<number>(0)
  const [backendOk, setBackendOk] = useState<boolean | null>(null)
  const [mountLoading, setMountLoading] = useState(false)
  const [syncLoading, setSyncLoading] = useState(false)

  const refreshAll = useCallback(async () => {
    if (!isRunningInTauri()) return
    try {
      const [locked, status, sync, list] = await Promise.all([
        isSessionLocked(),
        getVirtualDiskStatus(),
        getSyncStatus(),
        getOfflineFiles(),
      ])
      setSessionLocked(locked)
      setDiskMounted(status.mounted)
      setSyncProgress(sync)
      setOfflineCount(Array.isArray(list) ? list.length : 0)
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    const checkSession = async () => {
      if (!isRunningInTauri()) return
      try {
        const locked = await isSessionLocked()
        const token =
          typeof window !== 'undefined'
            ? localStorage.getItem('axshare_access_token')
            : null
        if (!locked && token) {
          setDesktopStep('dashboard')
        }
      } catch {
        // ignore
      }
    }
    checkSession()
  }, [])

  useEffect(() => {
    if (!isRunningInTauri() || desktopStep !== 'dashboard') return
    refreshAll()
    const id = setInterval(refreshAll, POLL_MS)
    return () => clearInterval(id)
  }, [desktopStep, refreshAll])

  useEffect(() => {
    if (!isRunningInTauri() || desktopStep !== 'dashboard') return
    const check = async () => {
      try {
        const r = await fetch(BACKEND_HEALTH_URL, { method: 'GET' })
        setBackendOk(r.ok)
      } catch {
        setBackendOk(false)
      }
    }
    check()
    const id = setInterval(check, HEALTH_POLL_MS)
    return () => clearInterval(id)
  }, [desktopStep])

  useEffect(() => {
    if (!isRunningInTauri() || desktopStep !== 'dashboard') return
    let unlisten: (() => void) | undefined
    onToggleVirtualDisk(() => {
      refreshAll()
    }).then((fn) => {
      unlisten = fn
    })
    return () => {
      unlisten?.()
    }
  }, [desktopStep, refreshAll])

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoginError('')
    setLoading(true)
    try {
      const { data } = await authApi.devLogin(email, password)
      if (!data.access_token) {
        setLoginError('Nessun token ricevuto.')
        return
      }
      await saveTokensSecure(data.access_token, data.refresh_token)
      setDesktopStep('pin')
    } catch (err: unknown) {
      const ex = err as {
        response?: { data?: { detail?: string } }
        message?: string
      }
      setLoginError(
        ex?.response?.data?.detail ?? ex?.message ?? 'Login fallito.'
      )
    } finally {
      setLoading(false)
    }
  }

  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setPinError('')
    setLoading(true)
    try {
      await refreshUser()
      const resp = await usersApi.getPrivateKey()
      const bundle = resp.data?.encrypted_private_key
      if (!bundle) {
        setPinError('Chiave privata non trovata.')
        setLoading(false)
        return
      }
      const privateKey = await keyManager.unlockWithPin(email, pin, bundle)
      setSessionKey(privateKey)
      if (typeof window !== 'undefined') {
        sessionStorage.setItem(SESSION_PIN_KEY, pin)
      }
      setDesktopStep('dashboard')
    } catch {
      setPinError('PIN non corretto')
    } finally {
      setLoading(false)
    }
  }

  const handleLockSession = async () => {
    if (!isRunningInTauri()) return
    try {
      await lockSession()
      setDesktopStep('login')
      setEmail('')
      setPassword('')
      setPin('')
      setLoginError('')
      setPinError('')
    } catch (e) {
      console.error(e)
    }
  }

  const handleMountDisk = async () => {
    if (!isRunningInTauri()) return
    setMountLoading(true)
    try {
      await mountVirtualDisk(getDefaultMountPoint())
      setDiskMounted(true)
    } catch (e) {
      console.error(e)
    } finally {
      setMountLoading(false)
    }
  }

  const handleUnmountDisk = async () => {
    if (!isRunningInTauri()) return
    setMountLoading(true)
    try {
      await unmountVirtualDisk()
      setDiskMounted(false)
    } catch (e) {
      console.error(e)
    } finally {
      setMountLoading(false)
    }
  }

  const handleSyncNow = async () => {
    if (!isRunningInTauri()) return
    setSyncLoading(true)
    try {
      const p = await startSync()
      setSyncProgress(p)
    } catch (e) {
      console.error(e)
    } finally {
      setSyncLoading(false)
    }
  }

  const handlePauseSync = async () => {
    if (!isRunningInTauri()) return
    try {
      await pauseSync()
      const p = await getSyncStatus()
      setSyncProgress(p)
    } catch (e) {
      console.error(e)
    }
  }

  const handleDecifraTutti = async () => {
    if (!isRunningInTauri()) return
    try {
      await unlockSession()
      setSessionLocked(false)
    } catch (e) {
      console.error(e)
    }
  }

  const handleCifraTutti = async () => {
    if (!isRunningInTauri()) return
    try {
      await lockSession()
      setSessionLocked(true)
    } catch (e) {
      console.error(e)
    }
  }

  if (!isRunningInTauri()) {
    return (
      <div className="ax-desktop-client">
        <div className="ax-desktop-placeholder">
          <p>Apri dall&apos;app desktop AXSHARE per usare il client compatto.</p>
        </div>
      </div>
    )
  }

  if (desktopStep === 'login') {
    return (
      <div className="ax-desktop-client ax-desktop-step">
        <div className="ax-desktop-step-inner">
          <div className="ax-desktop-logo-area">
            <Image
              src="/favicon.png"
              alt=""
              width={32}
              height={32}
              className="ax-desktop-step-logo"
            />
            <span className="ax-desktop-title">AXSHARE</span>
          </div>
          <p className="ax-login-form-subheading">Accedi al client desktop</p>
          <form onSubmit={handleLoginSubmit} className="ax-desktop-form">
            <div className="ax-login-field">
              <label className="ax-login-field-label" htmlFor="desktop-email">
                Email
              </label>
              <input
                id="desktop-email"
                type="email"
                className="ax-login-field-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
            <div className="ax-login-field">
              <label className="ax-login-field-label" htmlFor="desktop-password">
                Password
              </label>
              <input
                id="desktop-password"
                type="password"
                className="ax-login-field-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
            {loginError && (
              <p className="ax-desktop-error" role="alert">
                {loginError}
              </p>
            )}
            <button
              type="submit"
              className="ax-login-btn-primary"
              disabled={loading}
            >
              {loading ? 'Accesso...' : 'Accedi'}
            </button>
          </form>
          <p className="ax-desktop-footer-badge">🔒 AES-256-GCM · E2E</p>
        </div>
      </div>
    )
  }

  if (desktopStep === 'pin') {
    return (
      <div className="ax-desktop-client ax-desktop-step">
        <div className="ax-desktop-step-inner">
          <div className="ax-desktop-logo-area">
            <Image
              src="/favicon.png"
              alt=""
              width={32}
              height={32}
              className="ax-desktop-step-logo"
            />
            <span className="ax-desktop-title">AXSHARE</span>
          </div>
          <p className="ax-login-form-heading">Inserisci il tuo PIN</p>
          <p className="ax-login-form-subheading">
            per attivare la cifratura
          </p>
          <form onSubmit={handlePinSubmit} className="ax-desktop-form">
            <div className="ax-desktop-pin-dots">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <span
                  key={i}
                  className={
                    i < pin.length
                      ? 'ax-desktop-pin-dot filled'
                      : 'ax-desktop-pin-dot'
                  }
                />
              ))}
            </div>
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              autoComplete="off"
              className="ax-login-field-input ax-desktop-pin-input"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="PIN 6 cifre"
              aria-label="PIN"
            />
            {pinError && (
              <p className="ax-desktop-error" role="alert">
                {pinError}
              </p>
            )}
            <button
              type="submit"
              className="ax-login-btn-primary"
              disabled={loading || pin.length !== 6}
            >
              {loading ? 'Verifica...' : 'Attiva cifratura'}
            </button>
            <button
              type="button"
              className="ax-login-btn-social"
              onClick={() => {
                setDesktopStep('login')
                setPin('')
                setPinError('')
              }}
            >
              ← Torna al login
            </button>
          </form>
        </div>
      </div>
    )
  }

  const syncLabel =
    syncProgress?.status === 'syncing'
      ? `Sincronizzazione... ${syncProgress.done}/${syncProgress.total}`
      : syncProgress?.status === 'paused'
        ? 'In pausa'
        : 'Sincronizzato'
  const syncTime = syncProgress?.last_sync
    ? formatTime(syncProgress.last_sync)
    : '—'

  return (
    <div className="ax-desktop-client">
      <header className="ax-desktop-header">
        <div className="ax-desktop-logo-wrap">
          <Image
            src="/favicon.png"
            alt=""
            width={24}
            height={24}
            className="ax-desktop-logo"
          />
          <span className="ax-desktop-title">AXSHARE</span>
        </div>
        <div className="ax-desktop-services-badge">
          <span className="ax-desktop-dot ax-desktop-dot-on" />
          Servizi attivi
        </div>
        <button
          type="button"
          className="ax-desktop-btn ax-desktop-btn-secondary ax-desktop-btn-lock"
          onClick={handleLockSession}
        >
          Blocca sessione
        </button>
      </header>

      <section className="ax-desktop-section">
        <h2 className="ax-desktop-section-title">STATO SESSIONE</h2>
        <div className="ax-desktop-card">
          <div className="ax-desktop-session-line">
            {sessionLocked ? '🔒 Sessione bloccata' : '🔒 Sessione attiva'}
          </div>
          <div className="ax-desktop-session-email">
            {(user?.email ?? email) || '—'}
          </div>
          <div className="ax-desktop-session-keys">
            <span>Chiave pubblica {user?.has_public_key ? '✓' : '—'}</span>
            <span>Chiave privata {hasSessionKey ? '✓' : '—'}</span>
          </div>
        </div>
      </section>

      <section className="ax-desktop-section">
        <h2 className="ax-desktop-section-title">DISCO VIRTUALE</h2>
        <div className="ax-desktop-card">
          <div className="ax-desktop-disk-path">
            💿 {getDefaultMountPoint()}
          </div>
          {diskMounted ? (
            <button
              type="button"
              className="ax-desktop-btn ax-desktop-btn-secondary"
              onClick={handleUnmountDisk}
              disabled={mountLoading}
            >
              Smonta disco
            </button>
          ) : (
            <button
              type="button"
              className="ax-desktop-btn ax-desktop-btn-primary"
              onClick={handleMountDisk}
              disabled={mountLoading}
            >
              Monta disco
            </button>
          )}
        </div>
      </section>

      <section className="ax-desktop-section">
        <h2 className="ax-desktop-section-title">SINCRONIZZAZIONE</h2>
        <div className="ax-desktop-sync-row">
          <span className="ax-desktop-dot ax-desktop-dot-on" />
          <span>{syncLabel}</span>
          <span className="ax-desktop-muted">· {syncTime}</span>
        </div>
        <div className="ax-desktop-btn-row">
          <button
            type="button"
            className="ax-desktop-btn ax-desktop-btn-primary"
            onClick={handleSyncNow}
            disabled={
              syncLoading || syncProgress?.status === 'syncing'
            }
          >
            Sincronizza ora
          </button>
          <button
            type="button"
            className="ax-desktop-btn ax-desktop-btn-icon"
            onClick={handlePauseSync}
            disabled={syncProgress?.status !== 'syncing'}
            aria-label="Pausa"
          >
            ⏸
          </button>
        </div>
      </section>

      <section className="ax-desktop-section">
        <h2 className="ax-desktop-section-title">SERVIZI</h2>
        <div className="ax-desktop-services-list">
          <div className="ax-desktop-service-row">
            <span>Backend</span>
            <span className="ax-desktop-dot-wrap">
              {backendOk === null ? (
                <span className="ax-desktop-dot ax-desktop-dot-warn" />
              ) : backendOk ? (
                <span className="ax-desktop-dot ax-desktop-dot-on" />
              ) : (
                <span className="ax-desktop-dot ax-desktop-dot-off" />
              )}
              <span className="ax-desktop-muted">
                {backendOk === null ? '…' : backendOk ? 'online' : 'offline'}
              </span>
            </span>
          </div>
          <div className="ax-desktop-service-row">
            <span>Storage</span>
            <span className="ax-desktop-muted">—</span>
          </div>
          <div className="ax-desktop-service-row">
            <span>Vault</span>
            <span className="ax-desktop-muted">—</span>
          </div>
        </div>
      </section>

      <section className="ax-desktop-section">
        <h2 className="ax-desktop-section-title">FILE LOCALI (.axs)</h2>
        <div className="ax-desktop-local-files">
          <span>{offlineCount} file cifrati</span>
          <div className="ax-desktop-btn-row">
            <button
              type="button"
              className="ax-desktop-btn ax-desktop-btn-secondary"
              onClick={handleDecifraTutti}
            >
              🔓 Decifra tutti
            </button>
            <button
              type="button"
              className="ax-desktop-btn ax-desktop-btn-icon"
              onClick={handleCifraTutti}
              aria-label="Cifra tutti"
            >
              🔒
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
