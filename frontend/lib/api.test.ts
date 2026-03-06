/**
 * Test unitari per api.ts e auth.ts
 * Eseguire con: npx vitest run api.test
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  saveTokens,
  getAccessToken,
  getRefreshToken,
  clearTokens,
  isTokenExpired,
  isAuthenticated,
} from '@/lib/auth'

const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value
    },
    removeItem: (key: string) => {
      delete store[key]
    },
    clear: () => {
      store = {}
    },
  }
})()

describe('auth utils', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      writable: true,
    })
    localStorageMock.clear()
  })

  it('saveTokens stores access token', () => {
    saveTokens('test_token')
    expect(getAccessToken()).toBe('test_token')
  })

  it('clearTokens removes all tokens', () => {
    saveTokens('access', 'refresh')
    clearTokens()
    expect(getAccessToken()).toBeNull()
    expect(getRefreshToken()).toBeNull()
  })

  it('isTokenExpired returns true for expired token', () => {
    const toBase64url = (obj: object) =>
      Buffer.from(JSON.stringify(obj))
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '')
    const header = toBase64url({ alg: 'RS256', typ: 'JWT' })
    const payload = toBase64url({
      sub: '123',
      exp: 1,
      iat: 0,
      type: 'access',
      role: 'user',
    })
    const expiredToken = `${header}.${payload}.sig`
    expect(isTokenExpired(expiredToken)).toBe(true)
  })

  it('isAuthenticated returns false when no token', () => {
    expect(isAuthenticated()).toBe(false)
  })
})
