'use client'

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from 'react'

export type DesktopSyncState = 'idle' | 'syncing' | 'success' | 'error'

interface SyncContextValue {
  syncState: DesktopSyncState
  lastSync: Date | null
  setSyncState: (s: DesktopSyncState) => void
  setLastSync: (d: Date | null) => void
}

const SyncContext = createContext<SyncContextValue | null>(null)

export function SyncProvider({ children }: { children: ReactNode }) {
  const [syncState, setSyncState] = useState<DesktopSyncState>('idle')
  const [lastSync, setLastSync] = useState<Date | null>(() => {
    if (typeof window === 'undefined') return null
    const s = localStorage.getItem('axshare_last_sync')
    return s ? new Date(s) : null
  })

  const setLastSyncAndStore = useCallback((d: Date | null) => {
    setLastSync(d)
    if (typeof window !== 'undefined') {
      if (d) localStorage.setItem('axshare_last_sync', d.toISOString())
      else localStorage.removeItem('axshare_last_sync')
    }
  }, [])

  return (
    <SyncContext.Provider
      value={{
        syncState,
        lastSync,
        setSyncState,
        setLastSync: setLastSyncAndStore,
      }}
    >
      {children}
    </SyncContext.Provider>
  )
}

export function useSyncContext(): SyncContextValue | null {
  return useContext(SyncContext)
}
