'use client'

import Link from 'next/link'
import { useUser } from '@/hooks/useUser'
import { useAuthContext } from '@/context/AuthContext'

export default function SettingsPage() {
  const { user } = useAuthContext()
  const { user: userDetail } = useUser()

  return (
    <div>
      <h1>Impostazioni</h1>

      <section data-testid="profile-section">
        <h2>Profilo</h2>
        <dl>
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
