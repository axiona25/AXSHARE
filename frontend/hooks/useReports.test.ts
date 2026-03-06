import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useMyDashboard, useTimeSeries } from '@/hooks/useReports'

vi.mock('swr', () => ({
  default: vi.fn((key: string) => {
    if (key?.includes('timeseries')) {
      return {
        data: {
          metric: 'uploads',
          points: [{ date: '2026-03-01', value: 5 }],
          total: 5,
        },
        isLoading: false,
        mutate: vi.fn(),
      }
    }
    return {
      data: {
        storage: {
          total_files: 10,
          total_size_bytes: 1024000,
          total_size_mb: 0.977,
          largest_file_bytes: 512000,
          average_file_bytes: 102400,
        },
        sharing: {
          active_share_links: 3,
          total_share_links: 5,
          active_guest_sessions: 1,
          total_downloads_via_links: 12,
        },
        signatures: {
          signed_files: 2,
          verified_signatures: 2,
          invalid_signatures: 0,
          pending_verification: 0,
        },
        activity: {
          uploads_last_30d: 8,
          downloads_last_30d: 15,
          logins_last_30d: 20,
          failed_logins_last_30d: 0,
        },
        generated_at: '2026-03-05T10:00:00Z',
      },
      isLoading: false,
      mutate: vi.fn(),
    }
  }),
}))

vi.mock('@/context/AuthContext', () => ({
  useAuthContext: () => ({ user: { id: 'u1', role: 'user' } }),
}))

vi.mock('@/lib/api', () => ({
  reportsApi: {
    getMyDashboard: vi.fn().mockResolvedValue({ data: {} }),
    getAdminDashboard: vi.fn().mockResolvedValue({ data: {} }),
    getTimeSeries: vi.fn().mockResolvedValue({ data: {} }),
  },
}))

describe('useMyDashboard', () => {
  it('returns dashboard data', () => {
    const { result } = renderHook(() => useMyDashboard())
    expect(result.current.dashboard?.storage.total_files).toBe(10)
    expect(result.current.dashboard?.sharing.active_share_links).toBe(3)
  })

  it('not loading initially', () => {
    const { result } = renderHook(() => useMyDashboard())
    expect(result.current.isLoading).toBe(false)
  })
})

describe('useTimeSeries', () => {
  it('returns time series points', () => {
    const { result } = renderHook(() => useTimeSeries('uploads', 30))
    expect(result.current.series?.metric).toBe('uploads')
    expect(result.current.series?.points).toHaveLength(1)
    expect(result.current.series?.total).toBe(5)
  })
})
