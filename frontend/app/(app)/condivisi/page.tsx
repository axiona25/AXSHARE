'use client'

import { useState, useRef, useEffect, useMemo, useCallback, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import Image from 'next/image'
import useSWR from 'swr'
import { useAuthContext } from '@/context/AuthContext'
import { useFileMutations } from '@/hooks/useFiles'
import { useCrypto } from '@/hooks/useCrypto'
import { activityApi, filesApi, searchApi, shareLinksApi, permissionsApi, type ShareLinkData } from '@/lib/api'
import { getFileIcon, getFileLabel, getAxsFileIcon } from '@/lib/fileIcons'
import { AppHeader } from '@/components/AppHeader'
import { AppSidebar } from '@/components/AppSidebar'
import ConfirmModal from '@/components/ConfirmModal'
import { CreateLinkModal } from '@/components/CreateLinkModal'
import { ShareBadge, getShareBadgeType } from '@/components/ShareBadge'
import { isRunningInTauri } from '@/lib/tauri'
import type { ActivityLog, FileItem } from '@/types'

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

function getActivityLabel(log: ActivityLog): string {
  return ACTION_LABELS[log.action] ?? log.action
}

function getInitialsFromEmail(email: string): string {
  if (!email?.trim()) return '?'
  const part = email.split('@')[0]?.trim() || ''
  const segments = part.split(/[._-]/).filter(Boolean)
  if (segments.length >= 2) return (segments[0][0]! + segments[1][0]!).toUpperCase()
  return (part.slice(0, 2) || '?').toUpperCase()
}

function getInitialsFromDisplayName(name: string | null | undefined): string {
  const t = name?.trim()
  if (!t) return '?'
  const bySpace = t.split(/\s+/).filter(Boolean)
  if (bySpace.length >= 2) return (bySpace[0]![0]! + bySpace[1]![0]!).toUpperCase()
  if (t.includes('.')) {
    const byDot = t.split('.').filter(Boolean)
    if (byDot.length >= 2) return (byDot[0]![0]! + byDot[1]![0]!).toUpperCase()
  }
  const two = (t.slice(0, 2) || '?').replace(/[^A-Za-z]/g, '')
  return (two || t[0] || '?').toUpperCase()
}

type SharedFileItem = FileItem & { size?: number; shared_by?: string; access?: string }

export default function CondivisiPage() {
  const { data: sharedFilesRaw, isLoading: filesLoading, mutate: reloadShared } = useSWR(
    'search-shared',
    () => searchApi.searchFiles({ shared_with_me: true, page_size: 100 }).then((r) => r.data)
  )
  const sharedItems = (sharedFilesRaw?.items ?? []) as SharedFileItem[]
  const { deleteFile, moveFile } = useFileMutations()
  const { user, hasSessionKey } = useAuthContext()
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
        window.localStorage.setItem('axshare_favorites', JSON.stringify([...next]))
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
  const [linksByFileId, setLinksByFileId] = useState<Record<string, ShareLinkData[]>>({})
  const [teamShareByTargetId, setTeamShareByTargetId] = useState<Record<string, boolean>>({})
  const [sharedUsersByTargetId, setSharedUsersByTargetId] = useState<Record<string, { id: string; email: string; display_name?: string }[]>>({})
  const [linkDetailModal, setLinkDetailModal] = useState<{ fileId: string; fileName: string; link: ShareLinkData } | null>(null)
  const [linkModal, setLinkModal] = useState<{ id: string; name: string } | null>(null)

  const refetchActivityForFile = useCallback(async (fileId: string) => {
    try {
      const res = await activityApi.getFileActivity(fileId, { cacheBust: true })
      const list = res.data ?? []
      const first = list[0] ?? null
      setLastActivityByTargetId((prev) => ({ ...prev, [fileId]: first }))
    } catch {
      // ignore
    }
  }, [])

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
    if (!hasSessionKey || !sharedItems.length) return
    const toDecrypt = sharedItems.filter((f) => !decryptedNames[f.id])
    if (toDecrypt.length === 0) return
    decryptFileNames(toDecrypt).then((names) => {
      setDecryptedNames((prev) => ({ ...prev, ...names }))
    })
  }, [hasSessionKey, sharedItems, decryptedNames, decryptFileNames])

  useEffect(() => {
    if (!hasSessionKey || sharedItems.length === 0) return
    const fileIds = sharedItems.map((f) => f.id)
    let cancelled = false
    const load = async () => {
      const next: Record<string, ActivityLog | null> = {}
      await Promise.all(
        fileIds.map(async (id) => {
          if (cancelled) return
          try {
            const res = await activityApi.getFileActivity(id)
            const list = res.data ?? []
            if (!cancelled) next[id] = list[0] ?? null
          } catch {
            if (!cancelled) next[id] = null
          }
        })
      )
      if (!cancelled) setLastActivityByTargetId((prev) => ({ ...prev, ...next }))
    }
    load()
    return () => { cancelled = true }
  }, [hasSessionKey, sharedItems])

  const shareLinkFileIds = useMemo(() => sharedItems.map((f) => f.id), [sharedItems])
  useEffect(() => {
    if (shareLinkFileIds.length === 0) return
    let cancelled = false
    const load = async () => {
      const next: Record<string, ShareLinkData[]> = {}
      await Promise.all(
        shareLinkFileIds.map(async (id) => {
          if (cancelled) return
          try {
            const res = await shareLinksApi.list(id)
            const list = (res.data ?? []) as ShareLinkData[]
            if (!cancelled) next[id] = list
          } catch {
            if (!cancelled) next[id] = []
          }
        })
      )
      if (!cancelled) setLinksByFileId((prev) => ({ ...prev, ...next }))
    }
    load()
    return () => { cancelled = true }
  }, [shareLinkFileIds])

  useEffect(() => {
    if (shareLinkFileIds.length === 0) return
    let cancelled = false
    const load = async () => {
      const next: Record<string, boolean> = {}
      const usersNext: Record<string, { id: string; email: string; display_name?: string }[]> = {}
      await Promise.all(
        shareLinkFileIds.map(async (id) => {
          if (cancelled) return
          try {
            const res = await permissionsApi.listForFile(id)
            const list = res.data ?? []
            if (!cancelled) {
              next[id] = list.length > 0
              usersNext[id] = list.filter((p) => p.subject_user_id).map((p) => ({ id: String(p.subject_user_id), email: p.subject_user_email ?? '', display_name: p.subject_user_display_name ?? undefined }))
            }
          } catch {
            if (!cancelled) next[id] = false
          }
        })
      )
      if (!cancelled) {
        setTeamShareByTargetId((prev) => ({ ...prev, ...next }))
        setSharedUsersByTargetId((prev) => ({ ...prev, ...usersNext }))
      }
    }
    load()
    return () => { cancelled = true }
  }, [shareLinkFileIds])

  const fetchLinksForFile = useCallback(async (fileId: string) => {
    try {
      const res = await shareLinksApi.list(fileId)
      const list = (res.data ?? []) as ShareLinkData[]
      setLinksByFileId((prev) => ({ ...prev, [fileId]: list }))
    } catch {
      setLinksByFileId((prev) => ({ ...prev, [fileId]: [] }))
    }
  }, [])

  const q = searchQuery.trim().toLowerCase()
  const filteredFiles = useMemo(() => {
    const list = q
      ? sharedItems.filter((f) =>
          (decryptedNames[f.id] ?? f.name_encrypted ?? '').toLowerCase().includes(q)
        )
      : sharedItems
    return [...list].sort((a, b) => {
      const dateA = (a as SharedFileItem & { updated_at?: string }).updated_at ?? ''
      const dateB = (b as SharedFileItem & { updated_at?: string }).updated_at ?? ''
      return dateB.localeCompare(dateA)
    })
  }, [sharedItems, decryptedNames, q])

  const allItemIds = useMemo(() => filteredFiles.map((f) => f.id), [filteredFiles])
  const allSelected = allItemIds.length > 0 && allItemIds.every((id) => selected.has(id))

  async function handleDownloadFile(file: SharedFileItem) {
    if (!hasSessionKey) return
    try {
      if (isRunningInTauri()) {
        const blob = await downloadAndDecrypt(file.id)
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

  async function doDeleteFile(fileId: string) {
    await deleteFile(fileId, undefined)
    reloadShared()
  }

  function handleDelete(fileId: string) {
    setConfirmModal({
      title: 'Elimina file',
      message: "Eliminare il file? L'operazione è irreversibile.",
      confirmLabel: 'Elimina',
      variant: 'danger',
      onConfirm: () => {
        setConfirmModal(null)
        doDeleteFile(fileId)
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
      <AppHeader searchValue={searchQuery} onSearchChange={setSearchQuery} hasShareNotification={hasShareNotif} onClearShareNotification={() => setHasShareNotif(false)} />

      <div className="app-body">
        <AppSidebar />

        <main className="main" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          <div className="section-header">
            <div className="section-title">
              <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              Condivisi
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
                    Tutti i condivisi
                  </button>
                </>
              </div>
              {selected.size > 0 && (
                <div className="files-toolbar-actions" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    type="button"
                    className="ax-toolbar-btn ax-toolbar-btn-danger"
                    onClick={() => {
                      const first = filteredFiles.find((f) => selected.has(f.id))
                      if (first) handleDelete(first.id)
                      setSelected(new Set())
                    }}
                  >
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
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                </div>
                <p style={{ fontSize: 18, fontWeight: 600, color: 'var(--ax-text)', marginBottom: 8, letterSpacing: '-0.01em' }}>
                  Nessun file condiviso
                </p>
                <p style={{ fontSize: 14, color: 'var(--ax-muted)', maxWidth: 320, lineHeight: 1.5 }}>
                  I file che altri condividono con te appariranno qui.
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
                      <th style={{ width: '38%' }}>NOME</th>
                      <th style={{ width: '10%' }}>DIMENSIONE</th>
                      <th style={{ width: '12%' }}>CONDIVISO DA</th>
                      <th style={{ width: '10%' }}>ACCESSO</th>
                      <th style={{ width: '12%' }}>STATO</th>
                      <th style={{ width: '12%' }}>CONDIVISIONI</th>
                      <th style={{ width: '12%' }}>MODIFICATO</th>
                      <th style={{ width: '14%', textAlign: 'left' }}>ATTIVITÀ</th>
                    </tr>
                  </thead>
                  <tbody className="file-table-tbody-fixed">
                    {filteredFiles.map((file) => {
                      const displayName = decryptedNames[file.id] ?? file.name_encrypted
                      const fileWithDates = file as SharedFileItem & { updated_at?: string; created_at?: string }
                      const fileModifiedOrCreatedAt = fileWithDates.updated_at ?? fileWithDates.created_at
                      const fileChecked = selected.has(file.id)
                      const lastActivity = lastActivityByTargetId[file.id]
                      return (
                        <tr
                          key={file.id}
                          className="file-table-row-file"
                          style={{ background: fileChecked ? 'rgba(50,153,243,0.06)' : undefined }}
                          onClick={() => {
                            const ext = (displayName.split('.').pop() ?? '').toLowerCase()
                            const isPdf = ext === 'pdf'
                            const isOffice = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext)
                            if (isPdf || isOffice) {
                              downloadAndDecrypt(file.id).then((blob) => {
                                if (blob) {
                                  const url = URL.createObjectURL(blob)
                                  window.open(url, '_blank')
                                }
                              })
                            } else {
                              void handleDownloadFile(file)
                            }
                          }}
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
                            {formatFileSize((file as FileItem).size_bytes ?? file.size ?? 0)}
                          </td>
                          <td>{(file as SharedFileItem).shared_by ?? '—'}</td>
                          <td>{(file as SharedFileItem).access ?? 'Lettura'}</td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                              <ShareBadge
                                type={getShareBadgeType({
                                  hasLink: (linksByFileId[file.id] ?? []).filter((l) => l.is_active).length > 0,
                                  hasTeamShare: teamShareByTargetId[file.id] ?? false,
                                })}
                              />
                              {(linksByFileId[file.id] ?? []).filter((l) => l.is_active).length > 0 && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    const active = (linksByFileId[file.id] ?? []).filter((l) => l.is_active)
                                    if (active[0]) setLinkDetailModal({ fileId: file.id, fileName: displayName, link: active[0] })
                                  }}
                                  title="Collegamento attivo"
                                  style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, padding: 0, border: 'none', borderRadius: 8, background: 'var(--ax-surface-1)', color: 'var(--ax-muted)', cursor: 'pointer' }}
                                >
                                  <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
                                </button>
                              )}
                            </div>
                          </td>
                          <td className="ax-condivisioni-cell">
                            {(() => {
                              const users = sharedUsersByTargetId[file.id] ?? []
                              if (users.length === 0) return '—'
                              const show = users.slice(0, 3)
                              const hasMore = users.length > 3
                              return (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                                  {show.map((u) => (
                                    <span key={u.id} className="ax-shared-avatar" title={u.display_name?.trim() || u.email} style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--ax-blue)', color: 'white', fontSize: 10, fontWeight: 600, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{getInitialsFromDisplayName(u.display_name) !== '?' ? getInitialsFromDisplayName(u.display_name) : getInitialsFromEmail(u.email)}</span>
                                  ))}
                                  {hasMore && <span style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--ax-surface-2)', color: 'var(--ax-muted)', fontSize: 11, fontWeight: 600, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>+</span>}
                                </span>
                              )
                            })()}
                          </td>
                          <td className="modified-cell">
                            {fileModifiedOrCreatedAt ? formatRelativeModified(fileModifiedOrCreatedAt) + (formatDateTimeIt(fileModifiedOrCreatedAt) ? ` · ${formatDateTimeIt(fileModifiedOrCreatedAt)}` : '') : '—'}
                          </td>
                          <td style={{ textAlign: 'left' }} className="activity-cell">
                            {lastActivity ? (
                              <>
                                <span className="activity-label">{getActivityLabel(lastActivity)}</span>
                                {formatActivityDate(lastActivity.created_at) ? (
                                  <>
                                    <br />
                                    <span className="activity-date">{formatActivityDate(lastActivity.created_at)}</span>
                                  </>
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

      {linkModal && (
        <CreateLinkModal
          open
          type="file"
          id={linkModal.id}
          name={linkModal.name}
          onClose={() => setLinkModal(null)}
          onSuccess={(label) => {
            showShareToast('🔗 Collegamento creato', `"${label}" · Link copiato negli appunti`)
            fetchLinksForFile(linkModal.id)
            refetchActivityForFile(linkModal.id)
          }}
          getFileKeyForLink={() => getFileKeyBase64ForShare(linkModal.id)}
        />
      )}

      {linkDetailModal && (
        <div className="ax-create-folder-overlay" onClick={() => setLinkDetailModal(null)} role="dialog" aria-modal="true" aria-labelledby="ax-link-detail-title">
          <div className="ax-create-folder-modal" onClick={(e) => e.stopPropagation()} style={{ minWidth: 400, maxWidth: 480 }}>
            <div className="ax-create-folder-modal-header">
              <h2 id="ax-link-detail-title" className="ax-create-folder-modal-title">Collegamento</h2>
              <button type="button" className="ax-create-folder-modal-close" onClick={() => setLinkDetailModal(null)} aria-label="Chiudi">
                <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div className="ax-create-folder-modal-body">
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ax-muted)', marginBottom: 6 }}>Etichetta</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ax-text)', wordBreak: 'break-all' }}>{linkDetailModal.link.label ?? `axshare.${linkDetailModal.fileName}`}</div>
              </div>
              <p style={{ fontSize: 13, color: 'var(--ax-muted)', marginBottom: 16 }}>
                Rimuovendo il collegamento, il link non funzionerà più per nessuno, anche inserendo la password.
              </p>
            </div>
            <div className="ax-create-folder-modal-footer">
              <button type="button" className="ax-create-folder-btn ax-create-folder-btn-secondary" onClick={() => setLinkDetailModal(null)}>Chiudi</button>
              <button
                type="button"
                className="ax-create-folder-btn"
                style={{ background: 'var(--ax-error)', color: 'white' }}
                onClick={async () => {
                  try {
                    await shareLinksApi.revoke(linkDetailModal.link.id)
                    await fetchLinksForFile(linkDetailModal.fileId)
                    await refetchActivityForFile(linkDetailModal.fileId)
                    showToastMsg('Collegamento rimosso')
                    setLinkDetailModal(null)
                  } catch {
                    showToastMsg('Errore durante la rimozione')
                  }
                }}
              >
                Rimuovi collegamento
              </button>
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
            { icon: <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" /></svg>, label: 'Condividi', action: () => { showToastMsg('Usa la dashboard per condividere'); setContextMenu(null) } },
            { icon: <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>, label: 'Copia collegamento', action: () => { setLinkModal({ id: contextMenu.id, name: contextMenu.name }); setContextMenu(null) } },
            { icon: <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>, label: 'Scarica', action: () => { const f = filteredFiles.find((ff) => ff.id === contextMenu.id); if (f) void handleDownloadFile(f); setContextMenu(null) } },
            { icon: <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>, label: 'Rinomina', action: () => { showToastMsg('Usa la dashboard per rinominare'); setContextMenu(null) } },
            { icon: <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><polyline points="5 9 2 12 5 15" /><polyline points="9 5 12 2 15 5" /><polyline points="15 19 12 22 9 19" /><polyline points="19 9 22 12 19 15" /><line x1="2" y1="12" x2="22" y2="12" /><line x1="12" y1="2" x2="12" y2="22" /></svg>, label: 'Sposta', action: () => { showToastMsg('Usa la dashboard per spostare'); setContextMenu(null) } },
            { icon: <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>, label: 'Aggiungi a In Evidenza', action: () => { showToastMsg('Usa la dashboard per In Evidenza'); setContextMenu(null) } },
            { icon: <svg width="14" height="14" fill={favorites.has(contextMenu.id) ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg>, label: favorites.has(contextMenu.id) ? 'Rimuovi dai preferiti' : 'Aggiungi a preferiti', action: () => { toggleFavorite(contextMenu.id); setContextMenu(null) } },
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
