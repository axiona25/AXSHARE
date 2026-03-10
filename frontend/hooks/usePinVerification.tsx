'use client'

import type React from 'react'
import { useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { authApi } from '@/lib/api'

const PIN_LENGTH = 8

export interface UsePinVerificationReturn {
  isPinModalOpen: boolean
  pinError: string | null
  requestPin: () => Promise<boolean>
  PinModal: () => React.ReactNode
}

export function usePinVerification(): UsePinVerificationReturn {
  const [isPinModalOpen, setIsPinModalOpen] = useState(false)
  const [pinError, setPinError] = useState<string | null>(null)
  const [pinValue, setPinValue] = useState('')
  const resolveRef = useRef<((value: boolean) => void) | null>(null)

  const requestPin = useCallback((): Promise<boolean> => {
    return new Promise((resolve) => {
      setPinError(null)
      setPinValue('')
      resolveRef.current = resolve
      setIsPinModalOpen(true)
    })
  }, [])

  const closeModal = useCallback((result: boolean) => {
    setIsPinModalOpen(false)
    setPinValue('')
    setPinError(null)
    const fn = resolveRef.current
    resolveRef.current = null
    fn?.(result)
  }, [])

  const handleConfirm = useCallback(async () => {
    const pin = pinValue.slice(0, PIN_LENGTH)
    if (pin.length < 4) {
      setPinError('Inserisci almeno 4 caratteri')
      return
    }
    setPinError(null)
    try {
      const res = await authApi.verifyPin(pin)
      if (res.data?.valid) {
        closeModal(true)
      } else {
        setPinError('PIN non corretto, riprova')
      }
    } catch {
      setPinError('PIN non corretto, riprova')
    }
  }, [pinValue, closeModal])

  const handleCancel = useCallback(() => {
    closeModal(false)
  }, [closeModal])

  const PinModal = useCallback(() => {
    if (!isPinModalOpen) return null
    return createPortal(
      <div
        className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pin-modal-title"
      >
        <div
          className="ax-pin-verify-box"
          style={{
            background: 'var(--ax-navy-900, #0D2645)',
            borderRadius: 12,
            padding: 24,
            minWidth: 320,
            maxWidth: 400,
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            border: '1px solid var(--ax-blue, #3299F3)',
          }}
        >
          <h2
            id="pin-modal-title"
            className="text-lg font-semibold text-white mb-2"
          >
            Inserisci il tuo PIN
          </h2>
          <p className="text-sm text-gray-300 mb-4">
            Questo file richiede la verifica del PIN per essere aperto.
          </p>
          <input
            type="password"
            inputMode="numeric"
            maxLength={PIN_LENGTH}
            autoComplete="off"
            className="w-full px-3 py-2 rounded border bg-white/10 border-gray-500 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[var(--ax-blue)] focus:border-transparent"
            value={pinValue}
            onChange={(e) => setPinValue(e.target.value.slice(0, PIN_LENGTH))}
            placeholder={`PIN (max ${PIN_LENGTH} caratteri)`}
            aria-label="PIN"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleConfirm()
              if (e.key === 'Escape') handleCancel()
            }}
          />
          {pinError && (
            <p className="mt-2 text-sm text-red-400" role="alert">
              {pinError}
            </p>
          )}
          <div className="mt-4 flex gap-3 justify-end">
            <button
              type="button"
              onClick={handleCancel}
              className="px-4 py-2 rounded border border-gray-500 text-gray-300 hover:bg-white/10 transition-colors"
            >
              Annulla
            </button>
            <button
              type="button"
              onClick={() => void handleConfirm()}
              className="px-4 py-2 rounded bg-[var(--ax-blue)] text-white hover:opacity-90 transition-colors"
            >
              Conferma
            </button>
          </div>
        </div>
      </div>,
      document.body
    )
  }, [isPinModalOpen, pinValue, pinError, handleConfirm, handleCancel])

  return { isPinModalOpen, pinError, requestPin, PinModal }
}
