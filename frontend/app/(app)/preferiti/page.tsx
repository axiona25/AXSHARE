'use client'

import { useState, useRef, useEffect, useMemo, useCallback, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useAuthContext } from '@/context/AuthContext'
import { useFiles, useFolders, useFileMutations } from '@/hooks/useFiles'
import { useCrypto } from '@/hooks/useCrypto'
import { usePinVerification } from '@/hooks/usePinVerification'
import { activityApi, foldersApi, filesApi, trashApi, shareLinksApi, permissionsApi, type ShareLinkData } from '@/lib/api'
import { getFileIcon, getFileLabel, getAxsFileIcon, getFolderColorIcon, FOLDER_ICON_OPTIONS } from '@/lib/fileIcons'
import { getSafeDisplayName } from '@/lib/displayName'
import { AppHeader } from '@/components/AppHeader'
import { AppSidebar } from '@/components/AppSidebar'
import ConfirmModal from '@/components/ConfirmModal'
import { CreateLinkModal } from '@/components/CreateLinkModal'
import { ManageAccessModal } from '@/components/ManageAccessModal'
import { ShareBadge, getShareBadgeType } from '@/components/ShareBadge'
import { isRunningInTauri } from '@/lib/tauri'
import type { ActivityLog, FileItem, Folder, RootFileItem } from '@/types'

const FAVORITES_KEY = 'axshare_favorites'

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

/** Azioni da mostrare in ATTIVITÀ: upload web, modifica, eliminazione, condivisione, collegamento, spostamento. Esclude download/sync virtual disk. */
const ACTIVITY_ACTIONS_TO_SHOW = new Set([
  'upload', 'rename', 'move', 'delete', 'share', 'share_link', 'share_revoke', 'trash', 'destroy', 'create_folder', 'update',
])

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

const MEDIA_IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico'])
const MEDIA_AUDIO_EXT = new Set(['mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac', 'wma'])
const MEDIA_VIDEO_EXT = new Set(['mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v'])

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

/** Per i file con collegamenti: preferisce mostrare l’ultima attività di creazione/rimozione link. */
function pickDisplayActivity(list: ActivityLog[]): ActivityLog | null {
  if (!list?.length) return null
  const allowed = list.filter((a) => ACTIVITY_ACTIONS_TO_SHOW.has(a.action))
  if (!allowed.length) return null
  const shareRelated = allowed.find((a) => a.action === 'share_link' || a.action === 'share_revoke')
  return shareRelated ?? allowed[0] ?? null
}

function getFavoritesSet(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = localStorage.getItem(FAVORITES_KEY) ?? '[]'
    const arr = JSON.parse(raw) as string[]
    return new Set(Array.isArray(arr) ? arr : [])
  } catch {
    return new Set()
  }
}

