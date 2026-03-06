'use client'

import { useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuthContext } from '@/context/AuthContext'
import { useNotifications } from '@/hooks/useNotifications'
import { SyncStatusBar } from '@/components/SyncStatusBar'
import { isDesktop } from '@/lib/tauri'

export default function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const router = useRouter()
  const { user, logout, isLoading } = useAuthContext()
  const { unreadCount } = useNotifications()

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace('/login')
      return
    }
    if (isDesktop() && user) {
      const done = typeof window !== 'undefined' && localStorage.getItem('desktop_onboarding_done')
      const onOnboarding = typeof window !== 'undefined' && window.location.pathname.startsWith('/desktop/onboarding')
      if (!done && !onOnboarding) {
        router.push('/desktop/onboarding')
      }
    }
  }, [user, isLoading, router])

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
            <Link href="/desktop/sync" data-testid="nav-sync">Sync</Link>
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

      <main>
        {children}
      </main>
    </div>
  )
}
