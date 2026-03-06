/**
 * Utilità per gestione JWT e sessione lato client.
 * Token in localStorage (browser e WebView Tauri).
 */

import { decodeJwt } from 'jose'
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

/** Salva token. In Tauri dev usa localStorage (Keychain può non essere pronto). */
export async function saveTokensSecure(
  accessToken: string,
  refreshToken?: string
): Promise<void> {
  if (typeof window === 'undefined') return
  // In Tauri usiamo localStorage così AuthContext e api trovano il token
  // (la WebView ha un contesto separato; il keychain Rust può non essere sincronizzato)
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken)
  if (refreshToken) {
    localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken)
  }
}

/** Recupera access token. In Tauri legge da localStorage (stesso store di saveTokensSecure). */
export async function getAccessTokenSecure(): Promise<string | null> {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(ACCESS_TOKEN_KEY)
}

/** Recupera refresh token. */
export async function getRefreshTokenSecure(): Promise<string | null> {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(REFRESH_TOKEN_KEY)
}

/** Rimuove token da localStorage. */
export async function clearTokensSecure(): Promise<void> {
  if (typeof window === 'undefined') return
  localStorage.removeItem(ACCESS_TOKEN_KEY)
  localStorage.removeItem(REFRESH_TOKEN_KEY)
}

export function decodeToken(token: string): JWTPayload | null {
  try {
    const payload = decodeJwt(token) as unknown as JWTPayload
    return payload
  } catch {
    return null
  }
}

/** Decode JWT payload (base64 o base64url). */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const pad = b64.length % 4
    if (pad) b64 += '='.repeat(4 - pad)
    return JSON.parse(atob(b64)) as Record<string, unknown>
  } catch {
    return null
  }
}

export function isTokenExpired(token: string): boolean {
  try {
    const payload = decodeJwtPayload(token)
    if (!payload) {
      console.error('[TOKEN] Errore decode JWT')
      return true
    }
    const exp = payload.exp as number | undefined
    const now = Math.floor(Date.now() / 1000)
    console.log('[TOKEN] payload.exp:', exp, 'now:', now)
    if (exp == null) return false // nessuna scadenza = valido
    // 10 secondi di tolleranza per clock skew
    return exp < now - 10
  } catch {
    console.error('[TOKEN] Errore decode JWT')
    return true
  }
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
