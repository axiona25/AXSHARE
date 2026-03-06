'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  clearLocalCache,
  getCacheInfo,
  getOfflineFiles,
  getSyncStatus,
  isTauri,
  startSync,
  pauseSync,
  resumeSync,
  enableOfflineFile,
  disableOfflineFile,
} from '@/lib/tauri'

export function useSync() {
  const [status, setStatus] = useState<string>('idle')
  const [progress, setProgress] = useState({ total: 0, done: 0, last_sync: 0 })
  const [currentFile, setCurrentFile] = useState<string | undefined>()
  const [offlineFiles, setOfflineFiles] = useState<unknown[]>([])
  const [cacheInfo, setCacheInfo] = useState({ size_bytes: 0, size_mb: 0 })

  useEffect(() => {
    if (!isTauri()) return
    const interval = setInterval(async () => {
      const s = await getSyncStatus()
      setStatus(s.status)
      setProgress({ total: s.total, done: s.done, last_sync: s.last_sync })
      setCurrentFile(s.current_file)
    }, 2000)
    return () => clearInterval(interval)
  }, [])

  const triggerSync = useCallback(async () => {
    const result = await startSync()
    setStatus(result.status)
  }, [])

  const toggleOffline = useCallback(
    async (fileId: string, enabled: boolean) => {
      if (enabled) await enableOfflineFile(fileId)
      else await disableOfflineFile(fileId)
      const files = await getOfflineFiles()
      setOfflineFiles(files)
      const info = await getCacheInfo()
      setCacheInfo(info)
    },
    []
  )

  const clearCache = useCallback(async () => {
    await clearLocalCache()
    setOfflineFiles([])
    setCacheInfo({ size_bytes: 0, size_mb: 0 })
  }, [])

  useEffect(() => {
    if (!isTauri()) return
    Promise.all([getOfflineFiles(), getCacheInfo()]).then(([files, info]) => {
      setOfflineFiles(files)
      setCacheInfo(info)
    })
  }, [])

  return {
    status,
    progress,
    currentFile,
    isSyncing: status === 'syncing',
    offlineFiles,
    cacheInfo,
    triggerSync,
    pauseSync,
    resumeSync,
    toggleOffline,
    clearCache,
  }
}
