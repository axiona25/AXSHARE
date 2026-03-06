import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useNotifications } from '@/hooks/useNotifications'

vi.mock('swr', () => ({
  default: vi.fn((key: string) => {
    if (key.includes('count')) {
      return { data: { unread_count: 2 }, isLoading: false, mutate: vi.fn() }
    }
    return {
      data: {
        items: [
          {
            id: 'n1',
            type: 'signature_invalid',
            title: 'Firma non valida',
            body: 'Versione 1',
            is_read: false,
            severity: 'error',
            created_at: '2026-03-05T10:00:00Z',
          },
          {
            id: 'n2',
            type: 'share_link_accessed',
            title: 'Link usato',
            body: null,
            is_read: false,
            severity: 'info',
            created_at: '2026-03-05T09:00:00Z',
          },
        ],
        unread_count: 2,
      },
      isLoading: false,
      mutate: vi.fn(),
    }
  }),
}))

vi.mock('@/lib/api', () => ({
  notificationsApi: {
    list: vi.fn().mockResolvedValue({ data: { items: [], unread_count: 0 } }),
    getCount: vi.fn().mockResolvedValue({ data: { unread_count: 0 } }),
    markRead: vi.fn().mockResolvedValue({}),
  },
}))

describe('useNotifications', () => {
  it('returns notifications list', () => {
    const { result } = renderHook(() => useNotifications())
    expect(result.current.notifications).toHaveLength(2)
    expect(result.current.notifications[0].type).toBe('signature_invalid')
  })

  it('returns unread count', () => {
    const { result } = renderHook(() => useNotifications())
    expect(result.current.unreadCount).toBe(2)
  })

  it('initial state: not loading', () => {
    const { result } = renderHook(() => useNotifications())
    expect(result.current.isLoading).toBe(false)
    expect(result.current.error).toBeUndefined()
  })
})
