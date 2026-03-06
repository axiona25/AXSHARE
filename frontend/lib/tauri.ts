/**
 * Bridge Tauri per il frontend.
 * Rileva se siamo in ambiente Tauri e fornisce API unificate.
 * Nel browser normale tutte le funzioni sono no-op o usano localStorage.
 */

declare global {
  interface Window {
    __TAURI__?: unknown
  }
}

export const isTauri = (): boolean =>
  typeof window !== 'undefined' && !!window.__TAURI__

/** Alias for Tauri desktop environment (used by desktop-only UI). */
export const isDesktop = isTauri

// ─── Session lock / Vault ─────────────────────────────────────────────────────

export async function lockSession(): Promise<void> {
  if (!isTauri()) return
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('lock_session')
}

export async function unlockSession(): Promise<void> {
  if (!isTauri()) return
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('unlock_session')
}

/** Lock vault (desktop): same as lock_session. */
export async function lockVault(): Promise<void> {
  await lockSession()
}

/** Unlock vault (desktop): same as unlock_session. Passphrase for future use. */
export async function unlockVault(_passphrase: string): Promise<void> {
  await unlockSession()
}

export async function isSessionLocked(): Promise<boolean> {
  if (!isTauri()) return false
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<boolean>('is_session_locked')
}

// ─── Keychain ─────────────────────────────────────────────────────────────────

export async function saveTokenSecure(
  key: string,
  value: string
): Promise<void> {
  if (!isTauri()) {
    if (typeof window !== 'undefined') localStorage.setItem(key, value)
    return
  }
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('save_token', { key, value })
}

export async function getTokenSecure(key: string): Promise<string | null> {
  if (!isTauri()) {
    if (typeof window === 'undefined') return null
    return localStorage.getItem(key)
  }
  const { invoke } = await import('@tauri-apps/api/core')
  const result = await invoke<string | null>('get_token', { key })
  return result
}

export async function deleteTokenSecure(key: string): Promise<void> {
  if (!isTauri()) {
    if (typeof window !== 'undefined') localStorage.removeItem(key)
    return
  }
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('delete_token', { key })
}

// ─── Virtual disk ─────────────────────────────────────────────────────────────

export async function getVirtualDiskStatus(): Promise<{
  mounted: boolean
}> {
  if (!isTauri()) return { mounted: false }
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<{ mounted: boolean }>('get_virtual_disk_status')
}

// ─── Tray events listener ─────────────────────────────────────────────────────

export async function onSessionLock(
  callback: () => void
): Promise<() => void> {
  if (!isTauri()) return () => {}
  const { listen } = await import('@tauri-apps/api/event')
  const unlisten = await listen('session-lock', () => callback())
  return unlisten
}

export async function onToggleVirtualDisk(
  callback: () => void
): Promise<() => void> {
  if (!isTauri()) return () => {}
  const { listen } = await import('@tauri-apps/api/event')
  const unlisten = await listen('toggle-virtual-disk', () => callback())
  return unlisten
}

/** Subscribe to deep-link URLs (e.g. axshare://invite/TOKEN). Calls handler with the path to open. */
export async function onDeepLink(handler: (path: string) => void): Promise<() => void> {
  if (!isTauri()) return () => {}
  const { listen } = await import('@tauri-apps/api/event')
  const unlisten = await listen<unknown>('deep-link://new-url', (event) => {
    const raw = event.payload
    const urls = Array.isArray(raw) ? raw : [raw]
    for (const u of urls) {
      const href = typeof u === 'string' ? u : (u as { href?: string })?.href ?? (u as { path?: string })?.path
      if (typeof href !== 'string') continue
      if (href.startsWith('axshare://invite/')) {
        handler('/invite/' + href.replace('axshare://invite/', ''))
        return
      }
      if (href.startsWith('axshare://share/')) {
        handler('/share/' + href.replace('axshare://share/', ''))
        return
      }
    }
  })
  return unlisten
}

// ─── App version ─────────────────────────────────────────────────────────────

export async function getAppVersion(): Promise<string> {
  if (!isTauri()) return 'web'
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<string>('get_app_version')
}

// ─── Auto-lock ───────────────────────────────────────────────────────────────

export async function setAutoLockTimeout(minutes: number): Promise<void> {
  if (!isTauri()) return
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('set_autolock_timeout', { minutes })
}

export async function setAutoLockEnabled(enabled: boolean): Promise<void> {
  if (!isTauri()) return
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('set_autolock_enabled', { enabled })
}

export async function registerUserActivity(): Promise<void> {
  if (!isTauri()) return
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('register_user_activity')
}

// ─── Notifiche ───────────────────────────────────────────────────────────────

export async function sendNativeNotification(
  title: string,
  body: string
): Promise<void> {
  if (!isTauri()) {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body })
    }
    return
  }
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('show_notification', { payload: { title, body } })
}

