'use client'

import { useEffect, useCallback, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuthContext } from '@/context/AuthContext'
import { useSyncContext } from '@/context/SyncContext'
import { useNotifications } from '@/hooks/useNotifications'
import { SyncStatusBar } from '@/components/SyncStatusBar'
import PinSetup from '@/components/PinSetup'
import { usersApi, notificationsApi } from '@/lib/api'
import { keyManager } from '@/lib/keyManager'
import { isDesktop, isRunningInTauri } from '@/lib/tauri'

export default function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const router = useRouter()
  const { user, logout, isLoading, hasSessionKey, isRestoringSessionKey, setSessionKey, clearSessionKey } = useAuthContext()
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

    // 2. Se autenticato + chiavi ma no sessione → modal PIN (solo dopo aver tentato il ripristino da sessionStorage, per evitare flash)
    if (user.has_public_key && !hasSessionKey && !isRestoringSessionKey) {
      console.log('[LAYOUT] Mostro modal unlock PIN')
      setShowUnlockModal(true)
      return
    }

    // 3. Tutto ok (PIN non configurato → banner in dashboard; PIN configurato e sbloccato → accesso completo)
    setShowUnlockModal(false)
    console.log('[LAYOUT] Tutto ok, dashboard')
  }, [isLoading, user, hasSessionKey, isRestoringSessionKey, router])

  useEffect(() => {
    if (!isLoading && user?.has_public_key && !hasSessionKey && !isRestoringSessionKey) {
      setShowUnlockModal(true)
    }
  }, [isLoading, user, hasSessionKey, isRestoringSessionKey])

  const handlePinUnlock = useCallback(async (pin: string) => {
    if (!user?.email) throw new Error('Utente non trovato')
    const resp = await usersApi.getPrivateKey()
    const bundle = resp.data?.encrypted_private_key
    if (!bundle) throw new Error('Chiave privata non trovata')
    const privateKey = await keyManager.unlockWithPin(user.email, pin, bundle)
    setSessionKey(privateKey)
    if (typeof window !== 'undefined') sessionStorage.setItem('axshare_session_pin', pin)
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

  const prevUnreadCountRef = useRef(0)
  const lastNotifRef = useRef<string | null>(null)

  useEffect(() => {
    if (!user) return
    const checkNotifications = async () => {
      try {
        const { data: countData } = await notificationsApi.getCount()
        const newCount = countData.unread_count
        if (newCount > prevUnreadCountRef.current) {
          const { data } = await notificationsApi.list({
            unread_only: true,
            page_size: 1,
          })
          const latest = data.items?.[0]
          if (latest && latest.id !== lastNotifRef.current) {
            lastNotifRef.current = latest.id
            if (isRunningInTauri()) {
              const { invoke } = await import('@tauri-apps/api/core')
              switch (latest.type) {
                case 'file_shared':
                case 'share_link_created':
                  await invoke('notify_file_shared', {
                    sender: 'AXSHARE',
                    filename: latest.body ?? 'un file',
                  })
                  break
                case 'link_accessed':
                  await invoke('show_notification', {
                    payload: {
                      title: '👁 File visualizzato',
                      body: latest.body ?? 'Il tuo link è stato aperto',
                      icon: null,
                    },
                  })
                  break
                default:
                  await invoke('show_notification', {
                    payload: {
                      title: latest.title,
                      body: latest.body ?? '',
                      icon: null,
                    },
                  })
              }
            }
          }
        }
        prevUnreadCountRef.current = newCount
      } catch {
        // ignora errori di rete
      }
    }
    checkNotifications()
    const interval = setInterval(checkNotifications, 15000)
    return () => clearInterval(interval)
  }, [user])

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

  // Blocca navigazione con swipe sinistra/destra su browser web
  useEffect(() => {
    if (isRunningInTauri()) return
    const preventSwipe = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        const touch = e.touches[0]
        if (touch.clientX < 30 || touch.clientX > window.innerWidth - 30) {
          e.preventDefault()
        }
      }
    }
    document.addEventListener('touchstart', preventSwipe, { passive: false })
    const onPopState = () => {
      if (!window.location.pathname.startsWith('/login')) {
        window.history.pushState(null, '', window.location.pathname)
      }
    }
    window.addEventListener('popstate', onPopState)
    window.history.pushState(null, '', window.location.pathname)
    return () => {
      document.removeEventListener('touchstart', preventSwipe)
      window.removeEventListener('popstate', onPopState)
    }
  }, [])

  const handleLogout = useCallback(async () => {
    await logout()
    router.push('/login')
  }, [logout, router])

  // Redirect a login solo quando abbiamo finito di caricare e non c'è utente (nessun "Caricamento..." a schermo)
  if (!user && !isLoading) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column',
      height: '100vh', overflow: 'hidden' }} data-testid={isLoading ? 'app-loading' : undefined}>

      {/* Nav nascosto — mantiene data-testid per i test, invisibile all'utente */}
      <nav data-testid="navbar" style={{ display: 'none' }}>
        <span><strong>AXSHARE</strong></span>
        <span> | </span>
        <Link href="/dashboard" data-testid="nav-dashboard">Dashboard</Link>
        {isDesktop() && (
          <>
            <span> | </span>
            <Link href="/desktop/sync" data-testid="nav-sync">
              {syncContext?.syncState === 'syncing' && (
                <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}
                  title="Sincronizzazione in corso">🔄</span>
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
        {user?.role === 'admin' && (
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
        <span data-testid="nav-user">{user?.email ?? ''}</span>
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
        <button type="button" onClick={handleLogout} data-testid="logout-button">
          Esci
        </button>
      </nav>

      {/* SyncStatusBar — mantieni, solo nascosta visivamente se vuota */}
      <SyncStatusBar />

      {/* Modal PIN decifratura: mostrata solo dopo login, centrata, stile progetto. Non richiesta di nuovo finché JWT è valido; con logout il token viene rimosso e al nuovo login si richiede di nuovo il PIN (web + desktop). */}
      {showUnlockModal && user && (
        <div className="ax-pin-modal-overlay" data-testid="pin-unlock-modal">
          <PinSetup
            mode="unlock"
            email={user.email ?? ''}
            onComplete={handlePinUnlock}
            appearance="project"
          />
        </div>
      )}

      {/* Children (dashboard, settings, ecc.) — occupa tutto lo spazio; visibili solo quando user è pronto (auth + eventuale restore chiave in background) */}
      <main style={{
        flex: 1,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        overscrollBehaviorX: 'none',
        touchAction: 'pan-y',
      }}>
        {user ? children : null}
      </main>
    </div>
  )
}
