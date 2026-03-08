'use client'

import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import Image from 'next/image'
import { useAuthContext } from '@/context/AuthContext'
import { useCrypto } from '@/hooks/useCrypto'
import { getFileIcon, getFileLabel, getAxsFileIcon } from '@/lib/fileIcons'
import { trashApi } from '@/lib/api'
import { AppHeader } from '@/components/AppHeader'
import { AppSidebar } from '@/components/AppSidebar'
import ConfirmModal from '@/components/ConfirmModal'

type TrashedFile = { id: string; name_encrypted: string; size_bytes?: number; trashed_at: string | null; original_folder_id: string | null; type: 'file' }
type TrashedFolder = { id: string; name_encrypted: string; trashed_at: string | null; original_folder_id: string | null; type: 'folder' }
type TrashedItem = TrashedFile | TrashedFolder

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function formatDateTimeIt(date: Date | string | null | undefined): string {
  if (date == null) return ''
  const d = typeof date === 'string' ? new Date(date) : date
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function CestinoPage() {
  useAuthContext()
  const { decryptFileNames, decryptFolderNames } = useCrypto()
  const [searchQuery, setSearchQuery] = useState('')
  const [trashedFiles, setTrashedFiles] = useState<TrashedFile[]>([])
  const [trashedFolders, setTrashedFolders] = useState<TrashedFolder[]>([])
  const [decryptedFileNames, setDecryptedFileNames] = useState<Record<string, string>>({})
  const [decryptedFolderNames, setDecryptedFolderNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; id: string; name: string; type: 'file' | 'folder' } | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const tableContainerRef = useRef<HTMLDivElement>(null)
  const [availableHeight, setAvailableHeight] = useState(600)
  const ROW_HEIGHT = 52
  const HEADER_HEIGHT = 52
  const [toast, setToast] = useState<string | null>(null)
  const [shareToast, setShareToast] = useState<{
    title: string
    body: string
    visible: boolean
    hiding: boolean
  } | null>(null)
  const [hasShareNotif, setHasShareNotif] = useState(false)
  const shareToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [confirmModal, setConfirmModal] = useState<{
    title: string
    message: string
    confirmLabel?: string
    variant?: 'danger' | 'default'
    onConfirm: () => void
  } | null>(null)

  useLayoutEffect(() => {
    if (!contextMenu || !contextMenuRef.current) return
    const el = contextMenuRef.current
    const rect = el.getBoundingClientRect()
    let top = contextMenu.y
    let left = contextMenu.x
    if (rect.bottom > window.innerHeight) top = contextMenu.y - rect.height
    if (rect.right > window.innerWidth) left = contextMenu.x - rect.width
    if (top < 8) top = 8
    if (left < 8) left = 8
    el.style.top = `${top}px`
    el.style.left = `${left}px`
  }, [contextMenu])

  useEffect(() => {
    function handleClick() {
      setContextMenu(null)
    }
    if (contextMenu) {
      document.addEventListener('click', handleClick)
      return () => document.removeEventListener('click', handleClick)
    }
  }, [contextMenu])

  function showToastMsg(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  const showShareToast = useCallback((title: string, body: string) => {
    if (shareToastTimerRef.current) {
      clearTimeout(shareToastTimerRef.current)
    }
    setShareToast({ title, body, visible: true, hiding: false })
    setHasShareNotif(true)
    shareToastTimerRef.current = setTimeout(() => {
      setShareToast((prev) => (prev ? { ...prev, hiding: true, visible: false } : null))
      setTimeout(() => setShareToast(null), 400)
    }, 4000)
  }, [])

  useEffect(() => {
    return () => {
      if (shareToastTimerRef.current) clearTimeout(shareToastTimerRef.current)
    }
  }, [])

  useEffect(() => {
    const load = async () => {
      try {
        const res = await trashApi.list()
        const data = res.data ?? { files: [], folders: [] }
        const files = (data.files ?? []) as TrashedFile[]
        const folders = (data.folders ?? []) as TrashedFolder[]
        setTrashedFiles(files)
        setTrashedFolders(folders)
        if (files.length > 0) {
          const names = await decryptFileNames(files)
          setDecryptedFileNames(names)
        } else {
          setDecryptedFileNames({})
        }
        if (folders.length > 0) {
          const names = await decryptFolderNames(folders)
          setDecryptedFolderNames(names)
        } else {
          setDecryptedFolderNames({})
        }
      } catch {
        showToastMsg('Errore caricamento cestino')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [decryptFileNames, decryptFolderNames])

  const filteredItems: TrashedItem[] = [
    ...trashedFolders.map((f) => ({ ...f, type: 'folder' as const })),
    ...trashedFiles.map((f) => ({ ...f, type: 'file' as const })),
  ]
  const allItemIds = filteredItems.map((i) => i.id)
  const allSelected = allItemIds.length > 0 && allItemIds.every((id) => selected.has(id))
  const hasItems = trashedFiles.length > 0 || trashedFolders.length > 0

  const handleRestore = async (id: string, type: 'file' | 'folder') => {
    try {
      if (type === 'file') await trashApi.restoreFile(id)
      else await trashApi.restoreFolder(id)
      setTrashedFiles((p) => p.filter((f) => f.id !== id))
      setTrashedFolders((p) => p.filter((f) => f.id !== id))
      showToastMsg('Elemento ripristinato')
    } catch {
      showToastMsg('Errore durante il ripristino')
    }
  }

  const handleDestroyPermanent = async (id: string, type: 'file' | 'folder') => {
    try {
      if (type === 'file') await trashApi.destroyFile(id)
      else await trashApi.destroyFolder(id)
      setTrashedFiles((p) => p.filter((f) => f.id !== id))
      setTrashedFolders((p) => p.filter((f) => f.id !== id))
      showToastMsg('Eliminato definitivamente')
    } catch {
      showToastMsg("Errore durante l'eliminazione")
    }
  }

  function openDestroyConfirm(id: string, type: 'file' | 'folder') {
    setConfirmModal({
      title: 'Eliminazione definitiva',
      message: 'Questo elemento verrà eliminato per sempre senza possibilità di recupero.',
      confirmLabel: 'Elimina definitivamente',
      variant: 'danger',
      onConfirm: () => {
        setConfirmModal(null)
        handleDestroyPermanent(id, type)
      },
    })
  }

  function openEmptyTrashConfirm() {
    setConfirmModal({
      title: 'Svuota cestino?',
      message: 'Tutti gli elementi nel cestino verranno eliminati definitivamente.',
      confirmLabel: 'Svuota cestino',
      variant: 'danger',
      onConfirm: async () => {
        setConfirmModal(null)
        try {
          await trashApi.emptyTrash()
          setTrashedFiles([])
          setTrashedFolders([])
          showToastMsg('Cestino svuotato')
        } catch {
          showToastMsg('Errore durante lo svuotamento')
        }
      },
    })
  }

  useEffect(() => {
    const el = tableContainerRef.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      setAvailableHeight(el.clientHeight)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const visibleRows = Math.max(0, Math.floor((availableHeight - HEADER_HEIGHT) / ROW_HEIGHT))
  const totalRealRows = filteredItems.length
  const emptyRowsCount =
    totalRealRows === 0
      ? Math.max(0, visibleRows - 1)
      : Math.max(0, visibleRows - totalRealRows)

  return (
    <div className="ax-dash-mockup-root">
      <AppHeader searchValue={searchQuery} onSearchChange={setSearchQuery} hasShareNotification={hasShareNotif} onClearShareNotification={() => setHasShareNotif(false)} />

      <div className="app-body">
        <AppSidebar />

        <main className="main" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          <div className="section-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <div className="section-title">
              <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
              </svg>
              Cestino
            </div>
            {hasItems && (
              <button
                type="button"
                className="ax-toolbar-btn ax-toolbar-btn-danger"
                onClick={openEmptyTrashConfirm}
              >
                Svuota cestino
              </button>
            )}
          </div>

          <div className="files-section" data-testid="file-list" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div className="files-toolbar">
              <div className="files-title" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <>
                  <svg className="files-title-arrow" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                  <button type="button" className="files-title-breadcrumb-item" onClick={() => {}} data-testid="breadcrumb-root">
                    Tutti gli elementi
                  </button>
                </>
              </div>
            </div>

            {loading ? (
              <div className="file-table-empty-placeholder" style={{ flex: 1, minHeight: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ color: 'var(--ax-muted)', fontSize: 14 }}>Caricamento...</span>
              </div>
            ) : filteredItems.length === 0 ? (
              <div
                className="file-table-empty-placeholder"
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minHeight: 320,
                  padding: 48,
                  textAlign: 'center',
                }}
              >
                <div
                  style={{
                    width: 80,
                    height: 80,
                    borderRadius: '50%',
                    background: 'linear-gradient(135deg, var(--ax-surface-1) 0%, var(--ax-surface-2) 100%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: 24,
                  }}
                >
                  <svg width="40" height="40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5" style={{ color: 'var(--ax-muted)' }}>
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6M14 11v6" />
                  </svg>
                </div>
                <p style={{ fontSize: 18, fontWeight: 600, color: 'var(--ax-text)', marginBottom: 8, letterSpacing: '-0.01em' }}>
                  Il cestino è vuoto
                </p>
                <p style={{ fontSize: 14, color: 'var(--ax-muted)', maxWidth: 320, lineHeight: 1.5 }}>
                  I file e le cartelle eliminati appariranno qui. Vengono rimossi definitivamente dopo 30 giorni.
                </p>
              </div>
            ) : (
              <div className="file-table-scroll-wrap" ref={tableContainerRef} style={{ flex: 1, overflow: totalRealRows >= visibleRows ? 'auto' : 'hidden', minHeight: 0 }}>
                <table className="file-table">
                  <thead>
                    <tr>
                      <th style={{ width: 44, paddingLeft: 20, paddingRight: 0, verticalAlign: 'middle' }}>
                        <div
                          role="checkbox"
                          aria-checked={allSelected}
                          tabIndex={0}
                          className="ax-table-check ax-table-check-all"
                          onClick={(e) => {
                            e.stopPropagation()
                            if (allSelected) setSelected(new Set())
                            else setSelected(new Set(allItemIds))
                          }}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click() } }}
                          style={{
                            width: 20, height: 20, borderRadius: '50%',
                            border: `2px solid ${allSelected ? 'var(--ax-blue)' : 'var(--ax-border)'}`,
                            background: allSelected ? 'var(--ax-blue)' : 'white',
                            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                          }}
                        >
                          {allSelected && (
                            <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                              <path d="M1 4l3 3 5-6" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </div>
                      </th>
                      <th style={{ width: '40%' }}>NOME</th>
                      <th style={{ width: '12%' }}>DIMENSIONE</th>
                      <th style={{ width: '12%' }}>TIPO</th>
                      <th style={{ width: '18%' }}>ELIMINATO IL</th>
                      <th style={{ width: '18%' }}>SCADE IL</th>
                    </tr>
                  </thead>
                  <tbody className="file-table-tbody-fixed">
                    {filteredItems.map((item) => {
                      const displayName = item.type === 'file'
                        ? (decryptedFileNames[item.id] ?? item.name_encrypted)
                        : (decryptedFolderNames[item.id] ?? item.name_encrypted)
                      const itemChecked = selected.has(item.id)
                      const isFile = item.type === 'file'
                      return (
                        <tr
                          key={item.id}
                          className="file-table-row-file"
                          style={{ background: itemChecked ? 'rgba(50,153,243,0.06)' : undefined }}
                          onContextMenu={(e) => {
                            e.preventDefault()
                            setContextMenu({ x: e.clientX, y: e.clientY, id: item.id, name: displayName, type: item.type })
                          }}
                        >
                          <td style={{ width: 44, paddingLeft: 20, paddingRight: 0, verticalAlign: 'middle' }} onClick={(e) => e.stopPropagation()}>
                            <div
                              role="checkbox"
                              aria-checked={itemChecked}
                              onClick={(e) => {
                                e.stopPropagation()
                                setSelected((prev) => {
                                  const s = new Set(prev)
                                  if (s.has(item.id)) s.delete(item.id)
                                  else s.add(item.id)
                                  return s
                                })
                              }}
                              style={{
                                width: 20, height: 20, borderRadius: '50%',
                                border: `2px solid ${itemChecked ? 'var(--ax-blue)' : 'var(--ax-border)'}`,
                                background: itemChecked ? 'var(--ax-blue)' : 'white',
                                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                              }}
                            >
                              {itemChecked && (
                                <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                                  <path d="M1 4l3 3 5-6" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              )}
                            </div>
                          </td>
                          <td>
                            <div className="file-name-cell">
                              <div className="file-type-icon-wrap">
                                {isFile ? (
                                  <Image src={displayName.endsWith('.axs') ? getAxsFileIcon(displayName) : getFileIcon(displayName, false)} alt={getFileLabel(displayName)} width={52} height={52} className="file-type-icon" style={{ objectFit: 'contain', flexShrink: 0 }} unoptimized />
                                ) : (
                                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--ax-folder)' }}>
                                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                                  </svg>
                                )}
                              </div>
                              <span className="file-name">{displayName}</span>
                            </div>
                          </td>
                          <td className="file-size-cell">{isFile ? formatFileSize((item as TrashedFile).size_bytes ?? 0) : '—'}</td>
                          <td>{isFile ? 'File' : 'Cartella'}</td>
                          <td>{item.trashed_at ? formatDateTimeIt(item.trashed_at) : '—'}</td>
                          <td>—</td>
                        </tr>
                      )
                    })}
                    {Array.from({ length: emptyRowsCount }).map((_, i) => (
                      <tr key={`empty-${i}`} className="file-table-empty-row" aria-hidden style={{ height: ROW_HEIGHT }}>
                        <td style={{ borderBottom: 'none', padding: 0 }} />
                        <td style={{ borderBottom: 'none', padding: 0 }} />
                        <td style={{ borderBottom: 'none', padding: 0 }} />
                        <td style={{ borderBottom: 'none', padding: 0 }} />
                        <td style={{ borderBottom: 'none', padding: 0 }} />
                        <td style={{ borderBottom: 'none', padding: 0 }} />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="table-footer">
              <div className="table-info">
                {filteredItems.length === 0 ? '0 elementi' : `${filteredItems.length} elementi`}
              </div>
            </div>
          </div>
        </main>
      </div>

      {confirmModal && (
        <ConfirmModal
          open
          title={confirmModal.title}
          message={confirmModal.message}
          confirmLabel={confirmModal.confirmLabel}
          variant={confirmModal.variant}
          onConfirm={confirmModal.onConfirm}
          onCancel={() => setConfirmModal(null)}
        />
      )}

      {contextMenu && typeof document !== 'undefined' && createPortal(
        <div
          ref={contextMenuRef}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            zIndex: 10000,
            left: contextMenu.x,
            top: contextMenu.y,
            background: 'white',
            border: '1px solid var(--ax-border)',
            borderRadius: 14,
            padding: 8,
            minWidth: 210,
            maxHeight: 'calc(100vh - 16px)',
            overflowY: 'auto',
            boxShadow: '0 8px 32px rgba(30,58,95,0.15)',
          }}
        >
          <div style={{ padding: '8px 12px 10px', borderBottom: '1px solid var(--ax-surface-2)', marginBottom: 4 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ax-navy)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180 }}>
              {contextMenu.name}
            </div>
          </div>
          {[
            { icon: <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M3 10h10a8 8 0 0 1 8 8v2M3 10l6 6m-6-6 6-6" /></svg>, label: 'Ripristina', action: () => { handleRestore(contextMenu.id, contextMenu.type); setContextMenu(null) } },
          ].map((item) => (
            <div
              key={item.label}
              onClick={() => item.action()}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 8, fontSize: 13, fontWeight: 500, color: 'var(--ax-text)', cursor: 'pointer' }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLDivElement).style.background = 'var(--ax-surface-1)')}
              onMouseLeave={(e) => ((e.currentTarget as HTMLDivElement).style.background = 'transparent')}
            >
              <span style={{ color: 'var(--ax-muted)', display: 'flex' }}>{item.icon}</span>
              {item.label}
            </div>
          ))}
          <div style={{ height: 1, background: 'var(--ax-surface-2)', margin: '4px 0' }} />
          <div
            onClick={() => { openDestroyConfirm(contextMenu.id, contextMenu.type); setContextMenu(null) }}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 8, fontSize: 13, fontWeight: 500, color: 'var(--ax-error)', cursor: 'pointer' }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLDivElement).style.background = 'rgba(239,68,68,0.06)')}
            onMouseLeave={(e) => ((e.currentTarget as HTMLDivElement).style.background = 'transparent')}
          >
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /></svg>
            Elimina definitivamente
          </div>
        </div>,
        document.body
      )}

      <div className={`ax-dash-toast${toast ? ' show' : ''}`} role="status" aria-live="polite">
        {toast ?? ''}
      </div>

      {shareToast && (
        <div className={`ax-share-toast${shareToast.visible ? ' show' : ''}${shareToast.hiding ? ' hide' : ''}`}>
          <div className="ax-share-toast-header">
            <div className="ax-share-toast-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ax-accent,#3b82f6)" strokeWidth="2.5">
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                <polyline points="16 6 12 2 8 6" />
                <line x1="12" y1="2" x2="12" y2="15" />
              </svg>
            </div>
            <span className="ax-share-toast-title">{shareToast.title}</span>
            <button
              type="button"
              className="ax-share-toast-close"
              onClick={() => {
                setShareToast(null)
                if (shareToastTimerRef.current) clearTimeout(shareToastTimerRef.current)
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div className="ax-share-toast-body">{shareToast.body}</div>
          <div className="ax-share-toast-progress" key={shareToast.title} />
        </div>
      )}
    </div>
  )
}