export default function PreferitiPage() {
  const router = useRouter()
  const [favorites, setFavorites] = useState<Set<string>>(
    () => {
      if (typeof window === 'undefined') return new Set()
      return new Set(JSON.parse(localStorage.getItem('axshare_favorites') ?? '[]'))
    }
  )

  const { files, isLoading: filesLoading, revalidate: reloadFiles } = useFiles(undefined)
  const { folders, revalidate: reloadFolders } = useFolders(undefined)
  const { deleteFile, deleteFolder, moveFile, moveFolder } = useFileMutations()
  const { user, hasSessionKey } = useAuthContext()
  const { downloadAndDecrypt, decryptFileNames, decryptFolderNames, getFileKeyBase64ForShare } = useCrypto()
  const { requestPin, PinModal } = usePinVerification()

  const [decryptedNames, setDecryptedNames] = useState<Record<string, string>>({})
  const [decryptedFolderNames, setDecryptedFolderNames] = useState<Record<string, string>>({})
  const [searchQuery, setSearchQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    type: 'file' | 'folder'
    id: string
    name: string
  } | null>(null)
  const [manageAccessModal, setManageAccessModal] = useState<{ type: 'file' | 'folder'; id: string; name: string } | null>(null)
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
  const [shareModal, setShareModal] = useState<{ type: 'file' | 'folder'; id: string; name: string } | null>(null)
  const [moveModal, setMoveModal] = useState<{ items: { type: 'file' | 'folder'; id: string; name: string }[] } | null>(null)
  const [moveModalMoving, setMoveModalMoving] = useState(false)
  const [linkModal, setLinkModal] = useState<{ type: 'file' | 'folder'; id: string; name: string } | null>(null)
  const [linksByFileId, setLinksByFileId] = useState<Record<string, ShareLinkData[]>>({})
  const [linkDetailModal, setLinkDetailModal] = useState<{ fileId: string; fileName: string; link: ShareLinkData } | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const [previewUrl, setPreviewUrl] = useState('')
  const [previewType, setPreviewType] = useState<'image' | 'video' | 'audio'>('image')
  const [previewName, setPreviewName] = useState('')
  const [previewFileId, setPreviewFileId] = useState<string | null>(null)
  const [lastActivityByTargetId, setLastActivityByTargetId] = useState<Record<string, ActivityLog | null>>({})
  const [teamShareByTargetId, setTeamShareByTargetId] = useState<Record<string, boolean>>({})
  const [sharedUsersByTargetId, setSharedUsersByTargetId] = useState<Record<string, { id: string; email: string; display_name?: string }[]>>({})

  const refetchActivityForFile = useCallback(async (fileId: string) => {
    try {
      const res = await activityApi.getFileActivity(fileId, { cacheBust: true })
      const list = res.data ?? []
      const toShow = pickDisplayActivity(list)
      setLastActivityByTargetId((prev) => ({ ...prev, [fileId]: toShow }))
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

  useEffect(() => {
    return () => {
      if (shareToastTimerRef.current) clearTimeout(shareToastTimerRef.current)
    }
  }, [])

  useEffect(() => {
    const onFocus = () => setFavorites(getFavoritesSet())
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
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

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  useEffect(() => {
    if (!hasSessionKey || !files?.length) return
    const filesToDecrypt = files.filter((f) => !decryptedNames[f.id])
    if (filesToDecrypt.length === 0) return
    decryptFileNames(filesToDecrypt).then((names) => {
      setDecryptedNames((prev) => ({ ...prev, ...names }))
    })
  }, [hasSessionKey, files, decryptedNames, decryptFileNames])

  useEffect(() => {
    if (!hasSessionKey || !folders?.length) return
    const foldersToDecrypt = folders.filter((f) => !decryptedFolderNames[f.id])
    if (foldersToDecrypt.length === 0) return
    decryptFolderNames(foldersToDecrypt).then((names) => {
      setDecryptedFolderNames((prev) => ({ ...prev, ...names }))
    })
  }, [hasSessionKey, folders, decryptedFolderNames, decryptFolderNames])

  useEffect(() => {
    if (!hasSessionKey || files === undefined || folders === undefined) return
    const fileIds = (files ?? []).map((f) => f.id)
    const folderIds = (folders ?? []).map((f) => f.id)
    if (fileIds.length === 0 && folderIds.length === 0) return
    let cancelled = false
    const load = async () => {
      const next: Record<string, ActivityLog | null> = {}
      await Promise.all([
        ...fileIds.map(async (id) => {
          if (cancelled) return
          try {
            const res = await activityApi.getFileActivity(id)
            const list = res.data ?? []
            if (!cancelled) next[id] = pickDisplayActivity(list)
          } catch {
            if (!cancelled) next[id] = null
          }
        }),
        ...folderIds.map(async (id) => {
          if (cancelled) return
          try {
            const res = await activityApi.getFolderActivity(id)
            const list = res.data ?? []
            const first = (list as ActivityLog[]).find((log) => ACTIVITY_ACTIONS_TO_SHOW.has(log.action)) ?? null
            if (!cancelled) next[id] = first
          } catch {
            if (!cancelled) next[id] = null
          }
        }),
      ])
      if (!cancelled) setLastActivityByTargetId((prev) => ({ ...prev, ...next }))
    }
    load()
    return () => { cancelled = true }
  }, [hasSessionKey, files, folders])

  const toggleFavorite = useCallback((id: string) => {
    setFavorites((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      if (typeof window !== 'undefined')
        localStorage.setItem('axshare_favorites', JSON.stringify(Array.from(next)))
      return next
    })
  }, [])

  function isValidFile(filename: string): boolean {
    if (!filename) return false
    if (filename.startsWith('~$') || filename.startsWith('~WRL') || filename.startsWith('._')) return false
    if (filename === '.DS_Store' || filename.endsWith('.tmp') || filename.endsWith('.TMP')) return false
    if (filename.startsWith('file_') && filename.length === 13) return false
    return true
  }

  const visibleFiles = useMemo(() => {
    return (files ?? []).filter((f) => {
      const name = decryptedNames[f.id]
      return !!name && isValidFile(name) && favorites.has(f.id)
    })
  }, [files, decryptedNames, favorites])

  const q = searchQuery.trim().toLowerCase()
  const filteredFolders = useMemo(() => {
    const list = (folders ?? []).filter((folder) => favorites.has(folder.id))
    const filtered = q
      ? list.filter((folder) =>
          (decryptedFolderNames[folder.id] ?? '').toLowerCase().includes(q)
        )
      : list
    const withDates = filtered as Array<Folder & { created_at?: string; updated_at?: string }>
    return [...withDates].sort((a, b) => {
      const dateA = a.updated_at ?? a.created_at ?? ''
      const dateB = b.updated_at ?? b.created_at ?? ''
      return dateB.localeCompare(dateA)
    })
  }, [folders, favorites, q, decryptedFolderNames])

  const filteredFiles = useMemo(() => {
    const list = q
      ? visibleFiles.filter(
          (f) => (decryptedNames[f.id] ?? '').toLowerCase().includes(q)
        )
      : visibleFiles
    const withDates = list as Array<FileItem & { created_at?: string; updated_at?: string }>
    return [...withDates].sort((a, b) => {
      const dateA = a.updated_at ?? a.created_at ?? ''
      const dateB = b.updated_at ?? b.created_at ?? ''
      return dateB.localeCompare(dateA)
    })
  }, [visibleFiles, decryptedNames, q])

  const allTableItems = useMemo(
    () => [
      ...filteredFolders.map((f) => ({ type: 'folder' as const, data: f })),
      ...filteredFiles.map((f) => ({ type: 'file' as const, data: f })),
    ],
    [filteredFolders, filteredFiles]
  )

  const shareLinkFileIds = useMemo(() => filteredFiles.map((f) => f.id), [filteredFiles])

  const fetchLinksForFile = useCallback(async (fileId: string) => {
    try {
      const res = await shareLinksApi.list(fileId)
      const list = (res.data ?? []) as ShareLinkData[]
      setLinksByFileId((prev) => ({ ...prev, [fileId]: list }))
    } catch {
      setLinksByFileId((prev) => ({ ...prev, [fileId]: [] }))
    }
  }, [])

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

  const folderIdsForPermissions = useMemo(() => filteredFolders.map((f) => f.id), [filteredFolders])
  useEffect(() => {
    const fileIds = shareLinkFileIds
    const fldIds = folderIdsForPermissions
    if (fileIds.length === 0 && fldIds.length === 0) return
    let cancelled = false
    const load = async () => {
      const next: Record<string, boolean> = {}
      const usersNext: Record<string, { id: string; email: string; display_name?: string }[]> = {}
      await Promise.all([
        ...fileIds.map(async (id) => {
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
        }),
        ...fldIds.map(async (id) => {
          if (cancelled) return
          try {
            const res = await permissionsApi.listForFolder(id)
            const list = res.data ?? []
            if (!cancelled) {
              next[id] = list.length > 0
              usersNext[id] = list.filter((p) => p.subject_user_id).map((p) => ({ id: String(p.subject_user_id), email: p.subject_user_email ?? '', display_name: p.subject_user_display_name ?? undefined }))
            }
          } catch {
            if (!cancelled) next[id] = false
          }
        }),
      ])
      if (!cancelled) {
        setTeamShareByTargetId((prev) => ({ ...prev, ...next }))
        setSharedUsersByTargetId((prev) => ({ ...prev, ...usersNext }))
      }
    }
    load()
    return () => { cancelled = true }
  }, [shareLinkFileIds, folderIdsForPermissions])

  const folderIdsSet = useMemo(() => new Set(filteredFolders.map((f) => f.id)), [filteredFolders])
  const allItemIds = useMemo(() => allTableItems.map((i) => i.data.id), [allTableItems])
  const allSelected = allItemIds.length > 0 && allItemIds.every((id) => selected.has(id))

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
      const displayName = decryptedNames[file.id] ?? ''
      const mime = (blob.type || '').toLowerCase()
      const ext = (displayName.split('.').pop() ?? '').toLowerCase()
      const isImage = mime.startsWith('image/') || MEDIA_IMAGE_EXT.has(ext)
      const isVideo = mime.startsWith('video/') || MEDIA_VIDEO_EXT.has(ext)
      const isAudio = mime.startsWith('audio/') || MEDIA_AUDIO_EXT.has(ext)
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
        const isPdf = ext === 'pdf'
        const isOffice = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext)
        if (isPdf || isOffice) {
          const url = URL.createObjectURL(blob)
          window.open(url, '_blank')
        } else {
          void handleDownloadFile(file)
        }
      }
    } catch {
      showToast('Errore durante l\'apertura')
    }
  }

  async function handleDownloadFile(file: FileItem | RootFileItem) {
    if (!hasSessionKey) return
    try {
      if (isRunningInTauri()) {
        const blob = await downloadAndDecrypt(file.id, decryptedNames[file.id], { onRequiresPin: requestPin })
        if (!blob) return
        const { invoke } = await import('@tauri-apps/api/core')
        const fileName = decryptedNames[file.id] ?? 'file'
        const safeName = fileName.replace(/[/\\:*?"<>|]/g, '_')
        const arrayBuffer = await blob.arrayBuffer()
        const bytes = Array.from(new Uint8Array(arrayBuffer))
        const filePath = await invoke<string>('write_temp_file', { name: safeName, contents: bytes })
        await invoke('open_file_native', { path: filePath })
        showToast('Apertura con app predefinita')
      } else {
        const { data } = await filesApi.download(file.id)
        const encryptedBlob = new Blob([data as ArrayBuffer], { type: 'application/octet-stream' })
        const url = URL.createObjectURL(encryptedBlob)
        const a = document.createElement('a')
        a.href = url
        a.download = (decryptedNames[file.id] ?? 'file') + '.axs'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        setTimeout(() => URL.revokeObjectURL(url), 1000)
        showToast('File cifrato scaricato')
      }
    } catch {
      showToast('Errore durante il download')
    }
  }

  async function handleDownloadFolder(folder: Folder) {
    if (!hasSessionKey) return
    try {
      const JSZip = (await import('jszip')).default
      const zip = new JSZip()
      const manifest: { folders: { id: string; path: string; name_encrypted: string }[]; files: { id: string; path: string; name_encrypted: string }[] } = { folders: [], files: [] }
      const addFolderToZip = async (folderId: string, pathPrefix: string, folderNameEncrypted: string) => {
        const [filesResp, childrenResp] = await Promise.all([foldersApi.listFiles(folderId), foldersApi.listChildren(folderId)])
        const files = filesResp.data ?? []
        const children = childrenResp.data ?? []
        manifest.folders.push({ id: folderId, path: pathPrefix.replace(/\/$/, ''), name_encrypted: folderNameEncrypted })
        for (const f of files) {
          const downloadResp = await filesApi.download(f.id)
          const encryptedData = downloadResp.data as ArrayBuffer
          if (encryptedData?.byteLength) {
            zip.file(pathPrefix + f.id, encryptedData)
            manifest.files.push({ id: f.id, path: pathPrefix + f.id, name_encrypted: f.name_encrypted })
          }
        }
        for (const sub of children) {
          await addFolderToZip(sub.id, pathPrefix + sub.id + '/', sub.name_encrypted)
        }
      }
      await addFolderToZip(folder.id, folder.id + '/', folder.name_encrypted)
      zip.file('axshare_manifest.json', JSON.stringify(manifest))
      const zipBlob = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(zipBlob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${folder.id}.zip`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
      showToast('Download cartella avviato')
    } catch {
      showToast('Errore download cartella')
    }
  }

  const doTrashFile = async (fileId: string) => {
    try {
      await trashApi.trashFile(fileId)
      refetchActivityForFile(fileId)
      reloadFiles()
      showToast('File spostato nel cestino')
    } catch {
      showToast('Errore durante lo spostamento nel cestino')
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

  const doTrashFolder = async (folderId: string) => {
    try {
      await trashApi.trashFolder(folderId)
      setDecryptedFolderNames((prev) => {
        const n = { ...prev }
        delete n[folderId]
        return n
      })
      reloadFolders()
      showToast('Cartella spostata nel cestino')
    } catch {
      showToast('Errore durante lo spostamento nel cestino')
    }
  }

  function handleDeleteFolder(folderId: string) {
    setConfirmModal({
      title: 'Sposta nel cestino',
      message: 'La cartella verrà spostata nel cestino. Potrai recuperarla in seguito.',
      confirmLabel: 'Sposta nel cestino',
      variant: 'danger',
      onConfirm: () => {
        setConfirmModal(null)
        doTrashFolder(folderId)
      },
    })
  }

  function handleDeleteSelected() {
    if (selected.size === 0) return
    setConfirmModal({
      title: 'Sposta nel cestino',
      message: `Gli ${selected.size} elementi selezionati verranno spostati nel cestino. Potrai recuperarli in seguito.`,
      confirmLabel: 'Sposta nel cestino',
      variant: 'danger',
      onConfirm: () => {
        setConfirmModal(null)
        doDeleteSelected()
      },
    })
  }

  async function doDeleteSelected() {
    let ok = 0
    for (const id of Array.from(selected)) {
      try {
        if (folderIdsSet.has(id)) {
          await trashApi.trashFolder(id)
          setDecryptedFolderNames((prev) => {
            const n = { ...prev }
            delete n[id]
            return n
          })
          reloadFolders()
        } else {
          await trashApi.trashFile(id)
          refetchActivityForFile(id)
          reloadFiles()
        }
        ok++
      } catch {
        // skip
      }
    }
    setSelected(new Set())
    showToast(ok === 1 ? 'Elemento spostato nel cestino' : `${ok} elementi spostati nel cestino`)
  }

  const handleMoveToDestination = useCallback(
    async (targetFolderId: string | null) => {
      if (!moveModal || moveModal.items.length === 0 || moveModalMoving) return
      setMoveModalMoving(true)
      try {
        for (const item of moveModal.items) {
          if (item.type === 'file') {
            await moveFile(item.id, targetFolderId, null)
          } else {
            await moveFolder(item.id, targetFolderId, null)
          }
        }
        setSelected((prev) => {
          const next = new Set(prev)
          moveModal.items.forEach((i) => next.delete(i.id))
          return next
        })
        setMoveModal(null)
        showToast(moveModal.items.length === 1 ? 'Elemento spostato' : `${moveModal.items.length} elementi spostati`)
      } catch {
        showToast('Errore durante lo spostamento')
      } finally {
        setMoveModalMoving(false)
      }
    },
    [moveModal, moveModalMoving, moveFile, moveFolder]
  )

  const showListLoading = filesLoading

  const hasNoFavorites = allTableItems.length === 0 && !showListLoading

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
  const totalRealRows = filteredFolders.length + filteredFiles.length
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
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
              Preferiti
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
                    Tutti i preferiti
                  </button>
                </>
              </div>
              {selected.size > 0 && (
                <div className="files-toolbar-actions" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    type="button"
                    className="ax-toolbar-btn ax-toolbar-btn-secondary"
                    onClick={() => {
                      const items = allTableItems.filter((i) => selected.has(i.data.id)).map((i) => ({ type: i.type, id: i.data.id, name: i.type === 'folder' ? getSafeDisplayName(decryptedFolderNames[i.data.id]) : getSafeDisplayName(decryptedNames[i.data.id]) }))
                      if (items.length) setMoveModal({ items })
                    }}
                  >
                    <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3" /></svg>
                    Sposta selezionati ({selected.size})
                  </button>
                  <button
                    type="button"
                    className="ax-toolbar-btn ax-toolbar-btn-secondary"
                    onClick={() => {
                      const items = allTableItems.filter((i) => selected.has(i.data.id)).map((i) => ({ type: i.type as 'file' | 'folder', id: i.data.id, name: i.type === 'folder' ? getSafeDisplayName(decryptedFolderNames[i.data.id]) : getSafeDisplayName(decryptedNames[i.data.id]) }))
                      items.filter((x) => x.type === 'file').forEach((x) => { const f = filteredFiles.find((ff) => ff.id === x.id); if (f) void handleDownloadFile(f) })
                      items.filter((x) => x.type === 'folder').forEach((x) => { const folder = filteredFolders.find((ff) => ff.id === x.id); if (folder) void handleDownloadFolder(folder) })
                    }}
                  >
                    Scarica
                  </button>
                  <button
                    type="button"
                    className="ax-toolbar-btn ax-toolbar-btn-secondary"
                    onClick={() => {
                      const first = allTableItems.find((i) => selected.has(i.data.id))
                      if (first) setShareModal({ type: first.type, id: first.data.id, name: first.type === 'folder' ? getSafeDisplayName(decryptedFolderNames[first.data.id]) : getSafeDisplayName(decryptedNames[first.data.id]) })
                    }}
                  >
                    Condividi
                  </button>
                  <button type="button" className="ax-toolbar-btn ax-toolbar-btn-danger" onClick={handleDeleteSelected}>
                    <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /></svg>
                    Elimina selezionati ({selected.size})
                  </button>
                  <button type="button" className="ax-toolbar-btn ax-toolbar-btn-secondary" onClick={() => setSelected(new Set())} aria-label="Deseleziona tutto">
                    <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </button>
                </div>
              )}
            </div>

            {hasNoFavorites ? (
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
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                  </svg>
                </div>
                <p style={{ fontSize: 18, fontWeight: 600, color: 'var(--ax-text)', marginBottom: 8, letterSpacing: '-0.01em' }}>
                  Nessun preferito ancora
                </p>
                <p style={{ fontSize: 14, color: 'var(--ax-muted)', maxWidth: 320, lineHeight: 1.5 }}>
                  Clicca col tasto destro su un file o cartella per aggiungerlo ai preferiti
                </p>
              </div>
            ) : (
              <>
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
                              if (allSelected) setSelected((prev) => { const s = new Set(prev); allItemIds.forEach((id) => s.delete(id)); return s })
                              else setSelected((prev) => { const s = new Set(prev); allItemIds.forEach((id) => s.add(id)); return s })
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
                  {allTableItems.map((item) => {
                          if (item.type === 'folder') {
                            const folder = item.data
                            const folderName = getSafeDisplayName(decryptedFolderNames[folder.id])
                            const folderAny = folder as unknown as Record<string, unknown>
                            const created = folderAny.created_at ?? folder.created_at
                            const updated = folderAny.updated_at ?? folder.updated_at
                            const hasModifications = updated && created && String(updated) !== String(created)
                            const modifiedOrCreatedAt = (hasModifications ? updated : created ?? updated) as string | undefined
                            const folderChecked = selected.has(folder.id)
                            const lastActivity = lastActivityByTargetId[folder.id]
                            return (
                              <tr
                                key={`folder-${folder.id}`}
                                className="file-table-row-folder"
                                style={{ cursor: 'default', background: folderChecked ? 'rgba(50,153,243,0.06)' : undefined }}
                                onContextMenu={(e) => {
                                  e.preventDefault()
                                  setContextMenu({ x: e.clientX, y: e.clientY, type: 'folder', id: folder.id, name: folderName })
                                }}
                              >
                                <td style={{ width: 44, paddingLeft: 20, paddingRight: 0, verticalAlign: 'middle' }} onClick={(e) => e.stopPropagation()}>
                                  <div
                                    role="checkbox"
                                    aria-checked={folderChecked}
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setSelected((prev) => { const s = new Set(prev); if (s.has(folder.id)) s.delete(folder.id); else s.add(folder.id); return s })
                                    }}
                                    style={{
                                      width: 20, height: 20, borderRadius: '50%',
                                      border: `2px solid ${folderChecked ? 'var(--ax-blue)' : 'var(--ax-border)'}`,
                                      background: folderChecked ? 'var(--ax-blue)' : 'white',
                                      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                                    }}
                                  >
                                    {folderChecked && (
                                      <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                                        <path d="M1 4l3 3 5-6" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                                      </svg>
                                    )}
                                  </div>
                                </td>
                                <td>
                                  <div className="file-name-cell">
                                    <div className="file-type-icon-wrap">
                                      <Image src={getFolderColorIcon((folder as Folder).color ?? 'yellow', isRunningInTauri())} alt={folderName} width={44} height={44} className="file-type-icon" style={{ objectFit: 'contain', flexShrink: 0 }} />
                                    </div>
                                    <span className="file-name">{folderName}</span>
                                  </div>
                                </td>
                                <td className="file-size-cell">{formatFileSize(folder.total_size_bytes ?? 0)}</td>
                                <td>
                                  <div className="owner-cell">
                                    <div className="owner-avatar">{user?.display_name?.trim() ? getInitialsFromDisplayName(user.display_name) : (user?.email ? user.email.split('@')[0].slice(0, 2) : 'U').toUpperCase()}</div>
                                    {user?.display_name?.trim() || 'Tu'}
                                  </div>
                                </td>
                                <td>
                                  <ShareBadge type={getShareBadgeType({ hasLink: false, hasTeamShare: teamShareByTargetId[folder.id] ?? false, isFolder: true })} />
                                </td>
                                <td className="ax-condivisioni-cell">
                                  {(() => {
                                    const users = sharedUsersByTargetId[folder.id] ?? []
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
                                <td className="modified-cell" title={created && (typeof created === 'string' || created instanceof Date) ? formatDateTimeIt(created) : undefined}>
                                  {created && (typeof created === 'string' || created instanceof Date) ? formatDateTimeIt(created) : '—'}
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
                          }
                          const file = item.data as FileItem & { size?: number }
                          const displayName = decryptedNames[file.id] ?? ''
                          const fileWithDates = file as FileItem & { created_at?: string; updated_at?: string }
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
                                setContextMenu({ x: e.clientX, y: e.clientY, type: 'file', id: file.id, name: getSafeDisplayName(displayName) })
                              }}
                            >
                              <td style={{ width: 44, paddingLeft: 20, paddingRight: 0, verticalAlign: 'middle' }} onClick={(e) => e.stopPropagation()}>
                                <div
                                  role="checkbox"
                                  aria-checked={fileChecked}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setSelected((prev) => { const s = new Set(prev); if (s.has(file.id)) s.delete(file.id); else s.add(file.id); return s })
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
                                  <span className="file-name">{getSafeDisplayName(displayName)}</span>
                                </div>
                              </td>
                              <td className="file-size-cell">
                                {formatFileSize((file as FileItem).size_bytes ?? file.size ?? 0)}
                              </td>
                              <td>
                                <div className="owner-cell">
                                  <div className="owner-avatar">{user?.display_name?.trim() ? getInitialsFromDisplayName(user.display_name) : (user?.email ? user.email.split('@')[0].slice(0, 2) : 'U').toUpperCase()}</div>
                                  {user?.display_name?.trim() || 'Tu'}
                                </div>
                              </td>
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
                                  const show = users.slice(0, 4)
                                  const extra = users.length - 4
                                  return (
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                                      {show.map((u) => (
                                        <span key={u.id} className="ax-shared-avatar" title={u.display_name?.trim() || u.email} style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--ax-blue)', color: 'white', fontSize: 10, fontWeight: 600, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginLeft: extra > 0 || show.indexOf(u) > 0 ? -4 : 0, border: '2px solid var(--ax-bg, #fff)' }}>{getInitialsFromDisplayName(u.display_name) !== '?' ? getInitialsFromDisplayName(u.display_name) : getInitialsFromEmail(u.email)}</span>
                                      ))}
                                      {extra > 0 && (
                                        <span className="ax-shared-avatar-more" title={`Altri ${extra} utenti`} style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--ax-surface-2)', color: 'var(--ax-muted)', fontSize: 10, fontWeight: 600, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginLeft: -4, border: '2px solid var(--ax-bg, #fff)' }}>+{extra}</span>
                                      )}
                                    </span>
                                  )
                                })()}
                              </td>
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
                                ) : (linksByFileId[file.id] ?? []).filter((l) => l.is_active).length > 0
                                  ? 'Collegamento creato'
                                  : ''}
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

                <div className="table-footer">
                  <div className="table-info">
                    {allTableItems.length === 0 ? '0 elementi' : `${allTableItems.length} elementi`}
                  </div>
                </div>
              </>
            )}
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
          type={linkModal.type}
          id={linkModal.id}
          name={linkModal.name}
          onClose={() => setLinkModal(null)}
          onSuccess={(label) => {
            showShareToast('🔗 Collegamento creato', `"${label}" · Link copiato negli appunti`)
            if (linkModal.type === 'file') {
              fetchLinksForFile(linkModal.id)
              refetchActivityForFile(linkModal.id)
            }
          }}
          getFileKeyForLink={linkModal.type === 'file' ? () => getFileKeyBase64ForShare(linkModal.id) : undefined}
        />
      )}

      {linkDetailModal && (
        <div className="ax-create-folder-overlay" onClick={() => setLinkDetailModal(null)} role="dialog" aria-modal="true" aria-labelledby="ax-link-detail-title-pref">
          <div className="ax-create-folder-modal" onClick={(e) => e.stopPropagation()} style={{ minWidth: 400, maxWidth: 480 }}>
            <div className="ax-create-folder-modal-header">
              <h2 id="ax-link-detail-title-pref" className="ax-create-folder-modal-title">Collegamento</h2>
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
                    showToast('Collegamento rimosso')
                    setLinkDetailModal(null)
                  } catch {
                    showToast('Errore durante la rimozione')
                  }
                }}
              >
                Rimuovi collegamento
              </button>
            </div>
          </div>
        </div>
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

      {shareModal && (
        <div className="ax-create-folder-overlay" onClick={() => setShareModal(null)} role="dialog" aria-modal="true">
          <div className="ax-create-folder-modal" onClick={(e) => e.stopPropagation()} style={{ minWidth: 360 }}>
            <div className="ax-create-folder-modal-header">
              <h2 className="ax-create-folder-modal-title">Condividi</h2>
              <button type="button" className="ax-create-folder-modal-close" onClick={() => setShareModal(null)} aria-label="Chiudi">
                <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div className="ax-create-folder-modal-body">
              <p style={{ fontSize: 13, color: 'var(--ax-muted)' }}>{shareModal.name}</p>
              <p style={{ fontSize: 12, color: 'var(--ax-muted)', marginTop: 8 }}>Condivisione disponibile dalla dashboard.</p>
            </div>
          </div>
        </div>
      )}

      {moveModal && (
        <div className="ax-create-folder-overlay" onClick={() => !moveModalMoving && setMoveModal(null)} role="dialog" aria-modal="true">
          <div className="ax-create-folder-modal" onClick={(e) => e.stopPropagation()} style={{ minWidth: 360, maxWidth: 420 }}>
            <div className="ax-create-folder-modal-header">
              <h2 className="ax-create-folder-modal-title">Sposta</h2>
              <button type="button" className="ax-create-folder-modal-close" onClick={() => !moveModalMoving && setMoveModal(null)} aria-label="Chiudi" disabled={moveModalMoving}>
                <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div className="ax-create-folder-modal-body">
              <p style={{ fontSize: 13, color: 'var(--ax-muted)', marginBottom: 12 }}>
                {moveModal.items.length === 1 ? `Destinazione per "${moveModal.items[0].name}"` : `Destinazione per ${moveModal.items.length} elementi`}
              </p>
              <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid var(--ax-border)', borderRadius: 12, padding: 8 }}>
                <button
                  type="button"
                  disabled={moveModalMoving}
                  onClick={() => handleMoveToDestination(null)}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 12px', border: 'none', borderRadius: 8, background: 'transparent', cursor: moveModalMoving ? 'not-allowed' : 'pointer', fontFamily: 'inherit', fontSize: 13, color: 'var(--ax-text)', textAlign: 'left' }}
                >
                  <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
                  Home
                </button>
                {folders
                  ?.filter((f) => !moveModal.items.some((i) => i.type === 'folder' && i.id === f.id))
                  .map((folder) => {
                    const folderName = getSafeDisplayName(decryptedFolderNames[folder.id])
                    return (
                      <button
                        key={folder.id}
                        type="button"
                        disabled={moveModalMoving}
                        onClick={() => handleMoveToDestination(folder.id)}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 12px', border: 'none', borderRadius: 8, background: 'transparent', cursor: moveModalMoving ? 'not-allowed' : 'pointer', fontFamily: 'inherit', fontSize: 13, color: 'var(--ax-text)', textAlign: 'left' }}
                      >
                        <Image src={getFolderColorIcon(folder.color ?? 'yellow', isRunningInTauri())} alt="" width={20} height={18} style={{ objectFit: 'contain' }} />
                        {folderName}
                      </button>
                    )
                  })}
              </div>
              {moveModalMoving && <p style={{ fontSize: 12, color: 'var(--ax-blue)', marginTop: 8 }}>Spostamento in corso...</p>}
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
          {contextMenu.type === 'folder' && (
            <div style={{ padding: '4px 0 6px', borderBottom: '1px solid var(--ax-surface-2)', marginBottom: 4 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ax-muted)', padding: '4px 12px 6px' }}>Icona cartella</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '0 12px' }}>
                {FOLDER_ICON_OPTIONS.map((opt) => (
                  <button
                    key={opt.index}
                    type="button"
                    onClick={async () => {
                      await foldersApi.patch(contextMenu.id, { color: opt.colorKey })
                      await reloadFolders()
                      showToast(`Colore ${opt.label}`)
                      setContextMenu(null)
                    }}
                    className="context-menu-icon-btn"
                    style={{ width: 36, height: 36, borderRadius: 8, border: `2px solid ${opt.color}`, background: 'var(--ax-surface-1)', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    title={opt.label}
                  >
                    <Image src={getFolderColorIcon(opt.colorKey, isRunningInTauri())} alt={opt.label} width={28} height={24} style={{ objectFit: 'contain', pointerEvents: 'none' }} unoptimized />
                  </button>
                ))}
              </div>
            </div>
          )}
          {[
            { icon: <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" /></svg>, label: 'Condividi', action: () => { setShareModal({ type: contextMenu.type, id: contextMenu.id, name: contextMenu.name }); setContextMenu(null) } },
            { icon: <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>, label: 'Gestisci accessi', action: () => { setManageAccessModal({ type: contextMenu.type, id: contextMenu.id, name: contextMenu.name }); setContextMenu(null) } },
            { icon: <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>, label: 'Copia collegamento', action: () => { setLinkModal({ type: contextMenu.type, id: contextMenu.id, name: contextMenu.name }); setContextMenu(null) } },
            { icon: <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>, label: 'Scarica', action: () => { if (contextMenu.type === 'file') { const f = filteredFiles.find((f) => f.id === contextMenu.id); if (f) void handleDownloadFile(f) } else { const folder = filteredFolders.find((f) => f.id === contextMenu.id); if (folder) void handleDownloadFolder(folder) }; setContextMenu(null) } },
            { icon: <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>, label: 'Rinomina', action: () => { showToast('Usa la dashboard per rinominare'); setContextMenu(null) } },
            { icon: <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><polyline points="5 9 2 12 5 15" /><polyline points="9 5 12 2 15 5" /><polyline points="15 19 12 22 9 19" /><polyline points="19 9 22 12 19 15" /><line x1="2" y1="12" x2="22" y2="12" /><line x1="12" y1="2" x2="12" y2="22" /></svg>, label: 'Sposta', action: () => { setMoveModal({ items: [{ type: contextMenu.type, id: contextMenu.id, name: contextMenu.name }] }); setContextMenu(null) } },
            { icon: <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>, label: 'Aggiungi a In Evidenza', action: () => { showToast('Usa la dashboard per In Evidenza'); setContextMenu(null) } },
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
            onClick={() => { if (contextMenu.type === 'file') handleDelete(contextMenu.id); else handleDeleteFolder(contextMenu.id); setContextMenu(null) }}
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

      {manageAccessModal && (
        <ManageAccessModal
          resourceType={manageAccessModal.type}
          resourceId={manageAccessModal.id}
          resourceName={manageAccessModal.name}
          onClose={() => setManageAccessModal(null)}
          showToast={showToast}
        />
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
