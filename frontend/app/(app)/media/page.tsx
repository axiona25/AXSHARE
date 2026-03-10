'use client'

import { useState, useRef, useEffect, useMemo, useLayoutEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import Image from 'next/image'
import { useAuthContext } from '@/context/AuthContext'
import { useFiles, useFileMutations } from '@/hooks/useFiles'
import { useCrypto } from '@/hooks/useCrypto'
import { usePinVerification } from '@/hooks/usePinVerification'
import { activityApi, filesApi, trashApi, shareLinksApi } from '@/lib/api'
import { getFileIcon, getFileLabel, getAxsFileIcon } from '@/lib/fileIcons'
import { AppHeader } from '@/components/AppHeader'
import { AppSidebar } from '@/components/AppSidebar'
import ConfirmModal from '@/components/ConfirmModal'
import { CreateLinkModal } from '@/components/CreateLinkModal'
import { isRunningInTauri } from '@/lib/tauri'
import type { ActivityLog, FileItem, RootFileItem } from '@/types'

const MEDIA_IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico'])
const MEDIA_AUDIO_EXT = new Set(['mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac', 'wma'])
const MEDIA_VIDEO_EXT = new Set(['mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v'])

function isMediaFile(filename: string): boolean {
  const ext = (filename.split('.').pop() ?? '').toLowerCase()
  return MEDIA_IMAGE_EXT.has(ext) || MEDIA_AUDIO_EXT.has(ext) || MEDIA_VIDEO_EXT.has(ext)
}

function getMediaType(filename: string): string {
  const ext = (filename.split('.').pop() ?? '').toLowerCase()
  if (MEDIA_IMAGE_EXT.has(ext)) return 'Immagine'
  if (MEDIA_AUDIO_EXT.has(ext)) return 'Audio'
  if (MEDIA_VIDEO_EXT.has(ext)) return 'Video'
  return '—'
}

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
    second: '2-digit',
  })
}

function formatRelativeModified(date: Date | string | null | undefined): string {
  if (date == null) return '—'
  const d = typeof date === 'string' ? new Date(date) : date
  if (Number.isNaN(d.getTime())) return '—'
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays < 0) return '—'
  if (diffDays === 0) return 'Oggi'
  if (diffDays === 1) return 'Ieri'
  if (diffDays <= 6) return `${diffDays} giorni fa`
  if (diffDays <= 13) return '7 giorni fa'
  const diffWeeks = Math.floor(diffDays / 7)
  if (diffWeeks <= 11) return `${diffWeeks} settimane fa`
  return `${diffWeeks} settimane fa`
}

const ACTION_LABELS: Record<string, string> = {
  upload: 'Caricato',
  download: 'Scaricato',
  rename: 'Rinominato',
  move: 'Spostato',
  delete: 'Eliminato',
  share: 'Condiviso',
  share_link: 'Collegamento creato',
  share_revoke: 'Collegamento rimosso',
  create_folder: 'Creato',
  trash: 'Spostato nel cestino',
  restore: 'Ripristinato',
  destroy: 'Eliminato definitivamente',
}

/** Azioni da mostrare in ATTIVITÀ: esclude download/sync virtual disk. */
const ACTIVITY_ACTIONS_TO_SHOW = new Set([
  'upload', 'rename', 'move', 'delete', 'share', 'share_link', 'share_revoke', 'trash', 'destroy', 'create_folder', 'update',
])

function getActivityLabel(log: ActivityLog): string {
  return ACTION_LABELS[log.action] ?? log.action
}

function formatActivityDate(createdAt: string): string {
  const d = new Date(createdAt)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays === 0) {
    const time = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
    return `oggi ${time}`
  }
  if (diffDays === 1) return 'ieri'
  return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })
}

function formatActivityDisplay(log: ActivityLog): string {
  const label = ACTION_LABELS[log.action] ?? log.action
  const dateStr = formatActivityDate(log.created_at)
  return dateStr ? `${label} · ${dateStr}` : label
}

