import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSubmitLock, useUploadQueue } from './useRateLimit'

describe('useSubmitLock', () => {
  it('lock esegue la fn e blocca per lockMs', async () => {
    const fn = vi.fn().mockResolvedValue(42)
    const { result } = renderHook(() => useSubmitLock(100))

    let out: number | null = null
    await act(async () => {
      out = await result.current.lock(fn)!
    })
    expect(out).toBe(42)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(result.current.isLocked).toBe(true)

    const secondCall = vi.fn().mockResolvedValue(99)
    await act(async () => {
      const r = await result.current.lock(secondCall)
      expect(r).toBeNull()
    })
    expect(secondCall).not.toHaveBeenCalled()
  })
})

describe('useUploadQueue', () => {
  it('canUpload è true inizialmente', () => {
    const { result } = renderHook(() => useUploadQueue())
    expect(result.current.canUpload).toBe(true)
    expect(result.current.activeUploads).toBe(0)
  })

  it('startUpload esegue la fn e aggiorna activeUploads', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    const { result } = renderHook(() => useUploadQueue())

    let out: string | null = null
    await act(async () => {
      out = await result.current.startUpload(fn)!
    })
    expect(out).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
