import { describe, it, expect } from 'vitest'
import { sha256Hex } from '@/lib/signing'

describe('signing utils', () => {
  it('sha256Hex returns 64-char hex string', async () => {
    const data = new Uint8Array([1, 2, 3, 4, 5])
    const hash = await sha256Hex(data)
    expect(hash).toHaveLength(64)
    expect(hash).toMatch(/^[0-9a-f]+$/)
  })

  it('sha256Hex is deterministic', async () => {
    const data = new Uint8Array([10, 20, 30])
    const h1 = await sha256Hex(data)
    const h2 = await sha256Hex(data)
    expect(h1).toBe(h2)
  })

  it('different data produces different hash', async () => {
    const h1 = await sha256Hex(new Uint8Array([1]))
    const h2 = await sha256Hex(new Uint8Array([2]))
    expect(h1).not.toBe(h2)
  })
})
