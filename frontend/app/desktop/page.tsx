'use client'

import { useEffect, useState, useCallback } from 'react'
import { flushSync } from 'react-dom'
import Image from 'next/image'
import { useAuthContext } from '@/context/AuthContext'
import { authApi, usersApi, activityApi, foldersApi, reportsApi, filesApi } from '@/lib/api'
import { saveTokensSecure, getAccessTokenSecure } from '@/lib/auth'
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
  getOfflineFiles,
  onToggleVirtualDisk,
  type SyncProgress,
} from '@/lib/tauri'
import { getAxshareFileIcon, getFileIcon } from '@/lib/fileIcons'
import { decryptFileKeyWithRSA, decryptFileChunked, base64ToBytes, bytesToBase64 } from '@/lib/crypto'
import { useCrypto } from '@/hooks/useCrypto'
import type { ActivityLog } from '@/types'
import type { Folder } from '@/types'

type DecryptedEntry = {
  file_id: string
  name: string
  size: number
  is_folder: boolean
  folder_path: string
  file_key_base64: string | null
}

const SESSION_PIN_KEY = 'axshare_session_pin'
const BACKEND_HEALTH_URL = 'http://localhost:8000/health'
const POLL_MS = 10_000
const HEALTH_POLL_MS = 30_000
const RECENT_FILES_LIMIT = 15

const ACTION_LABELS: Record<string, string> = {
  upload: 'Caricato',
  download: 'Scaricato',
  rename: 'Rinominato',
  move: 'Spostato',
  delete: 'Eliminato',
  share: 'Condiviso',
  share_link: 'Collegamento creato',
  share_revoke: 'Collegamento rimosso',
  create_folder: 'Creato',
  trash: 'Nel cestino',
  restore: 'Ripristinato',
  destroy: 'Eliminato',
}

type DesktopStep = 'login' | 'pin' | 'dashboard'

function formatTime(ts: number): string {
  if (!ts) return '—'
  const d = new Date(ts * 1000)
  return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
}