export default function MediaPage() {
  const { files, isLoading: filesLoading, revalidate: reloadFiles } = useFiles(undefined)
  const { deleteFile } = useFileMutations()
  const { hasSessionKey, user } = useAuthContext()
  const { downloadAndDecrypt, decryptFileNames, getFileKeyBase64ForShare } = useCrypto()

  const [decryptedNames, setDecryptedNames] = useState<Record<string, string>>({})
  const [searchQuery, setSearchQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set()
    try {
      return new Set(JSON.parse(window.localStorage.getItem('axshare_favorites') ?? '[]'))
    } catch {
      return new Set()
    }
  })
  const toggleFavorite = useCallback((id: string) => {
    setFavorites((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      try {
        window.localStorage.setItem('axshare_favorites', JSON.stringify(Array.from(next)))
      } catch { /* ignore */ }
      return next
    })
  }, [])
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; id: string; name: string } | null>(null)
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
  const [lastActivityByTargetId, setLastActivityByTargetId] = useState<Record<string, ActivityLog | null>>({})
  const [linkModal, setLinkModal] = useState<{ id: string; name: string } | null>(null)
  const [shareModal, setShareModal] = useState<{ type: 'file'; id: string; name: string } | null>(null)
  const [sharePermission, setSharePermission] = useState<'read' | 'write'>('read')
  const [shareBlockForward, setShareBlockForward] = useState(false)
  const [shareBlockDelete, setShareBlockDelete] = useState(false)
  const [shareBlockDownload, setShareBlockDownload] = useState(false)
  const [shareExpiry, setShareExpiry] = useState<'never' | 'custom'>('never')
  const [shareExpiryDate, setShareExpiryDate] = useState('')
  const [shareExpiryTime, setShareExpiryTime] = useState('23:59')
  const [sharePinRequired, setSharePinRequired] = useState(false)
  const [shareUserSearchQuery, setShareUserSearchQuery] = useState('')
  const [shareRecipientUsers, setShareRecipientUsers] = useState<Array<{ id: string; email: string; display_name?: string }>>([])
  const [shareSearchDropdownOpen, setShareSearchDropdownOpen] = useState(false)
  const shareSearchRef = useRef<HTMLDivElement>(null)

  const [showPreview, setShowPreview] = useState(false)
  const [previewUrl, setPreviewUrl] = useState('')
  const [previewType, setPreviewType] = useState<'image' | 'video' | 'audio'>('image')
  const [previewName, setPreviewName] = useState('')
  const [previewFileId, setPreviewFileId] = useState<string | null>(null)
  const { requestPin, PinModal } = usePinVerification()

  function closePreview() {
    setShowPreview(false)
    setPreviewFileId(null)
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl('')
  }

  async function handleOpenMedia(file: FileItem | RootFileItem) {
    if (!hasSessionKey) return
    try {
      const blob = await downloadAndDecrypt(file.id, decryptedNames[file.id], { onRequiresPin: requestPin })
      if (!blob) return
      const displayName = decryptedNames[file.id] ?? file.name_encrypted
      const mime = (blob.type || '').toLowerCase()
      // Estensione da displayName decifrato (affidabile) — non dal nome cifrato
      const ext = (displayName.split('.').pop() ?? '').toLowerCase()
      const isImage = mime.startsWith('image/') || MEDIA_IMAGE_EXT.has(ext)
      const isVideo = mime.startsWith('video/') || MEDIA_VIDEO_EXT.has(ext)
      const isAudio = mime.startsWith('audio/') || MEDIA_AUDIO_EXT.has(ext)

      // Se il blob ha MIME generico ma l'estensione è media, forza il MIME corretto
      // così il tag <img>/<video>/<audio> lo renderizza correttamente
      let finalBlob = blob
      if (blob.type === 'application/octet-stream' && (isImage || isVideo || isAudio)) {
        const FORCE_MIME: Record<string, string> = {
          jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
          gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
          svg: 'image/svg+xml',
          mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
          avi: 'video/x-msvideo', mkv: 'video/x-matroska', m4v: 'video/mp4',
          mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4',
          ogg: 'audio/ogg', flac: 'audio/flac', aac: 'audio/aac',
        }
        if (FORCE_MIME[ext]) {
          finalBlob = new Blob([await blob.arrayBuffer()], { type: FORCE_MIME[ext] })
        }
      }

      if (isImage || isVideo || isAudio) {
        if (previewUrl) URL.revokeObjectURL(previewUrl)
        const url = URL.createObjectURL(finalBlob)
        setPreviewUrl(url)
        setPreviewType(isImage ? 'image' : isVideo ? 'video' : 'audio')
        setPreviewName(displayName)
        setPreviewFileId(file.id)
        setShowPreview(true)
      } else {
        void handleDownloadFile(file)
      }
    } catch {
      showToastMsg('Errore durante l\'apertura')
    }
  }

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

  const refetchActivityForFile = useCallback(async (fileId: string) => {
    try {
      const res = await activityApi.getFileActivity(fileId)
      const list = res.data ?? []
      const first = (list as ActivityLog[]).find((log) => ACTIVITY_ACTIONS_TO_SHOW.has(log.action)) ?? null
      setLastActivityByTargetId((prev) => ({ ...prev, [fileId]: first }))
    } catch {
      // ignore
    }
  }, [])

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

  const resetShareModalState = useCallback(() => {
    setSharePermission('read')
    setShareBlockForward(false)
    setShareBlockDelete(false)
    setShareBlockDownload(false)
    setShareExpiry('never')
    setShareExpiryDate('')
    setShareExpiryTime('23:59')
    setSharePinRequired(false)
    setShareUserSearchQuery('')
    setShareRecipientUsers([])
    setShareSearchDropdownOpen(false)
  }, [])

  const addRecipientUser = useCallback((user: { id: string; email: string; display_name?: string }) => {
    setShareRecipientUsers((prev) => {
      if (prev.some((u) => u.id === user.id || u.email.toLowerCase() === user.email.toLowerCase())) return prev
      return [...prev, user]
    })
    setShareUserSearchQuery('')
    setShareSearchDropdownOpen(false)
  }, [])

  const removeRecipientUser = useCallback((id: string) => {
    setShareRecipientUsers((prev) => prev.filter((u) => u.id !== id))
  }, [])

  const handleShare = useCallback(async () => {
    if (!shareModal) return
    let expiresAt: string | undefined
    if (shareExpiry === 'custom' && shareExpiryDate) {
      expiresAt = new Date(`${shareExpiryDate}T${shareExpiryTime}`).toISOString()
    }
    const recipientLabel = shareRecipientUsers.map((u) => u.display_name || u.email).join(', ') || undefined
    try {
      let fileKeyBase64: string | null = null
      if (shareModal.type === 'file') {
        fileKeyBase64 = await getFileKeyBase64ForShare(shareModal.id)
      }
      const result = await shareLinksApi.create(shareModal.id, {
        expires_at: expiresAt,
        require_recipient_pin: sharePinRequired || undefined,
        label: recipientLabel,
        ...(fileKeyBase64 != null && { file_key_encrypted_for_link: fileKeyBase64 }),
      })
      const link = `${typeof window !== 'undefined' ? window.location.origin : ''}/share/${result.data.token}`
      await navigator.clipboard.writeText(link)
      showShareToast('🔗 Link di condivisione creato', `"${shareModal?.name}" · Link copiato negli appunti`)
      refetchActivityForFile(shareModal.id)
    } catch {
      showToastMsg('Errore durante la condivisione')
    }
    resetShareModalState()
    setShareModal(null)
  }, [shareModal, shareExpiry, shareExpiryDate, shareExpiryTime, sharePinRequired, shareRecipientUsers, resetShareModalState, showShareToast, refetchActivityForFile, getFileKeyBase64ForShare])

  useEffect(() => {
    if (!hasSessionKey || !files?.length) return
    const toDecrypt = files.filter((f) => !decryptedNames[f.id])
    if (toDecrypt.length === 0) return
    decryptFileNames(toDecrypt).then((names) => {
      setDecryptedNames((prev) => ({ ...prev, ...names }))
    })
  }, [hasSessionKey, files, decryptedNames, decryptFileNames])

  const visibleFiles = useMemo(() => {
    return (files ?? []).filter((f) => {
      const name = decryptedNames[f.id] ?? ''
      return !!name && isMediaFile(name)
    })
  }, [files, decryptedNames])

  useEffect(() => {
    if (!hasSessionKey || visibleFiles.length === 0) return
    const fileIds = visibleFiles.map((f) => f.id)
    let cancelled = false
    const load = async () => {
      const next: Record<string, ActivityLog | null> = {}
      await Promise.all(
        fileIds.map(async (id) => {
          if (cancelled) return
          try {
            const res = await activityApi.getFileActivity(id)
            const list = res.data ?? []
            const first = (list as ActivityLog[]).find((log) => ACTIVITY_ACTIONS_TO_SHOW.has(log.action)) ?? null
            if (!cancelled) next[id] = first
          } catch {
            if (!cancelled) next[id] = null
          }
        })
      )
      if (!cancelled) setLastActivityByTargetId((prev) => ({ ...prev, ...next }))
    }
    load()
    return () => { cancelled = true }
  }, [hasSessionKey, visibleFiles])

  useEffect(() => {
    return () => {
      if (shareToastTimerRef.current) clearTimeout(shareToastTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!shareModal) return
    const onDocClick = (e: MouseEvent) => {
      if (shareSearchRef.current && !shareSearchRef.current.contains(e.target as Node)) setShareSearchDropdownOpen(false)
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [shareModal])

  const q = searchQuery.trim().toLowerCase()
  const filteredFiles = useMemo(() => {
    const list = q
      ? visibleFiles.filter((f) =>
          (decryptedNames[f.id] ?? f.name_encrypted ?? '').toLowerCase().includes(q)
        )
      : visibleFiles
    const withDates = list as Array<FileItem & { updated_at?: string; created_at?: string }>
    return [...withDates].sort((a, b) => {
      const dateA = a.updated_at ?? a.created_at ?? ''
      const dateB = b.updated_at ?? b.created_at ?? ''
      return dateB.localeCompare(dateA)
    })
  }, [visibleFiles, decryptedNames, q])

  const allItemIds = useMemo(() => filteredFiles.map((f) => f.id), [filteredFiles])
  const allSelected = allItemIds.length > 0 && allItemIds.every((id) => selected.has(id))

  async function handleDownloadFile(file: FileItem | RootFileItem) {
    if (!hasSessionKey) return
    try {
      if (isRunningInTauri()) {
        const blob = await downloadAndDecrypt(file.id, decryptedNames[file.id], { onRequiresPin: requestPin })
        if (!blob) return
        const { invoke } = await import('@tauri-apps/api/core')
        const fileName = decryptedNames[file.id] ?? file.name_encrypted ?? file.id
        const safeName = fileName.replace(/[/\\:*?"<>|]/g, '_')
        const arrayBuffer = await blob.arrayBuffer()
        const bytes = Array.from(new Uint8Array(arrayBuffer))
        const filePath = await invoke<string>('write_temp_file', { name: safeName, contents: bytes })
        await invoke('open_file_native', { path: filePath })
        showToastMsg('Apertura con app predefinita')
      } else {
        const { data } = await filesApi.download(file.id)
        const encryptedBlob = new Blob([data as ArrayBuffer], { type: 'application/octet-stream' })
        const url = URL.createObjectURL(encryptedBlob)
        const a = document.createElement('a')
        a.href = url
        a.download = (decryptedNames[file.id] ?? file.name_encrypted) + '.axs'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        setTimeout(() => URL.revokeObjectURL(url), 1000)
        showToastMsg('File cifrato scaricato')
      }
    } catch {
      showToastMsg('Errore durante il download')
    }
  }

  const doTrashFile = async (fileId: string) => {
    try {
      await trashApi.trashFile(fileId)
      refetchActivityForFile(fileId)
      reloadFiles()
      showToastMsg('File spostato nel cestino')
    } catch {
      showToastMsg('Errore durante lo spostamento nel cestino')
    }
  }

  function handleDelete(fileId: string) {
    setConfirmModal({
      title: 'Sposta nel cestino',
      message: 'Il file verrà spostato nel cestino. Potrai recuperarlo in seguito.',
      confirmLabel: 'Sposta nel cestino',
      variant: 'danger',
      onConfirm: () => {
        setConfirmModal(null)
        doTrashFile(fileId)
      },
    })
  }

  const showListLoading = filesLoading

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
  const totalRealRows = filteredFiles.length
  const emptyRowsCount =
    totalRealRows === 0
      ? Math.max(0, visibleRows - 1)
      : Math.max(0, visibleRows - totalRealRows)

  return (
    <div className="ax-dash-mockup-root">
      <PinModal />
      <AppHeader searchValue={searchQuery} onSearchChange={setSearchQuery} hasShareNotification={hasShareNotif} onClearShareNotification={() => setHasShareNotif(false)} />

      <div className="app-body">
        <AppSidebar />

        <main className="main" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          <div className="section-header">
            <div className="section-title">
              <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
              Media
            </div>
          </div>

          <div className="files-section" data-testid="file-list" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div className="files-toolbar">
              <div className="files-title" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <>
                  <svg className="files-title-arrow" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                  <button type="button" className="files-title-breadcrumb-item" onClick={() => {}} data-testid="breadcrumb-root">
                    Tutti i media
                  </button>
                </>
              </div>
              {selected.size > 0 && (
                <div className="files-toolbar-actions" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    type="button"
                    className="ax-toolbar-btn ax-toolbar-btn-secondary"
                    onClick={() => {
                      filteredFiles.filter((f) => selected.has(f.id)).forEach((f) => void handleDownloadFile(f))
                    }}
                  >
                    Scarica
                  </button>
                  <button type="button" className="ax-toolbar-btn ax-toolbar-btn-danger" onClick={() => {
                    const first = filteredFiles.find((f) => selected.has(f.id))
                    if (first) handleDelete(first.id)
                    setSelected(new Set())
                  }}>
                    Elimina selezionati ({selected.size})
                  </button>
                  <button type="button" className="ax-toolbar-btn ax-toolbar-btn-secondary" onClick={() => setSelected(new Set())} aria-label="Deseleziona tutto">
                    <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </button>
                </div>
              )}
            </div>

            {!showListLoading && filteredFiles.length === 0 ? (
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
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                </div>
                <p style={{ fontSize: 18, fontWeight: 600, color: 'var(--ax-text)', marginBottom: 8, letterSpacing: '-0.01em' }}>
                  Nessun file media
                </p>
                <p style={{ fontSize: 14, color: 'var(--ax-muted)', maxWidth: 320, lineHeight: 1.5 }}>
                  I file immagini, audio e video nella root appariranno qui.
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
                      <th style={{ width: '35%' }}>NOME</th>
                      <th style={{ width: '8%' }}>DIMENSIONE</th>
                      <th style={{ width: '16%' }}>PROPRIETARIO</th>
                      <th style={{ width: '8%' }}>STATO</th>
                      <th style={{ width: '10%' }}>CONDIVISIONI</th>
                      <th style={{ width: '12%', textAlign: 'left' }}>DATA CREAZIONE</th>
                      <th style={{ width: '11%', textAlign: 'left' }}>ATTIVITÀ</th>
                    </tr>
                  </thead>
                  <tbody className="file-table-tbody-fixed">
                    {filteredFiles.map((file) => {
                      const displayName = decryptedNames[file.id] ?? file.name_encrypted
                      const fileWithDates = file as FileItem & { updated_at?: string; created_at?: string }
                      const fileModifiedOrCreatedAt = fileWithDates.updated_at ?? fileWithDates.created_at
                      const fileChecked = selected.has(file.id)
                      const lastActivity = lastActivityByTargetId[file.id]
                      return (
                        <tr
                          key={file.id}
                          className="file-table-row-file"
                          style={{ background: fileChecked ? 'rgba(50,153,243,0.06)' : undefined }}
                          onClick={() => void handleOpenMedia(file)}
                          onContextMenu={(e) => {
                            e.preventDefault()
                            setContextMenu({ x: e.clientX, y: e.clientY, id: file.id, name: displayName })
                          }}
                        >
                          <td style={{ width: 44, paddingLeft: 20, paddingRight: 0, verticalAlign: 'middle' }} onClick={(e) => e.stopPropagation()}>
                            <div
                              role="checkbox"
                              aria-checked={fileChecked}
                              onClick={(e) => {
                                e.stopPropagation()
                                setSelected((prev) => {
                                  const s = new Set(prev)
                                  if (s.has(file.id)) s.delete(file.id)
                                  else s.add(file.id)
                                  return s
                                })
                              }}
                              style={{
                                width: 20, height: 20, borderRadius: '50%',
                                border: `2px solid ${fileChecked ? 'var(--ax-blue)' : 'var(--ax-border)'}`,
                                background: fileChecked ? 'var(--ax-blue)' : 'white',
                                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                              }}
                            >
                              {fileChecked && (
                                <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                                  <path d="M1 4l3 3 5-6" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              )}
                            </div>
                          </td>
                          <td>
                            <div className="file-name-cell">
                              <div className="file-type-icon-wrap">
                                <Image src={displayName.endsWith('.axs') ? getAxsFileIcon(displayName) : getFileIcon(displayName, (file as FileItem).is_signed)} alt={getFileLabel(displayName)} width={52} height={52} className="file-type-icon" style={{ objectFit: 'contain', flexShrink: 0 }} unoptimized />
                              </div>
                              <span className="file-name">{displayName}</span>
                            </div>
                          </td>
                          <td className="file-size-cell">
                            {formatFileSize(((file as { size_bytes?: number; size?: number }).size_bytes ?? (file as { size_bytes?: number; size?: number }).size) ?? 0)}
                          </td>
                          <td>
                            <div className="owner-cell">
                              <div className="owner-avatar">
                                {user?.display_name?.trim()
                                  ? (user.display_name.split(/\s+/).filter(Boolean)[0]?.[0] ?? user.display_name[0] ?? 'U').toUpperCase()
                                  : (user?.email ? user.email.split('@')[0].slice(0, 2) : 'U').toUpperCase()}
                              </div>
                              {user?.display_name?.trim() || 'Tu'}
                            </div>
                          </td>
                          <td>Privato</td>
                          <td>—</td>
                          <td className="modified-cell" title={fileWithDates.created_at ? formatDateTimeIt(fileWithDates.created_at) : undefined}>
                            {fileWithDates.created_at ? formatDateTimeIt(fileWithDates.created_at) : '—'}
                          </td>
                          <td style={{ textAlign: 'left' }} className="activity-cell activity-cell-one-line">
                            {lastActivity && ACTIVITY_ACTIONS_TO_SHOW.has(lastActivity.action) ? (
                              <>
                                <span className="activity-label">{getActivityLabel(lastActivity)}</span>
                                {formatActivityDate(lastActivity.created_at) ? (
                                  <span className="activity-date"> · {formatActivityDate(lastActivity.created_at)}</span>
                                ) : null}
                              </>
                            ) : ''}
                          </td>
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
                {filteredFiles.length === 0 ? '0 elementi' : `${filteredFiles.length} elementi`}
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

      {showPreview && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '2rem',
          }}
        >
          <div className="ax-preview-modal">
            <div className="ax-preview-modal-header">
              <span className="ax-preview-modal-title" title={previewName}>{previewName}</span>
              <button
                type="button"
                className="ax-preview-modal-close"
                onClick={closePreview}
                aria-label="Chiudi anteprima"
              >
                <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="ax-preview-modal-body">
              {previewType === 'image' && (
                <img src={previewUrl} alt={previewName} />
              )}
              {previewType === 'video' && (
                <video src={previewUrl} controls autoPlay>
                  Il browser non supporta la riproduzione video.
                </video>
              )}
              {previewType === 'audio' && (
                <audio src={previewUrl} controls autoPlay>
                  Il browser non supporta la riproduzione audio.
                </audio>
              )}
            </div>
          </div>
        </div>
      )}

      {linkModal && (
        <CreateLinkModal
          open
          type="file"
          id={linkModal.id}
          name={linkModal.name}
          onClose={() => setLinkModal(null)}
          onSuccess={(label) => {
            showShareToast('🔗 Collegamento creato', `"${label}" · Link copiato negli appunti`)
            refetchActivityForFile(linkModal.id)
          }}
        />
      )}

      {shareModal && (
        <div className="ax-create-folder-overlay" onClick={() => { resetShareModalState(); setShareModal(null) }} role="dialog" aria-modal="true" aria-labelledby="ax-share-title-media">
          <div className="ax-create-folder-modal ax-share-modal" onClick={(e) => e.stopPropagation()} style={{ minWidth: 560, maxWidth: 680 }}>
            <div className="ax-create-folder-modal-header" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Image src={shareModal.name.endsWith('.axs') ? getAxsFileIcon(shareModal.name) : getFileIcon(shareModal.name, false)} alt="" width={28} height={28} style={{ objectFit: 'contain', flexShrink: 0 }} unoptimized />
              <h2 id="ax-share-title-media" className="ax-create-folder-modal-title" style={{ margin: 0, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Condividi &quot;{shareModal.name}&quot;</h2>
              <button type="button" className="ax-create-folder-modal-close" onClick={() => { resetShareModalState(); setShareModal(null) }} aria-label="Chiudi" style={{ flexShrink: 0 }}>
                <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div className="ax-share-modal-body">
              <div className="ax-share-modal-grid">
                <div>
                  <div className="ax-share-modal-section" ref={shareSearchRef}>
                    <div className="ax-share-modal-section-title">DESTINATARI</div>
                    <div style={{ position: 'relative', width: '100%' }}>
                      <input
                        type="text"
                        className="ax-share-input"
                        value={shareUserSearchQuery}
                        onChange={(e) => { setShareUserSearchQuery(e.target.value); setShareSearchDropdownOpen(e.target.value.length > 0) }}
                        onFocus={() => setShareSearchDropdownOpen(shareUserSearchQuery.length > 0)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && shareUserSearchQuery.trim()) {
                            e.preventDefault()
                            addRecipientUser({ id: shareUserSearchQuery.trim(), email: shareUserSearchQuery.trim(), display_name: shareUserSearchQuery.trim() })
                          }
                        }}
                        placeholder="Cerca nome o email"
                        style={{ width: '100%', height: 40, padding: '0 12px', border: '1.5px solid var(--ax-border)', borderRadius: 10, fontSize: 14, background: 'var(--ax-surface-0)', boxSizing: 'border-box' }}
                      />
                      {shareSearchDropdownOpen && (
                        <div className="ax-share-search-dropdown" style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 6, background: 'var(--ax-surface-0)', border: '1px solid var(--ax-border)', borderRadius: 12, boxShadow: '0 10px 40px rgba(30,58,95,0.14)', zIndex: 10, maxHeight: 200, overflowY: 'auto' }}>
                          {shareUserSearchQuery.trim() ? (
                            <button
                              type="button"
                              onClick={() => addRecipientUser({ id: shareUserSearchQuery.trim(), email: shareUserSearchQuery.trim(), display_name: shareUserSearchQuery.trim() })}
                              style={{ width: '100%', padding: '12px 14px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, color: 'var(--ax-text)', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12, borderRadius: 10, transition: 'background 0.15s ease' }}
                              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--ax-surface-1)' }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                            >
                              <span style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--ax-blue)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 600, flexShrink: 0 }}>{(shareUserSearchQuery.trim()[0] ?? '?').toUpperCase()}</span>
                              <span style={{ flex: 1, minWidth: 0 }}>
                                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ fontWeight: 500 }}>Aggiungi</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ flexShrink: 0, color: 'var(--ax-blue)' }}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg></span>
                                <span style={{ display: 'block', fontSize: 13, color: 'var(--ax-muted)', marginTop: 2, wordBreak: 'break-all' }}>{shareUserSearchQuery.trim()}</span>
                              </span>
                            </button>
                          ) : (
                            <div style={{ padding: '14px 16px', fontSize: 13, color: 'var(--ax-muted)' }}>Digita nome o email per cercare</div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="ax-share-modal-section">
                    <div className="ax-share-modal-section-title">PERMESSI</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 14 }}>
                        <input type="radio" name="share-permission-media" checked={sharePermission === 'read'} onChange={() => setSharePermission('read')} />
                        <span>Lettura</span>
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 14 }}>
                        <input type="radio" name="share-permission-media" checked={sharePermission === 'write'} onChange={() => setSharePermission('write')} />
                        <span>Lettura e scrittura</span>
                      </label>
                    </div>
                  </div>
                  <div className="ax-share-modal-section">
                    <div className="ax-share-modal-section-title">BLOCCHI</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 14 }}>
                        <input type="checkbox" checked={shareBlockForward} onChange={(e) => setShareBlockForward(e.target.checked)} />
                        <span>Non può inoltrare il link</span>
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 14 }}>
                        <input type="checkbox" checked={shareBlockDelete} onChange={(e) => setShareBlockDelete(e.target.checked)} />
                        <span>Non può eliminare i file</span>
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 14 }}>
                        <input type="checkbox" checked={shareBlockDownload} onChange={(e) => { setShareBlockDownload(e.target.checked); if (e.target.checked) setSharePermission('read') }} />
                        <span>Non può scaricare</span>
                      </label>
                    </div>
                  </div>
                </div>
                <div>
                  <div className="ax-share-modal-section">
                    <div className="ax-share-modal-section-title">SCADENZA</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 14 }}>
                        <input type="radio" name="share-expiry-media" checked={shareExpiry === 'never'} onChange={() => setShareExpiry('never')} />
                        <span>Nessuna scadenza</span>
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 14 }}>
                        <input type="radio" name="share-expiry-media" checked={shareExpiry === 'custom'} onChange={() => setShareExpiry('custom')} />
                        <span>Imposta scadenza</span>
                      </label>
                      {shareExpiry === 'custom' && (
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 24, marginTop: 8 }}>
                          <input type="date" value={shareExpiryDate} onChange={(e) => setShareExpiryDate(e.target.value)} min={new Date().toISOString().split('T')[0]} style={{ flex: 1, height: 40, padding: '0 10px', border: '1.5px solid var(--ax-border)', borderRadius: 10, fontSize: 14 }} />
                          <input type="time" value={shareExpiryTime} onChange={(e) => setShareExpiryTime(e.target.value)} style={{ flex: 1, height: 40, padding: '0 10px', border: '1.5px solid var(--ax-border)', borderRadius: 10, fontSize: 14 }} />
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="ax-share-modal-section">
                    <div className="ax-share-modal-section-title">PIN DI ACCESSO</div>
                    <p style={{ fontSize: 12, color: 'var(--ax-muted)', marginBottom: 10, lineHeight: 1.4 }}>Se attivi &quot;Sì&quot;, il destinatario dovrà inserire il proprio PIN (quello già configurato al primo accesso) per aprire il contenuto condiviso.</p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <button type="button" className={sharePinRequired ? 'ax-create-folder-btn ax-create-folder-btn-secondary' : 'ax-create-folder-btn ax-create-folder-btn-primary'} style={{ padding: '8px 16px', borderRadius: 10, fontSize: 13 }} onClick={() => setSharePinRequired(false)}>No</button>
                      <button type="button" className={!sharePinRequired ? 'ax-create-folder-btn ax-create-folder-btn-secondary' : 'ax-create-folder-btn ax-create-folder-btn-primary'} style={{ padding: '8px 16px', borderRadius: 10, fontSize: 13 }} onClick={() => setSharePinRequired(true)}>Sì</button>
                    </div>
                  </div>
                  {shareRecipientUsers.length > 0 && (
                    <div className="ax-share-modal-section" style={{ marginTop: 8 }}>
                      <div className="ax-share-modal-section-title">DESTINATARI AGGIUNTI</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {shareRecipientUsers.map((u) => (
                          <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'var(--ax-surface-1)', borderRadius: 10 }}>
                            <span style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--ax-blue)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 600, flexShrink: 0 }}>{(u.display_name || u.email)[0].toUpperCase()}</span>
                            <span style={{ flex: 1, fontSize: 14, fontWeight: 500, color: 'var(--ax-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.display_name || u.email}</span>
                            <button type="button" onClick={() => removeRecipientUser(u.id)} aria-label="Rimuovi" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--ax-muted)', lineHeight: 1 }}>×</button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="ax-create-folder-modal-footer">
              <button type="button" className="ax-create-folder-btn ax-create-folder-btn-secondary" onClick={() => { resetShareModalState(); setShareModal(null) }}>Annulla</button>
              <button type="button" className="ax-create-folder-btn ax-create-folder-btn-primary" disabled={shareExpiry === 'custom' && !shareExpiryDate} onClick={() => handleShare()}>Condividi</button>
            </div>
          </div>
        </div>
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
            { icon: <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" /></svg>, label: 'Condividi', action: () => { setShareModal({ type: 'file', id: contextMenu.id, name: contextMenu.name }); setContextMenu(null) } },
            { icon: <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>, label: 'Copia collegamento', action: () => { setLinkModal({ id: contextMenu.id, name: contextMenu.name }); setContextMenu(null) } },
            { icon: <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>, label: 'Scarica', action: () => { const f = filteredFiles.find((ff) => ff.id === contextMenu.id); if (f) void handleDownloadFile(f); setContextMenu(null) } },
            { icon: <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>, label: 'Rinomina', action: () => { showToastMsg('Usa la dashboard per rinominare'); setContextMenu(null) } },
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
            onClick={() => { handleDelete(contextMenu.id); setContextMenu(null) }}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 8, fontSize: 13, fontWeight: 500, color: 'var(--ax-error)', cursor: 'pointer' }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLDivElement).style.background = 'rgba(239,68,68,0.06)')}
            onMouseLeave={(e) => ((e.currentTarget as HTMLDivElement).style.background = 'transparent')}
          >
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /></svg>
            Elimina
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
