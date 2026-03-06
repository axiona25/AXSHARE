'use client'

import { useNotifications } from '@/hooks/useNotifications'

export default function NotificationsPage() {
  const { notifications, unreadCount, isLoading, markRead, markAllRead } =
    useNotifications()

  return (
    <div>
      <h1>Notifiche</h1>

      {unreadCount > 0 && (
        <div>
          <span data-testid="unread-count">{unreadCount} non lette</span>
          <button
            type="button"
            data-testid="mark-all-read-button"
            onClick={() => markAllRead()}
          >
            Segna tutte come lette
          </button>
        </div>
      )}

      {isLoading && <p>Caricamento...</p>}

      {!isLoading && notifications.length === 0 && (
        <p data-testid="no-notifications">Nessuna notifica.</p>
      )}

      <ul data-testid="notifications-list">
        {notifications.map((n) => (
          <li
            key={n.id}
            data-testid="notification-item"
            data-read={n.is_read}
          >
            <strong>{n.title}</strong>
            <p>{n.body}</p>
            <small>{n.created_at ? new Date(n.created_at).toLocaleString('it') : ''}</small>
            <span> [{n.severity}]</span>
            {!n.is_read && (
              <button
                type="button"
                data-testid={`mark-read-${n.id}`}
                onClick={() => markRead([n.id])}
              >
                Segna come letta
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
