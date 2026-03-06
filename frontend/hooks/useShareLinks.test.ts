import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useShareLinks } from '@/hooks/useShareLinks'

vi.mock('swr', () => ({
  default: vi.fn(() => ({
    data: [
      {
        id: 'link-1',
        file_id: 'file-1',
        token: 'abc123',
        is_password_protected: false,
        expires_at: null,
        max_downloads: null,
        download_count: 2,
        is_active: true,
        label: 'test link',
        created_at: '2026-03-05T10:00:00Z',
        share_url: 'http://localhost:3000/share/abc123',
      },
    ],
    isLoading: false,
    mutate: vi.fn(),
  })),
}))

vi.mock('@/lib/api', () => ({
  shareLinksApi: {
    list: vi.fn().mockResolvedValue({ data: [] }),
    create: vi.fn().mockResolvedValue({ data: { id: 'new-link', token: 'xyz' } }),
    revoke: vi.fn().mockResolvedValue({}),
  },
}))

describe('useShareLinks', () => {
  it('returns links list', () => {
    const { result } = renderHook(() => useShareLinks('file-1'))
    expect(result.current.links).toHaveLength(1)
    expect(result.current.links[0].token).toBe('abc123')
  })

  it('initial state: not creating, no error', () => {
    const { result } = renderHook(() => useShareLinks('file-1'))
    expect(result.current.isCreating).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('active links computed correctly', () => {
    const { result } = renderHook(() => useShareLinks('file-1'))
    const activeLinks = result.current.links.filter((l) => l.is_active)
    expect(activeLinks).toHaveLength(1)
  })
})
