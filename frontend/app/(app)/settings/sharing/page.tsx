'use client'

import { useGuestSessions } from '@/hooks/useGuestSessions'
import type { GuestSessionData } from '@/lib/api'

export default function SharingSettingsPage() {
  const { activeSessions, expiredSessions, revokeSession } = useGuestSessions()

  return (
    <div>
      <h1>Condivisione — Sessioni guest</h1>

      <section data-testid="active-sessions">
        <h2>Sessioni attive ({activeSessions.length})</h2>
        {activeSessions.length === 0 && (
          <p data-testid="no-active-sessions">Nessuna sessione guest attiva.</p>
        )}
        <ul>
          {activeSessions.map((s: GuestSessionData) => (
            <li key={s.id} data-testid="guest-session-item">
              <span>{s.guest_email ?? s.id}</span>
              <span> — scade: {new Date(s.expires_at).toLocaleString('it')}</span>
              {s.label && <span> — {s.label}</span>}
              <button
                type="button"
                data-testid={`revoke-session-${s.id}`}
                onClick={() => revokeSession(s.id)}
              >
                Revoca
              </button>
            </li>
          ))}
        </ul>
      </section>

      <hr />

      <section data-testid="expired-sessions">
        <h2>Sessioni scadute/revocate ({expiredSessions.length})</h2>
        {expiredSessions.length === 0 && (
          <p>Nessuna sessione scaduta.</p>
        )}
        <ul>
          {expiredSessions.map((s: GuestSessionData) => (
            <li key={s.id} data-testid="expired-session-item">
              <span>{s.guest_email ?? s.id}</span>
              <span> — {s.is_active ? 'scaduta' : 'revocata'}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
