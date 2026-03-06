import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { PasskeyManager } from './PasskeyManager'

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    registerPasskey: vi.fn(),
    isLoading: false,
    error: null,
    clearError: vi.fn(),
  }),
}))

vi.mock('@/lib/api', () => ({
  authApi: {
    getWebAuthnCredentials: vi.fn().mockResolvedValue({ data: { credentials: [] } }),
    deleteWebAuthnCredential: vi.fn(),
  },
}))

describe('PasskeyManager', () => {
  it('mostra stato senza passkey', async () => {
    render(<PasskeyManager />)
    const managers = screen.getAllByTestId('passkey-manager')
    expect(managers.length).toBeGreaterThan(0)
    expect(within(managers[0]).getByTestId('register-passkey-form')).toBeTruthy()
  })

  it('ha il pulsante aggiungi passkey', () => {
    render(<PasskeyManager />)
    const manager = screen.getAllByTestId('passkey-manager')[0]
    expect(within(manager).getByTestId('register-passkey-button')).toBeTruthy()
  })
})
