import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useGuestSessions } from '@/hooks/useGuestSessions'

vi.mock('swr', () => ({
  default: vi.fn(() => ({
    data: [
      {
        id: 'sess-1',
        guest_email: 'guest@test.com',
        expires_at: new Date(Date.now() + 86400000).toISOString(),
        is_active: true,
        label: null,
        invite_used: false,
        created_at: '2026-03-05T10:00:00Z',
        accessible_files: ['file-1'],
      },
      {
        id: 'sess-2',
        guest_email: 'expired@test.com',
        expires_at: new Date(Date.now() - 86400000).toISOString(),
        is_active: false,
        label: null,
        invite_used: true,
        created_at: '2026-03-04T10:00:00Z',
        accessible_files: ['file-2'],
      },
    ],
    isLoading: false,
    mutate: vi.fn(),
  })),
}))

vi.mock('@/lib/api', () => ({
  guestApi: {
    listSessions: vi.fn().mockResolvedValue({ data: [] }),
    createInvite: vi.fn().mockResolvedValue({ data: {} }),
    revokeSession: vi.fn().mockResolvedValue({}),
  },
}))

describe('useGuestSessions', () => {
  it('separates active and expired sessions', () => {
    const { result } = renderHook(() => useGuestSessions())
    expect(result.current.activeSessions).toHaveLength(1)
    expect(result.current.expiredSessions).toHaveLength(1)
  })

  it('active session has future expiry', () => {
    const { result } = renderHook(() => useGuestSessions())
    const active = result.current.activeSessions[0]
    expect(new Date(active.expires_at) > new Date()).toBe(true)
  })

  it('initial state: not inviting, no error', () => {
    const { result } = renderHook(() => useGuestSessions())
    expect(result.current.isInviting).toBe(false)
    expect(result.current.error).toBeNull()
  })
})
