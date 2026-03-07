'use client'

import { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import useSWR, { mutate } from 'swr'
import { useAuthContext } from '@/context/AuthContext'
import { useFiles, useFolders, useFileMutations } from '@/hooks/useFiles'
import { useCrypto } from '@/hooks/useCrypto'
import { useFileEvents } from '@/hooks/useFileEvents'
import { useSubmitLock, useUploadQueue } from '@/hooks/useRateLimit'
import { useMyDashboard } from '@/hooks/useReports'
import { useThumbnail } from '@/hooks/useThumbnail'
import { searchApi, foldersApi, filesApi } from '@/lib/api'
import { getFileIcon, getFileLabel, getAxsFileIcon, getFolderIcon, getFolderIconByIndex, FOLDER_ICON_OPTIONS } from '@/lib/fileIcons'
import { OnboardingBanner } from '@/components/OnboardingBanner'
import ConfirmModal from '@/components/ConfirmModal'
import { VersionHistory } from '@/components/VersionHistory'
import { isRunningInTauri } from '@/lib/tauri'
import { getAccessTokenSecure } from '@/lib/auth'
import { generateKey, encryptFileChunked, bytesToBase64, encryptFileKeyWithRSA, hexToBytes } from '@/lib/crypto'
import { keyManager } from '@/lib/keyManager'
import { thumbnailApi } from '@/lib/api'
import { generateThumbnail } from '@/lib/thumbnail'
import type { FileItem, Folder, RootFileItem } from '@/types'

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

/** Formatta una data in etichetta relativa (Ieri, 3 giorni fa, 7 giorni fa, 2 settimane fa, …). */
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
  if (diffWeeks <= 3) return `${diffWeeks} settimane fa`
  if (diffWeeks <= 11) return `${diffWeeks} settimane fa`
  if (diffWeeks <= 13) return '12 settimane fa'
  return `${diffWeeks} settimane fa`
}

/** Formatta data e ora in italiano (gg/mm/aaaa, hh:mm:ss) — ora esatta di caricamento/modifica. */
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

