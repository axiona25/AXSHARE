'use client'

import { useCallback } from 'react'
import useSWR from 'swr'
import { notificationsApi } from '@/lib/api'

export function useNotifications(unreadOnly = false) {
  const { data, isLoading, error, mutate } = useSWR(
    `/notifications?unread_only=${unreadOnly}`,
    () => notificationsApi.list({ unread_only: unreadOnly }).then((r) => r.data),
    { revalidateOnFocus: false, refreshInterval: 60000 }
  )

  const { data: countData, mutate: mutateCount } = useSWR(
    '/notifications/count',
    () => notificationsApi.getCount().then((r) => r.data),
    { revalidateOnFocus: false, refreshInterval: 60000 }
  )

  const markRead = useCallback(
    async (ids?: string[]) => {
      await notificationsApi.markRead(ids)
      await Promise.all([mutate(), mutateCount()])
    },
    [mutate, mutateCount]
  )

  const markAllRead = useCallback(async () => {
    await notificationsApi.markRead()
    await Promise.all([mutate(), mutateCount()])
  }, [mutate, mutateCount])

  return {
    notifications: data?.items ?? [],
    unreadCount: countData?.unread_count ?? data?.unread_count ?? 0,
    isLoading,
    error,
    markRead,
    markAllRead,
    refresh: mutate,
  }
}
