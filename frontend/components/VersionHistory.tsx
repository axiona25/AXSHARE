'use client'

import { useCallback, useState } from 'react'
import { useFileVersions, useFileMutations } from '@/hooks/useFiles'
import { useCrypto } from '@/hooks/useCrypto'
import type { FileVersion as FileVersionType } from '@/types'

interface VersionHistoryProps {
  fileId: string
  fileName: string
  onClose: () => void
}

export function VersionHistory({ fileId, fileName, onClose }: VersionHistoryProps) {
  const { versions, isLoading, error, revalidate } = useFileVersions(fileId)
  const { restoreVersion, deleteVersion } = useFileMutations()
  const { downloadVersionAndDecrypt } = useCrypto()
  const [actionVersion, setActionVersion] = useState<number | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const handleRestore = useCallback(
    async (versionNumber: number) => {
      setActionError(null)
      setActionVersion(versionNumber)
      try {
        await restoreVersion(fileId, versionNumber)
        await revalidate()
        onClose()
      } catch (e) {
        setActionError(e instanceof Error ? e.message : 'Ripristino fallito')
      } finally {
        setActionVersion(null)
      }
    },
    [fileId, restoreVersion, revalidate, onClose]
  )

  const handleDownloadVersion = useCallback(
    async (versionNumber: number) => {
      setActionError(null)
      setActionVersion(versionNumber)
      try {
        const blob = await downloadVersionAndDecrypt(fileId, versionNumber)
        if (!blob) {
          setActionError('Download fallito')
          return
        }
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${fileName.replace(/\.[^.]+$/, '')}_v${versionNumber}`
        a.click()
        URL.revokeObjectURL(url)
      } catch (e) {
        setActionError(e instanceof Error ? e.message : 'Download fallito')
      } finally {
        setActionVersion(null)
      }
    },
    [fileId, fileName, downloadVersionAndDecrypt]
  )

  const handleDeleteVersion = useCallback(
    async (versionNumber: number) => {
      if (!confirm(`Eliminare la versione ${versionNumber}? Questa azione non è reversibile.`)) return
      setActionError(null)
      setActionVersion(versionNumber)
      try {
        await deleteVersion(fileId, versionNumber)
        await revalidate()
      } catch (e) {
        setActionError(e instanceof Error ? e.message : 'Eliminazione fallita')
      } finally {
        setActionVersion(null)
      }
    },
    [fileId, deleteVersion, revalidate]
  )

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          background: 'var(--background)',
          borderRadius: 8,
          padding: 24,
          maxWidth: 720,
          width: '100%',
          maxHeight: '80vh',
          overflow: 'auto',
          boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ marginTop: 0, marginBottom: 16 }}>
          Cronologia versioni: {fileName}
        </h2>
        {actionError && (
          <p style={{ color: 'var(--destructive)', marginBottom: 12 }}>{actionError}</p>
        )}
        {isLoading && <p>Caricamento versioni...</p>}
        {error && <p style={{ color: 'var(--destructive)' }}>Errore: {String(error)}</p>}
        {!isLoading && !error && versions && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={{ textAlign: 'left', padding: 8 }}>Versione</th>
                <th style={{ textAlign: 'left', padding: 8 }}>Data</th>
                <th style={{ textAlign: 'left', padding: 8 }}>Dimensione</th>
                <th style={{ textAlign: 'left', padding: 8 }}>Nota</th>
                <th style={{ textAlign: 'left', padding: 8 }}>Azioni</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v: FileVersionType) => (
                <tr
                  key={v.version_number}
                  style={{
                    borderBottom: '1px solid var(--border)',
                    fontWeight: v.is_current ? 'bold' : 'normal',
                  }}
                >
                  <td style={{ padding: 8 }}>
                    v{v.version_number} {v.is_current && '(corrente)'}
                  </td>
                  <td style={{ padding: 8 }}>
                    {new Date(v.created_at).toLocaleString('it-IT')}
                  </td>
                  <td style={{ padding: 8 }}>
                    {(v.size / 1024).toFixed(1)} KB
                  </td>
                  <td style={{ padding: 8 }}>{v.comment || '—'}</td>
                  <td style={{ padding: 8 }}>
                    {v.is_current ? (
                      <span>✓ Attiva</span>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => handleRestore(v.version_number)}
                          disabled={actionVersion !== null}
                          style={{ marginRight: 8 }}
                        >
                          Ripristina
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDownloadVersion(v.version_number)}
                          disabled={actionVersion !== null}
                          style={{ marginRight: 8 }}
                        >
                          Scarica
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteVersion(v.version_number)}
                          disabled={actionVersion !== null}
                        >
                          Elimina
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div style={{ marginTop: 16 }}>
          <button type="button" onClick={onClose}>
            Chiudi
          </button>
        </div>
      </div>
    </div>
  )
}
