'use client'

import { useState } from 'react'

interface PinSetupProps {
  onComplete: (pin: string) => Promise<void>
  mode: 'setup' | 'unlock'
  email: string
  /** Stile progetto AXSHARE (modale centrata dopo login). Default: tema scuro. */
  appearance?: 'default' | 'project'
}

export default function PinSetup({
  onComplete,
  mode,
  email,
  appearance = 'default',
}: PinSetupProps) {
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const validatePin = (value: string) => /^.{8}$/.test(value)

  const hasLetters = (v: string) => /[a-zA-Z]/.test(v)
  const hasNumbers = (v: string) => /[0-9]/.test(v)
  const hasSymbols = (v: string) => /[^a-zA-Z0-9]/.test(v)
  const pinStrength =
    pin.length === 8
      ? hasLetters(pin) && hasNumbers(pin) && hasSymbols(pin)
        ? 'Forte'
        : hasLetters(pin) && hasNumbers(pin)
          ? 'Medio'
          : 'Debole'
      : null

  const handleSubmit = async () => {
    setError('')

    if (!validatePin(pin)) {
      setError(
        'Il PIN deve essere esattamente 8 caratteri (lettere, numeri e simboli sono tutti accettati)'
      )
      return
    }

    if (mode === 'setup' && pin !== confirmPin) {
      setError('I PIN non coincidono')
      return
    }

    setLoading(true)
    try {
      await onComplete(pin)
    } catch (e: unknown) {
      setError((e as Error)?.message ?? 'Errore')
    } finally {
      setLoading(false)
    }
  }

  const isProject = appearance === 'project'

  const cardContent = (
    <>
      <div className={isProject ? 'ax-pin-modal-icon' : ''} style={!isProject ? { fontSize: 32, marginBottom: 8 } : undefined}>
        🔐
      </div>
      <h2 className={isProject ? 'ax-login-form-heading' : ''} style={!isProject ? { color: '#fff', margin: '0 0 8px' } : undefined}>
        {mode === 'setup' ? 'Crea il tuo PIN' : 'Inserisci PIN'}
      </h2>
      <p className={isProject ? 'ax-login-form-subheading' : ''} style={!isProject ? { color: '#888', fontSize: 14, margin: '0 0 32px' } : undefined}>
        {mode === 'setup'
          ? 'Scegli un PIN di 8 caratteri: lettere, numeri e simboli (es. Ax3!mZ@1)'
          : `Bentornato, ${email.split('@')[0] ?? email}. Inserisci il PIN per decifrare i dati.`}
      </p>

      <input
        type="password"
        value={pin}
        onChange={(e) => setPin(e.target.value.slice(0, 8))}
        placeholder="PIN (8 caratteri)"
        title="8 caratteri: lettere, numeri e simboli"
        maxLength={8}
        className={isProject ? 'ax-login-field-input' : ''}
        style={isProject ? { textAlign: 'center', letterSpacing: 4, marginBottom: 12 } : {
          width: '100%',
          padding: '12px 16px',
          background: '#2a2a2a',
          border: '1px solid #444',
          borderRadius: 8,
          color: '#fff',
          fontSize: 18,
          letterSpacing: 4,
          textAlign: 'center',
          marginBottom: 12,
          boxSizing: 'border-box',
        }}
        onKeyDown={(e) => e.key === 'Enter' && !loading && handleSubmit()}
        autoFocus
      />

      {mode === 'setup' && (
        <input
          type="password"
          value={confirmPin}
          onChange={(e) => setConfirmPin(e.target.value.slice(0, 8))}
          placeholder="Conferma PIN"
          maxLength={8}
          className={isProject ? 'ax-login-field-input' : ''}
          style={isProject ? { textAlign: 'center', letterSpacing: 4, marginBottom: 12 } : {
            width: '100%',
            padding: '12px 16px',
            background: '#2a2a2a',
            border: '1px solid #444',
            borderRadius: 8,
            color: '#fff',
            fontSize: 18,
            letterSpacing: 4,
            textAlign: 'center',
            marginBottom: 12,
            boxSizing: 'border-box',
          }}
          onKeyDown={(e) => e.key === 'Enter' && !loading && handleSubmit()}
        />
      )}

      {pin.length > 0 && mode === 'setup' && (
        <div style={{ marginBottom: 12, textAlign: 'left' }}>
          <div
            style={{
              fontSize: 12,
              color:
                pinStrength === 'Forte'
                  ? (isProject ? 'var(--ax-success)' : '#4CAF50')
                  : pinStrength === 'Medio'
                    ? (isProject ? 'var(--ax-warning)' : '#ff9800')
                    : (isProject ? 'var(--ax-error)' : '#f44336'),
            }}
          >
            {pin.length}/8 caratteri
            {pinStrength && ` · ${pinStrength}`}
          </div>
        </div>
      )}

      {error && (
        <div className={isProject ? 'ax-login-error' : ''} style={isProject ? { marginBottom: 16, padding: '8px 12px', borderRadius: 6, background: 'rgba(239,68,68,0.08)' } : {
          color: '#ff4444',
          fontSize: 13,
          marginBottom: 16,
          padding: '8px 12px',
          background: '#ff44440f',
          borderRadius: 6,
        }}>
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={
          loading ||
          pin.length !== 8 ||
          (mode === 'setup' && (confirmPin.length !== 8 || pin !== confirmPin))
        }
        className={isProject ? 'ax-login-btn-primary' : ''}
        style={isProject ? undefined : {
          width: '100%',
          padding: '14px',
          background:
            pin.length === 8 &&
            (mode !== 'setup' || (confirmPin.length === 8 && pin === confirmPin))
              ? '#4CAF50'
              : '#333',
          color:
            pin.length === 8 &&
            (mode !== 'setup' || (confirmPin.length === 8 && pin === confirmPin))
              ? '#fff'
              : '#666',
          border: 'none',
          borderRadius: 8,
          fontSize: 16,
          fontWeight: 600,
          cursor:
            pin.length === 8 &&
            (mode !== 'setup' || (confirmPin.length === 8 && pin === confirmPin))
              ? 'pointer'
              : 'not-allowed',
          transition: 'all 0.2s',
        }}
      >
        {loading
          ? '⏳ Elaborazione...'
          : mode === 'setup'
            ? '🔐 Crea PIN e accedi'
            : '🔓 Sblocca'}
      </button>

      <p
        className={isProject ? 'ax-login-form-subheading' : ''}
        style={{
          marginTop: 20,
          lineHeight: 1.5,
          fontSize: 11,
          ...(isProject ? { marginBottom: 0 } : { color: '#555' }),
        }}
      >
        Il PIN non viene mai inviato al server. Viene usato localmente per
        proteggere le tue chiavi crittografiche.
      </p>
    </>
  )

  if (isProject) {
    return (
      <div className="ax-pin-modal-card-wrap">
        <div className="ax-login-card ax-pin-modal-card">
          {cardContent}
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: '#0a0a0a',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div
        style={{
          background: '#1a1a1a',
          border: '1px solid #333',
          borderRadius: 16,
          padding: 40,
          width: 360,
          textAlign: 'center',
        }}
      >
        {cardContent}
      </div>
    </div>
  )
}