/** Preview prima pagina per le card file "In Evidenza": thumbnail salvata oppure anteprima generata al volo. Se non disponibile mostra icona tipo file. */
function InEvidenzaFilePreview({
  fileId,
  fileName,
  sessionPrivateKey,
  onLoadPreviewUrl,
  fallbackIconSrc,
}: {
  fileId: string
  fileName: string
  sessionPrivateKey: CryptoKey | null
  onLoadPreviewUrl?: (fileId: string, fileName: string) => Promise<string | null>
  /** Icona da mostrare quando l’anteprima non è disponibile (es. DOCX). */
  fallbackIconSrc?: string
}) {
  const { objectUrl, hasThumb } = useThumbnail(fileId, { sessionPrivateKey: sessionPrivateKey ?? undefined })
  const [livePreviewUrl, setLivePreviewUrl] = useState<string | null>(null)
  const [previewUnavailable, setPreviewUnavailable] = useState(false)
  const requestedRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    setLivePreviewUrl(null)
    setPreviewUnavailable(false)
  }, [fileId, fileName])

  useEffect(() => {
    if (objectUrl || hasThumb) return
    if (!onLoadPreviewUrl || !sessionPrivateKey) return
    if (requestedRef.current.has(fileId)) return
    requestedRef.current.add(fileId)
    let cancelled = false
    onLoadPreviewUrl(fileId, fileName).then((url) => {
      if (cancelled) return
      if (url) setLivePreviewUrl(url)
      else setPreviewUnavailable(true)
    })
    return () => {
      cancelled = true
    }
  }, [fileId, fileName, objectUrl, hasThumb, sessionPrivateKey, onLoadPreviewUrl])

  useEffect(() => {
    const url = livePreviewUrl ?? objectUrl
    if (!url || !url.startsWith('blob:')) return
    return () => URL.revokeObjectURL(url)
  }, [livePreviewUrl, objectUrl])

  const displayUrl = objectUrl ?? livePreviewUrl

  return (
    <div
      className="ax-file-card-preview"
      style={{
        width: 76,
        minHeight: 72,
        borderRadius: 8,
        background: 'var(--ax-surface-1)',
        border: '1px solid var(--ax-border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        overflow: 'hidden',
      }}
    >
      {displayUrl ? (
        <img src={displayUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : hasThumb ? (
        <span style={{ fontSize: 10, color: 'var(--ax-text-muted)', padding: 4 }}>Caricamento…</span>
      ) : previewUnavailable && fallbackIconSrc ? (
        <Image src={fallbackIconSrc} alt="" width={40} height={40} style={{ objectFit: 'contain' }} unoptimized />
      ) : previewUnavailable ? (
        <span style={{ fontSize: 9, color: 'var(--ax-text-muted)', padding: 4, textAlign: 'center' }}>Anteprima non disp.</span>
      ) : (
        <span style={{ fontSize: 9, color: 'var(--ax-text-muted)', padding: 4, textAlign: 'center' }}>Generazione anteprima…</span>
      )}
    </div>
  )
}

export default function DashboardPage() {
  const router = useRouter()
  const t = useTranslations('dashboard')
  const [currentFolderId, setCurrentFolderId] = useState<string | undefined>()
  const [breadcrumb, setBreadcrumb] = useState<{ id: string; name: string }[]>([])

  const { files, isLoading: filesLoading, error: filesError, revalidate: reloadFiles } = useFiles(currentFolderId)
  const { folders, isLoading: foldersLoading, error: foldersError, revalidate: reloadFolders } = useFolders(currentFolderId)
  const { deleteFile, deleteFolder, createFolder, renameFolder, moveFile, moveFolder } = useFileMutations()
  const { user, hasSessionKey, sessionPrivateKey, logout } = useAuthContext()
  const { uploadFile, uploadNewVersion, downloadAndDecrypt, decryptFileNames, decryptFolderNames, decryptFileNamesAndKeys, isLoading: cryptoLoading, error: cryptoError, clearError: clearCryptoError } = useCrypto()
  const { lock: lockUpload, isLocked: uploadLocked } = useSubmitLock(1500)
  const { startUpload, activeUploads, canUpload } = useUploadQueue()
  const { dashboard: storageDashboard, refresh: refreshStorageDashboard } = useMyDashboard()

  const fileInputRef = useRef<HTMLInputElement>(null)
  const multiFileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const [creaCaricaDropdownOpen, setCreaCaricaDropdownOpen] = useState(false)
  const currentFolderIdRef = useRef(currentFolderId)
  currentFolderIdRef.current = currentFolderId
  const tempFileTimeoutsRef = useRef<Map<string, { timeout: ReturnType<typeof setTimeout>; filePath: string }>>(new Map())
  const prevDiskFileIdsRef = useRef<string>('')
  const [uploadStatus, setUploadStatus] = useState('')
  const [showCreateFolderModal, setShowCreateFolderModal] = useState(false)
  const [createFolderModalName, setCreateFolderModalName] = useState('')
  const [createFolderModalColor, setCreateFolderModalColor] = useState<1 | 2 | 3 | 4 | 5 | 6>(1)

  const [decryptedNames, setDecryptedNames] = useState<Record<string, string>>({})
  const [decryptedFolderNames, setDecryptedFolderNames] = useState<Record<string, string>>({})
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null)
  const [renamingFolderValue, setRenamingFolderValue] = useState('')

  const [openingFileId, setOpeningFileId] = useState<string | null>(null)
  /** 'open' = apertura file, 'download' = scarica da menu contestuale; usato per il testo di loading in tabella */
  const [openingMode, setOpeningMode] = useState<'open' | 'download' | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const [previewFileId, setPreviewFileId] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string>('')
  const [previewType, setPreviewType] = useState<string>('')
  const [previewName, setPreviewName] = useState<string>('')
  const [previewText, setPreviewText] = useState<string>('')

  const [versionModalFile, setVersionModalFile] = useState<{ fileId: string; fileName: string } | null>(null)
  const [uploadVersionFile, setUploadVersionFile] = useState<{ fileId: string; fileName: string } | null>(null)
  const [versionComment, setVersionComment] = useState('')
  const versionFileInputRef = useRef<HTMLInputElement>(null)
  const [autoSaving, setAutoSaving] = useState<Record<string, boolean>>({})
  const [autoSaveMessage, setAutoSaveMessage] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    type: 'file' | 'folder'
    id: string
    name: string
  } | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
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
  const [toast, setToast] = useState<string | null>(null)
  const [headerAvatarOpen, setHeaderAvatarOpen] = useState(false)
  const headerAvatarRef = useRef<HTMLDivElement>(null)
  const [confirmModal, setConfirmModal] = useState<{
    title: string
    message: string
    confirmLabel?: string
    variant?: 'danger' | 'default'
    onConfirm: () => void
  } | null>(null)
  const [shareModal, setShareModal] = useState<{ type: 'file' | 'folder'; id: string; name: string } | null>(null)
  const [shareModalEmail, setShareModalEmail] = useState('')
  const [shareModalLevel, setShareModalLevel] = useState<'read' | 'write' | 'read_no_download'>('read')
  const [shareModalPermissionOpen, setShareModalPermissionOpen] = useState(false)
  const shareModalPermissionRef = useRef<HTMLDivElement>(null)
  const [renameModal, setRenameModal] = useState<{ type: 'file' | 'folder'; id: string; name: string } | null>(null)
  const [renameModalValue, setRenameModalValue] = useState('')
  const [moveModal, setMoveModal] = useState<{ items: { type: 'file' | 'folder'; id: string; name: string }[] } | null>(null)
  const [moveModalMoving, setMoveModalMoving] = useState(false)
  const [uploadConfirmPending, setUploadConfirmPending] = useState<{ files: File[]; folderName?: string } | null>(null)
  const IN_EVIDENZA_KEY = 'ax-in-evidenza'
  const IN_EVIDENZA_MAX = 5
  type InEvidenzaItem = { type: 'folder' | 'file'; id: string; name: string; folderIconIndex?: number; size_bytes?: number; created_at?: string }
  const [inEvidenza, setInEvidenza] = useState<InEvidenzaItem[]>(() => {
    if (typeof window === 'undefined') return []
    try {
      const raw = window.localStorage.getItem(IN_EVIDENZA_KEY)
      if (!raw) return []
      const parsed = JSON.parse(raw) as InEvidenzaItem[]
      return Array.isArray(parsed) ? parsed.slice(0, IN_EVIDENZA_MAX) : []
    } catch { return [] }
  })
  const addToInEvidenza = useCallback((item: InEvidenzaItem) => {
    setInEvidenza((prev) => {
      if (prev.some((x) => x.id === item.id && x.type === item.type)) return prev
      if (prev.length >= IN_EVIDENZA_MAX) return prev
      const next = [...prev, item]
      try { window.localStorage.setItem(IN_EVIDENZA_KEY, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }, [])
  const removeFromInEvidenza = useCallback((id: string, type: 'folder' | 'file') => {
    setInEvidenza((prev) => {
      const next = prev.filter((x) => !(x.id === id && x.type === type))
      try { window.localStorage.setItem(IN_EVIDENZA_KEY, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }, [])
  const FOLDER_ICON_PREF_KEY = 'ax-folder-icon-pref'
  const [folderIconPref, setFolderIconPref] = useState<Record<string, 1 | 2 | 3 | 4 | 5 | 6>>(() => {
    if (typeof window === 'undefined') return {}
    try {
      const raw = window.localStorage.getItem(FOLDER_ICON_PREF_KEY)
      if (!raw) return {}
      const parsed = JSON.parse(raw) as Record<string, number>
      const out: Record<string, 1 | 2 | 3 | 4 | 5 | 6> = {}
      for (const [id, v] of Object.entries(parsed)) {
        if (v >= 1 && v <= 6) out[id] = v as 1 | 2 | 3 | 4 | 5 | 6
      }
      return out
    } catch { return {} }
  })
  const setFolderIcon = (folderId: string, index: 1 | 2 | 3 | 4 | 5 | 6) => {
    setFolderIconPref((prev) => {
      const next = { ...prev, [folderId]: index }
      try { window.localStorage.setItem(FOLDER_ICON_PREF_KEY, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }
  const { data: searchData, error: searchError, isLoading: searchLoading } = useSWR(
    searchQuery.trim() ? ['/search/files', searchQuery] : null,
    () => searchApi.searchFiles({ page: 1, page_size: 100 }).then((r) => r.data)
  )

  /** Metadati (size, created_at) per file "In Evidenza" che non li hanno salvati in item — fetch da API. */
  const inEvidenzaFileIdsToFetch = useMemo(
    () => inEvidenza.filter((i) => i.type === 'file' && i.size_bytes == null).map((i) => i.id),
    [inEvidenza]
  )
  const { data: inEvidenzaFileMetaMap } = useSWR(
    inEvidenzaFileIdsToFetch.length > 0 ? ['in-evidenza-file-meta', inEvidenzaFileIdsToFetch.join(',')] : null,
    async () => {
      const map: Record<string, { size_bytes: number; created_at: string }> = {}
      for (const id of inEvidenzaFileIdsToFetch) {
        try {
          const r = await filesApi.get(id)
          const d = r.data as { size_encrypted?: number; size_bytes?: number; created_at?: string }
          const size = d.size_encrypted ?? d.size_bytes
          if (size != null) map[id] = { size_bytes: size, created_at: d.created_at ?? '' }
        } catch {
          /* ignore */
        }
      }
      return map
    }
  )

  useEffect(() => {
    if (filesError) console.error('[DASHBOARD] useFiles SWR error:', filesError)
  }, [filesError])
  useEffect(() => {
    if (foldersError) console.error('[DASHBOARD] useFolders SWR error:', foldersError)
  }, [foldersError])
  useEffect(() => {
    if (searchError) console.error('[DASHBOARD] search SWR error:', searchError)
  }, [searchError])
  useEffect(() => {
    function handleClick() {
      setContextMenu(null)
    }
    if (contextMenu) {
      document.addEventListener('click', handleClick)
      return () => document.removeEventListener('click', handleClick)
    }
  }, [contextMenu])
  const creaCaricaDropdownRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!creaCaricaDropdownOpen) return
    function handleClickOutside(event: MouseEvent) {
      if (creaCaricaDropdownRef.current && !creaCaricaDropdownRef.current.contains(event.target as Node)) {
        setCreaCaricaDropdownOpen(false)
      }
    }
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [creaCaricaDropdownOpen])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2800)
  }

  const searchResultsRaw = (searchData?.items ?? []) as FileItem[]
  const searchResults = searchQuery.trim()
    ? searchResultsRaw.filter((f) =>
        f.name_encrypted?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : searchResultsRaw

  function openFolder(folder: Folder) {
    setBreadcrumb((prev) => [...prev, { id: folder.id, name: decryptedFolderNames[folder.id] ?? folder.name_encrypted }])
    setCurrentFolderId(folder.id)
  }

  /** Apre una cartella per id/nome (es. da In Evidenza quando non è nella lista corrente). */
  function openFolderById(id: string, name: string) {
    setBreadcrumb((prev) => [...prev, { id, name }])
    setCurrentFolderId(id)
  }

  function navigateBreadcrumb(index: number) {
    if (index < 0) {
      setBreadcrumb([])
      setCurrentFolderId(undefined)
    } else {
      const crumb = breadcrumb[index]
      setBreadcrumb((prev) => prev.slice(0, index + 1))
      setCurrentFolderId(crumb.id)
    }
  }

  /** Genera e carica thumbnail (prima pagina) per PDF e immagini, così le card "In Evidenza" mostrano l'anteprima. */
  async function uploadThumbnailIfSupported(fileId: string, file: File): Promise<void> {
    const type = file.type?.toLowerCase() ?? ''
    if (!type.startsWith('image/') && type !== 'application/pdf') return
    if (!user?.id) return
    try {
      const result = await generateThumbnail(file)
      if (!result) return
      const publicKeyPem = await keyManager.getPublicKeyPem(user.id)
      if (!publicKeyPem) return
      const thumbKeyEncrypted = await encryptFileKeyWithRSA(hexToBytes(result.keyHex), publicKeyPem)
      await thumbnailApi.upload(fileId, result.encryptedBase64, thumbKeyEncrypted)
      mutate(`/files/${fileId}/thumbnail`)
    } catch (e) {
      console.error('[Dashboard] Thumbnail upload failed:', e)
    }
  }

  /** Carica anteprima prima pagina per la card: scarica, decifra, genera data URL (PDF/immagini). Per immagini, se la thumbnail fallisce usa il blob come preview. */
  const loadPreviewUrlForFile = useCallback(
    async (fileId: string, fileName: string): Promise<string | null> => {
      const ext = (fileName.split('.').pop() ?? '').toLowerCase().replace(/\s/g, '')
      const noPreview = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'zip', 'rar'].includes(ext)
      if (noPreview) return null
      try {
        const blob = await downloadAndDecrypt(fileId)
        if (!blob) return null
        const mime = blob.type || getMimeFromPath(fileName) || (ext === 'pdf' ? 'application/pdf' : 'application/octet-stream')
        const file = new File([blob], fileName, { type: mime })
        let url = await generateThumbnailPreviewUrl(file)
        if (!url && blob.type.startsWith('image/')) url = URL.createObjectURL(blob)
        if (!url && (ext === 'pdf' || !ext) && blob.type === 'application/octet-stream') {
          const pdfFile = new File([blob], fileName, { type: 'application/pdf' })
          url = await generateThumbnailPreviewUrl(pdfFile)
        }
        return url
      } catch (e) {
        console.error('[Dashboard] Preview load failed:', e)
        return null
      }
    },
    [downloadAndDecrypt]
  )

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    await lockUpload(async () =>
      startUpload(async () => {
        setUploadStatus('Upload in corso...')
        try {
          const result = await uploadFile({ file, folderId: currentFolderId })
          if (result?.fileId) await uploadThumbnailIfSupported(result.fileId, file)
          setUploadStatus('Upload completato.')
          reloadFiles()
          reloadFolders()
          refreshStorageDashboard()
        } catch {
          setUploadStatus('Errore durante upload.')
        }
      }),
    )
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  /** Raccoglie ricorsivamente tutti i File da una directory (File System Access API). */
  async function getFilesFromDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<{ files: File[]; folderName: string }> {
    const folderName = handle.name
    const files: File[] = []
    async function walk(dir: FileSystemDirectoryHandle): Promise<void> {
      for await (const [, entry] of dir.entries()) {
        if (entry.kind === 'file') {
          files.push(await (entry as FileSystemFileHandle).getFile())
        } else {
          await walk(entry as FileSystemDirectoryHandle)
        }
      }
    }
    await walk(handle)
    return { files, folderName }
  }

  /** Apre il picker cartella: se disponibile usa File System Access API (solo la nostra modale), altrimenti input (dialog browser + nostra modale). */
  async function handlePickFolderClick() {
    if (typeof window !== 'undefined' && 'showDirectoryPicker' in window && window.isSecureContext) {
      try {
        const handle = await (window as Window & { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker()
        const { files, folderName } = await getFilesFromDirectoryHandle(handle)
        if (files.length) setUploadConfirmPending({ files, folderName })
      } catch (err) {
        if ((err as Error)?.name !== 'AbortError') showToast('Impossibile aprire la cartella')
      }
      return
    }
    folderInputRef.current?.click()
  }

  /** Apre il picker file multipli: se disponibile usa File System Access API (solo la nostra modale), altrimenti input. */
  async function handlePickMultipleFilesClick() {
    if (typeof window !== 'undefined' && 'showOpenFilePicker' in window && window.isSecureContext) {
      try {
        const handles = await (window as Window & { showOpenFilePicker: (o: { multiple: boolean }) => Promise<FileSystemFileHandle[]> }).showOpenFilePicker({ multiple: true })
        const files = await Promise.all(handles.map((h) => h.getFile()))
        if (files.length) setUploadConfirmPending({ files })
      } catch (err) {
        if ((err as Error)?.name !== 'AbortError') showToast('Impossibile aprire i file')
      }
      return
    }
    multiFileInputRef.current?.click()
  }

  function handleMultiFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const fileList = e.target.files
    if (!fileList?.length) return
    const files = Array.from(fileList)
    setUploadConfirmPending({ files })
    e.target.value = ''
  }

  function handleFolderSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const fileList = e.target.files
    if (!fileList?.length) return
    const files = Array.from(fileList)
    const folderName = files[0]?.webkitRelativePath?.split('/')[0] ?? undefined
    setUploadConfirmPending({ files, folderName })
    e.target.value = ''
  }

  async function doPendingUpload() {
    if (!uploadConfirmPending?.files.length) return
    const { files, folderName } = uploadConfirmPending
    setUploadConfirmPending(null)
    await lockUpload(async () =>
      startUpload(async () => {
        setUploadStatus(folderName ? `Caricamento cartella (${files.length} file)...` : `Upload in corso (${files.length} file)...`)
        try {
          let targetFolderId: string | undefined = currentFolderId
          if (folderName && user?.id) {
            const folderKey = await generateKey()
            const nameBytes = new TextEncoder().encode(folderName)
            const nameEncryptedBytes = await encryptFileChunked(nameBytes, folderKey, user.id)
            const nameEncrypted = bytesToBase64(new Uint8Array(nameEncryptedBytes))
            const publicKeyPem = await keyManager.getPublicKeyPem(user.id)
            if (!publicKeyPem) throw new Error('Chiave pubblica non trovata')
            const folderKeyEncrypted = await encryptFileKeyWithRSA(folderKey, publicKeyPem)
            const newFolderId = await createFolder(nameEncrypted, currentFolderId, folderKeyEncrypted)
            if (newFolderId) {
              setFolderIcon(newFolderId, 1)
              targetFolderId = newFolderId
            }
          }
          for (const file of files) {
            const result = await uploadFile({ file, folderId: targetFolderId })
            if (result?.fileId) await uploadThumbnailIfSupported(result.fileId, file)
          }
          setUploadStatus(folderName ? 'Cartella caricata.' : 'Caricamento completato.')
          reloadFiles()
          reloadFolders()
          refreshStorageDashboard()
        } catch {
          setUploadStatus(folderName ? 'Errore durante upload cartella.' : 'Errore durante upload.')
        }
      }),
    )
  }

  useFileEvents((event) => {
    if (
      event.type === 'file_created' ||
      event.type === 'file_deleted' ||
      event.type === 'file_updated'
    ) {
      reloadFiles()
      reloadFolders()
      refreshStorageDashboard()
    }
  })

  useEffect(() => {
    if (!isRunningInTauri()) return
    let unlisten: (() => void) | null = null
    const setup = async () => {
      const { listen } = await import('@tauri-apps/api/event')
      const { invoke } = await import('@tauri-apps/api/core')
      unlisten = await listen<{ file_id: string; temp_path: string }>(
        'file-modified',
        async (event) => {
          const { file_id, temp_path } = event.payload
          console.log('[AUTO-VERSION] File modificato:', file_id)
          setAutoSaving((prev) => ({ ...prev, [file_id]: true }))
          try {
            const bytes = await invoke<number[]>('read_temp_file', { path: temp_path })
            const mimeType = getMimeFromPath(temp_path)
            const fileName = temp_path.split(/[/\\]/).pop() ?? 'modified'
            const file = new File([new Uint8Array(bytes)], fileName, { type: mimeType })
            await uploadNewVersion(file_id, file)
            console.log('[AUTO-VERSION] Upload completato per:', file_id)
            console.log('[AUTO-VERSION] Ricarico lista file...')
            clearCryptoError()
            await mutate('/folders/root/files')
            const folderId = currentFolderIdRef.current
            if (folderId) {
              await mutate(`/folders/${folderId}/files`)
            }
            setAutoSaveMessage('Nuova versione salvata automaticamente')
            setTimeout(() => setAutoSaveMessage(null), 3000)
          } catch (err) {
            console.error('[AUTO-VERSION] Errore:', err)
            setAutoSaveMessage(`Errore salvataggio versione: ${err instanceof Error ? err.message : String(err)}`)
            setTimeout(() => setAutoSaveMessage(null), 5000)
          } finally {
            setAutoSaving((prev) => ({ ...prev, [file_id]: false }))
          }
        }
      )
    }
    setup()
    return () => { unlisten?.() }
  }, [uploadNewVersion, clearCryptoError])

  // Decifratura incrementale: decifra solo i file non ancora in decryptedNames,
  // così quando la lista si aggiorna (es. SSE) i nomi già decifrati non spariscono.
  useEffect(() => {
    if (!hasSessionKey) return
    if (!files?.length) return
    const filesToDecrypt = files.filter((f) => !decryptedNames[f.id])
    if (filesToDecrypt.length === 0) return
    console.log('[DECRYPT NAMES] Decifro solo file nuovi:', filesToDecrypt.length, 'di', files.length)
    decryptFileNames(filesToDecrypt).then((names) => {
      setDecryptedNames((prev) => ({ ...prev, ...names }))
    })
  }, [hasSessionKey, files, decryptedNames, decryptFileNames])

  useEffect(() => {
    if (!hasSessionKey) return
    if (!folders?.length) return
    const foldersToDecrypt = folders.filter((f) => !decryptedFolderNames[f.id])
    if (foldersToDecrypt.length === 0) return
    decryptFolderNames(foldersToDecrypt).then((names) => {
      setDecryptedFolderNames((prev) => ({ ...prev, ...names }))
    })
  }, [hasSessionKey, folders, decryptedFolderNames, decryptFolderNames])

  // Pre-popola il disco e monta solo quando la lista file cambia (aggiunta/eliminazione), non ad ogni re-render/SSE
  useEffect(() => {
    if (!isRunningInTauri() || !hasSessionKey || !files?.length || currentFolderId !== undefined) return
    if (Object.keys(decryptedNames).length === 0) return

    const currentIds = files
      .map((f) => f.id)
      .sort()
      .join(',')
    if (currentIds === prevDiskFileIdsRef.current) return
    prevDiskFileIdsRef.current = currentIds

    const updateAndMount = async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core')
        const token = await getAccessTokenSecure()
        const { keysBase64 } = await decryptFileNamesAndKeys(files)
        const fileEntries = files
          .filter((f: FileItem) => {
            const hasKey = !!keysBase64[f.id]
            if (!hasKey) {
              console.warn('[DISK] Skip file (no key):', f.id, decryptedNames[f.id])
              return false
            }
            const name = decryptedNames[f.id] ?? `file_${f.id.substring(0, 8)}`
            if (name.startsWith('file_')) return false
            if (name.startsWith('~$')) return false
            if (name.startsWith('~WRL')) return false
            if (name.endsWith('.tmp') || name.endsWith('.TMP')) return false
            return true
          })
          .map((f: FileItem) => ({
            file_id: f.id,
            name: decryptedNames[f.id] ?? `file_${f.id.substring(0, 8)}`,
            size: f.size_bytes ?? 0,
            is_folder: false,
            folder_path: '/',
            file_key_base64: keysBase64[f.id] as string,
          }))

        console.log('[DISK] update_disk_file_list:', fileEntries.length, 'file con chiave')
        await invoke('update_disk_file_list', { files: fileEntries, jwtToken: token ?? null })
        console.log('[DISK] Lista aggiornata, ora monto disco...')

        const isMounted = await invoke<boolean>('is_disk_mounted')
        if (!isMounted && token) {
          await invoke('mount_virtual_disk', {
            mountPoint: '/Volumes/AXSHARE',
            jwtToken: token,
          })
          console.log('[DISK] Disco montato con file già presenti')
          try {
            await invoke('cleanup_disk_files')
          } catch {
            // ignora
          }
          try {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'
            await fetch(`${apiUrl}/files/cleanup-system-files`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${token}` },
            })
          } catch {
            // ignora
          }
        } else if (isMounted) {
          console.log('[DISK] Disco già montato, solo aggiornato')
        }
      } catch (e) {
        console.error('[DISK] Errore:', e)
      }
    }

    updateAndMount()
  }, [decryptedNames, hasSessionKey, files, currentFolderId, decryptFileNamesAndKeys])

  /** Esclude dalla lista file di sistema e temporanei (Office, Apple, nomi non decifrati). */
  function isValidFile(filename: string): boolean {
    if (!filename) return false
    if (filename.startsWith('~$')) return false
    if (filename.startsWith('~WRL')) return false
    if (filename.startsWith('._')) return false
    if (filename.startsWith('.')) return false
    if (filename === '.DS_Store') return false
    if (filename.endsWith('.tmp') || filename.endsWith('.TMP')) return false
    if (filename.startsWith('file_') && filename.length === 13) return false
    return true
  }

  const visibleFiles = useMemo(() => {
    return files.filter((f) => {
      const name = decryptedNames[f.id]
      return !!name && isValidFile(name)
    })
  }, [files, decryptedNames])

  const q = searchQuery.trim().toLowerCase()
  const filteredFiles = useMemo(() => {
    const list = q
      ? visibleFiles.filter(
          (f) => (decryptedNames[f.id] ?? f.name_encrypted ?? '').toLowerCase().includes(q)
        )
      : visibleFiles
    const withDates = list as Array<FileItem & { created_at?: string; updated_at?: string }>
    return [...withDates].sort((a, b) => {
      const dateA = a.updated_at ?? a.created_at ?? ''
      const dateB = b.updated_at ?? b.created_at ?? ''
      return dateB.localeCompare(dateA)
    })
  }, [visibleFiles, decryptedNames, q])
  const filteredFolders = useMemo(() => {
    const list = q
      ? folders.filter((folder) =>
          (decryptedFolderNames[folder.id] ?? folder.name_encrypted ?? '').toLowerCase().includes(q)
        )
      : folders
    const withDates = list as Array<Folder & { created_at?: string; updated_at?: string }>
    return [...withDates].sort((a, b) => {
      const dateA = a.updated_at ?? a.created_at ?? ''
      const dateB = b.updated_at ?? b.created_at ?? ''
      return dateB.localeCompare(dateA)
    })
  }, [folders, q, decryptedFolderNames])

  const ROWS_PER_PAGE = 8
  const [fileTablePage, setFileTablePage] = useState(1)
  /** Lista unificata cartelle + file per tabella con paginazione fissa (stessa altezza a ogni livello). */
  const allTableItems = useMemo(
    () => [
      ...filteredFolders.map((f) => ({ type: 'folder' as const, data: f })),
      ...filteredFiles.map((f) => ({ type: 'file' as const, data: f })),
    ],
    [filteredFolders, filteredFiles]
  )
  const totalTablePages = Math.max(1, Math.ceil(allTableItems.length / ROWS_PER_PAGE))
  const paginatedTableItems = useMemo(
    () =>
      allTableItems.slice(
        (fileTablePage - 1) * ROWS_PER_PAGE,
        fileTablePage * ROWS_PER_PAGE
      ),
    [allTableItems, fileTablePage]
  )
  const folderIdsSet = useMemo(() => new Set(filteredFolders.map((f) => f.id)), [filteredFolders])
  const allItemIds = useMemo(
    () => paginatedTableItems.map((i) => i.data.id),
    [paginatedTableItems]
  )
  const allSelected = allItemIds.length > 0 && allItemIds.every((id) => selected.has(id))

  useEffect(() => {
    if (fileTablePage > totalTablePages) setFileTablePage(1)
  }, [fileTablePage, totalTablePages])
  useEffect(() => {
    setFileTablePage(1)
  }, [currentFolderId])

  useEffect(() => {
    if (!headerAvatarOpen) return
    const onOutside = (e: MouseEvent) => {
      if (headerAvatarRef.current && !headerAvatarRef.current.contains(e.target as Node)) setHeaderAvatarOpen(false)
    }
    document.addEventListener('click', onOutside)
    return () => document.removeEventListener('click', onOutside)
  }, [headerAvatarOpen])

  useEffect(() => {
    if (!shareModalPermissionOpen) return
    const onOutside = (e: MouseEvent) => {
      if (shareModalPermissionRef.current && !shareModalPermissionRef.current.contains(e.target as Node)) setShareModalPermissionOpen(false)
    }
    document.addEventListener('click', onOutside)
    return () => document.removeEventListener('click', onOutside)
  }, [shareModalPermissionOpen])

  const isLoading = filesLoading || foldersLoading
  const isListReady =
    files.length === 0 ||
    files.some((f) => decryptedNames[f.id] && isValidFile(decryptedNames[f.id]))
  const showListLoading = isLoading || (files.length > 0 && !isListReady)

  const visibleSearchResults = useMemo(
    () =>
      searchResults.filter((file) =>
        isValidFile(
          decryptedNames[file.id] ?? file.name_encrypted ?? file.id
        )
      ),
    [searchResults, decryptedNames]
  )

  function getMimeFromPath(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase() ?? ''
    const mimes: Record<string, string> = {
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      pdf: 'application/pdf',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      txt: 'text/plain',
      md: 'text/markdown',
      zip: 'application/zip',
    }
    return mimes[ext] ?? 'application/octet-stream'
  }

  function extensionToMime(ext: string): string {
    const map: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      svg: 'image/svg+xml',
      bmp: 'image/bmp',
      pdf: 'application/pdf',
      txt: 'text/plain',
      md: 'text/markdown',
      json: 'application/json',
      js: 'application/javascript',
      ts: 'text/plain',
      html: 'text/html',
      css: 'text/css',
      csv: 'text/csv',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls: 'application/vnd.ms-excel',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ppt: 'application/vnd.ms-powerpoint',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      zip: 'application/zip',
      mp4: 'video/mp4',
      webm: 'video/webm',
      mov: 'video/quicktime',
      avi: 'video/x-msvideo',
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      ogg: 'audio/ogg',
    }
    return map[ext] ?? 'application/octet-stream'
  }

  const OFFICE_EXTENSIONS = new Set(['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'])

  function closePreview() {
    setShowPreview(false)
    setPreviewFileId(null)
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl('')
    setPreviewText('')
  }

  async function openWithNativeApp(
    blob: Blob,
    file: FileItem,
    decryptedNamesMap: Record<string, string>
  ) {
    const { invoke } = await import('@tauri-apps/api/core')

    const existing = tempFileTimeoutsRef.current.get(file.id)
    if (existing) {
      clearTimeout(existing.timeout)
      try {
        await invoke('unwatch_temp_file', { tempPath: existing.filePath })
        await invoke('delete_temp_file', { path: existing.filePath })
      } catch {
        /* ignora */
      }
      tempFileTimeoutsRef.current.delete(file.id)
    }

    const fileName = decryptedNamesMap[file.id] ?? file.name_encrypted ?? file.id
    const safeName = fileName.replace(/[/\\:*?"<>|]/g, '_')

    const arrayBuffer = await blob.arrayBuffer()
    const bytes = Array.from(new Uint8Array(arrayBuffer))

    const filePath = await invoke<string>('write_temp_file', {
      name: safeName,
      contents: bytes,
    })

    await invoke('watch_temp_file', { fileId: file.id, tempPath: filePath })

    await invoke('open_file_native', { path: filePath })

    const timeout = setTimeout(async () => {
      try {
        await invoke('unwatch_temp_file', { tempPath: filePath })
        await invoke('delete_temp_file', { path: filePath })
      } catch {
        /* ignora */
      }
      tempFileTimeoutsRef.current.delete(file.id)
    }, 30 * 60 * 1000)
    tempFileTimeoutsRef.current.set(file.id, { timeout, filePath })
  }

  async function handleOpen(file: FileItem) {
    if (!hasSessionKey) return

    // Client desktop Tauri: decripta e apri con app nativa
    if (isRunningInTauri()) {
      setOpeningFileId(file.id)
      setOpeningMode('open')
      try {
        const blob = await downloadAndDecrypt(file.id)
        if (!blob) return
        await openWithNativeApp(blob, file, decryptedNames)
      } catch {
        alert('Errore durante l\'apertura.')
      } finally {
        setOpeningFileId(null)
        setOpeningMode(null)
      }
      return
    }

    // Browser: decripta e apri PDF/Office in nuova tab, media in modale
    setOpeningFileId(file.id)
    setOpeningMode('open')
    try {
      const blob = await downloadAndDecrypt(file.id)
      if (!blob) return
      const displayName = decryptedNames[file.id] ?? file.name_encrypted
      const mime = (blob.type || getMimeFromPath(displayName)).toLowerCase()

      const isPdf = mime === 'application/pdf'
      const isOffice =
        mime.includes('wordprocessingml') ||
        mime.includes('spreadsheetml') ||
        mime.includes('presentationml') ||
        mime === 'application/msword' ||
        mime === 'application/vnd.ms-excel' ||
        mime === 'application/vnd.ms-powerpoint'
      const isImage = mime.startsWith('image/')
      const isVideo = mime.startsWith('video/')
      const isAudio = mime.startsWith('audio/')

      if (isPdf || isOffice) {
        const url = URL.createObjectURL(blob)
        window.open(url, '_blank', 'noopener,noreferrer')
      } else if (isImage || isVideo || isAudio) {
        if (previewUrl) URL.revokeObjectURL(previewUrl)
        const url = URL.createObjectURL(blob)
        setPreviewUrl(url)
        setPreviewType(isImage ? 'image' : isVideo ? 'video' : 'audio')
        setPreviewName(displayName)
        setPreviewFileId(file.id)
        setPreviewText('')
        setShowPreview(true)
      } else {
        if (previewUrl) URL.revokeObjectURL(previewUrl)
        setPreviewUrl('')
        setPreviewType('unsupported')
        setPreviewName(displayName)
        setPreviewFileId(file.id)
        setPreviewText('')
        setShowPreview(true)
      }
    } catch {
      alert('Errore durante l\'apertura.')
    } finally {
      setOpeningFileId(null)
      setOpeningMode(null)
    }
  }

  /** Scarica il file: in Tauri decifra e apre con app nativa; nel browser scarica il file cifrato .axs */
  async function handleDownloadFile(file: FileItem) {
    if (!hasSessionKey) return
    try {
      setOpeningFileId(file.id)
      setOpeningMode('download')
      if (isRunningInTauri()) {
        const blob = await downloadAndDecrypt(file.id)
        if (!blob) return
        await openWithNativeApp(blob, file, decryptedNames)
        return
      }
      // Browser: scarica file cifrato raw con estensione .axs
      const { data } = await filesApi.download(file.id)
      const encryptedBlob = new Blob([data as ArrayBuffer], {
        type: 'application/octet-stream',
      })
      const url = URL.createObjectURL(encryptedBlob)
      const a = document.createElement('a')
      a.href = url
      const displayName = decryptedNames[file.id] ?? file.name_encrypted
      a.download = displayName + '.axs'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      showToast('File cifrato scaricato — aprilo con il client desktop AXSHARE')
    } catch {
      showToast('Errore durante il download')
    } finally {
      setOpeningFileId(null)
      setOpeningMode(null)
    }
  }

  /** Scarica la cartella come ZIP con tutti i file ancora cifrati (nessun dato in chiaro esce da AXSHARE). */
  async function handleDownloadFolder(folder: Folder & { name?: string }) {
    if (!hasSessionKey) return
    try {
      const JSZip = (await import('jszip')).default
      const zip = new JSZip()
      const manifest: { folders: { id: string; path: string; name_encrypted: string }[]; files: { id: string; path: string; name_encrypted: string }[] } = { folders: [], files: [] }

      async function addFolderToZip(folderId: string, pathPrefix: string, folderNameEncrypted: string) {
        const [filesResp, childrenResp] = await Promise.all([
          foldersApi.listFiles(folderId),
          foldersApi.listChildren(folderId),
        ])
        const files = filesResp.data ?? []
        const children = childrenResp.data ?? []
        manifest.folders.push({ id: folderId, path: pathPrefix.replace(/\/$/, ''), name_encrypted: folderNameEncrypted })
        for (const f of files) {
          const downloadResp = await filesApi.download(f.id)
          const encryptedData = downloadResp.data as ArrayBuffer
          if (encryptedData && encryptedData.byteLength > 0) {
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
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 5000)
      showToast('Download cartella cifrata avviato')
    } catch {
      showToast('Errore durante il download della cartella')
    }
  }

  async function handleCreateFolderSubmit() {
    const name = createFolderModalName.trim()
    if (!name || !user?.id) return
    try {
      // Genera chiave cartella
      const folderKey = await generateKey()

      // Cifra il nome con la folderKey
      const nameBytes = new TextEncoder().encode(name)
      const nameEncryptedBytes = await encryptFileChunked(
        nameBytes,
        folderKey,
        user.id
      )
      const nameEncrypted = bytesToBase64(new Uint8Array(nameEncryptedBytes))

      // Cifra la folderKey con la chiave pubblica RSA dell'utente
      // (come per i file in useCrypto) così potrà essere decifrata con la chiave privata
      const publicKeyPem = await keyManager.getPublicKeyPem(user.id)
      if (!publicKeyPem) throw new Error('Chiave pubblica non trovata')
      const folderKeyEncrypted = await encryptFileKeyWithRSA(
        folderKey,
        publicKeyPem
      )

      const folderId = await createFolder(
        nameEncrypted,
        currentFolderId,
        folderKeyEncrypted
      )
      if (folderId) setFolderIcon(folderId, createFolderModalColor)
      reloadFolders()
      setShowCreateFolderModal(false)
      setCreateFolderModalName('')
      setCreateFolderModalColor(1)
    } catch {
      // errore gestito dall'hook
    }
  }

  async function doDeleteFile(fileId: string) {
    await deleteFile(fileId, currentFolderId)
    removeFromInEvidenza(fileId, 'file')
    reloadFiles()
    refreshStorageDashboard()
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

  async function doDeleteFolder(folderId: string) {
    try {
      await deleteFolder(folderId, currentFolderId ?? undefined)
      removeFromInEvidenza(folderId, 'folder')
      setDecryptedFolderNames((prev) => {
        const n = { ...prev }
        delete n[folderId]
        return n
      })
      reloadFolders()
      showToast('Cartella eliminata')
    } catch {
      showToast("Errore durante l'eliminazione")
    }
  }

  function handleDeleteFolder(folderId: string) {
    setConfirmModal({
      title: 'Elimina cartella',
      message: 'Eliminare questa cartella?',
      confirmLabel: 'Elimina',
      variant: 'danger',
      onConfirm: () => {
        setConfirmModal(null)
        doDeleteFolder(folderId)
      },
    })
  }

  async function handleRenameFolder(folderId: string, newName: string) {
    if (!newName.trim() || !user?.id) return
    try {
      const folderKey = await generateKey()
      const nameBytes = new TextEncoder().encode(newName.trim())
      const nameEncryptedBytes = await encryptFileChunked(nameBytes, folderKey, user.id)
      const nameEncrypted = bytesToBase64(new Uint8Array(nameEncryptedBytes))
      const publicKeyPem = await keyManager.getPublicKeyPem(user.id)
      if (!publicKeyPem) throw new Error('Chiave pubblica non trovata')
      const folderKeyEncrypted = await encryptFileKeyWithRSA(folderKey, publicKeyPem)
      await renameFolder(folderId, nameEncrypted, folderKeyEncrypted, currentFolderId ?? undefined)
      setDecryptedFolderNames((prev) => ({ ...prev, [folderId]: newName.trim() }))
      setRenamingFolderId(null)
      reloadFolders()
      showToast('Cartella rinominata')
    } catch {
      showToast('Errore durante la rinomina')
    }
  }

  function handleDeleteSelected() {
    if (selected.size === 0) return
    setConfirmModal({
      title: 'Elimina selezionati',
      message: `Eliminare ${selected.size} elemento/i selezionato/i?`,
      confirmLabel: 'Elimina',
      variant: 'danger',
      onConfirm: () => {
        setConfirmModal(null)
        doDeleteSelected()
      },
    })
  }

  async function doDeleteSelected() {
    let ok = 0
    let err = 0
    for (const id of Array.from(selected)) {
      try {
        if (folderIdsSet.has(id)) {
          await deleteFolder(id, currentFolderId ?? undefined)
          removeFromInEvidenza(id, 'folder')
          setDecryptedFolderNames((prev) => {
            const n = { ...prev }
            delete n[id]
            return n
          })
          reloadFolders()
        } else {
          await deleteFile(id, currentFolderId)
          removeFromInEvidenza(id, 'file')
          reloadFiles()
        }
        ok++
      } catch {
        err++
      }
    }
    setSelected(new Set())
    refreshStorageDashboard()
    if (err > 0) showToast(`${ok} eliminati, ${err} errori`)
    else showToast(ok === 1 ? 'Elemento eliminato' : `${ok} elementi eliminati`)
  }

  const handleMoveToDestination = useCallback(
    async (targetFolderId: string | null) => {
      if (!moveModal || moveModal.items.length === 0 || moveModalMoving) return
      const sourceFolderId = currentFolderId ?? undefined
      setMoveModalMoving(true)
      try {
        for (const item of moveModal.items) {
          if (item.type === 'file') {
            await moveFile(item.id, targetFolderId, sourceFolderId ?? null)
          } else {
            await moveFolder(item.id, targetFolderId, sourceFolderId ?? null)
          }
        }
        setSelected((prev) => {
          const next = new Set(prev)
          moveModal.items.forEach((i) => next.delete(i.id))
          return next
        })
        setMoveModal(null)
        const n = moveModal.items.length
        showToast(n === 1 ? 'Elemento spostato' : `${n} elementi spostati`)
        refreshStorageDashboard()
      } catch {
        showToast('Errore durante lo spostamento')
      } finally {
        setMoveModalMoving(false)
      }
    },
    [moveModal, moveModalMoving, currentFolderId, moveFile, moveFolder]
  )

  async function handleUploadNewVersion(e: React.FormEvent) {
    e.preventDefault()
    if (!uploadVersionFile) return
    const input = versionFileInputRef.current
    const selectedFile = input?.files?.[0]
    if (!selectedFile) {
      alert('Seleziona un file.')
      return
    }
    const result = await uploadNewVersion(uploadVersionFile.fileId, selectedFile, versionComment || undefined)
    if (result) {
      setUploadVersionFile(null)
      setVersionComment('')
      if (input) input.value = ''
      reloadFiles()
      refreshStorageDashboard()
    }
  }

  return (
    <div className="ax-dash-mockup-root">

      {/* HEADER — identico al mockup */}
      <header className="header">
        <div className="header-logo-area">
          <img src="/Logo.png" alt="AXSHARE" className="header-logo-img" style={{ height: 38, width: 'auto', objectFit: 'contain' }} />
        </div>

        <div className="search-wrap">
          <span className="search-icon" aria-hidden>
            <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </span>
          <input
            id="search"
            className="search-input"
            data-testid="search-input"
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cerca in Axshare..."
          />
          {searchLoading ? (
            <span data-testid="search-loading" style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: 'var(--ax-muted)' }}>Ricerca...</span>
          ) : searchQuery ? (
            <button type="button" className="search-clear-btn" onClick={() => setSearchQuery('')} aria-label="Cancella">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          ) : null}
        </div>

        <div className="header-spacer" />

        <div className="header-actions">
          <input ref={fileInputRef} data-testid="file-input" type="file" onChange={handleFileSelect} disabled={uploadLocked || !canUpload} style={{ display: 'none' }} />
          <button type="button" className="icon-btn" aria-label="Notifiche" onClick={() => router.push('/notifications')}>
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
          </button>
          <div className="header-avatar-wrap" ref={headerAvatarRef}>
            <button
              type="button"
              className="header-user-block-btn"
              onClick={(e) => { e.stopPropagation(); setHeaderAvatarOpen((o) => !o) }}
              aria-expanded={headerAvatarOpen}
              aria-haspopup="true"
              aria-label="Menu utente"
            >
              <span className="avatar-btn avatar-btn-sm avatar-btn-circle">
                {(user?.email ? user.email.split('@')[0].slice(0, 2) : 'U').toUpperCase()}
              </span>
              <span className="header-user-block-text">
                <span className="header-user-name">{user?.display_name || user?.email?.split('@')[0] || 'Utente'}</span>
                <span className="header-user-role">{user?.email ?? ''}</span>
              </span>
              <svg className={`header-user-chevron ${headerAvatarOpen ? 'open' : ''}`} width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {headerAvatarOpen && (
              <div className="header-avatar-dropdown" role="menu">
                <button type="button" className="header-avatar-dropdown-item" role="menuitem" onClick={() => { setHeaderAvatarOpen(false); router.push('/settings') }}>
                  Profilo
                </button>
                <button type="button" className="header-avatar-dropdown-item" role="menuitem" onClick={async () => { setHeaderAvatarOpen(false); await logout(); router.push('/login') }}>
                  Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="app-body">

        {/* SIDEBAR */}
        <aside className="sidebar">
          <div className="nav-section-label">Principale</div>
          <div className="nav-item active">
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" />
            </svg>
            Home
          </div>
          <div className="nav-item" onClick={() => router.push('/dashboard')}>
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /><polyline points="2 10 22 10" />
            </svg>
            I miei file
          </div>
          <div className="nav-section-label">Libreria</div>
          <div className="nav-item">
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
            </svg>
            Condivisi
            <span className="nav-badge">3</span>
          </div>
          <div className="nav-item">
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
            </svg>
            Recenti
          </div>
          <div className="nav-item">
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
            Preferiti
          </div>
          <div className="nav-section-label">Altro</div>
          <div className="nav-item">
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" />
            </svg>
            Cestino
            <span className="nav-badge">2</span>
          </div>
          <div className="sidebar-footer">
            <div className="storage-label">
              Spazio usato <span className="storage-pct">{storageDashboard?.storage ? Math.min(100, Math.round((storageDashboard.storage.total_size_bytes / (storageDashboard.storage.storage_quota_bytes || 1)) * 100)) : 0}%</span>
            </div>
            <div className="storage-track">
              <div className="storage-fill" style={{ width: `${storageDashboard?.storage ? Math.min(100, (storageDashboard.storage.total_size_bytes / (storageDashboard.storage.storage_quota_bytes || 1)) * 100) : 0}%` }} />
            </div>
            <div className="storage-sub">
              {storageDashboard?.storage
                ? `${formatFileSize(storageDashboard.storage.total_size_bytes)} di ${formatFileSize(storageDashboard.storage.storage_quota_bytes)} usati`
                : '0 B di 1 GB usati'}
            </div>
          </div>
        </aside>

        <main className="main">
        {/* OnboardingBanner — nascosto visivamente per match con secondo screen */}
        <div className="ax-dash-hide-onboarding">
          <OnboardingBanner />
        </div>

        {/* Banner PIN — MANTIENI logica invariata */}
        {!user?.has_public_key && (
          <div className="ax-dash-banner-warning"
            data-testid="pin-not-configured-banner">
            <span>⚠️ PIN di sicurezza non configurato.</span>
            <button type="button" className="ax-dash-banner-btn"
              onClick={() => router.push('/settings/security')}
              data-testid="configure-pin-button">
              Configura PIN
            </button>
          </div>
        )}

        {/* Page header — titolo + Crea o carica */}
        <div className="page-header">
          <div>
            <div className="page-title">Bentornato{user?.email ? `, ${user.email.split('@')[0]}` : ''} 👋</div>
            <div className="page-subtitle">Ultimo accesso oggi alle 09:14. 6 file modificati di recente</div>
          </div>
          <div className="crea-carica-wrap" ref={creaCaricaDropdownRef}>
            <input ref={multiFileInputRef} type="file" multiple onChange={handleMultiFileSelect} disabled={uploadLocked || !canUpload} style={{ display: 'none' }} data-testid="multi-file-input" />
            <input ref={folderInputRef} type="file" onChange={handleFolderSelect} disabled={uploadLocked || !canUpload} style={{ display: 'none' }} data-testid="folder-upload-input" {...({ webkitdirectory: 'true' } as React.InputHTMLAttributes<HTMLInputElement>)} />
            <button type="button" className="btn-crea-carica" onClick={() => setCreaCaricaDropdownOpen((o) => !o)} aria-expanded={creaCaricaDropdownOpen} aria-haspopup="true">
              <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              Crea o carica
            </button>
            {creaCaricaDropdownOpen && (
              <div className="crea-carica-dropdown" role="menu">
                <button type="button" className="crea-carica-item" role="menuitem" onClick={() => { setShowCreateFolderModal(true); setCreaCaricaDropdownOpen(false) }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
                  Cartella
                </button>
                <button type="button" className="crea-carica-item" role="menuitem" onClick={() => { void handlePickMultipleFilesClick(); setCreaCaricaDropdownOpen(false) }} disabled={uploadLocked || !canUpload}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="12" y1="11" x2="12" y2="17" /><line x1="9" y1="14" x2="15" y2="14" /></svg>
                  Caricamento file
                </button>
                <button type="button" className="crea-carica-item" role="menuitem" onClick={() => { void handlePickFolderClick(); setCreaCaricaDropdownOpen(false) }} disabled={uploadLocked || !canUpload}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /><path d="M12 11v6" /><path d="M9 14h6" /></svg>
                  Caricamento cartella
                </button>
              </div>
            )}
          </div>
        </div>

        <nav className="ax-dash-breadcrumb ax-dash-breadcrumb-hidden" data-testid="breadcrumb"
          style={{ display: 'flex', alignItems: 'center', gap: 4,
            marginBottom: 20, flexWrap: 'wrap' }}>
          <button type="button"
            onClick={() => navigateBreadcrumb(-1)}
            data-testid="breadcrumb-root"
            style={{ fontSize: 13, fontWeight: 600, color: 'var(--ax-blue)',
              background: 'none', border: 'none', cursor: 'pointer',
              padding: '4px 8px', borderRadius: 6 }}>
            Root
          </button>
          {breadcrumb.map((crumb, i) => (
            <span key={crumb.id}
              style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ color: 'var(--ax-muted)', fontSize: 13 }}>/</span>
              <button type="button"
                onClick={() => navigateBreadcrumb(i)}
                data-testid={`breadcrumb-${crumb.id}`}
                style={{ fontSize: 13, fontWeight: 600, color: 'var(--ax-blue)',
                  background: 'none', border: 'none', cursor: 'pointer',
                  padding: '4px 8px', borderRadius: 6 }}>
                {crumb.name}
              </button>
            </span>
          ))}
        </nav>

        {/* Messaggi di stato — MANTIENI logica esistente */}
        {autoSaveMessage && (
          <p data-testid="auto-save-message"
            style={{ color: 'var(--ax-success)', marginBottom: 12,
              fontSize: 13, fontWeight: 600 }}>
            {autoSaveMessage}
          </p>
        )}
        {uploadStatus && (
          <p data-testid="upload-status"
            style={{ fontSize: 13, color: 'var(--ax-text)', marginBottom: 12 }}>
            {uploadStatus}
          </p>
        )}
        {!canUpload && (
          <p data-testid="upload-queue-full"
            style={{ fontSize: 12, color: 'var(--ax-muted)', marginBottom: 12 }}>
            {activeUploads} upload in corso (max 3)
          </p>
        )}
        {cryptoError && (
          <p data-testid="crypto-error" role="alert"
            style={{ marginBottom: 12, fontSize: 13, color: 'var(--ax-error)',
              display: 'flex', alignItems: 'center', gap: 8 }}>
            {cryptoError}
            <button type="button" className="ax-dash-btn-secondary"
              onClick={clearCryptoError}>Chiudi</button>
          </p>
        )}

        {/* CARTELLE — filtrate dalla ricerca nel campo header */}
          <>
            <div className="section-header cartelle-preferite-header">
              <div className="section-title">
                <svg className="section-title-folder-icon" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
                In Evidenza
              </div>
            </div>

            <div className="folders-grid folders-grid-large" data-testid="folder-list">
              {Array.from({ length: IN_EVIDENZA_MAX }, (_, i) => {
                const item = inEvidenza[i]
                if (item) {
                  const isFolder = item.type === 'folder'
                  return (
                    <div
                      key={`${item.type}-${item.id}`}
                      className="folder-card folder-card-favorite"
                      data-testid="in-evidenza-item"
                      onClick={() => {
                        if (isFolder) {
                          const f = folders.find((x) => x.id === item.id)
                          if (f) openFolder(f)
                          else openFolderById(item.id, item.name)
                        }
                      }}
                      onDoubleClick={() => {
                        if (isFolder) {
                          const f = folders.find((x) => x.id === item.id)
                          if (f) openFolder(f)
                          else openFolderById(item.id, item.name)
                        } else {
                          const file = files.find((x) => x.id === item.id)
                          if (file) handleOpen(file)
                        }
                      }}
                      style={{ position: 'relative', cursor: isFolder ? 'pointer' : undefined }}
                    >
                      <button
                        type="button"
                        aria-label="Rimuovi da In Evidenza"
                        onClick={(e) => { e.stopPropagation(); removeFromInEvidenza(item.id, item.type); showToast('Rimosso da In Evidenza') }}
                        style={{ position: 'absolute', top: 8, right: 8, width: 24, height: 24, borderRadius: '50%', border: 'none', background: 'var(--ax-surface-2)', color: 'var(--ax-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}
                      >
                        ×
                      </button>
                      {isFolder ? (
                        <>
                          <div className="folder-icon-img-wrap">
                            <Image src={getFolderIconByIndex(folderIconPref[item.id] ?? item.folderIconIndex ?? 1)} alt={item.name} width={56} height={48} style={{ objectFit: 'contain' }} />
                          </div>
                          <div className="folder-name">{item.name}</div>
                          <div className="folder-meta">Cartella</div>
                        </>
                      ) : (() => {
                        const file = files.find((f) => f.id === item.id) as (FileItem & { created_at?: string }) | undefined
                        const meta = inEvidenzaFileMetaMap?.[item.id]
                        const sizeBytes = item.size_bytes ?? file?.size_bytes ?? meta?.size_bytes
                        const createdAt = item.created_at ?? file?.created_at ?? meta?.created_at
                        const sizeLabel = sizeBytes != null ? formatFileSize(sizeBytes) : '—'
                        const createdLabel = createdAt ? formatRelativeModified(createdAt) : '—'
                        const fileIconSrc = item.name.endsWith('.axs') ? getAxsFileIcon(item.name) : getFileIcon(item.name)
                        return (
                          <>
                            <div className="folder-icon-img-wrap">
                              <Image src={fileIconSrc} alt={item.name} width={56} height={48} style={{ objectFit: 'contain' }} unoptimized />
                            </div>
                            <div className="folder-name">{item.name}</div>
                            <div className="folder-meta">{sizeLabel} · {createdLabel}</div>
                          </>
                        )
                      })()}
                    </div>
                  )
                }
                return (
                  <div
                    key={`placeholder-${i}`}
                    className="folder-card folder-card-favorite ax-in-evidenza-placeholder"
                    style={{ borderStyle: 'dashed', opacity: 0.85 }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--ax-muted)' }}>
                      <svg width="32" height="32" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                      </svg>
                      <span style={{ fontSize: 12, fontWeight: 600 }}>Aggiungi in evidenza</span>
                      <span style={{ fontSize: 11 }}>Dalla tabella sotto</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </>

        {/* FILE TABLE — filtrato dalla ricerca nel campo header */}
          <>
            <div className="section-header">
              <div className="section-title">
                <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
                </svg>
                Recenti
              </div>
              <button type="button" className="section-action" onClick={() => showToast('Tutti i file e le cartelle')}>Vedi Tutti →</button>
            </div>

            <div className="files-section" data-testid="file-list">
              <div className="files-toolbar">
                <div className="files-title" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  {breadcrumb.length === 0 ? (
                    <>
                      <svg className="files-title-arrow" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                      Tutti i file
                    </>
                  ) : (
                    <>
                      <svg className="files-title-arrow" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                      <button
                        type="button"
                        className="files-title-breadcrumb-item"
                        onClick={() => navigateBreadcrumb(-1)}
                        data-testid="breadcrumb-root"
                      >
                        Tutti i file
                      </button>
                      {breadcrumb.map((crumb, i) => (
                        <span key={crumb.id} className="files-title-breadcrumb-wrap">
                          <span className="files-title-breadcrumb-sep">/</span>
                          <button
                            type="button"
                            className="files-title-breadcrumb-item"
                            onClick={() => navigateBreadcrumb(i)}
                            data-testid={`breadcrumb-${crumb.id}`}
                            style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160 }}
                          >
                            {crumb.name}
                          </button>
                        </span>
                      ))}
                    </>
                  )}
                </div>
                {selected.size > 0 && (
                  <div className="files-toolbar-actions" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button
                      type="button"
                      className="ax-toolbar-btn ax-toolbar-btn-secondary"
                      onClick={() => {
                        const items = allTableItems
                          .filter((i) => selected.has(i.data.id))
                          .map((i) => ({
                            type: i.type,
                            id: i.data.id,
                            name: i.type === 'folder' ? (decryptedFolderNames[i.data.id] ?? i.data.name_encrypted) : (decryptedNames[i.data.id] ?? i.data.name_encrypted),
                          }))
                        if (items.length) setMoveModal({ items })
                      }}
                    >
                      <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3" />
                      </svg>
                      Sposta selezionati ({selected.size})
                    </button>
                    <button
                      type="button"
                      className="ax-toolbar-btn ax-toolbar-btn-danger"
                      onClick={handleDeleteSelected}
                    >
                      <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" />
                      </svg>
                      Elimina selezionati ({selected.size})
                    </button>
                  </div>
                )}
              </div>

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
                          width: 20,
                          height: 20,
                          borderRadius: '50%',
                          border: `2px solid ${allSelected ? 'var(--ax-blue)' : 'var(--ax-border)'}`,
                          background: allSelected ? 'var(--ax-blue)' : 'white',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        {allSelected && (
                          <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                            <path d="M1 4l3 3 5-6" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </div>
                    </th>
                    <th style={{ width: '40%' }}>NOME <span className="sort-icon sort-icon-plus">+</span></th>
                    <th style={{ width: '10%' }}>DIMENSIONE</th>
                    <th style={{ width: '15%' }}>PROPRIETARIO</th>
                    <th style={{ width: '15%' }}>CONDIVISIONE</th>
                    <th style={{ width: '15%' }}>MODIFICATO</th>
                    <th style={{ width: '15%', textAlign: 'right' }}>AZIONI</th>
                  </tr>
                </thead>
                <tbody className="file-table-tbody-fixed">
                  {!showListLoading && allTableItems.length === 0 ? (
                    Array.from({ length: ROWS_PER_PAGE }).map((_, i) => (
                      <tr key={`empty-${i}`} className="file-table-empty-row" aria-hidden>
                        <td colSpan={7} className="file-table-empty-cell" />
                      </tr>
                    ))
                  ) : (
                    <>
                  {paginatedTableItems.map((item, idx) => {
                    if (item.type === 'folder') {
                      const folder = item.data
                    const folderName = decryptedFolderNames[folder.id] ?? folder.name_encrypted
                    const isRenaming = renamingFolderId === folder.id
                    const folderAny = folder as Record<string, unknown>
                    const created = folderAny.created_at ?? folder.created_at
                    const updated = folderAny.updated_at ?? folder.updated_at
                    const hasModifications = updated && created && String(updated) !== String(created)
                    const modifiedOrCreatedAt = (hasModifications ? updated : created ?? updated) as string | undefined
                    const folderChecked = selected.has(folder.id)
                    return (
                      <tr
                        key={`folder-${folder.id}`}
                        className="file-table-row-folder"
                        style={{ cursor: 'pointer', background: folderChecked ? 'rgba(50,153,243,0.06)' : undefined }}
                        onClick={() => openFolder(folder)}
                        onContextMenu={(e) => {
                          e.preventDefault()
                          setContextMenu({ x: e.clientX, y: e.clientY, type: 'folder', id: folder.id, name: folderName })
                        }}
                      >
                        <td style={{ width: 44, paddingLeft: 20, paddingRight: 0, verticalAlign: 'middle' }} onClick={(e) => e.stopPropagation()}>
                          <div
                            role="checkbox"
                            aria-checked={folderChecked}
                            className="ax-row-chk"
                            onClick={(e) => {
                              e.stopPropagation()
                              setSelected((prev) => {
                                const s = new Set(prev)
                                if (s.has(folder.id)) s.delete(folder.id)
                                else s.add(folder.id)
                                return s
                              })
                            }}
                            style={{
                              width: 20,
                              height: 20,
                              borderRadius: '50%',
                              border: `2px solid ${folderChecked ? 'var(--ax-blue)' : 'var(--ax-border)'}`,
                              background: folderChecked ? 'var(--ax-blue)' : 'white',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
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
                            <Image src={getFolderIconByIndex(folderIconPref[folder.id] ?? 1)} alt={folderName} width={24} height={20} style={{ objectFit: 'contain', marginRight: 8 }} />
                            {isRenaming ? (
                              <input
                                autoFocus
                                defaultValue={folderName}
                                style={{ fontSize: 13, border: '1px solid var(--ax-border)', borderRadius: 4, padding: '2px 6px' }}
                                onBlur={(e) => handleRenameFolder(folder.id, e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleRenameFolder(folder.id, e.currentTarget.value)
                                  if (e.key === 'Escape') setRenamingFolderId(null)
                                }}
                              />
                            ) : (
                              <span className="file-name">{folderName}</span>
                            )}
                          </div>
                        </td>
                        <td className="file-size-cell">
                          {formatFileSize(folder.total_size_bytes ?? 0)}
                        </td>
                        <td>
                          <div className="owner-cell">
                            <div className="owner-avatar">
                              {(user?.display_name?.trim()
                                ? user.display_name.trim().split(/\s+/).length >= 2
                                  ? (user.display_name.trim().split(/\s+/)[0][0] + user.display_name.trim().split(/\s+/)[1][0]).toUpperCase()
                                  : user.display_name.trim().slice(0, 2).toUpperCase()
                                : user?.email ? user.email.split('@')[0].slice(0, 2) : 'U'
                              ).toUpperCase()}
                            </div>
                            {user?.display_name?.trim() || user?.email?.split('@')[0] || 'Tu'}
                          </div>
                        </td>
                        <td>
                          <span className="share-badge share-private">
                            <svg className="share-badge-icon" width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg> Privata
                          </span>
                        </td>
                        <td className="modified-cell" style={{ visibility: 'visible', overflow: 'visible' }}>
                          {modifiedOrCreatedAt ? (
                            <span className="modified-cell-content" style={{ display: 'inline' }}>
                              {formatRelativeModified(modifiedOrCreatedAt)}
                              {formatDateTimeIt(modifiedOrCreatedAt) && (
                                <span style={{ opacity: 0.85, fontSize: '0.95em', marginLeft: 4 }}>
                                  · {formatDateTimeIt(modifiedOrCreatedAt)}
                                </span>
                              )}
                            </span>
                          ) : (
                            <span>—</span>
                          )}
                        </td>
                        <td>
                          <div className="row-actions">
                            <button
                              type="button"
                              className="row-action-btn"
                              title="In Evidenza"
                              onClick={(e) => {
                                e.stopPropagation()
                                if (inEvidenza.length >= IN_EVIDENZA_MAX) { showToast(`Massimo ${IN_EVIDENZA_MAX} elementi in evidenza`); return }
                                if (inEvidenza.some((x) => x.id === folder.id && x.type === 'folder')) { showToast('Già in evidenza'); return }
                                addToInEvidenza({ type: 'folder', id: folder.id, name: folderName, folderIconIndex: folderIconPref[folder.id] ?? 1 })
                                showToast('Aggiunto a In Evidenza')
                              }}
                            >
                              <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
                            </button>
                            <button
                              type="button"
                              className="row-action-btn"
                              title="Rinomina"
                              onClick={(e) => {
                                e.stopPropagation()
                                setRenamingFolderId(folder.id)
                                setRenamingFolderValue(folderName)
                              }}
                            >
                              <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                            </button>
                            <button
                              type="button"
                              className="row-action-btn"
                              title="Elimina"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleDeleteFolder(folder.id)
                              }}
                              style={{ color: 'var(--ax-error)' }}
                            >
                              <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /></svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  }
                  const file = item.data as FileItem
                  const globalIdx = (fileTablePage - 1) * ROWS_PER_PAGE + idx
                  const displayName = decryptedNames[file.id] ?? file.name_encrypted
                  const fileWithDates = file as FileItem & { created_at?: string; updated_at?: string }
                  const fileCreatedAt = fileWithDates.created_at
                  const fileUpdatedAt = fileWithDates.updated_at
                  const fileHasModifications = fileUpdatedAt && fileCreatedAt && fileUpdatedAt !== fileCreatedAt
                  const fileModifiedOrCreatedAt = fileHasModifications ? fileUpdatedAt : (fileCreatedAt ?? fileUpdatedAt)
                  const fileChecked = selected.has(file.id)
                  return (
                        <tr
                          key={file.id}
                          className="file-table-row-file"
                          data-testid="file-item"
                          style={{ background: fileChecked ? 'rgba(50,153,243,0.06)' : undefined }}
                          onClick={() => handleOpen(file)}
                          onContextMenu={(e) => {
                            e.preventDefault()
                            setContextMenu({ x: e.clientX, y: e.clientY, type: 'file', id: file.id, name: displayName })
                          }}
                        >
                          <td style={{ width: 44, paddingLeft: 20, paddingRight: 0, verticalAlign: 'middle' }} onClick={(e) => e.stopPropagation()}>
                            <div
                              role="checkbox"
                              aria-checked={fileChecked}
                              className="ax-row-chk"
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
                                width: 20,
                                height: 20,
                                borderRadius: '50%',
                                border: `2px solid ${fileChecked ? 'var(--ax-blue)' : 'var(--ax-border)'}`,
                                background: fileChecked ? 'var(--ax-blue)' : 'white',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
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
                                <Image src={displayName.endsWith('.axs') ? getAxsFileIcon(displayName) : getFileIcon(displayName, file.is_signed)} alt={getFileLabel(displayName)} width={44} height={44} className="file-type-icon" style={{ objectFit: 'contain', flexShrink: 0, opacity: openingFileId === file.id ? 0.5 : 1 }} unoptimized />
                                {openingFileId === file.id && (
                                  <span className="file-open-loader" aria-label={openingMode === 'download' ? 'Download in corso' : 'Apertura in corso'} />
                                )}
                              </div>
                              <span className="file-name" data-testid={`file-name-${file.id}`}>
                                {displayName}
                                {autoSaving[file.id] && <span style={{ color: 'var(--ax-success)', fontSize: 11, fontWeight: 600, marginLeft: 6 }}>💾 Salvataggio...</span>}
                                {openingFileId === file.id && <span style={{ color: 'var(--ax-blue)', fontSize: 11, fontWeight: 600, marginLeft: 6 }}>{openingMode === 'download' ? 'Download in corso...' : 'Apertura in corso...'}</span>}
                              </span>
                            </div>
                          </td>
                          <td className="file-size-cell">
                            {formatFileSize((file as FileItem).size_bytes ?? (file as { size?: number }).size ?? 0)}
                          </td>
                          <td>
                            <div className="owner-cell">
                              <div className="owner-avatar">
                                {(user?.display_name?.trim()
                                  ? user.display_name.trim().split(/\s+/).length >= 2
                                    ? (user.display_name.trim().split(/\s+/)[0][0] + user.display_name.trim().split(/\s+/)[1][0]).toUpperCase()
                                    : user.display_name.trim().slice(0, 2).toUpperCase()
                                  : user?.email ? user.email.split('@')[0].slice(0, 2) : 'U'
                                ).toUpperCase()}
                              </div>
                              {user?.display_name?.trim() || user?.email?.split('@')[0] || 'Tu'}
                            </div>
                          </td>
                          <td>
                            <span className={globalIdx % 3 === 0 ? 'share-badge share-private' : globalIdx % 3 === 1 ? 'share-badge share-shared' : 'share-badge share-team'}>
                              {globalIdx % 3 === 0 ? (
                                <><svg className="share-badge-icon" width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg> Privata</>
                              ) : globalIdx % 3 === 1 ? (
                                <><svg className="share-badge-icon" width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg> Condiviso</>
                              ) : (
                                <><svg className="share-badge-icon" width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M20 6L9 17l-5-5" /></svg> Team</>
                              )}
                            </span>
                          </td>
                          <td className="modified-cell" style={{ visibility: 'visible', overflow: 'visible' }}>
                            {fileModifiedOrCreatedAt ? (
                              <span className="modified-cell-content" style={{ display: 'inline' }}>
                                {formatRelativeModified(fileModifiedOrCreatedAt)}
                                {formatDateTimeIt(fileModifiedOrCreatedAt) && (
                                  <span style={{ opacity: 0.85, fontSize: '0.95em', marginLeft: 4 }}>
                                    · {formatDateTimeIt(fileModifiedOrCreatedAt)}
                                  </span>
                                )}
                              </span>
                            ) : (
                              <span>—</span>
                            )}
                          </td>
                          <td>
                            <div className="row-actions">
                              <button
                                type="button"
                                className="row-action-btn"
                                title="In Evidenza"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  if (inEvidenza.length >= IN_EVIDENZA_MAX) { showToast(`Massimo ${IN_EVIDENZA_MAX} elementi in evidenza`); return }
                                  if (inEvidenza.some((x) => x.id === file.id && x.type === 'file')) { showToast('Già in evidenza'); return }
                                  addToInEvidenza({ type: 'file', id: file.id, name: displayName, size_bytes: file.size_bytes, created_at: file.created_at })
                                  showToast('Aggiunto a In Evidenza')
                                }}
                              >
                                <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
                              </button>
                              <button type="button" className="row-action-btn" title="Dettagli" data-testid={`details-${file.id}`} onClick={(e) => { e.stopPropagation(); router.push(`/files/${file.id}`) }}>
                                <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                              </button>
                              <button type="button" className="row-action-btn" title="Versioni" data-testid={`versions-${file.id}`} onClick={(e) => { e.stopPropagation(); setVersionModalFile({ fileId: file.id, fileName: displayName }) }}>
                                <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                              </button>
                              <button type="button" className="row-action-btn" title="Nuova versione" data-testid={`upload-version-${file.id}`} onClick={(e) => { e.stopPropagation(); setUploadVersionFile({ fileId: file.id, fileName: displayName }) }}>
                                <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                              </button>
                              <button type="button" className="row-action-btn" title="Elimina" data-testid={`delete-${file.id}`} onClick={(e) => { e.stopPropagation(); handleDelete(file.id) }} disabled={file.is_destroyed} style={{ color: 'var(--ax-error)' }}>
                                <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /></svg>
                              </button>
                            </div>
                          </td>
                        </tr>
                  )
                  })}
                  {Array.from({ length: Math.max(0, ROWS_PER_PAGE - paginatedTableItems.length) }).map((_, i) => (
                    <tr key={`empty-${i}`} className="file-table-empty-row" aria-hidden>
                      <td colSpan={7} className="file-table-empty-cell" />
                    </tr>
                  ))}
                    </>
                  )}
                </tbody>
              </table>

              <div className="table-footer">
                  <div className="table-info" data-testid="empty-state">
                    {allTableItems.length === 0
                      ? '0 elementi'
                      : `Mostra ${(fileTablePage - 1) * ROWS_PER_PAGE + 1}–${Math.min(fileTablePage * ROWS_PER_PAGE, allTableItems.length)} di ${allTableItems.length} elementi`}
                  </div>
                  <div className="pagination">
                    <button type="button" className="page-btn" disabled={fileTablePage <= 1} onClick={() => setFileTablePage((p) => Math.max(1, p - 1))}>‹</button>
                    {totalTablePages <= 5
                      ? Array.from({ length: totalTablePages }, (_, i) => i + 1).map((n) => (
                          <button key={n} type="button" className={`page-btn ${fileTablePage === n ? 'active' : ''}`} onClick={() => setFileTablePage(n)}>{n}</button>
                        ))
                      : (
                        <>
                          <button type="button" className={`page-btn ${fileTablePage === 1 ? 'active' : ''}`} onClick={() => setFileTablePage(1)}>1</button>
                          {fileTablePage > 2 && <button type="button" className="page-btn page-btn-ellipsis" disabled>...</button>}
                          {fileTablePage > 1 && fileTablePage < totalTablePages && <button type="button" className="page-btn active">{fileTablePage}</button>}
                          {fileTablePage < totalTablePages - 1 && <button type="button" className="page-btn page-btn-ellipsis" disabled>...</button>}
                          {totalTablePages > 1 && <button type="button" className={`page-btn ${fileTablePage === totalTablePages ? 'active' : ''}`} onClick={() => setFileTablePage(totalTablePages)}>{totalTablePages}</button>}
                        </>
                      )}
                    <button type="button" className="page-btn" disabled={fileTablePage >= totalTablePages} onClick={() => setFileTablePage((p) => Math.min(totalTablePages, p + 1))}>›</button>
                  </div>
                </div>
            </div>
          </>
        </main>
      </div>

      {/* Modale di conferma — stile progetto */}
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

      {/* Modale conferma upload (stile progetto, al posto del dialog nativo) */}
      {uploadConfirmPending && (
        <ConfirmModal
          open
          title={`Caricare ${uploadConfirmPending.files.length} file in questo sito?`}
          message={
            uploadConfirmPending.folderName
              ? `Verranno caricati tutti i file da "${uploadConfirmPending.folderName}". Esegui questa operazione solo se ritieni il sito affidabile.`
              : `Verranno caricati i ${uploadConfirmPending.files.length} file selezionati. Esegui questa operazione solo se ritieni il sito affidabile.`
          }
          confirmLabel="Carica"
          cancelLabel="Annulla"
          variant="default"
          onConfirm={doPendingUpload}
          onCancel={() => setUploadConfirmPending(null)}
        />
      )}

      {/* Modale Crea una cartella — stile progetto, 6 colori icone */}
      {showCreateFolderModal && (
        <div className="ax-create-folder-overlay" onClick={() => setShowCreateFolderModal(false)} role="dialog" aria-modal="true" aria-labelledby="ax-create-folder-title">
          <div className="ax-create-folder-modal" onClick={(e) => e.stopPropagation()} data-testid="new-folder-form">
            <div className="ax-create-folder-modal-header">
              <h2 id="ax-create-folder-title" className="ax-create-folder-modal-title">Crea una cartella</h2>
              <button type="button" className="ax-create-folder-modal-close" onClick={() => setShowCreateFolderModal(false)} aria-label="Chiudi">
                <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div className="ax-create-folder-modal-body">
              <label className="ax-create-folder-label" htmlFor="ax-create-folder-name">Nome</label>
              <input
                id="ax-create-folder-name"
                type="text"
                className="ax-create-folder-input"
                data-testid="folder-name-input"
                value={createFolderModalName}
                onChange={(e) => setCreateFolderModalName(e.target.value)}
                placeholder="Inserisci il nome della cartella"
                autoFocus
              />
              <label className="ax-create-folder-label" style={{ marginTop: 20 }}>Colore cartella</label>
              <div className="ax-create-folder-colors">
                {FOLDER_ICON_OPTIONS.map((opt) => (
                  <button
                    key={opt.index}
                    type="button"
                    className={`ax-create-folder-swatch ${createFolderModalColor === opt.index ? 'selected' : ''}`}
                    onClick={() => setCreateFolderModalColor(opt.index)}
                    title={opt.label}
                    aria-pressed={createFolderModalColor === opt.index}
                  >
                    <Image src={getFolderIconByIndex(opt.index)} alt={opt.label} width={40} height={36} style={{ objectFit: 'contain' }} />
                  </button>
                ))}
              </div>
            </div>
            <div className="ax-create-folder-modal-footer">
              <button
                type="button"
                className="ax-create-folder-btn ax-create-folder-btn-primary"
                data-testid="create-folder-button"
                disabled={!createFolderModalName.trim()}
                onClick={handleCreateFolderSubmit}
              >
                Crea
              </button>
              <button
                type="button"
                className="ax-create-folder-btn ax-create-folder-btn-secondary"
                onClick={() => { setShowCreateFolderModal(false); setCreateFolderModalName(''); setCreateFolderModalColor(1) }}
              >
                Annulla
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modale Condividi — layout completo, stile progetto */}
      {shareModal && (
        <div className="ax-create-folder-overlay" onClick={() => { setShareModal(null); setShareModalPermissionOpen(false) }} role="dialog" aria-modal="true" aria-labelledby="ax-share-title">
          <div className="ax-create-folder-modal ax-share-modal" onClick={(e) => e.stopPropagation()} style={{ minWidth: 420, maxWidth: 480 }}>
            <div className="ax-create-folder-modal-header">
              <h2 id="ax-share-title" className="ax-create-folder-modal-title">Condividi &quot;{shareModal.name}&quot;</h2>
              <button type="button" className="ax-create-folder-modal-close" onClick={() => { setShareModal(null); setShareModalPermissionOpen(false) }} aria-label="Chiudi">
                <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div className="ax-share-modal-body">
              <div className="ax-share-input-row">
                <div className="ax-share-input-wrap">
                  <span className="ax-share-input-icon" aria-hidden>
                    <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>
                  </span>
                  <input
                    id="ax-share-email"
                    type="text"
                    className="ax-share-input"
                    value={shareModalEmail}
                    onChange={(e) => setShareModalEmail(e.target.value)}
                    placeholder="Aggiungi un nome, gruppo o e-mail"
                  />
                </div>
                <div className="ax-share-permission-wrap" ref={shareModalPermissionRef}>
                  <button
                    type="button"
                    className="ax-share-permission-trigger"
                    onClick={() => setShareModalPermissionOpen((o) => !o)}
                    aria-expanded={shareModalPermissionOpen}
                    aria-haspopup="true"
                  >
                    <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                    <span className="ax-share-permission-label">
                      {shareModalLevel === 'write' ? 'Può modificare' : shareModalLevel === 'read_no_download' ? 'Solo visualizzazione' : 'Può visualizzare'}
                    </span>
                  </button>
                  {shareModalPermissionOpen && (
                    <div className="ax-share-permission-dropdown">
                      <button type="button" className="ax-share-permission-option" onClick={() => { setShareModalLevel('write'); setShareModalPermissionOpen(false) }}>
                        <span className="ax-share-permission-option-title">Può modificare</span>
                        <span className="ax-share-permission-option-desc">Apporta le modifiche</span>
                      </button>
                      <button type="button" className="ax-share-permission-option" onClick={() => { setShareModalLevel('read'); setShareModalPermissionOpen(false) }}>
                        <span className="ax-share-permission-option-title">Può visualizzare</span>
                        <span className="ax-share-permission-option-desc">Non è possibile apportare modifiche</span>
                      </button>
                      <div className="ax-share-permission-divider" />
                      <button type="button" className="ax-share-permission-option" onClick={() => { setShareModalLevel('read_no_download'); setShareModalPermissionOpen(false) }}>
                        <span className="ax-share-permission-option-title">Solo visualizzazione</span>
                        <span className="ax-share-permission-option-desc">Può visualizzare, ma non scaricare</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <div className="ax-share-shared-section">
                <span className="ax-share-shared-label">Condiviso con</span>
                <p className="ax-share-shared-empty">Nessun accesso condiviso. Aggiungi un nome o e-mail sopra.</p>
              </div>
              <div className="ax-share-message-option">
                <button type="button" className="ax-share-message-link" onClick={() => showToast('Messaggio opzionale – disponibile a breve')}>
                  Aggiungi un messaggio
                </button>
              </div>
            </div>
            <div className="ax-create-folder-modal-footer">
              <button type="button" className="ax-create-folder-btn ax-create-folder-btn-primary" disabled={!shareModalEmail.trim()} onClick={() => { showToast('Condivisione richiesta'); setShareModal(null); setShareModalPermissionOpen(false) }}>
                Condividi
              </button>
              <button type="button" className="ax-create-folder-btn ax-create-folder-btn-secondary" onClick={() => { setShareModal(null); setShareModalPermissionOpen(false) }}>Annulla</button>
            </div>
          </div>
        </div>
      )}

      {/* Modale Rinomina file — stile progetto (rinomina cartella è inline in tabella) */}
      {renameModal && (
        <div className="ax-create-folder-overlay" onClick={() => setRenameModal(null)} role="dialog" aria-modal="true" aria-labelledby="ax-rename-title">
          <div className="ax-create-folder-modal" onClick={(e) => e.stopPropagation()} style={{ minWidth: 360 }}>
            <div className="ax-create-folder-modal-header">
              <h2 id="ax-rename-title" className="ax-create-folder-modal-title">Rinomina</h2>
              <button type="button" className="ax-create-folder-modal-close" onClick={() => setRenameModal(null)} aria-label="Chiudi">
                <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div className="ax-create-folder-modal-body">
              <label className="ax-create-folder-label" htmlFor="ax-rename-input">Nome</label>
              <input
                id="ax-rename-input"
                type="text"
                className="ax-create-folder-input"
                value={renameModalValue}
                onChange={(e) => setRenameModalValue(e.target.value)}
                placeholder="Nuovo nome"
                disabled={renameModal.type === 'file'}
              />
              {renameModal.type === 'file' && (
                <p style={{ fontSize: 12, color: 'var(--ax-muted)', marginTop: 12 }}>La rinomina dei file sarà disponibile a breve.</p>
              )}
            </div>
            <div className="ax-create-folder-modal-footer">
              {renameModal.type === 'folder' ? (
                <>
                  <button type="button" className="ax-create-folder-btn ax-create-folder-btn-primary" disabled={!renameModalValue.trim()} onClick={() => { handleRenameFolder(renameModal.id, renameModalValue); setRenameModal(null); setRenameModalValue('') }}>
                    Rinomina
                  </button>
                  <button type="button" className="ax-create-folder-btn ax-create-folder-btn-secondary" onClick={() => { setRenameModal(null); setRenameModalValue('') }}>Annulla</button>
                </>
              ) : (
                <button type="button" className="ax-create-folder-btn ax-create-folder-btn-secondary" style={{ flex: 1 }} onClick={() => setRenameModal(null)}>Chiudi</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modale Sposta — stile progetto */}
      {moveModal && (
        <div className="ax-create-folder-overlay" onClick={() => !moveModalMoving && setMoveModal(null)} role="dialog" aria-modal="true" aria-labelledby="ax-move-title">
          <div className="ax-create-folder-modal" onClick={(e) => e.stopPropagation()} style={{ minWidth: 360, maxWidth: 420 }}>
            <div className="ax-create-folder-modal-header">
              <h2 id="ax-move-title" className="ax-create-folder-modal-title">Sposta</h2>
              <button type="button" className="ax-create-folder-modal-close" onClick={() => !moveModalMoving && setMoveModal(null)} aria-label="Chiudi" disabled={moveModalMoving}>
                <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div className="ax-create-folder-modal-body">
              {console.log('[MOVE MODAL] folders disponibili:', folders?.length, folders)}
              <p style={{ fontSize: 13, color: 'var(--ax-muted)', marginBottom: 12 }}>
                {moveModal.items.length === 1
                  ? `Destinazione per "${moveModal.items[0].name}"`
                  : `Destinazione per ${moveModal.items.length} elementi`}
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
                  .filter((f) => !moveModal.items.some((i) => i.type === 'folder' && i.id === f.id))
                  .map((folder) => {
                    const folderName = decryptedFolderNames[folder.id] ?? folder.name_encrypted
                    return (
                      <button
                        key={folder.id}
                        type="button"
                        disabled={moveModalMoving}
                        onClick={() => handleMoveToDestination(folder.id)}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 12px', border: 'none', borderRadius: 8, background: 'transparent', cursor: moveModalMoving ? 'not-allowed' : 'pointer', fontFamily: 'inherit', fontSize: 13, color: 'var(--ax-text)', textAlign: 'left' }}
                      >
                        <Image src={getFolderIconByIndex(folderIconPref[folder.id] ?? 1)} alt="" width={20} height={18} style={{ objectFit: 'contain' }} />
                        {folderName}
                      </button>
                    )
                  })}
              </div>
              {moveModalMoving && <p style={{ fontSize: 12, color: 'var(--ax-blue)', marginTop: 8 }}>Spostamento in corso...</p>}
            </div>
            <div className="ax-create-folder-modal-footer">
              <button type="button" className="ax-create-folder-btn ax-create-folder-btn-secondary" style={{ flex: 1 }} onClick={() => !moveModalMoving && setMoveModal(null)} disabled={moveModalMoving}>Annulla</button>
            </div>
          </div>
        </div>
      )}

      {versionModalFile && (
        <VersionHistory
          fileId={versionModalFile.fileId}
          fileName={versionModalFile.fileName}
          onClose={() => setVersionModalFile(null)}
        />
      )}

      {uploadVersionFile && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(30,58,95,0.25)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
          }}
          onClick={(e) => e.target === e.currentTarget && setUploadVersionFile(null)}
        >
          <div
            className="ax-dash-card"
            style={{ maxWidth: 420, padding: 24, boxShadow: '0 8px 32px rgba(30,58,95,0.15)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="ax-dash-page-title" style={{ fontSize: 18, marginBottom: 16 }}>Carica nuova versione: {uploadVersionFile.fileName}</h3>
            <form onSubmit={handleUploadNewVersion}>
              <div className="ax-login-field">
                <input
                  ref={versionFileInputRef}
                  type="file"
                  required
                  data-testid="upload-version-file-input"
                />
              </div>
              <div className="ax-login-field">
                <label className="ax-login-field-label" htmlFor="version-comment">Nota versione (opzionale)</label>
                <input
                  id="version-comment"
                  className="ax-dash-input"
                  type="text"
                  value={versionComment}
                  onChange={(e) => setVersionComment(e.target.value)}
                  placeholder="es. Correzioni finali"
                  style={{ width: '100%', marginTop: 6 }}
                  data-testid="version-comment-input"
                />
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                <button type="submit" className="ax-dash-btn-primary" disabled={cryptoLoading}>Carica</button>
                <button type="button" className="ax-dash-btn-secondary" onClick={() => { setUploadVersionFile(null); setVersionComment(''); }}>Annulla</button>
              </div>
            </form>
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

            <div className="ax-preview-modal-toolbar">
              <div className="ax-preview-toolbar-left">
                <button type="button" className="ax-preview-toolbar-btn" onClick={closePreview} aria-label="Home">
                  <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>
                  Home
                </button>
                <button
                  type="button"
                  className="ax-preview-toolbar-btn"
                  onClick={async () => {
                    if (!previewFileId) return
                    try {
                      if (isRunningInTauri()) {
                        const blob = await downloadAndDecrypt(previewFileId)
                        if (!blob) return
                        const url = URL.createObjectURL(blob)
                        const a = document.createElement('a')
                        a.href = url
                        const name = previewFileId ? (decryptedNames[previewFileId] ?? previewName) : 'file'
                        a.download = name
                        document.body.appendChild(a)
                        a.click()
                        document.body.removeChild(a)
                        setTimeout(() => URL.revokeObjectURL(url), 1000)
                        return
                      }
                      // Browser: scarica cifrato
                      const { data } = await filesApi.download(previewFileId)
                      const encryptedBlob = new Blob([data as ArrayBuffer], { type: 'application/octet-stream' })
                      const url = URL.createObjectURL(encryptedBlob)
                      const a = document.createElement('a')
                      a.href = url
                      const name = previewFileId ? (decryptedNames[previewFileId] ?? previewName) : 'file'
                      a.download = name + '.axs'
                      document.body.appendChild(a)
                      a.click()
                      document.body.removeChild(a)
                      setTimeout(() => URL.revokeObjectURL(url), 1000)
                      showToast('File cifrato scaricato — aprilo con il client desktop AXSHARE')
                    } catch {
                      showToast('Errore durante il download')
                    }
                  }}
                >
                  <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                  Download
                </button>
                <button
                  type="button"
                  className="ax-preview-toolbar-btn"
                  onClick={() => {
                    if (previewFileId) setMoveModal({ items: [{ type: 'file', id: previewFileId, name: previewName }] })
                  }}
                >
                  Sposta in
                </button>
                <button type="button" className="ax-preview-toolbar-btn" onClick={() => showToast('Copia in – disponibile a breve')}>
                  Copia in
                </button>
                <button type="button" className="ax-preview-toolbar-btn" onClick={() => showToast('Aggiunto ai Preferiti')}>
                  Preferito
                </button>
                <button
                  type="button"
                  className="ax-preview-toolbar-btn"
                  onClick={() => {
                    if (!previewFileId) return
                    if (inEvidenza.length >= IN_EVIDENZA_MAX) { showToast(`Massimo ${IN_EVIDENZA_MAX} elementi in evidenza`); return }
                    if (inEvidenza.some((x) => x.id === previewFileId && x.type === 'file')) { showToast('Già in evidenza'); return }
                    const previewFile = visibleFiles.find((f) => f.id === previewFileId)
                    addToInEvidenza({ type: 'file', id: previewFileId, name: previewName, size_bytes: previewFile?.size_bytes, created_at: previewFile?.created_at })
                    showToast('Aggiunto a In Evidenza')
                  }}
                >
                  In Evidenza
                </button>
              </div>
              <div className="ax-preview-toolbar-right">
                <button type="button" className="ax-preview-toolbar-btn" onClick={() => showToast('Modifica – disponibile a breve')}>
                  Modifica
                </button>
                <button
                  type="button"
                  className="ax-preview-toolbar-btn ax-preview-toolbar-btn-primary"
                  onClick={() => previewFileId && setShareModal({ type: 'file', id: previewFileId, name: previewName })}
                >
                  Condividi
                </button>
              </div>
            </div>

            <div className="ax-preview-modal-body">
              {previewType === 'image' && (
                <img src={previewUrl} alt={previewName} />
              )}

              {previewType === 'pdf' && (
                <iframe src={previewUrl} title={previewName} />
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

              {previewType === 'text' && (
                <pre>{previewText}</pre>
              )}

              {previewType === 'unsupported' && (
                <div className="ax-preview-modal-unsupported">
                  <p className="ax-preview-unsupported-name">📁 {previewName}</p>
                  <p>Questo tipo di file può essere aperto solo con il</p>
                  <p className="ax-preview-unsupported-cta">Client Desktop AXSHARE</p>
                  <p className="ax-preview-unsupported-hint">
                    Installa il client desktop per accedere a questo file tramite il disco virtuale cifrato.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══ CONTEXT MENU TASTO DESTRO — renderizzato fuori tabella (portal su body) ══ */}
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
            animation: 'axDropIn 0.15s ease forwards',
          }}
        >
          {/* Intestazione nome */}
          <div style={{ padding: '8px 12px 10px',
            borderBottom: '1px solid var(--ax-surface-2)',
            marginBottom: 4 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ax-navy)',
              whiteSpace: 'nowrap', overflow: 'hidden',
              textOverflow: 'ellipsis', maxWidth: 180 }}>
              {contextMenu.name}
            </div>
          </div>

          {/* Cambia icona cartella — solo per type === 'folder' */}
          {contextMenu.type === 'folder' && (
            <div style={{ padding: '4px 0 6px', borderBottom: '1px solid var(--ax-surface-2)', marginBottom: 4 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ax-muted)', padding: '4px 12px 6px' }}>
                Icona cartella
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '0 12px' }}>
                {FOLDER_ICON_OPTIONS.map((opt) => (
                  <button
                    key={opt.index}
                    type="button"
                    onClick={() => { setFolderIcon(contextMenu.id, opt.index); showToast(`Icona ${opt.label}`); setContextMenu(null) }}
                    className="context-menu-icon-btn"
                    style={{
                      width: 36, height: 36, borderRadius: 8, border: `2px solid ${opt.color}`,
                      background: 'var(--ax-surface-1)', cursor: 'pointer', padding: 4,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                    title={opt.label}
                  >
                    <Image src={getFolderIconByIndex(opt.index)} alt={opt.label} width={28} height={24} style={{ objectFit: 'contain', pointerEvents: 'none' }} />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Voci menu */}
          {([
            {
              icon: (
                <svg width="14" height="14" fill="none" viewBox="0 0 24 24"
                  stroke="currentColor" strokeWidth="2">
                  <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" />
                  <circle cx="18" cy="19" r="3" />
                  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                  <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                </svg>
              ),
              label: 'Condividi',
              action: () => { setShareModal({ type: contextMenu.type, id: contextMenu.id, name: contextMenu.name }); setShareModalEmail(''); setShareModalLevel('read') },
            },
            {
              icon: (
                <svg width="14" height="14" fill="none" viewBox="0 0 24 24"
                  stroke="currentColor" strokeWidth="2">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
              ),
              label: 'Copia collegamento',
              action: () => {
                const url = contextMenu.type === 'file'
                  ? `${typeof window !== 'undefined' ? window.location.origin : ''}/files/${contextMenu.id}`
                  : `${typeof window !== 'undefined' ? window.location.origin : ''}/dashboard?folder=${contextMenu.id}`
                navigator.clipboard.writeText(url)
                showToast('Link copiato negli appunti!')
              },
            },
            {
              icon: (
                <svg width="14" height="14" fill="none" viewBox="0 0 24 24"
                  stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              ),
              label: 'Scarica',
              action: () => {
                if (contextMenu.type === 'file') {
                  const f = visibleFiles.find((f) => f.id === contextMenu.id)
                  if (f) void handleDownloadFile(f)
                } else {
                  const folder = filteredFolders.find((f) => f.id === contextMenu.id)
                  if (folder) void handleDownloadFolder(folder)
                }
              },
            },
            {
              icon: (
                <svg width="14" height="14" fill="none" viewBox="0 0 24 24"
                  stroke="currentColor" strokeWidth="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              ),
              label: 'Rinomina',
              action: () => {
                setRenameModal({ type: contextMenu.type, id: contextMenu.id, name: contextMenu.name })
                setRenameModalValue(contextMenu.name)
              },
            },
            {
              icon: (
                <svg width="14" height="14" fill="none" viewBox="0 0 24 24"
                  stroke="currentColor" strokeWidth="2">
                  <polyline points="5 9 2 12 5 15" /><polyline points="9 5 12 2 15 5" /><polyline points="15 19 12 22 9 19" /><polyline points="19 9 22 12 19 15" /><line x1="2" y1="12" x2="22" y2="12" /><line x1="12" y1="2" x2="12" y2="22" />
                </svg>
              ),
              label: 'Sposta',
              action: () => { setMoveModal({ items: [{ type: contextMenu.type, id: contextMenu.id, name: contextMenu.name }] }) },
            },
            {
              icon: (
                <svg width="14" height="14" fill="none" viewBox="0 0 24 24"
                  stroke="currentColor" strokeWidth="2">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              ),
              label: 'Aggiungi a In Evidenza',
              action: () => {
                if (inEvidenza.length >= IN_EVIDENZA_MAX) { showToast(`Massimo ${IN_EVIDENZA_MAX} elementi in evidenza`); return }
                if (contextMenu.type === 'folder') {
                  if (inEvidenza.some((x) => x.id === contextMenu.id && x.type === 'folder')) { showToast('Già in evidenza'); return }
                  addToInEvidenza({ type: 'folder', id: contextMenu.id, name: contextMenu.name, folderIconIndex: folderIconPref[contextMenu.id] ?? 1 })
                } else {
                  if (inEvidenza.some((x) => x.id === contextMenu.id && x.type === 'file')) { showToast('Già in evidenza'); return }
                  const ctxFile = visibleFiles.find((f) => f.id === contextMenu.id)
                  addToInEvidenza({ type: 'file', id: contextMenu.id, name: contextMenu.name, size_bytes: ctxFile?.size_bytes, created_at: ctxFile?.created_at })
                }
                showToast('Aggiunto a In Evidenza')
              },
            },
          ] as Array<{ icon: React.ReactNode; label: string; action: () => void; show?: boolean }>)
            .filter((item) => item.show !== false)
            .map((item) => (
              <div
                key={item.label}
                onClick={() => { item.action(); setContextMenu(null) }}
                style={{ display: 'flex', alignItems: 'center', gap: 10,
                  padding: '9px 12px', borderRadius: 8, fontSize: 13,
                  fontWeight: 500, color: 'var(--ax-text)', cursor: 'pointer',
                  transition: 'background 0.12s' }}
                onMouseEnter={(e) =>
                  (e.currentTarget as HTMLDivElement).style.background =
                    'var(--ax-surface-1)'}
                onMouseLeave={(e) =>
                  (e.currentTarget as HTMLDivElement).style.background = 'transparent'}
              >
                <span style={{ color: 'var(--ax-muted)', display: 'flex' }}>
                  {item.icon}
                </span>
                {item.label}
              </div>
            ))
          }

          {/* Separatore */}
          <div style={{ height: 1, background: 'var(--ax-surface-2)', margin: '4px 0' }} />

          {/* Elimina — rosso */}
          <div
            onClick={() => {
              if (contextMenu.type === 'file') handleDelete(contextMenu.id)
              else handleDeleteFolder(contextMenu.id)
              setContextMenu(null)
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 10,
              padding: '9px 12px', borderRadius: 8, fontSize: 13,
              fontWeight: 500, color: 'var(--ax-error)', cursor: 'pointer',
              transition: 'background 0.12s' }}
            onMouseEnter={(e) =>
              (e.currentTarget as HTMLDivElement).style.background =
                'rgba(239,68,68,0.06)'}
            onMouseLeave={(e) =>
              (e.currentTarget as HTMLDivElement).style.background = 'transparent'}
          >
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24"
              stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6M14 11v6" />
            </svg>
            Elimina
          </div>
        </div>,
        document.body
      )}

      {/* TOAST — identico al mockup */}
      <div className={`ax-dash-toast${toast ? ' show' : ''}`} role="status" aria-live="polite">
        {toast ?? ''}
      </div>
    </div>
  )
}
