/**
 * Configurazione globale SWR per AXSHARE.
 * Gestisce: fetcher default, retry, revalidation.
 */

import type { SWRConfiguration } from 'swr'
import { apiClient } from '@/lib/api'
import type { ApiError } from '@/types'

export const swrFetcher = async (url: string) => {
  const response = await apiClient.get(url)
  return response.data
}

export const swrConfig: SWRConfiguration = {
  fetcher: swrFetcher,
  revalidateOnFocus: false,
  revalidateOnReconnect: true,
  shouldRetryOnError: (err: unknown) => {
    const status = (err as ApiError)?.status
    return status == null || ![401, 403, 404].includes(status)
  },
  errorRetryCount: 3,
  errorRetryInterval: 2000,
  dedupingInterval: 5000,
}