function formatActivityDate(createdAt: string): string {
  const d = new Date(createdAt)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 1) return 'ora'
  if (diffMins < 60) return `${diffMins} min`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours} h`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays === 1) return 'ieri'
  return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })
}

function formatFolderDateTime(updatedAt?: string | null, createdAt?: string): string {
  const raw = updatedAt || createdAt
  if (!raw) return '—'
  const d = new Date(raw)
  return d.toLocaleString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function shouldSkipDiskFile(name: string): boolean {
  const n = name.trim()
  if (!n) return true
  if (n.startsWith('._') || n === '.DS_Store' || n.startsWith('.')) return true
  if (n.startsWith('~$') || n.startsWith('~WRL')) return true
  if (n.endsWith('.tmp') || n.endsWith('.TMP')) return true
  return false
}

export default function DesktopPage() {
  const { user, hasSessionKey, sessionPrivateKey, refreshUser, setSessionKey, isRestoringSessionKey } = useAuthContext()
  const { decryptFolderNames, decryptFileNames, decryptFileNamesAndKeys } = useCrypto()

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
  const [mountError, setMountError] = useState<string | null>(null)
  const [showUnmountConfirm, setShowUnmountConfirm] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [syncLoading, setSyncLoading] = useState(false)

  const [recentActivity, setRecentActivity] = useState<ActivityLog[]>([])
  const [rootFolders, setRootFolders] = useState<Folder[]>([])
  const [decryptedFolderNames, setDecryptedFolderNames] = useState<Record<string, string>>({})
  const [decryptedActivityFileNames, setDecryptedActivityFileNames] = useState<Record<string, string>>({})
  const [storageReport, setStorageReport] = useState<{
    total_size_bytes: number
    storage_quota_bytes: number
  } | null>(null)

  useEffect(() => {
    // Al mount parte sempre dal login
    // Non ripristinare mai la sessione automaticamente
    // L'utente deve sempre fare login + PIN al riavvio
    setDesktopStep('login')
    setMounted(true)
  }, [])

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
    if (desktopStep !== 'dashboard') return
    const load = async () => {
      try {
        const [activityRes, foldersRes, reportRes] = await Promise.all([
          activityApi.getRecent().catch(() => ({ data: [] as ActivityLog[] })),
          foldersApi.listRoot().catch(() => ({ data: [] as Folder[] })),
          reportsApi.getMyDashboard().catch(() => ({ data: null })),
        ])
        setRecentActivity(Array.isArray(activityRes.data) ? activityRes.data : [])
        setRootFolders(Array.isArray(foldersRes.data) ? foldersRes.data : [])
        if (reportRes.data?.storage) {
          setStorageReport({
            total_size_bytes: reportRes.data.storage.total_size_bytes,
            storage_quota_bytes: reportRes.data.storage.storage_quota_bytes,
          })
        }
      } catch {
        // ignore
      }
    }
    load()
    const id = setInterval(load, POLL_MS)
    return () => clearInterval(id)
  }, [desktopStep])

  useEffect(() => {
    if (desktopStep !== 'dashboard' || !hasSessionKey || rootFolders.length === 0) return
    const toDecrypt = rootFolders.filter((f) => !decryptedFolderNames[f.id])
    if (toDecrypt.length === 0) return
    decryptFolderNames(toDecrypt).then((names) => {
      setDecryptedFolderNames((prev) => ({ ...prev, ...names }))
    }).catch(() => {})
  }, [desktopStep, hasSessionKey, rootFolders, decryptedFolderNames, decryptFolderNames])

  useEffect(() => {
    if (desktopStep !== 'dashboard' || !hasSessionKey) return
    const fileLogs = recentActivity
      .filter((a) => a.target_type === 'file' && a.target_id)
      .slice(0, RECENT_FILES_LIMIT)
    if (fileLogs.length === 0) return
    const loadAndDecrypt = async () => {
      const files: { id: string; name_encrypted: string }[] = []
      const seen = new Set<string>()
      for (const log of fileLogs) {
        if (seen.has(log.target_id)) continue
        seen.add(log.target_id)
        try {
          const meta = await filesApi.getMeta(log.target_id)
          if (meta?.data?.name_encrypted) {
            files.push({ id: log.target_id, name_encrypted: meta.data.name_encrypted })
          }
        } catch {
          if (log.target_name) {
            files.push({ id: log.target_id, name_encrypted: log.target_name })
          }
        }
      }
      if (files.length === 0) return
      const names = await decryptFileNames(files)
      setDecryptedActivityFileNames((prev) => ({ ...prev, ...names }))
    }
    loadAndDecrypt().catch(() => {})
  }, [desktopStep, hasSessionKey, recentActivity, decryptFileNames])

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

  // Regola fissa: adatta sempre l'altezza della finestra al contenuto (no scroll verticale)
  useEffect(() => {
    if (!isRunningInTauri() || desktopStep !== 'dashboard') return
    const root = document.querySelector('.ax-desktop-root') as HTMLElement | null
    if (!root) return
    const applyHeight = async (height: number) => {
      if (height < 720) return
      try {
        const { invoke } = await import('@tauri-apps/api/core')
        await invoke('set_main_window_size', { width: 760, height })
      } catch {
        // ignore
      }
    }
    const run = () => applyHeight(root.offsetHeight)
    const t = setTimeout(run, 80)
    const ro = new ResizeObserver(run)
    ro.observe(root)
    return () => {
      clearTimeout(t)
      ro.disconnect()
    }
  }, [desktopStep])

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
      const userEmail = user?.email ?? email
      if (!userEmail) {
        setPinError('Sessione scaduta. Esegui di nuovo l’accesso.')
        setLoading(false)
        return
      }
      const resp = await usersApi.getPrivateKey()
      const bundle = resp.data?.encrypted_private_key
      if (!bundle) {
        setPinError('Chiave privata non trovata.')
        setLoading(false)
        return
      }
      const privateKey = await keyManager.unlockWithPin(userEmail, pin, bundle)
      flushSync(() => {
        setSessionKey(privateKey)
      })
      if (typeof window !== 'undefined') {
        sessionStorage.setItem(SESSION_PIN_KEY, pin)
      }
      if (isRunningInTauri()) {
        const { invoke } = await import('@tauri-apps/api/core')
        await invoke('decrypt_local_files_command').catch((e) => console.warn('decrypt_local_files_command:', e))
      }
      setDesktopStep('dashboard')
    } catch {
      setPinError('PIN non corretto')
    } finally {
      setLoading(false)
    }
  }

  const handleLockSession = async () => {
    console.log('[LOGOUT] handleLockSession chiamato, isRunningInTauri:', isRunningInTauri())
    if (!isRunningInTauri()) {
      console.log('[LOGOUT] Skip: non in Tauri')
      return
    }
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('encrypt_local_files_command')
      console.log('[LOGOUT] encrypt_local_files_command completato')
    } catch (e) {
      console.error('[LOGOUT] encrypt_local_files_command fallito:', e)
    }
    try {
      await lockSession()
      setDesktopStep('login')
      setEmail('')
      setPassword('')
      setPin('')
      setLoginError('')
      setPinError('')
    } catch (e) {
      console.error('[LOGOUT] lockSession fallito:', e)
    }
  }

  /** Costruisce la lista completa (cartelle + file) con nomi decifrati e chiavi, e la invia al Rust. */
  const buildAndSendFileList = useCallback(async () => {
    if (!isRunningInTauri() || !user || !sessionPrivateKey) return
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const entries: DecryptedEntry[] = []

      const safeName = (s: string) => s.replace(/\//g, '_').replace(/\\/g, '_')

      const processFolder = async (
        folder: { id: string; name_encrypted: string },
        parentPath: string
      ): Promise<void> => {
        try {
          const keyResp = await foldersApi.getKey(folder.id)
          const folderKey = await decryptFileKeyWithRSA(
            keyResp.data.folder_key_encrypted,
            sessionPrivateKey
          )
          const nameBytes = base64ToBytes(folder.name_encrypted)
          const decrypted = await decryptFileChunked(nameBytes, folderKey, user.id)
          const folderName = safeName(new TextDecoder().decode(decrypted))
          console.log('[BUILD] processFolder:', folderName, 'parentPath:', parentPath)
          const fullPath = parentPath === '/' ? `/${folderName}` : `${parentPath}/${folderName}`
          // Path della cartella corrente: per i file dentro usa sempre il nome decifrato (es. /SM4, /Axiona)
          const folderPathForFiles = parentPath === '/' ? `/${folderName}` : fullPath

          entries.push({
            file_id: folder.id,
            name: folderName,
            size: 0,
            is_folder: true,
            folder_path: parentPath,
            file_key_base64: null,
          })

          const filesResp = await foldersApi.listFiles(folder.id).catch(() => ({ data: [] as { id: string; name_encrypted: string; size_bytes?: number }[] }))
          console.log('[BUILD] files in folder', folder.id, ':', filesResp.data?.length)
          for (const file of filesResp.data ?? []) {
            try {
              const fileKeyResp = await filesApi.getKey(file.id)
              const fileKeyBytes = await decryptFileKeyWithRSA(
                fileKeyResp.data.file_key_encrypted,
                sessionPrivateKey
              )
              const fNameBytes = base64ToBytes(file.name_encrypted)
              const fDec = await decryptFileChunked(fNameBytes, fileKeyBytes, user.id)
              const fileName = safeName(new TextDecoder().decode(fDec))
              if (shouldSkipDiskFile(fileName)) continue
              entries.push({
                file_id: file.id,
                name: fileName,
                size: file.size_bytes ?? 0,
                is_folder: false,
                folder_path: folderPathForFiles,
                file_key_base64: bytesToBase64(fileKeyBytes),
              })
            } catch {
              // skip file se decifratura fallisce
            }
          }

          const childrenResp = await foldersApi.listChildren(folder.id).catch(() => ({ data: [] as Folder[] }))
          for (const child of childrenResp.data ?? []) {
            await processFolder(child, fullPath)
          }
        } catch (e) {
          console.error('[buildAndSendFileList] processFolder', folder.id, e)
        }
      }

      const rootFoldersRes = await foldersApi.listRoot().catch(() => ({ data: [] as Folder[] }))
      console.log('[BUILD] rootFolders:', rootFoldersRes.data?.length, rootFoldersRes.data?.map(f => f.id))
      for (const folder of rootFoldersRes.data ?? []) {
        await processFolder(folder, '/')
      }

      const rootFilesRes = await foldersApi.listRootFiles().catch(() => ({ data: [] as { id: string; name_encrypted: string; size?: number }[] }))
      console.log('[BUILD] rootFiles:', rootFilesRes.data?.length)
      for (const file of rootFilesRes.data ?? []) {
        try {
          const fileKeyResp = await filesApi.getKey(file.id)
          const fileKeyBytes = await decryptFileKeyWithRSA(
            fileKeyResp.data.file_key_encrypted,
            sessionPrivateKey
          )
          const fNameBytes = base64ToBytes(file.name_encrypted)
          const fDec = await decryptFileChunked(fNameBytes, fileKeyBytes, user.id)
          const fileName = safeName(new TextDecoder().decode(fDec))
          if (shouldSkipDiskFile(fileName)) continue
          entries.push({
            file_id: file.id,
            name: fileName,
            size: file.size ?? 0,
            is_folder: false,
            folder_path: '/',
            file_key_base64: bytesToBase64(fileKeyBytes),
          })
        } catch {
          // skip file
        }
      }

      console.log('[BUILD] total entries:', entries.length, entries.map(e => e.is_folder ? 'DIR:'+e.name : 'FILE:'+e.name+' in '+e.folder_path))
      await invoke('update_disk_files_decrypted', { entries })
    } catch (e) {
      console.error('buildAndSendFileList error:', e)
    }
  }, [user, sessionPrivateKey])

  /** Recupera tutti i file da mostrare sul disco (root + file nelle cartelle root). */
  const fetchFilesForDisk = useCallback(async (): Promise<{ id: string; name_encrypted: string; size: number }[]> => {
    const rootFilesRes = await foldersApi.listRootFiles().catch(() => ({ data: [] as { id: string; name_encrypted: string; size: number }[] }))
    const rootFiles = rootFilesRes.data ?? []
    const rootFoldersRes = await foldersApi.listRoot().catch(() => ({ data: [] as Folder[] }))
    const rootFolders = rootFoldersRes.data ?? []
    const fromFolders: { id: string; name_encrypted: string; size: number }[] = []
    for (const folder of rootFolders) {
      const res = await foldersApi.listFiles(folder.id).catch(() => ({ data: [] as { id: string; name_encrypted: string; size_bytes: number }[] }))
      const list = res.data ?? []
      for (const f of list) {
        fromFolders.push({ id: f.id, name_encrypted: f.name_encrypted, size: f.size_bytes ?? 0 })
      }
    }
    return [...rootFiles.map((f) => ({ id: f.id, name_encrypted: f.name_encrypted, size: f.size ?? 0 })), ...fromFolders]
  }, [])

  const handleMountDisk = async () => {
    if (!isRunningInTauri()) return
    setMountError(null)
    setMountLoading(true)
    try {
      const token = await getAccessTokenSecure()
      if (!token) {
        setMountError('Non autenticato. Effettua il login.')
        return
      }
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('set_jwt_token', { jwtToken: token })
      await mountVirtualDisk(getDefaultMountPoint())
      await buildAndSendFileList()
      await invoke('set_volume_icon', {})
      setDiskMounted(true)
      await refreshAll()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[Mount]', e)
      setMountError(msg || 'Montaggio fallito')
    } finally {
      setMountLoading(false)
    }
  }

  const handleUnmountDisk = async () => {
    if (!isRunningInTauri()) return
    setShowUnmountConfirm(false)
    setMountError(null)
    setMountLoading(true)
    try {
      await unmountVirtualDisk()
      setDiskMounted(false)
      await refreshAll()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setMountError(msg || 'Smontaggio fallito')
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

  if (!mounted) {
    return (
      <div className="ax-desktop-spinner-wrap">
        <div className="ax-desktop-spinner" aria-hidden />
      </div>
    )
  }

  if (!isRunningInTauri()) {
    return (
      <div className="ax-desktop-modal">
        <div className="ax-desktop-placeholder">
          <p>Apri dall&apos;app desktop AXSHARE per usare il client compatto.</p>
        </div>
      </div>
    )
  }

  if (desktopStep === 'dashboard' && user && !hasSessionKey) {
    if (isRestoringSessionKey) {
      return (
        <div className="ax-desktop-modal ax-desktop-step">
          <div className="ax-desktop-step-inner">
            <div className="ax-desktop-spinner" aria-hidden />
            <p className="ax-login-form-subheading">Sblocco chiave in corso...</p>
          </div>
        </div>
      )
    }
    return (
      <div className="ax-desktop-modal ax-desktop-step">
        <div className="ax-desktop-step-inner">
          <div className="ax-desktop-logo-area">
            <Image
              src="/favicon.png"
              alt=""
              width={72}
              height={72}
              className="ax-desktop-step-logo"
            />
            <span className="ax-desktop-title">AXSHARE</span>
          </div>
          <p className="ax-login-form-subheading">Inserisci il PIN per decifrare nomi file e cartelle</p>
          <form onSubmit={handlePinSubmit} className="ax-desktop-form">
            <div className="ax-login-field">
              <label className="ax-login-field-label" htmlFor="desktop-pin-unlock">
                PIN (8 cifre)
              </label>
              <input
                id="desktop-pin-unlock"
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={8}
                className="ax-login-field-input"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
                placeholder="••••••••"
                autoComplete="off"
              />
            </div>
            {pinError && <p className="ax-login-error" role="alert">{pinError}</p>}
            <button type="submit" className="ax-login-submit" disabled={loading || pin.length !== 8}>
              {loading ? '...' : 'Sblocca'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  if (desktopStep === 'login') {
    return (
      <div className="ax-desktop-modal ax-desktop-step">
        <div className="ax-desktop-step-inner">
          <div className="ax-desktop-logo-area">
            <Image
              src="/favicon.png"
              alt=""
              width={72}
              height={72}
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
      <div className="ax-desktop-modal ax-desktop-step">
        <div className="ax-desktop-step-inner">
          <div className="ax-desktop-logo-area">
            <Image
              src="/favicon.png"
              alt=""
              width={72}
              height={72}
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
              {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
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
              maxLength={8}
              autoComplete="off"
              className="ax-login-field-input ax-desktop-pin-input"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
              placeholder="PIN 8 cifre"
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
              disabled={loading || pin.length !== 8}
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

  const fileActivity = recentActivity
    .filter((a) => a.target_type === 'file')
    .slice(0, RECENT_FILES_LIMIT)
  const storageUsed = storageReport?.total_size_bytes ?? 0
  const storageQuota = storageReport?.storage_quota_bytes || 1_073_741_824
  const storagePct = Math.min(100, (storageUsed / storageQuota) * 100)

  return (
    <div className="ax-desktop-modal ax-desktop-client">
      <header className="ax-desktop-header">
        <div className="ax-desktop-logo-wrap">
          <Image
            src="/favicon.png"
            alt=""
            width={26}
            height={26}
            className="ax-desktop-logo"
          />
          <span className="ax-desktop-title">AXSHARE</span>
        </div>
        <div className="ax-desktop-services-badge">
          <span className="ax-desktop-dot ax-desktop-dot-on" />
          Servizi attivi
        </div>
      </header>

      <div className="ax-desktop-dashboard-body">
        {/* Sync status — come nel mock */}
        <section className="ax-desktop-section ax-desktop-sync-block">
          <div className="ax-desktop-sync-line">
            <div className="ax-desktop-sync-row">
              <span className="ax-desktop-dot ax-desktop-dot-on" />
              <span>
                {syncProgress?.status === 'syncing'
                  ? 'Sincronizzazione in tempo reale'
                  : 'Tutto sincronizzato'}
              </span>
              <span className="ax-desktop-muted">· {syncTime}</span>
            </div>
            <div className="ax-desktop-btn-row">
              <button
                type="button"
                className={`ax-desktop-btn ax-desktop-btn-icon ax-desktop-btn-sync-toggle ${syncProgress?.status === 'syncing' ? 'ax-desktop-btn-sync-pause' : 'ax-desktop-btn-sync-play'}`}
                onClick={syncProgress?.status === 'syncing' ? handlePauseSync : handleSyncNow}
                disabled={syncLoading}
                aria-label={syncProgress?.status === 'syncing' ? 'Pausa' : 'Sincronizza ora'}
                title={syncProgress?.status === 'syncing' ? 'Pausa' : 'Sincronizza ora'}
              >
                {syncProgress?.status === 'syncing' ? '⏸' : '▶'}
              </button>
              <button
                type="button"
                className="ax-desktop-btn ax-desktop-btn-icon"
                onClick={handlePauseSync}
                disabled={syncProgress?.status !== 'syncing'}
                aria-label="Pausa"
                title="Pausa"
              >
                ⏸
              </button>
            </div>
          </div>
        </section>

        {/* Cartelle — scroll solo qui */}
        <section className="ax-desktop-section ax-desktop-section-has-list">
          <h2 className="ax-desktop-section-title">CARTELLE</h2>
          <div className="ax-desktop-folders-list">
            {rootFolders.length === 0 ? (
              <p className="ax-desktop-muted" style={{ fontSize: 12, margin: 0 }}>
                Nessuna cartella in root
              </p>
            ) : (
              rootFolders.map((folder) => (
                <div key={folder.id} className="ax-desktop-folder-row">
                  <span className="ax-desktop-folder-icon" aria-hidden>📁</span>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {decryptedFolderNames[folder.id] ?? folder.name_encrypted ?? 'Cartella'}
                  </span>
                  <span className="ax-desktop-folder-meta" title="Ultima modifica">
                    {formatFolderDateTime(folder.updated_at, folder.created_at)}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Ultimi file — scroll solo qui */}
        <section className="ax-desktop-section ax-desktop-section-has-list">
          <h2 className="ax-desktop-section-title">ULTIMI FILE</h2>
          <div className="ax-desktop-activity-list">
            {fileActivity.length === 0 ? (
              <p className="ax-desktop-muted" style={{ fontSize: 12, margin: 0, padding: 8 }}>
                Nessuna attività recente
              </p>
            ) : (
              fileActivity.map((log) => {
                const label = ACTION_LABELS[log.action] ?? log.action
                const displayName = decryptedActivityFileNames[log.target_id] ?? log.target_name ?? 'File'
                const iconSrc = displayName.endsWith('.axshare')
                  ? getAxshareFileIcon(displayName)
                  : getFileIcon(displayName)
                return (
                  <div key={log.id} className="ax-desktop-activity-row">
                    <img
                      src={iconSrc}
                      alt=""
                      className="ax-desktop-activity-file-icon"
                    />
                    <span className="ax-desktop-activity-label" title={displayName}>
                      {label} {displayName}
                    </span>
                    <span className="ax-desktop-activity-meta" title="Data e ora">
                      {formatFolderDateTime(undefined, log.created_at)}
                    </span>
                  </div>
                )
              })
            )}
          </div>
        </section>

        {/* Storage — stessi dati e stile della sidebar web (reportsApi.getMyDashboard) */}
        <section className="ax-desktop-section ax-desktop-storage-wrap">
          <div className="ax-desktop-storage-label">
            Spazio usato <span className="ax-desktop-storage-pct">{Math.round(storagePct)}%</span>
          </div>
          <div className="ax-desktop-storage-bar">
            <div
              className="ax-desktop-storage-fill"
              style={{ width: `${storagePct}%` }}
              role="progressbar"
              aria-valuenow={storagePct}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
          <div className="ax-desktop-storage-sub">
            {storageReport
              ? `${formatFileSize(storageUsed)} di ${formatFileSize(storageQuota)} usati`
              : '0 B di 1.0 GB usati'}
          </div>
        </section>

        {/* Disco virtuale + Stato sessione (compatto) */}
        <div className="ax-desktop-dashboard-grid">
          <section className="ax-desktop-section">
            <h2 className="ax-desktop-section-title">DISCO VIRTUALE</h2>
            <div className="ax-desktop-card ax-desktop-disk-row">
              <div className="ax-desktop-disk-path">💿 {getDefaultMountPoint()}</div>
              <div className="ax-desktop-disk-actions">
                <button
                  type="button"
                  className={`ax-desktop-btn ax-desktop-btn-icon ax-desktop-disk-icon ${diskMounted ? 'ax-desktop-disk-icon-active' : ''}`}
                  onClick={diskMounted ? () => setShowUnmountConfirm(true) : handleMountDisk}
                  disabled={mountLoading}
                  aria-label={diskMounted ? 'Smonta disco' : 'Monta disco'}
                  title={diskMounted ? 'Smonta disco (clicca per conferma)' : 'Monta disco'}
                >
                  <img
                    src={diskMounted ? '/icons/Hard_Disk_active.png' : '/icons/Hard_Disk_off.png'}
                    alt=""
                    className="ax-desktop-disk-icon-img"
                  />
                </button>
                {mountError && (
                  <p className="ax-desktop-mount-error" role="alert">
                    {mountError}
                  </p>
                )}
              </div>
            </div>
          </section>
          <section className="ax-desktop-section">
            <h2 className="ax-desktop-section-title">SESSIONE</h2>
            <div className="ax-desktop-card">
              <div className="ax-desktop-session-line">
                {sessionLocked ? '🔒 Bloccata' : '🔒 Attiva'}
              </div>
              <div className="ax-desktop-session-email" style={{ marginBottom: 0 }}>
                {(user?.email ?? email) || '—'}
              </div>
              <div className="ax-desktop-session-keys">
                <div className="ax-desktop-session-key-row">
                  <span className="ax-desktop-session-key-label">Chiave pubblica</span>
                  <span
                    className={`ax-desktop-dot ${backendOk === false ? 'ax-desktop-dot-off' : user?.has_public_key ? 'ax-desktop-dot-on' : 'ax-desktop-dot-off'}`}
                    aria-label={user?.has_public_key && backendOk !== false ? 'Attiva' : 'Non attiva'}
                  />
                </div>
                <div className="ax-desktop-session-key-row">
                  <span className="ax-desktop-session-key-label">Chiave privata</span>
                  <span
                    className={`ax-desktop-dot ${backendOk === false ? 'ax-desktop-dot-off' : hasSessionKey ? 'ax-desktop-dot-on' : 'ax-desktop-dot-off'}`}
                    aria-label={hasSessionKey && backendOk !== false ? 'Attiva' : 'Non attiva'}
                  />
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* File locali .axshare */}
        <section className="ax-desktop-section">
          <div className="ax-desktop-local-files">
            <span>{offlineCount} file cifrati locali</span>
          </div>
        </section>
      </div>

      <div className="ax-desktop-footer-actions">
        <button
          type="button"
          className="ax-desktop-btn ax-desktop-btn-web"
          onClick={async () => {
            if (
              typeof window !== 'undefined' &&
              (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
            ) {
              const { invoke } = await import('@tauri-apps/api/core')
              await invoke('open_url_external', {
                url: 'http://localhost:3000/dashboard',
              })
            }
          }}
        >
          🌐 Apri web app
        </button>
        <button
          type="button"
          className="ax-desktop-btn ax-desktop-btn-logout"
          onClick={() => {
            console.log('[LOGOUT] Bottone Logout cliccato (onClick)')
            void handleLockSession()
          }}
        >
          Logout
        </button>
      </div>

      {showUnmountConfirm && (
        <div className="ax-desktop-overlay" role="dialog" aria-modal="true" aria-labelledby="ax-desktop-unmount-title">
          <div className="ax-desktop-confirm-modal">
            <h3 id="ax-desktop-unmount-title" className="ax-desktop-confirm-title">Smontare il disco virtuale?</h3>
            <p className="ax-desktop-confirm-text">Il disco {getDefaultMountPoint()} verrà smontato.</p>
            <div className="ax-desktop-confirm-actions">
              <button
                type="button"
                className="ax-desktop-btn ax-desktop-btn-secondary"
                onClick={() => setShowUnmountConfirm(false)}
              >
                Annulla
              </button>
              <button
                type="button"
                className="ax-desktop-btn ax-desktop-btn-primary"
                onClick={handleUnmountDisk}
                disabled={mountLoading}
              >
                {mountLoading ? '...' : 'Smonta'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
