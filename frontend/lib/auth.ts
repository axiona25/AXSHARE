/**
 * Utilità per gestione JWT e sessione lato client.
 * In Tauri usa Keychain OS; nel browser usa localStorage.
 */

import { decodeJwt } from 'jose'
import {
  isTauri,
  saveTokenSecure,
  getTokenSecure,
  deleteTokenSecure,
} from '@/lib/tauri'
import type { JWTPayload, UserRole } from '@/types'

const ACCESS_TOKEN_KEY = 'axshare_access_token'
const REFRESH_TOKEN_KEY = 'axshare_refresh_token'

export function saveTokens(accessToken: string, refreshToken?: string): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken)
  if (refreshToken) localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken)
}

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(ACCESS_TOKEN_KEY)
}

export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(REFRESH_TOKEN_KEY)
}

export function clearTokens(): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(ACCESS_TOKEN_KEY)
  localStorage.removeItem(REFRESH_TOKEN_KEY)
}

/** Salva token in Keychain (Tauri) o localStorage (browser). */
export async function saveTokensSecure(
  accessToken: string,
  refreshToken?: string
): Promise<void> {
  await saveTokenSecure(ACCESS_TOKEN_KEY, accessToken)
  if (refreshToken) await saveTokenSecure(REFRESH_TOKEN_KEY, refreshToken)
}

/** Recupera access token da Keychain (Tauri) o localStorage (browser). */
export async function getAccessTokenSecure(): Promise<string | null> {
  if (typeof window === 'undefined') return null
  if (isTauri()) return getTokenSecure(ACCESS_TOKEN_KEY)
  return localStorage.getItem(ACCESS_TOKEN_KEY)
}

/** Recupera refresh token da Keychain (Tauri) o localStorage (browser). */
export async function getRefreshTokenSecure(): Promise<string | null> {
  if (typeof window === 'undefined') return null
  if (isTauri()) return getTokenSecure(REFRESH_TOKEN_KEY)
  return localStorage.getItem(REFRESH_TOKEN_KEY)
}

/** Rimuove token da Keychain (Tauri) o localStorage (browser). */
export async function clearTokensSecure(): Promise<void> {
  await deleteTokenSecure(ACCESS_TOKEN_KEY)
  await deleteTokenSecure(REFRESH_TOKEN_KEY)
}

export function decodeToken(token: string): JWTPayload | null {
  try {
    const payload = decodeJwt(token) as unknown as JWTPayload
    return payload
  } catch {
    return null
  }
}

export function isTokenExpired(token: string): boolean {
  const payload = decodeToken(token)
  if (!payload) return true
  return payload.exp < Date.now() / 1000 - 60
}

export function getUserIdFromToken(token: string): string | null {
  return decodeToken(token)?.sub ?? null
}

export function getUserRoleFromToken(token: string): UserRole | null {
  return (decodeToken(token)?.role as UserRole) ?? null
}

export function isAuthenticated(): boolean {
  const token = getAccessToken()
  if (!token) return false
  return !isTokenExpired(token)
}
