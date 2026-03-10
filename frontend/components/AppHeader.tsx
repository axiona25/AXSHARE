'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthContext } from '@/context/AuthContext'
import { useNotifications } from '@/hooks/useNotifications'
import { notificationsApi } from '@/lib/api'
import { mutate as globalMutate } from 'swr'

/** Iniziali da nome e cognome. Gestisce "Mario Rossi" → MR, "r.amoroso80" → RA. */
function getInitialsFromDisplayName(name: string | null | undefined): string {
  const t = name?.trim()
  if (!t) return '?'
  const bySpace = t.split(/\s+/).filter(Boolean)
  if (bySpace.length >= 2) return (bySpace[0]![0]! + bySpace[1]![0]!).toUpperCase()
  if (t.includes('.')) {
    const byDot = t.split('.').filter(Boolean)
    if (byDot.length >= 2) return (byDot[0]![0]! + byDot[1]![0]!).toUpperCase()
  }
  const two = (t.slice(0, 2) || '?').replace(/[^A-Za-z]/g, '')
  return (two || t[0] || '?').toUpperCase()
}

interface AppHeaderProps {
  searchValue: string
  onSearchChange: (value: string) => void
  searchLoading?: boolean
  hasShareNotification?: boolean
  onClearShareNotification?: () => void
}

export function AppHeader({ searchValue, onSearchChange, searchLoading, hasShareNotification, onClearShareNotification }: AppHeaderProps) {
  const router = useRouter()
  const { user, logout } = useAuthContext()
  const { notifications, unreadCount, refresh } = useNotifications(false)
  const [headerAvatarOpen, setHeaderAvatarOpen] = useState(false)
  const [notifMenuOpen, setNotifMenuOpen] = useState(false)
  const headerAvatarRef = useRef<HTMLDivElement>(null)
  const notifMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!headerAvatarOpen) return
    const onOutside = (e: MouseEvent) => {
      if (headerAvatarRef.current && !headerAvatarRef.current.contains(e.target as Node)) {
        setHeaderAvatarOpen(false)
      }
    }
    document.addEventListener('click', onOutside)
    return () => document.removeEventListener('click', onOutside)
  }, [headerAvatarOpen])

  useEffect(() => {
    if (!notifMenuOpen) return
    const onOutside = (e: MouseEvent) => {
      if (notifMenuRef.current && !notifMenuRef.current.contains(e.target as Node)) {
        setNotifMenuOpen(false)
      }
    }
    document.addEventListener('click', onOutside)
    return () => document.removeEventListener('click', onOutside)
  }, [notifMenuOpen])

  const handleDeleteNotification = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await notificationsApi.delete(id)
      await Promise.all([globalMutate('/notifications?unread_only=false'), globalMutate('/notifications/count')])
      refresh()
    } catch {
      // ignore
    }
  }, [refresh])

  return (
    <header className="header">
      <div className="header-logo-area">
        <img src="/Logo.png" alt="AXSHARE" className="header-logo-img" style={{ height: 38, width: 'auto', objectFit: 'contain' }} />
      </div>

      <div className="search-wrap">
        <span className="search-icon" aria-hidden>
          <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </span>
        <input
          id="search"
          className="search-input"
          data-testid="search-input"
          type="search"
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Cerca in Axshare..."
        />
        {searchLoading ? (
          <span data-testid="search-loading" style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: 'var(--ax-muted)' }}>Ricerca...</span>
        ) : searchValue ? (
          <button type="button" className="search-clear-btn" onClick={() => onSearchChange('')} aria-label="Cancella">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        ) : null}
      </div>

      <div className="header-spacer" />

      <div className="header-actions">
        <div className="header-notif-wrap" ref={notifMenuRef} style={{ position: 'relative' }}>
          <button
            type="button"
            className="icon-btn"
            aria-label="Notifiche"
            aria-expanded={notifMenuOpen}
            onClick={() => { onClearShareNotification?.(); setNotifMenuOpen((o) => !o); setHeaderAvatarOpen(false) }}
            style={{ position: 'relative' }}
          >
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            {(hasShareNotification || unreadCount > 0) && (
              <span className="ax-notif-badge" />
            )}
          </button>
          {notifMenuOpen && (
            <div className="ax-notif-dropdown" role="menu" aria-label="Notifiche">
              <div className="ax-notif-dropdown-header">
                <span>Notifiche</span>
              </div>
              <div className="ax-notif-dropdown-list">
                {notifications.length === 0 ? (
                  <div className="ax-notif-dropdown-empty">Nessuna notifica.</div>
                ) : (
                  notifications.map((n) => (
                    <div key={n.id} className={`ax-notif-item ${n.is_read ? '' : 'ax-notif-item-unread'}`} role="menuitem">
                      <button type="button" className="ax-notif-item-close" aria-label="Elimina notifica" onClick={(e) => handleDeleteNotification(n.id, e)}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                      </button>
                      <div className="ax-notif-item-body" onClick={() => { setNotifMenuOpen(false); if (n.action_url) router.push(n.action_url) }}>
                        <span className="ax-notif-item-title">{n.title}</span>
                        {n.body && <span className="ax-notif-item-text">{n.body}</span>}
                        {n.created_at && <span className="ax-notif-item-date">{new Date(n.created_at).toLocaleString('it', { dateStyle: 'short', timeStyle: 'short' })}</span>}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
        <div className="header-avatar-wrap" ref={headerAvatarRef}>
          <button
            type="button"
            className="header-user-block-btn"
            onClick={(e) => { e.stopPropagation(); setHeaderAvatarOpen((o) => !o) }}
            aria-expanded={headerAvatarOpen}
            aria-haspopup="true"
            aria-label="Menu utente"
          >
            <span className="avatar-btn avatar-btn-sm avatar-btn-circle">
              {user?.display_name?.trim() ? getInitialsFromDisplayName(user.display_name) : (user?.email ? user.email.split('@')[0].slice(0, 2) : 'U').toUpperCase()}
            </span>
            <span className="header-user-block-text">
              <span className="header-user-name">{user?.display_name?.trim() || 'Utente'}</span>
              <span className="header-user-role">{user?.email ?? ''}</span>
            </span>
            <svg className={`header-user-chevron ${headerAvatarOpen ? 'open' : ''}`} width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {headerAvatarOpen && (
            <div className="header-avatar-dropdown" role="menu">
              <button type="button" className="header-avatar-dropdown-item" role="menuitem" onClick={() => { setHeaderAvatarOpen(false); router.push('/settings') }}>
                Profilo
              </button>
              <button type="button" className="header-avatar-dropdown-item" role="menuitem" onClick={async () => { setHeaderAvatarOpen(false); await logout(); router.push('/login') }}>
                Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