export async function notifyFileShared(
  sender: string,
  filename: string
): Promise<void> {
  if (!isTauri()) {
    return sendNativeNotification(
      'File condiviso',
      `${sender} ha condiviso "${filename}"`
    )
  }
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('notify_file_shared', { sender, filename })
}

export async function notifyPermissionExpiring(
  filename: string,
  minutes: number
): Promise<void> {
  if (!isTauri()) {
    return sendNativeNotification(
      'Permesso in scadenza',
      `"${filename}" scade tra ${minutes} min`
    )
  }
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('notify_permission_expiring', { filename, minutes })
}

export async function notifyFileDestroyed(filename: string): Promise<void> {
  if (!isTauri()) {
    return sendNativeNotification(
      'File distrutto',
      `"${filename}" è stato auto-distrutto`
    )
  }
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('notify_file_destroyed', { filename })
}

export async function notifySyncComplete(count: number): Promise<void> {
  if (!isTauri()) {
    return sendNativeNotification(
      'Sincronizzazione completata',
      `${count} file sincronizzati`
    )
  }
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('notify_sync_complete', { count })
}

// ─── File system / Drag & Drop ────────────────────────────────────────────────

export async function pickFiles(multiple = true): Promise<string[]> {
  if (!isTauri()) return []
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<string[]>('pick_files_dialog', { multiple })
}

export async function readFileForUpload(path: string): Promise<Uint8Array> {
  if (!isTauri()) throw new Error('readFileForUpload disponibile solo in Tauri')
  const { invoke } = await import('@tauri-apps/api/core')
  const bytes = await invoke<number[]>('read_file_for_upload', { path })
  return new Uint8Array(bytes)
}

export async function getFileMetadata(path: string): Promise<{
  path: string
  filename: string
  size: number
  is_file: boolean
}> {
  if (!isTauri()) throw new Error('Solo in Tauri')
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke('get_file_metadata', { path })
}

export async function onFilesDropped(
  callback: (paths: string[]) => void
): Promise<() => void> {
  if (!isTauri()) return () => {}
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const window = getCurrentWindow()
  return window.onDragDropEvent((event) => {
    if (event.payload.type === 'drop') {
      callback(event.payload.paths ?? [])
    }
  })
}

// ─── Disco virtuale ──────────────────────────────────────────────────────────

export async function mountVirtualDisk(mountPoint: string): Promise<void> {
  if (!isTauri()) throw new Error('Solo in Tauri')
  const { invoke } = await import('@tauri-apps/api/core')
  const { getAccessTokenSecure } = await import('@/lib/auth')
  const token = await getAccessTokenSecure()
  if (!token) throw new Error('Non autenticato')
  await invoke('mount_virtual_disk', {
    mount_point: mountPoint,
    jwt_token: token,
  })
}

/** Mount virtual disk using default mount point and current auth token (e.g. after onboarding). */
export async function mountVirtualDiskWithPassphrase(_passphrase: string): Promise<void> {
  if (!isTauri()) return
  await mountVirtualDisk(getDefaultMountPoint())
}

export async function unmountVirtualDisk(): Promise<void> {
  if (!isTauri()) return
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('unmount_virtual_disk')
}

export function getDefaultMountPoint(): string {
  if (typeof navigator !== 'undefined' && navigator.platform?.toLowerCase().includes('win')) {
    return 'Z:\\'
  }
  return '/Volumes/AXSHARE'
}

// ─── Sync offline & cache ────────────────────────────────────────────────────

export interface SyncProgress {
  status: string
  current_file?: string
  total: number
  done: number
  last_sync: number
}

export async function setSyncToken(token: string): Promise<void> {
  if (!isTauri()) return
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('set_sync_token', { jwt_token: token })
}

export async function startSync(): Promise<SyncProgress> {
  if (!isTauri()) return { status: 'unavailable', total: 0, done: 0, last_sync: 0 }
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<SyncProgress>('start_sync')
}

export async function pauseSync(): Promise<void> {
  if (!isTauri()) return
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('pause_sync')
}

export async function resumeSync(): Promise<void> {
  if (!isTauri()) return
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('resume_sync')
}

export async function getSyncStatus(): Promise<SyncProgress> {
  if (!isTauri()) return { status: 'unavailable', total: 0, done: 0, last_sync: 0 }
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<SyncProgress>('get_sync_status')
}

export async function enableOfflineFile(fileId: string): Promise<void> {
  if (!isTauri()) return
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('enable_offline_file', { file_id: fileId })
}

export async function disableOfflineFile(fileId: string): Promise<void> {
  if (!isTauri()) return
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('disable_offline_file', { file_id: fileId })
}

export async function getOfflineFiles(): Promise<unknown[]> {
  if (!isTauri()) return []
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<unknown[]>('list_offline_files')
}

export async function getCacheInfo(): Promise<{
  size_bytes: number
  size_mb: number
}> {
  if (!isTauri()) return { size_bytes: 0, size_mb: 0 }
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke('get_cache_info')
}

export async function clearLocalCache(): Promise<void> {
  if (!isTauri()) return
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('clear_cache')
}
