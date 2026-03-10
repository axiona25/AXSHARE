'use client'

import { useState, useCallback } from 'react'
import { shareLinksApi } from '@/lib/api'

const LINK_LABEL_PREFIX = 'axshare.'

export interface CreateLinkModalProps {
  open: boolean
  type: 'file' | 'folder'
  id: string
  name: string
  onClose: () => void
  onSuccess: (label: string) => void
  /** Per link su file: chiave file in base64 così l’ospite può decifrare. Se non fornita il link non permetterà il download. */
  getFileKeyForLink?: () => Promise<string | null>
}

export function CreateLinkModal({
  open,
  type,
  id,
  name,
  onClose,
  onSuccess,
  getFileKeyForLink,
}: CreateLinkModalProps) {
  const [password, setPassword] = useState('')
  const [expiry, setExpiry] = useState<'never' | 'custom'>('never')
  const [expiryDate, setExpiryDate] = useState('')
  const [expiryTime, setExpiryTime] = useState('23:59')
  const [shareLinkBlockDelete, setShareLinkBlockDelete] = useState(false)
  const [shareLinkRequirePin, setShareLinkRequirePin] = useState(false)
  const [shareLinkPin, setShareLinkPin] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const label = `${LINK_LABEL_PREFIX}${name}`

  const reset = useCallback(() => {
    setPassword('')
    setExpiry('never')
    setExpiryDate('')
    setExpiryTime('23:59')
    setShareLinkBlockDelete(false)
    setShareLinkRequirePin(false)
    setShareLinkPin('')
    setError(null)
  }, [])

  const handleClose = useCallback(() => {
    reset()
    onClose()
  }, [reset, onClose])

  const handleSubmit = useCallback(async () => {
    if (type === 'folder') {
      setError('Il collegamento con password è disponibile solo per i file.')
      return
    }
    if (!password.trim()) {
      setError('Inserisci la password che il destinatario dovrà usare per aprire il collegamento.')
      return
    }
    if (shareLinkRequirePin && !shareLinkPin.trim()) {
      setError('Inserisci il PIN per proteggere il collegamento.')
      return
    }
    if (expiry === 'custom' && !expiryDate) {
      setError('Seleziona una data di scadenza.')
      return
    }
    setError(null)
    setLoading(true)
    try {
      let expiresAt: string | undefined
      if (expiry === 'custom' && expiryDate) {
        expiresAt = new Date(`${expiryDate}T${expiryTime}`).toISOString()
      }
      let fileKeyBase64: string | null = null
      if (type === 'file' && getFileKeyForLink) {
        fileKeyBase64 = await getFileKeyForLink()
      }
      const result = await shareLinksApi.create(id, {
        password: password.trim(),
        expires_at: expiresAt ?? undefined,
        label,
        block_delete: shareLinkBlockDelete,
        require_pin: shareLinkRequirePin,
        ...(shareLinkRequirePin && shareLinkPin.trim() && { pin: shareLinkPin.trim() }),
        ...(fileKeyBase64 != null && { file_key_encrypted_for_link: fileKeyBase64 }),
      })
      const url = `${typeof window !== 'undefined' ? window.location.origin : ''}/share/${result.data.token}`
      await navigator.clipboard.writeText(url)
      onSuccess(label)
      handleClose()
    } catch {
      setError('Errore durante la creazione del collegamento.')
    } finally {
      setLoading(false)
    }
  }, [type, id, password, expiry, expiryDate, expiryTime, shareLinkBlockDelete, shareLinkRequirePin, shareLinkPin, onSuccess, handleClose, getFileKeyForLink])

  if (!open) return null

  return (
    <div
      className="ax-create-folder-overlay"
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ax-create-link-title"
    >
      <div
        className="ax-create-folder-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ minWidth: 400, maxWidth: 480 }}
      >
        <div className="ax-create-folder-modal-header">
          <h2 id="ax-create-link-title" className="ax-create-folder-modal-title">
            Crea collegamento
          </h2>
          <button
            type="button"
            className="ax-create-folder-modal-close"
            onClick={handleClose}
            aria-label="Chiudi"
          >
            <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="ax-create-folder-modal-body">
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ax-muted)', marginBottom: 6 }}>
              Etichetta collegamento
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ax-text)', wordBreak: 'break-all' }}>
              {label}
            </div>
            <p style={{ fontSize: 12, color: 'var(--ax-muted)', marginTop: 6, lineHeight: 1.4 }}>
              Il collegamento reale non viene mostrato. Il destinatario aprirà il link e inserirà la password che imposti qui.
            </p>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ax-muted)', marginBottom: 6 }}>
              Password per il destinatario
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Inserisci la password da comunicare al destinatario"
              style={{ width: '100%', height: 40, padding: '0 12px', border: '1.5px solid var(--ax-border)', borderRadius: 10, fontSize: 14, background: 'var(--ax-surface-0)', boxSizing: 'border-box' }}
              autoComplete="new-password"
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ax-muted)', marginBottom: 8 }}>
              Scadenza
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 14 }}>
                <input type="radio" name="create-link-expiry" checked={expiry === 'never'} onChange={() => setExpiry('never')} />
                <span>Perpetuo (nessuna scadenza)</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 14 }}>
                <input type="radio" name="create-link-expiry" checked={expiry === 'custom'} onChange={() => setExpiry('custom')} />
                <span>Con scadenza</span>
              </label>
              {expiry === 'custom' && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 24, marginTop: 4 }}>
                  <input
                    type="date"
                    value={expiryDate}
                    onChange={(e) => setExpiryDate(e.target.value)}
                    min={(() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().split('T')[0]; })()}
                    style={{ flex: 1, height: 40, padding: '0 10px', border: '1.5px solid var(--ax-border)', borderRadius: 10, fontSize: 14 }}
                  />
                  <input
                    type="time"
                    value={expiryTime}
                    onChange={(e) => setExpiryTime(e.target.value)}
                    style={{ flex: 1, height: 40, padding: '0 10px', border: '1.5px solid var(--ax-border)', borderRadius: 10, fontSize: 14 }}
                  />
                </div>
              )}
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 14, marginBottom: 8 }}>
              <input
                type="checkbox"
                checked={shareLinkBlockDelete}
                onChange={(e) => setShareLinkBlockDelete(e.target.checked)}
              />
              <span>Non può eliminare il file</span>
            </label>
            <p style={{ fontSize: 12, color: 'var(--ax-muted)', marginLeft: 28, lineHeight: 1.4 }}>
              Se attivo, il proprietario non potrà eliminare il file finché il collegamento è attivo.
            </p>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 14, marginBottom: 8 }}>
              <input
                type="checkbox"
                checked={shareLinkRequirePin}
                onChange={(e) => setShareLinkRequirePin(e.target.checked)}
              />
              <span>Proteggi con PIN</span>
            </label>
            {shareLinkRequirePin && (
              <input
                type="password"
                value={shareLinkPin}
                onChange={(e) => setShareLinkPin(e.target.value)}
                placeholder="PIN del collegamento (da comunicare al destinatario)"
                style={{ width: '100%', height: 40, padding: '0 12px', border: '1.5px solid var(--ax-border)', borderRadius: 10, fontSize: 14, background: 'var(--ax-surface-0)', boxSizing: 'border-box', marginTop: 6 }}
                autoComplete="off"
              />
            )}
          </div>

          {error && (
            <div style={{ padding: '10px 12px', background: 'rgba(239,68,68,0.08)', borderRadius: 10, fontSize: 13, color: 'var(--ax-error)', marginBottom: 16 }}>
              {error}
            </div>
          )}
        </div>
        <div className="ax-create-folder-modal-footer">
          <button type="button" className="ax-create-folder-btn ax-create-folder-btn-secondary" onClick={handleClose} disabled={loading}>
            Annulla
          </button>
          <button
            type="button"
            className="ax-create-folder-btn ax-create-folder-btn-primary"
            disabled={loading || (expiry === 'custom' && !expiryDate)}
            onClick={() => void handleSubmit()}
          >
            {loading ? 'Creazione...' : 'Crea collegamento'}
          </button>
        </div>
      </div>
    </div>
  )
}
