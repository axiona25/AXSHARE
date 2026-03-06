'use client'

import { useEffect, useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuthContext } from '@/context/AuthContext'
import { useSyncContext } from '@/context/SyncContext'
import { useNotifications } from '@/hooks/useNotifications'
import { SyncStatusBar } from '@/components/SyncStatusBar'
import PinSetup from '@/components/PinSetup'
import { usersApi } from '@/lib/api'
import { keyManager } from '@/lib/keyManager'
import { isDesktop, isRunningInTauri } from '@/lib/tauri'

export default function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const router = useRouter()
  const { user, logout, isLoading, hasSessionKey, setSessionKey, clearSessionKey } = useAuthContext()
  const syncContext = useSyncContext()
  const { unreadCount } = useNotifications()

  const [showUnlockModal, setShowUnlockModal] = useState(false)

  // Flusso: 1) non autenticato → login  2) autenticato + chiavi ma no sessione → modal PIN  3) tutto ok (dashboard accessibile sempre dopo login)
  useEffect(() => {
    const pathname = typeof window !== 'undefined' ? window.location.pathname : ''
    console.log('[LAYOUT DEBUG]', {
      isLoading,
      user: user?.email,
      has_public_key: user?.has_public_key,
      hasSessionKey,
      isTauri: isRunningInTauri(),
      pathname,
    })

    if (isLoading) {
      console.log('[LAYOUT] Attendo fine loading...')
      return
    }

    // 1. Se non autenticato → login
    if (!user) {
      console.log('[LAYOUT] Nessun utente, redirect login')
      router.replace('/login')
      return
    }

    // 2. Se autenticato + chiavi ma no sessione → modal PIN (secondo fattore dopo login)
    if (user.has_public_key && !hasSessionKey) {
      console.log('[LAYOUT] Mostro modal unlock PIN')
      setShowUnlockModal(true)
      return
    }

    // 3. Tutto ok (PIN non configurato → banner in dashboard; PIN configurato e sbloccato → accesso completo)
    setShowUnlockModal(false)
    console.log('[LAYOUT] Tutto ok, dashboard')
  }, [isLoading, user, hasSessionKey, router])

  useEffect(() => {
    if (!isLoading && user?.has_public_key && !hasSessionKey) {
      setShowUnlockModal(true)
    }
  }, [isLoading, user, hasSessionKey])

  const handlePinUnlock = useCallback(async (pin: string) => {
    if (!user?.email) throw new Error('Utente non trovato')
    const resp = await usersApi.getPrivateKey()
    const bundle = resp.data?.encrypted_private_key
    if (!bundle) throw new Error('Chiave privata non trovata')
    const privateKey = await keyManager.unlockWithPin(user.email, pin, bundle)
    setSessionKey(privateKey)
    setShowUnlockModal(false)
  }, [user?.email, setSessionKey])

  // Desktop: niente wizard setup chiavi; se non ha PIN → vai a Impostazioni/Sicurezza
  useEffect(() => {
    if (!user || isLoading || typeof window === 'undefined') return
    if (!isDesktop()) return

    const onboardingDone = localStorage.getItem('axshare_desktop_onboarding')
    if (!onboardingDone && !user.has_public_key) {
      const onSettings = window.location.pathname.startsWith('/settings')
      if (!onSettings) router.push('/settings/security')
      return
    }
    if (user.has_public_key) {
      localStorage.setItem('axshare_desktop_onboarding', 'true')
    }
  }, [user, isLoading, router])

  // Aggiorna tooltip tray in base a stato sync/sessione (desktop)
  useEffect(() => {
    if (!isDesktop() || typeof window === 'undefined') return
    const status =
      !hasSessionKey ? 'locked'
      : syncContext?.syncState === 'syncing' ? 'syncing'
      : syncContext?.syncState === 'error' ? 'error'
      : 'connected'
    import('@tauri-apps/api/core').then(({ invoke }) => {
      invoke('set_tray_status', { status }).catch(() => {})
    })
  }, [hasSessionKey, syncContext?.syncState])

  // Eventi dal tray (desktop): sync, blocca sessione, esci
  useEffect(() => {
    if (!isDesktop()) return
    let unlistenSync: (() => void) | undefined
    let unlistenLock: (() => void) | undefined
    let unlistenQuit: (() => void) | undefined

    const setupListeners = async () => {
      const { listen } = await import('@tauri-apps/api/event')
      unlistenSync = await listen('tray-sync', () => {
        console.log('[TRAY] Sync richiesto')
        window.dispatchEvent(new CustomEvent('axshare-sync'))
      })
      unlistenLock = await listen('tray-lock-session', async () => {
        console.log('[TRAY] Lock sessione')
        if (isRunningInTauri()) {
          try {
            const { invoke } = await import('@tauri-apps/api/core')
            await invoke('unmount_virtual_disk')
          } catch {
            // ignora se non montato o errore
          }
        }
        clearSessionKey()
        setShowUnlockModal(true)
      })
      unlistenQuit = await listen('tray-quit', async () => {
        console.log('[TRAY] Quit')
        try {
          const { invoke } = await import('@tauri-apps/api/core')
          await invoke('unmount_virtual_disk')
        } catch {
          // ignora se non montato o errore
        }
        await logout()
      })
    }
    setupListeners()

    return () => {
      unlistenSync?.()
      unlistenLock?.()
      unlistenQuit?.()
    }
  }, [clearSessionKey, logout])

  const handleLogout = useCallback(async () => {
    await logout()
    router.push('/login')
  }, [logout, router])

  if (isLoading) return <p data-testid="app-loading">Caricamento...</p>
  if (!user) return null

  return (
    <div>
      <nav data-testid="navbar">
        <span><strong>AXSHARE</strong></span>
        <span> | </span>
        <Link href="/dashboard" data-testid="nav-dashboard">Dashboard</Link>
        {isDesktop() && (
          <>
            <span> | </span>
            <Link href="/desktop/sync" data-testid="nav-sync">
              {syncContext?.syncState === 'syncing' && (
                <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }} title="Sincronizzazione in corso">🔄</span>
              )}
              {syncContext?.syncState === 'success' && syncContext?.lastSync != null && (
                <span title={`Sincronizzato il ${syncContext.lastSync.toLocaleString('it')}`}>✅</span>
              )}
              {syncContext?.syncState === 'error' && (
                <span title="Errore sincronizzazione">❌</span>
              )}
              {' Sync'}
            </Link>
          </>
        )}
        <span> | </span>
        <Link href="/settings" data-testid="nav-settings">Impostazioni</Link>
        {user.role === 'admin' && (
          <>
            <span> | </span>
            <Link href="/admin" data-testid="nav-admin">Admin</Link>
          </>
        )}
        <span> | </span>
        <Link href="/notifications" data-testid="nav-notifications">
          Notifiche {unreadCount > 0 && `(${unreadCount})`}
        </Link>
        <span> | </span>
        <span data-testid="nav-user">{user.email}</span>
        <span> | </span>
        {typeof window !== 'undefined' && isDesktop() && process.env.NODE_ENV === 'development' && (
          <>
            <button
              type="button"
              onClick={async () => {
                try {
                  const { invoke } = await import('@tauri-apps/api/core')
                  await invoke('open_devtools')
                } catch (e) {
                  console.error('[DevTools]', e)
                }
              }}
              data-testid="devtools-button"
            >
              [DEV] DevTools
            </button>
            <span> | </span>
          </>
        )}
        <button
          type="button"
          onClick={handleLogout}
          data-testid="logout-button"
        >
          Esci
        </button>
      </nav>
      <SyncStatusBar />

      <hr />

      {showUnlockModal && user && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
        >
          <PinSetup
            mode="unlock"
            email={user.email ?? ''}
            onComplete={handlePinUnlock}
          />
        </div>
      )}

      <main>
        {children}
      </main>
    </div>
  )
}
