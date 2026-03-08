'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'
import { shareLinksApi, type PublicShareInfo } from '@/lib/api'
import { base64ToBytes } from '@/lib/crypto'
import { decryptFileChunked } from '@/lib/crypto'
import { getFileIcon } from '@/lib/fileIcons'

export interface ShareFileData {
  file_id: string
  name_encrypted: string
  file_key_encrypted_for_link: string | null
  encryption_iv: string
  size_bytes: number
  download_count: number
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function formatWelcomeDate(d: Date): string {
  const days = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato']
  const months = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre']
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export default function SharePage() {
  const params = useParams<{ token: string }>()
  const token = (Array.isArray(params.token) ? params.token[0] : params.token) ?? ''

  const [info, setInfo] = useState<PublicShareInfo | null>(null)
  const [fileData, setFileData] = useState<ShareFileData | null>(null)
  const [password, setPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [time, setTime] = useState(() => new Date())
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [downloadInProgress, setDownloadInProgress] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)

  const isExpired = info?.expires_at ? new Date(info.expires_at).getTime() < Date.now() : false

  useEffect(() => {
    if (!token) return
    setLoading(true)
    setError(null)
    shareLinksApi
      .getPublicInfo(token)
      .then((r) => {
        setInfo(r.data)
        if (r.data.is_password_protected) {
          setShowPasswordModal(true)
        }
      })
      .catch((e: unknown) => {
        const err = e as { response?: { status?: number }; message?: string }
        const code = err?.response?.status
        if (code === 404) setError('Link non valido o scaduto')
        else if (code === 410) setError('Link non valido o scaduto')
        else setError(err?.message ?? 'Link non valido o scaduto')
      })
      .finally(() => setLoading(false))
  }, [token])

  useEffect(() => {
    if (!info || info.is_password_protected || fileData) return
    shareLinksApi.downloadViaLink(token).then((r) => setFileData(r.data)).catch(() => {})
  }, [info, token, fileData])

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    function handleClick() {
      setContextMenu(null)
    }
    if (contextMenu) {
      document.addEventListener('click', handleClick)
      return () => document.removeEventListener('click', handleClick)
    }
  }, [contextMenu])

  const handlePasswordSubmit = useCallback(async () => {
    setPasswordError('')
    try {
      const resp = await shareLinksApi.downloadViaLink(token, password)
      setFileData(resp.data)
      setShowPasswordModal(false)
    } catch {
      setPasswordError('Password non corretta')
    }
  }, [token, password])

  const getDecryptedBlob = useCallback(async (): Promise<Blob | null> => {
    if (!info || isExpired) return null
    if (info.is_password_protected && !fileData) return null
    const data = fileData
    if (!data?.file_key_encrypted_for_link) return null
    const streamResp = await shareLinksApi.getStream(token, info.is_password_protected ? password : undefined)
    const encrypted = new Uint8Array(streamResp.data)
    const keyBytes = base64ToBytes(data.file_key_encrypted_for_link)
    const plaintext = await decryptFileChunked(encrypted, keyBytes, '')
    return new Blob([plaintext])
  }, [info, token, password, fileData, isExpired])

  const handleDownload = useCallback(async () => {
    if (!info) return
    if (isExpired) return
    if (info.is_password_protected && !fileData) {
      setShowPasswordModal(true)
      setToast('Inserisci la password per sbloccare il download.')
      return
    }
    setDownloadInProgress(true)
    setToast(null)
    try {
      const data = fileData
      if (!data?.file_key_encrypted_for_link) {
        setToast('Chiave non disponibile per questo link. Crea un nuovo collegamento dall\'app.')
        setDownloadInProgress(false)
        return
      }
      const blob = await getDecryptedBlob()
      if (!blob) {
        setToast('Impossibile decifrare il file.')
        setDownloadInProgress(false)
        return
      }
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const baseName = (info.label || 'File condiviso').replace(/[/\\:*?"<>|]/g, '_')
      a.download = baseName.includes('.') ? baseName : baseName + '.axs'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      setToast('Download completato')
    } catch (e) {
      console.error(e)
      setToast('Errore durante il download')
    } finally {
      setDownloadInProgress(false)
    }
  }, [info, fileData, isExpired, getDecryptedBlob])

  const handleOpenInNewTab = useCallback(async () => {
    if (!info || isExpired) return
    if (info.is_password_protected && !fileData) {
      setShowPasswordModal(true)
      setToast('Inserisci la password per aprire il file.')
      return
    }
    setDownloadInProgress(true)
    setToast(null)
    try {
      if (!fileData?.file_key_encrypted_for_link) {
        setToast('Chiave non disponibile per questo link. Crea un nuovo collegamento dall\'app.')
        setDownloadInProgress(false)
        return
      }
      const blob = await getDecryptedBlob()
      if (!blob) {
        setToast('Impossibile decifrare il file.')
        setDownloadInProgress(false)
        return
      }
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener,noreferrer')
      setTimeout(() => URL.revokeObjectURL(url), 60000)
      setToast('Apertura in nuova scheda')
    } catch (e) {
      console.error(e)
      setToast('Errore durante l\'apertura')
    } finally {
      setDownloadInProgress(false)
    }
  }, [info, fileData, isExpired, getDecryptedBlob])

  const copyLink = useCallback(() => {
    if (typeof window !== 'undefined') {
      navigator.clipboard.writeText(window.location.href)
      setToast('Link copiato')
      setContextMenu(null)
    }
  }, [])

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--ax-bg-secondary, #EEF4FB)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-sans)' }}>
        <p data-testid="share-loading">Caricamento link...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--ax-bg-secondary, #EEF4FB)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-sans)' }}>
        <div style={{ textAlign: 'center' }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--ax-text)' }}>Link non valido o scaduto</h1>
          <p style={{ marginTop: 8, color: 'var(--ax-muted)' }}>{error}</p>
        </div>
      </div>
    )
  }

