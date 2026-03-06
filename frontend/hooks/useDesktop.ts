/**
 * Hook per funzionalità desktop native (solo Tauri).
 * In ambiente web tutte le funzioni sono no-op.
 */

'use client'

import { useCallback, useEffect, useRef } from 'react'
import {
  getFileMetadata,
  isTauri,
  onFilesDropped,
  onSessionLock,
  pickFiles,
  readFileForUpload,
  setAutoLockEnabled,
  setAutoLockTimeout,
  registerUserActivity,
  notifyFileShared,
  notifyPermissionExpiring,
  notifyFileDestroyed,
} from '@/lib/tauri'

interface UseDesktopOptions {
  onSessionLock?: () => void
  onFilesDropped?: (
    files: Array<{ name: string; size: number; bytes: Uint8Array }>
  ) => void
  autoLockMinutes?: number
}

export function useDesktop(options: UseDesktopOptions = {}) {
  const activityThrottle = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Setup auto-lock
  useEffect(() => {
    if (!isTauri()) return
    if (options.autoLockMinutes !== undefined) {
      setAutoLockTimeout(options.autoLockMinutes)
      setAutoLockEnabled(options.autoLockMinutes > 0)
    }
  }, [options.autoLockMinutes])

  // Listener session lock dal tray
  useEffect(() => {
    if (!isTauri() || !options.onSessionLock) return
    let cleanup: (() => void) | undefined
    onSessionLock(() => options.onSessionLock!()).then((fn) => {
      cleanup = fn
    })
    return () => {
      cleanup?.()
    }
  }, [options.onSessionLock])

  // Drag & drop dal filesystem
  useEffect(() => {
    if (!isTauri() || !options.onFilesDropped) return
    let cleanup: (() => void) | undefined
    onFilesDropped(async (paths) => {
      const files = await Promise.all(
        paths
          .filter((p) => !p.endsWith('/'))
          .map(async (path) => {
            const meta = await getFileMetadata(path)
            const bytes = await readFileForUpload(path)
            return { name: meta.filename, size: meta.size, bytes }
          })
      )
      options.onFilesDropped!(files)
    }).then((fn) => {
      cleanup = fn
    })
    return () => {
      cleanup?.()
    }
  }, [options.onFilesDropped])

  // Registra attività utente (throttled) per reset auto-lock
  const handleActivity = useCallback(() => {
    if (!isTauri()) return
    if (activityThrottle.current) return
    activityThrottle.current = setTimeout(() => {
      registerUserActivity()
      activityThrottle.current = null
    }, 5000) // throttle 5s
  }, [])

  // Picker file nativo
  const openFilePicker = useCallback(async (multiple = true) => {
    if (!isTauri()) return []
    const paths = await pickFiles(multiple)
    return Promise.all(
      paths.map(async (path) => {
        const meta = await getFileMetadata(path)
        const bytes = await readFileForUpload(path)
        return { name: meta.filename, size: meta.size, bytes }
      })
    )
  }, [])

  return {
    isTauri: isTauri(),
    handleActivity,
    openFilePicker,
    notifyFileShared,
    notifyPermissionExpiring,
    notifyFileDestroyed,
  }
}
