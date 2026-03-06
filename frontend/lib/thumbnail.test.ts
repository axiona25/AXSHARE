import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/crypto', () => ({
  generateKey: () => Promise.resolve(new Uint8Array(32).fill(1)),
  encryptFileChunked: async (data: Uint8Array) => data,
  decryptFileChunked: async (data: Uint8Array) => data,
  bytesToBase64: (b: Uint8Array) => btoa(String.fromCharCode(...b)),
  bytesToHex: (b: Uint8Array) =>
    Array.from(b)
      .map((x) => x.toString(16).padStart(2, '0'))
      .join(''),
  base64ToBytes: (s: string) => new Uint8Array(0),
  hexToBytes: (s: string) => new Uint8Array(32),
}))

import { generateThumbnail } from '@/lib/thumbnail'

describe('thumbnail', () => {
  it('returns null for unsupported file type', async () => {
    const file = new File(['data'], 'test.zip', {
      type: 'application/zip',
    })
    const result = await generateThumbnail(file)
    expect(result).toBeNull()
  })

  it('generateThumbnail returns null for non-image/pdf', async () => {
    const file = new File(['data'], 'test.txt', { type: 'text/plain' })
    const result = await generateThumbnail(file)
    expect(result).toBeNull()
  })
})