  if (!info) return null

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--ax-bg-secondary, #EEF4FB)',
        fontFamily: 'var(--font-sans)',
        padding: 24,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
    >
      <header style={{ textAlign: 'center', marginBottom: 32 }}>
        <img src="/Logo.png" alt="AXSHARE" style={{ height: 48, width: 'auto', objectFit: 'contain', marginBottom: 16 }} />
        <p style={{ fontSize: 14, color: 'var(--ax-muted)' }}>Benvenuto · {formatWelcomeDate(time)}</p>
        <p style={{ fontSize: 18, fontWeight: 600, color: 'var(--ax-text)', marginTop: 4 }}>{formatTime(time)}</p>
      </header>

      <div
        style={{
          maxWidth: 720,
          width: '100%',
          background: 'var(--ax-surface-0, #fff)',
          borderRadius: 16,
          boxShadow: '0 4px 24px rgba(30,58,95,0.08)',
          padding: 24,
          border: '1px solid var(--ax-border)',
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--ax-text)', marginBottom: 20 }}>Hai ricevuto un file condiviso</h2>

        {isExpired ? (
          <p style={{ color: 'var(--ax-error)' }}>Questo link è scaduto</p>
        ) : (
          <>
            <table className="file-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid var(--ax-border)', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--ax-muted)' }}>NOME</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid var(--ax-border)', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--ax-muted)' }}>DIMENSIONE</th>
                  <th style={{ textAlign: 'right', padding: '10px 12px', borderBottom: '1px solid var(--ax-border)', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--ax-muted)' }}>AZIONI</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  className="file-table-row-file"
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setContextMenu({ x: e.clientX, y: e.clientY })
                  }}
                  style={{ cursor: 'context-menu' }}
                >
                  <td style={{ padding: '12px', borderBottom: '1px solid var(--ax-border)' }}>
                    <div className="file-name-cell" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <img src={getFileIcon('file.axs')} alt="" width={40} height={40} style={{ objectFit: 'contain', flexShrink: 0 }} />
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={() => handleOpenInNewTab()}
                        onKeyDown={(e) => e.key === 'Enter' && handleOpenInNewTab()}
                        className="file-name"
                        style={{ fontWeight: 500, color: 'var(--ax-text)', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 2 }}
                      >
                        {info.label || 'File condiviso'}
                      </span>
                    </div>
                  </td>
                  <td style={{ padding: '12px', borderBottom: '1px solid var(--ax-border)', color: 'var(--ax-muted)', fontSize: 13 }}>
                    {fileData ? formatFileSize(fileData.size_bytes) : '—'}
                  </td>
                  <td style={{ padding: '12px', borderBottom: '1px solid var(--ax-border)', textAlign: 'right' }}>
                    <button
                      type="button"
                      onClick={handleDownload}
                      disabled={downloadInProgress || isExpired}
                      style={{
                        padding: '8px 16px',
                        borderRadius: 8,
                        border: 'none',
                        background: 'var(--ax-blue)',
                        color: 'white',
                        fontWeight: 600,
                        fontSize: 13,
                        cursor: downloadInProgress || isExpired ? 'not-allowed' : 'pointer',
                        opacity: downloadInProgress || isExpired ? 0.7 : 1,
                      }}
                    >
                      {downloadInProgress ? 'Scarica in corso...' : 'Scarica'}
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>

            {toast && <p style={{ marginTop: 12, fontSize: 13, color: 'var(--ax-muted)' }}>{toast}</p>}
          </>
        )}
      </div>

      {showPasswordModal && (
        <div
          className="ax-create-folder-overlay"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setShowPasswordModal(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            style={{
              background: 'var(--ax-surface-0)',
              borderRadius: 16,
              padding: 24,
              maxWidth: 400,
              width: '100%',
              boxShadow: '0 8px 32px rgba(30,58,95,0.15)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <img src="/Logo.png" alt="AXSHARE" style={{ height: 36, width: 'auto', objectFit: 'contain', marginBottom: 16 }} />
            <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--ax-text)', marginBottom: 8 }}>Questo file è protetto da password</p>
            <input
              type="password"
              placeholder="Inserisci password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handlePasswordSubmit()}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid var(--ax-border)',
                fontSize: 14,
                marginBottom: 8,
              }}
            />
            {passwordError && <p style={{ fontSize: 12, color: 'var(--ax-error)', marginBottom: 8 }}>{passwordError}</p>}
            <button
              type="button"
              onClick={handlePasswordSubmit}
              style={{
                width: '100%',
                padding: '10px 16px',
                borderRadius: 8,
                border: 'none',
                background: 'var(--ax-blue)',
                color: 'white',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Accedi
            </button>
          </div>
        </div>
      )}

      {contextMenu && typeof document !== 'undefined' && (
        <div
          ref={contextMenuRef}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            left: contextMenu.x,
            top: contextMenu.y,
            background: 'var(--ax-surface-0)',
            border: '1px solid var(--ax-border)',
            borderRadius: 12,
            padding: 8,
            minWidth: 160,
            boxShadow: '0 8px 24px rgba(30,58,95,0.12)',
            zIndex: 10000,
          }}
        >
          <button
            type="button"
            onClick={() => { handleDownload(); setContextMenu(null) }}
            style={{ display: 'block', width: '100%', padding: '8px 12px', textAlign: 'left', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--ax-text)' }}
          >
            Scarica
          </button>
          <button
            type="button"
            onClick={copyLink}
            style={{ display: 'block', width: '100%', padding: '8px 12px', textAlign: 'left', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--ax-text)' }}
          >
            Copia link
          </button>
        </div>
      )}
    </div>
  )
}
