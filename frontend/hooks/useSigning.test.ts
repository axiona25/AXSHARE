import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useSigning } from '@/hooks/useSigning'

vi.mock('swr', () => ({
  default: vi.fn((key: string | null) => {
    if (!key) return { data: undefined, isLoading: false, mutate: vi.fn() }
    return {
      data: [
        {
          id: 'sig-1',
          version: 1,
          signer_id: 'user-1',
          algorithm: 'RSA-PSS-SHA256',
          is_valid: true,
          verified_at: '2026-03-05T10:00:00Z',
          created_at: '2026-03-05T09:00:00Z',
        },
      ],
      isLoading: false,
      mutate: vi.fn(),
    }
  }),
}))

vi.mock('@/context/AuthContext', () => ({
  useAuthContext: () => ({ user: { id: 'user-1', email: 'test@test.com' } }),
}))

vi.mock('@/lib/api', () => ({
  signaturesApi: {
    list: vi.fn().mockResolvedValue({ data: [] }),
    sign: vi.fn().mockResolvedValue({ data: {} }),
    verify: vi.fn().mockResolvedValue({ data: { is_valid: true } }),
  },
  filesApi: {
    download: vi.fn().mockResolvedValue({ data: new ArrayBuffer(0) }),
    get: vi.fn().mockResolvedValue({ data: { current_version: 1 } }),
  },
}))

vi.mock('@/lib/signing', () => ({
  signFile: vi.fn().mockResolvedValue({
    signatureB64: 'b64',
    fileHashSha256: 'a'.repeat(64),
    publicKeyPemSnapshot: '-----BEGIN PUBLIC KEY-----',
    algorithm: 'RSA-PSS-SHA256',
  }),
}))

vi.mock('@/lib/signingKeys', () => ({
  signingKeyManager: {
    hasKeys: vi.fn().mockResolvedValue(true),
  },
}))

describe('useSigning', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns signatures list', () => {
    const { result } = renderHook(() => useSigning('file-123'))
    expect(result.current.signatures).toHaveLength(1)
    expect(result.current.signatures[0].version).toBe(1)
    expect(result.current.signatures[0].isValid).toBe(true)
  })

  it('initial state: not signing, not verifying', () => {
    const { result } = renderHook(() => useSigning('file-123'))
    expect(result.current.isSigning).toBe(false)
    expect(result.current.isVerifying).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('returns empty signatures for null fileId', () => {
    const { result } = renderHook(() => useSigning(''))
    expect(result.current.signatures).toHaveLength(0)
    expect(result.current.isSigning).toBe(false)
  })
})
