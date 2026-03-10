'use client'

import { createContext, useContext, useEffect, useRef, useCallback, useState } from 'react'
import { mutate } from 'swr'
import { getAccessTokenSecure } from '@/lib/auth'

const SSE_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000/api/v1'

interface NotificationsContextValue {
  unreadCount: number
  setUnreadCount: (n: number) => void
}

const NotificationsContext = createContext<NotificationsContextValue>({
  unreadCount: 0,
  setUnreadCount: () => {},
})

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const [unreadCount, setUnreadCount] = useState(0)
  const esRef = useRef<EventSource | null>(null)
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const revalidateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryDelay = useRef(2000)
  const REVALIDATE_DEBOUNCE_MS = 800

  const connectSSE = useCallback(() => {
    if (typeof window === 'undefined') return
    void (async () => {
      let token: string | null = null
      try { token = await getAccessTokenSecure() } catch { return }
      if (!token) return

      esRef.current?.close()
      const url = `${SSE_BASE}/notifications/stream?token=${encodeURIComponent(token)}`
      const es = new EventSource(url)
      esRef.current = es

      es.addEventListener('notification', (e: Event) => {
        const me = e as MessageEvent
        if (me.data && typeof me.data === 'string') {
          try {
            const payload = JSON.parse(me.data) as { type?: string; title?: string; body?: string }
            if (payload?.type === 'file_shared_with_me' || payload?.type === 'folder_shared_with_me' || payload?.type === 'permission_expired' || payload?.type === 'permission_revoked' || payload?.type === 'permission_updated') {
              window.dispatchEvent(new CustomEvent('axshare-notification-toast', { detail: payload }))
            }
          } catch {
            // ignore parse error
          }
        }
        // Invalida SWR globalmente con debounce per evitare raffiche di richieste
        if (revalidateTimeoutRef.current) clearTimeout(revalidateTimeoutRef.current)
        revalidateTimeoutRef.current = setTimeout(() => {
          revalidateTimeoutRef.current = null
          void mutate(
            (key: unknown) => typeof key === 'string' && (key as string).startsWith('/notifications'),
            undefined,
            { revalidate: true }
          )
        }, REVALIDATE_DEBOUNCE_MS)
        retryDelay.current = 2000
      })

      es.onopen = () => { retryDelay.current = 2000 }

      es.onerror = () => {
        es.close()
        esRef.current = null
        const delay = retryDelay.current
        retryDelay.current = Math.min(delay * 2, 30000)
        retryRef.current = setTimeout(() => connectSSE(), delay)
      }
    })()
  }, [])

  useEffect(() => {
    connectSSE()
    return () => {
      esRef.current?.close()
      esRef.current = null
      if (retryRef.current) clearTimeout(retryRef.current)
      if (revalidateTimeoutRef.current) clearTimeout(revalidateTimeoutRef.current)
    }
  }, [connectSSE])

  return (
    <NotificationsContext.Provider value={{ unreadCount, setUnreadCount }}>
      {children}
    </NotificationsContext.Provider>
  )
}

export function useNotificationsContext() {
  return useContext(NotificationsContext)
}
