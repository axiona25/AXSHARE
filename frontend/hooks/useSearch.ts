'use client'

import { useCallback, useState } from 'react'
import useSWR from 'swr'
import { searchApi } from '@/lib/api'

export interface SearchFilters {
  tags?: string[]
  tagsAny?: string[]
  mimeCategory?: string
  isStarred?: boolean
  isPinned?: boolean
  colorLabel?: string
  folderId?: string
  minSize?: number
  maxSize?: number
  createdAfter?: string
  createdBefore?: string
  hasSelfDestruct?: boolean
  sharedWithMe?: boolean
  page?: number
  pageSize?: number
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
}

export function useSearch() {
  const [filters, setFilters] = useState<SearchFilters>({})
  const [, setIsSearching] = useState(false)

  const buildParams = useCallback((f: SearchFilters) => {
    const params: Record<string, unknown> = {}
    if (f.tags?.length) params.tags = f.tags.join(',')
    if (f.tagsAny?.length) params.tags_any = f.tagsAny.join(',')
    if (f.mimeCategory) params.mime_category = f.mimeCategory
    if (f.isStarred !== undefined) params.is_starred = f.isStarred
    if (f.isPinned !== undefined) params.is_pinned = f.isPinned
    if (f.colorLabel) params.color_label = f.colorLabel
    if (f.folderId) params.folder_id = f.folderId
    if (f.minSize !== undefined) params.min_size = f.minSize
    if (f.maxSize !== undefined) params.max_size = f.maxSize
    if (f.createdAfter) params.created_after = f.createdAfter
    if (f.createdBefore) params.created_before = f.createdBefore
    if (f.hasSelfDestruct !== undefined)
      params.has_self_destruct = f.hasSelfDestruct
    if (f.sharedWithMe !== undefined)
      params.shared_with_me = f.sharedWithMe
    params.page = f.page ?? 1
    params.page_size = f.pageSize ?? 20
    params.sort_by = f.sortBy ?? 'created_at'
    params.sort_order = f.sortOrder ?? 'desc'
    return params
  }, [])

  const filterKeys = [
    'tags',
    'tagsAny',
    'mimeCategory',
    'isStarred',
    'isPinned',
    'colorLabel',
    'folderId',
    'minSize',
    'maxSize',
    'createdAfter',
    'createdBefore',
    'hasSelfDestruct',
    'sharedWithMe',
  ] as const
  const hasFilters = filterKeys.some(
    (k) => filters[k] !== undefined && filters[k] !== ''
  )

  const swrKey = hasFilters
    ? ['/search/files', JSON.stringify(filters)]
    : null

  const { data, error, isLoading, mutate } = useSWR(
    swrKey,
    () => searchApi.searchFiles(buildParams(filters)).then((r) => r.data)
  )

  const search = useCallback((newFilters: SearchFilters) => {
    setFilters({ ...newFilters, page: 1 })
  }, [])

  const setPage = useCallback((page: number) => {
    setFilters((f) => ({ ...f, page }))
  }, [])

  const clearSearch = useCallback(() => {
    setFilters({})
  }, [])

  return {
    filters,
    results: data?.items ?? [],
    total: data?.total ?? 0,
    pages: data?.pages ?? 0,
    currentPage: data?.page ?? 1,
    isLoading,
    error,
    hasFilters,
    search,
    setPage,
    clearSearch,
    mutate,
  }
}

export function useTagSuggestions(query: string) {
  const { data } = useSWR(
    query.length >= 1 ? `/search/tags/suggest?q=${encodeURIComponent(query)}` : null,
    () => searchApi.suggestTags(query).then((r) => r.data)
  )
  return data ?? []
}
