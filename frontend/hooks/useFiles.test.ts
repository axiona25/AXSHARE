/**
 * Test hooks file system — mock SWR e API
 * Eseguire con: npx vitest run useFiles.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useFiles, useFolders } from './useFiles'

// Mock SWR
const mockMutate = vi.fn()
vi.mock('swr', () => ({
  default: vi.fn((key: string | null) => {
    if (!key) return { data: undefined, error: undefined, isLoading: false }
    if (key.includes('/folders/') && key.endsWith('/files')) {
      return {
        data: [{ id: 'file-1', name_encrypted: 'enc_name' } as any],
        error: undefined,
        isLoading: false,
      }
    }
    if (key === '/folders/') {
      return {
        data: [{ id: 'folder-1', name_encrypted: 'enc_folder' } as any],
        error: undefined,
        isLoading: false,
      }
    }
    if (key.includes('/children')) {
      return { data: [], error: undefined, isLoading: false }
    }
    return { data: [], error: undefined, isLoading: false }
  }),
  mutate: (...args: unknown[]) => mockMutate(...args),
}))

describe('useFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty array when no folderId', () => {
    const { result } = renderHook(() => useFiles())
    expect(result.current.files).toEqual([])
    expect(result.current.isLoading).toBe(false)
  })

  it('returns files for given folderId', () => {
    const { result } = renderHook(() => useFiles('test-folder'))
    expect(result.current.files).toHaveLength(1)
    expect(result.current.files[0].id).toBe('file-1')
  })
})

describe('useFolders', () => {
  it('returns root folders when no parentId', () => {
    const { result } = renderHook(() => useFolders())
    expect(result.current.folders).toHaveLength(1)
    expect(result.current.folders[0].id).toBe('folder-1')
  })
})
