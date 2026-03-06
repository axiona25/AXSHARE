'use client'

import useSWR from 'swr'
import { reportsApi } from '@/lib/api'
import { useAuthContext } from '@/context/AuthContext'

export function useMyDashboard() {
  const { data, isLoading, error, mutate } = useSWR(
    '/audit/dashboard/me',
    () => reportsApi.getMyDashboard().then((r) => r.data),
    { revalidateOnFocus: false, dedupingInterval: 60000 }
  )
  return { dashboard: data, isLoading, error, refresh: mutate }
}

export function useAdminDashboard() {
  const { user } = useAuthContext()
  const isAdmin = user?.role === 'admin'
  const { data, isLoading, error, mutate } = useSWR(
    isAdmin ? '/audit/dashboard/admin' : null,
    () => reportsApi.getAdminDashboard().then((r) => r.data),
    { revalidateOnFocus: false, dedupingInterval: 60000 }
  )
  return { dashboard: data, isLoading, error, refresh: mutate }
}

export function useTimeSeries(
  metric: 'uploads' | 'downloads' | 'logins' | 'shares',
  days = 30
) {
  const { data, isLoading, error } = useSWR(
    `/audit/dashboard/timeseries?metric=${metric}&days=${days}`,
    () => reportsApi.getTimeSeries(metric, days).then((r) => r.data),
    { revalidateOnFocus: false, dedupingInterval: 300000 }
  )
  return { series: data, isLoading, error }
}
