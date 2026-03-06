'use client'

import { useEffect, useRef } from 'react'
import { useAuthContext } from '@/context/AuthContext'
import { getAccessTokenSecure } from '@/lib/auth'

const POLLING_FALLBACK_MS = 15000
const SSE_CONNECT_TIMEOUT_MS = 10000

export interface FileEvent {
  type: 'file_created' | 'file_deleted' | 'file_updated' | 'ping' | 'connected'
  file_id?: string
  timestamp?: string
}

function getEventsUrl(): string {
  const base =
    typeof process !== 'undefined' && process.env.NEXT_PUBLIC_API_URL
      ? process.env.NEXT_PUBLIC_API_URL
      : 'http://localhost:8000/api/v1'
  return `${base}/files/events`
}

export function useFileEvents(onEvent: (event: FileEvent) => void) {
  const { user } = useAuthContext()
  const onEventRef = useRef(onEvent)
  const esRef = useRef<EventSource | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const fallbackPollingRef = useRef<ReturnType<typeof setInterval>>()
  const fallbackTimeoutRef = useRef<ReturnType<typeof setTimeout>>()

  onEventRef.current = onEvent

  useEffect(() => {
    if (!user) return

    let cancelled = false

    const connect = async () => {
      const token = await getAccessTokenSecure()
      if (!token || !user || cancelled) return

      esRef.current?.close()
      clearTimeout(reconnectTimerRef.current)
      clearInterval(fallbackPollingRef.current)

      const url = `${getEventsUrl()}?token=${encodeURIComponent(token)}`
      const es = new EventSource(url)
      esRef.current = es

      es.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data) as FileEvent
          if (event.type !== 'ping' && event.type !== 'connected') {
            onEventRef.current(event)
          }
        } catch {
          // ignora
        }
      }

      es.onerror = () => {
        es.close()
        if (cancelled) return
        reconnectTimerRef.current = setTimeout(connect, 5000)
      }
    }

    connect()

    fallbackTimeoutRef.current = setTimeout(() => {
      if (cancelled) return
      if (esRef.current?.readyState !== EventSource.OPEN) {
        console.warn('[FILE EVENTS] SSE non disponibile, uso polling')
        esRef.current?.close()
        fallbackPollingRef.current = setInterval(() => {
          if (cancelled) return
          onEventRef.current({
            type: 'file_created',
            timestamp: new Date().toISOString(),
          })
        }, POLLING_FALLBACK_MS)
      }
    }, SSE_CONNECT_TIMEOUT_MS)

    return () => {
      cancelled = true
      esRef.current?.close()
      esRef.current = null
      clearTimeout(reconnectTimerRef.current)
      clearTimeout(fallbackTimeoutRef.current)
      clearInterval(fallbackPollingRef.current)
    }
  }, [user])
}
