'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useUser } from '@/hooks/useUser'
import { useAuthContext } from '@/context/AuthContext'
import { usersApi } from '@/lib/api'

export default function SettingsPage() {
  const { user, refreshUser } = useAuthContext()
  const { user: userDetail } = useUser()
  const [displayName, setDisplayName] = useState(user?.display_name ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setDisplayName(user?.display_name ?? '')
  }, [user?.display_name])

  const handleSaveName = async () => {
    const name = displayName.trim()
    setSaving(true)
    setSaved(false)
    try {
      await usersApi.updateMe({ display_name: name || undefined })
      await refreshUser()
      setDisplayName(name || (user?.display_name ?? ''))
      setSaved(true)
    } catch {
      // ignore
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <h1>Impostazioni</h1>

      <section data-testid="profile-section">
        <h2>Profilo</h2>
        <dl>
          <dt>Nome e cognome</dt>
          <dd style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Es. Mario Rossi"
              data-testid="profile-display-name"
              style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--ax-border)', minWidth: 200 }}
            />
            <button
              type="button"
              onClick={handleSaveName}
              disabled={saving || displayName.trim() === (user?.display_name ?? '')}
              data-testid="profile-save-name"
              style={{ padding: '6px 14px', borderRadius: 8, background: 'var(--ax-blue)', color: 'white', border: 'none', cursor: 'pointer', fontWeight: 500 }}
            >
              {saving ? 'Salvataggio…' : 'Salva'}
            </button>
            {saved && <span style={{ fontSize: 13, color: 'var(--ax-muted)' }}>Salvato</span>}
          </dd>
          <dt>Email</dt>
          <dd data-testid="profile-email">{user?.email}</dd>
          <dt>Ruolo</dt>
          <dd data-testid="profile-role">{user?.role}</dd>
          <dt>Account creato</dt>
          <dd>
            {userDetail?.created_at
              ? new Date(userDetail.created_at).toLocaleDateString('it')
              : '—'}
          </dd>
        </dl>
      </section>

      <hr />

      <section data-testid="settings-nav">
        <h2>Sezioni</h2>
        <ul>
          <li>
            <Link href="/settings/security" data-testid="nav-security">
              Sicurezza e chiavi crittografiche
            </Link>
          </li>
          <li>
            <Link href="/settings/sharing" data-testid="nav-sharing">
              Condivisione — sessioni guest attive
            </Link>
          </li>
          <li>
            <Link href="/settings/gdpr" data-testid="nav-gdpr">
              Privacy e GDPR
            </Link>
          </li>
        </ul>
      </section>
    </div>
  )
}
