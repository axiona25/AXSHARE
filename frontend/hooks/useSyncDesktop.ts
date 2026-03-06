'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useAuthContext } from '@/context/AuthContext'
import { useSyncContext } from '@/context/SyncContext'
import { useFileEvents } from '@/hooks/useFileEvents'
import { foldersApi, filesApi } from '@/lib/api'
import {
  decryptFileKeyWithRSA,
  decryptFileChunked,
  base64ToBytes,
} from '@/lib/crypto'
import type { RootFileItem } from '@/types'

export interface SyncedFile {
  id: string
  name: string
  size: number
  updatedAt: string | null
  synced: boolean
}

export function useSyncDesktop() {
  const { user, sessionPrivateKey } = useAuthContext()
  const syncContext = useSyncContext()

  const [syncedFiles, setSyncedFiles] = useState<SyncedFile[]>([])
  const [progress, setProgress] = useState(0)
  const [autoSyncIntervalMinutes, setAutoSyncIntervalMinutes] = useState<
    number | null
  >(null)
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(false)

  const syncNow = useCallback(async () => {
    if (!user?.id || !sessionPrivateKey || !syncContext) return

    syncContext.setSyncState('syncing')
    setProgress(0)

    try {
      const resp = await foldersApi.listRootFiles()
      const files = resp.data
      setProgress(30)

      const decrypted: SyncedFile[] = []
      const total = files.length

      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        try {
          const keyResp = await filesApi.getKey(file.id)
          const fileKey = await decryptFileKeyWithRSA(
            keyResp.data.file_key_encrypted,
            sessionPrivateKey
          )
          const nameBytes = base64ToBytes(file.name_encrypted)
          const decryptedName = await decryptFileChunked(
            nameBytes,
            fileKey,
            user.id
          )
          decrypted.push({
            id: file.id,
            name: new TextDecoder().decode(decryptedName),
            size: file.size ?? 0,
            updatedAt: file.updated_at ?? null,
            synced: true,
          })
        } catch {
          decrypted.push({
            id: file.id,
            name: file.name_encrypted,
            size: file.size ?? 0,
            updatedAt: file.updated_at ?? null,
            synced: false,
          })
        }
        setProgress(30 + Math.round(((i + 1) / total) * 60))
      }

      setSyncedFiles(decrypted)
      setProgress(100)
      const now = new Date()
      syncContext.setLastSync(now)
      syncContext.setSyncState('success')
    } catch (err) {
      console.error('[SYNC] Errore:', err)
      syncContext.setSyncState('error')
    }
  }, [user?.id, sessionPrivateKey, syncContext])

  const syncNowRef = useRef(syncNow)
  syncNowRef.current = syncNow
  useFileEvents((event) => {
    if (event.type === 'file_created' || event.type === 'file_deleted') {
      syncNowRef.current()
    }
  })

  // Tray "Sincronizza ora" → custom event axshare-sync
  useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = () => syncNowRef.current()
    window.addEventListener('axshare-sync', handler)
    return () => window.removeEventListener('axshare-sync', handler)
  }, [])

  const startAutoSync = useCallback((intervalMinutes: number) => {
    setAutoSyncIntervalMinutes(intervalMinutes)
    setAutoSyncEnabled(true)
    if (typeof window !== 'undefined') {
      localStorage.setItem('axshare_sync_interval', String(intervalMinutes))
      localStorage.setItem('axshare_sync_auto', 'true')
    }
  }, [])

  const stopAutoSync = useCallback(() => {
    setAutoSyncEnabled(false)
    setAutoSyncIntervalMinutes(null)
    if (typeof window !== 'undefined') {
      localStorage.setItem('axshare_sync_auto', 'false')
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const interval = localStorage.getItem('axshare_sync_interval')
    const auto = localStorage.getItem('axshare_sync_auto')
    if (auto === 'true' && interval) {
      const min = parseInt(interval, 10)
      if ([5, 15, 30, 60].includes(min)) {
        setAutoSyncIntervalMinutes(min)
        setAutoSyncEnabled(true)
      }
    }
  }, [])

  useEffect(() => {
    if (
      !autoSyncEnabled ||
      autoSyncIntervalMinutes == null ||
      !syncContext ||
      !user?.id ||
      !sessionPrivateKey
    )
      return
    const ms = autoSyncIntervalMinutes * 60 * 1000
    const id = setInterval(syncNow, ms)
    return () => clearInterval(id)
  }, [
    autoSyncEnabled,
    autoSyncIntervalMinutes,
    syncContext,
    user?.id,
    sessionPrivateKey,
    syncNow,
  ])

  return {
    syncState: syncContext?.syncState ?? 'idle',
    lastSync: syncContext?.lastSync ?? null,
    syncedFiles,
    progress,
    syncNow,
    startAutoSync,
    stopAutoSync,
    autoSyncEnabled,
    autoSyncIntervalMinutes,
    setAutoSyncEnabled,
    setAutoSyncIntervalMinutes,
  }
}
