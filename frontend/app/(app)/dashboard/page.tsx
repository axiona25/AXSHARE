'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import useSWR, { mutate } from 'swr'
import { useAuthContext } from '@/context/AuthContext'
import { useFiles, useFolders, useFileMutations } from '@/hooks/useFiles'
import { useCrypto } from '@/hooks/useCrypto'
import { useFileEvents } from '@/hooks/useFileEvents'
import { useSubmitLock, useUploadQueue } from '@/hooks/useRateLimit'
import { searchApi } from '@/lib/api'
import { OnboardingBanner } from '@/components/OnboardingBanner'
import { VersionHistory } from '@/components/VersionHistory'
import { isRunningInTauri } from '@/lib/tauri'
import { getAccessTokenSecure } from '@/lib/auth'
import type { FileItem, Folder, RootFileItem } from '@/types'

export default function DashboardPage() {
  const router = useRouter()
  const t = useTranslations('dashboard')
  const [currentFolderId, setCurrentFolderId] = useState<string | undefined>()
  const [breadcrumb, setBreadcrumb] = useState<{ id: string; name: string }[]>([])

  const { files, isLoading: filesLoading, error: filesError, revalidate: reloadFiles } = useFiles(currentFolderId)
  const { folders, isLoading: foldersLoading, error: foldersError, revalidate: reloadFolders } = useFolders(currentFolderId)
  const { deleteFile, createFolder } = useFileMutations()
  const { user, hasSessionKey } = useAuthContext()
  const { uploadFile, uploadNewVersion, downloadAndDecrypt, decryptFileNames, decryptFileNamesAndKeys, isLoading: cryptoLoading, error: cryptoError, clearError: clearCryptoError } = useCrypto()
  const { lock: lockUpload, isLocked: uploadLocked } = useSubmitLock(1500)
  const { startUpload, activeUploads, canUpload } = useUploadQueue()

  const fileInputRef = useRef<HTMLInputElement>(null)
  const currentFolderIdRef = useRef(currentFolderId)
  currentFolderIdRef.current = currentFolderId
  const tempFileTimeoutsRef = useRef<Map<string, { timeout: ReturnType<typeof setTimeout>; filePath: string }>>(new Map())
  const prevDiskFileIdsRef = useRef<string>('')
  const [uploadStatus, setUploadStatus] = useState('')
  const [newFolderName, setNewFolderName] = useState('')

  const [decryptedNames, setDecryptedNames] = useState<Record<string, string>>({})

  const [showPreview, setShowPreview] = useState(false)
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
  const { data: searchData, error: searchError, isLoading: searchLoading } = useSWR(
    searchQuery.trim() ? ['/search/files', searchQuery] : null,
    () => searchApi.searchFiles({ page: 1, page_size: 100 }).then((r) => r.data)
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
  const searchResultsRaw = (searchData?.items ?? []) as FileItem[]
  const searchResults = searchQuery.trim()
    ? searchResultsRaw.filter((f) =>
        f.name_encrypted?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : searchResultsRaw

  function openFolder(folder: Folder) {
    setBreadcrumb((prev) => [...prev, { id: folder.id, name: folder.name_encrypted }])
    setCurrentFolderId(folder.id)
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

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    await lockUpload(async () =>
      startUpload(async () => {
        setUploadStatus('Upload in corso...')
        try {
          await uploadFile({ file, folderId: currentFolderId })
          setUploadStatus('Upload completato.')
          reloadFiles()
          reloadFolders()
        } catch {
          setUploadStatus('Errore durante upload.')
        }
      }),
    )
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  useFileEvents((event) => {
    if (
      event.type === 'file_created' ||
      event.type === 'file_deleted' ||
      event.type === 'file_updated'
    ) {
      reloadFiles()
      reloadFolders()
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
      pdf: 'application/pdf',
      txt: 'text/plain',
      md: 'text/markdown',
      json: 'application/json',
      js: 'application/javascript',
      ts: 'text/plain',
      html: 'text/html',
      css: 'text/css',
      csv: 'text/csv',
      docx:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xlsx:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      pptx:
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      zip: 'application/zip',
      mp4: 'video/mp4',
      mp3: 'audio/mpeg',
    }
    return map[ext] ?? 'application/octet-stream'
  }

  function closePreview() {
    setShowPreview(false)
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
    try {
      const blob = await downloadAndDecrypt(file.id)
      if (!blob) return

      if (isRunningInTauri()) {
        await openWithNativeApp(blob, file, decryptedNames)
        return
      }

      const mimeType = blob.type || 'application/octet-stream'
      console.log('[PREVIEW] MIME type blob:', blob.type)
      console.log('[PREVIEW] Nome file:', decryptedNames[file.id])

      const fileName = decryptedNames[file.id] ?? ''
      const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
      const effectiveMime =
        mimeType === 'application/octet-stream' || !mimeType
          ? extensionToMime(ext)
          : mimeType

      const url = URL.createObjectURL(blob)
      const displayName = decryptedNames[file.id] ?? file.name_encrypted ?? file.id

      if (effectiveMime.startsWith('image/')) {
        setPreviewUrl(url)
        setPreviewType('image')
        setPreviewName(displayName)
        setShowPreview(true)
        return
      }
      if (effectiveMime === 'application/pdf') {
        setPreviewUrl(url)
        setPreviewType('pdf')
        setPreviewName(displayName)
        setShowPreview(true)
        return
      }
      const textLike =
        effectiveMime.startsWith('text/') ||
        effectiveMime === 'application/json' ||
        effectiveMime === 'application/javascript' ||
        effectiveMime === 'application/xml'
      if (textLike) {
        const text = await blob.text()
        setPreviewText(text)
        setPreviewType('text')
        setPreviewName(displayName)
        setShowPreview(true)
        URL.revokeObjectURL(url)
        return
      }
      URL.revokeObjectURL(url)
      setPreviewType('unsupported')
      setPreviewName(displayName)
      setShowPreview(true)
    } catch {
      alert('Errore durante l\'apertura.')
    }
  }

  async function handleCreateFolder(e: React.FormEvent) {
    e.preventDefault()
    if (!newFolderName.trim()) return
    await createFolder(newFolderName, currentFolderId)
    setNewFolderName('')
    reloadFolders()
  }

  async function handleDelete(fileId: string) {
    if (!confirm("Eliminare il file? L'operazione è irreversibile.")) return
    await deleteFile(fileId, currentFolderId)
    reloadFiles()
  }

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
    }
  }

  return (
    <div>
      <OnboardingBanner />

      {!user?.has_public_key && (
        <div
          style={{
            background: '#ff980015',
            border: '1px solid #ff9800',
            borderRadius: 8,
            padding: '12px 16px',
            marginBottom: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
          }}
          data-testid="pin-not-configured-banner"
        >
          <span style={{ color: '#ff9800' }}>
            ⚠️ PIN di sicurezza non configurato. I tuoi file non sono ancora protetti.
          </span>
          <button
            type="button"
            onClick={() => router.push('/settings/security')}
            style={{
              background: '#ff9800',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '6px 12px',
              cursor: 'pointer',
              fontWeight: 600,
            }}
            data-testid="configure-pin-button"
          >
            Configura PIN
          </button>
        </div>
      )}

      <h1>{t('title')}</h1>

      <nav data-testid="breadcrumb">
        <button type="button" onClick={() => navigateBreadcrumb(-1)} data-testid="breadcrumb-root">
          Root
        </button>
        {breadcrumb.map((crumb, i) => (
          <span key={crumb.id}>
            {' / '}
            <button type="button" onClick={() => navigateBreadcrumb(i)} data-testid={`breadcrumb-${crumb.id}`}>
              {crumb.name}
            </button>
          </span>
        ))}
      </nav>

      <div>
        <label htmlFor="search">{t('search')}</label>
        <input
          id="search"
          data-testid="search-input"
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Nome, tag, tipo..."
        />
        {searchLoading && <span data-testid="search-loading">Ricerca...</span>}
      </div>

      {autoSaveMessage && (
        <p data-testid="auto-save-message" style={{ color: '#4CAF50', marginBottom: 8 }}>
          {autoSaveMessage}
        </p>
      )}
      <div data-testid="upload-section">
        <input
          ref={fileInputRef}
          data-testid="file-input"
          type="file"
          onChange={handleFileSelect}
          disabled={uploadLocked || !canUpload}
        />
        {!canUpload && (
          <p data-testid="upload-queue-full">
            {activeUploads} upload in corso (max 3 simultanei)
          </p>
        )}
        {uploadStatus && (
          <p data-testid="upload-status">{uploadStatus}</p>
        )}
        {cryptoError && (
          <p data-testid="crypto-error" role="alert">
            {cryptoError}
            <button type="button" onClick={clearCryptoError} style={{ marginLeft: 8 }}>Chiudi</button>
          </p>
        )}
      </div>

      <form onSubmit={handleCreateFolder} data-testid="new-folder-form">
        <input
          data-testid="folder-name-input"
          type="text"
          value={newFolderName}
          onChange={(e) => setNewFolderName(e.target.value)}
          placeholder={t('new_folder')}
        />
        <button type="submit" data-testid="create-folder-button">
          {t('new_folder')}
        </button>
      </form>

      <hr />

      {searchQuery.trim() && (
        <section data-testid="search-results">
          <h2>Risultati ricerca</h2>
          {visibleSearchResults.length === 0 && !searchLoading && (
            <p data-testid="search-no-results">Nessun risultato.</p>
          )}
          <ul>
            {visibleSearchResults.map((file) => (
              <li key={file.id} data-testid="search-result-item">
                <span
                  role="button"
                  tabIndex={0}
                  onClick={() => handleOpen(file)}
                  onKeyDown={(e) => e.key === 'Enter' && handleOpen(file)}
                  className="cursor-pointer underline"
                >
                  {decryptedNames[file.id] ?? file.name_encrypted}
                </span>
                <button type="button" onClick={() => router.push(`/files/${file.id}`)}>
                  Dettagli
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!searchQuery.trim() && (
        <section data-testid="folder-list">
          <h2>{t('folders')}</h2>
          {folders.length === 0 && !foldersLoading && (
            <p>Nessuna cartella.</p>
          )}
          <ul>
            {folders.map((folder) => (
              <li key={folder.id} data-testid="folder-item">
                <button
                  type="button"
                  data-testid={`open-folder-${folder.id}`}
                  onClick={() => openFolder(folder)}
                >
                  {folder.name_encrypted}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!searchQuery.trim() && (
        <section data-testid="file-list">
          <h2>{t('files')}</h2>
          {showListLoading && <p>Caricamento...</p>}
          {!showListLoading && visibleFiles.length === 0 && (
            <p data-testid="empty-state">{t('empty')}</p>
          )}
          <ul>
            {visibleFiles.map((file) => {
              const displayName = decryptedNames[file.id] ?? file.name_encrypted
              const versionNum = (file as RootFileItem).current_version ?? 1
              const sizeVal = (file as { size?: number }).size ?? file.size_bytes ?? 0
              return (
                <li key={file.id} data-testid="file-item">
                  <span
                    data-testid={`file-name-${file.id}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleOpen(file)}
                    onKeyDown={(e) => e.key === 'Enter' && handleOpen(file)}
                    className="cursor-pointer underline"
                  >
                    {displayName}
                  </span>
                  <span> (v{versionNum}) — {sizeVal} bytes</span>
                  {autoSaving[file.id] && (
                    <span style={{ color: '#4CAF50', fontSize: '0.8rem', marginLeft: 8 }}>
                      💾 Salvataggio versione...
                    </span>
                  )}
                  <button
                    type="button"
                    data-testid={`details-${file.id}`}
                    onClick={() => router.push(`/files/${file.id}`)}
                  >
                    Dettagli
                  </button>
                  <button
                    type="button"
                    data-testid={`versions-${file.id}`}
                    onClick={() => setVersionModalFile({ fileId: file.id, fileName: displayName })}
                  >
                    Versioni
                  </button>
                  <button
                    type="button"
                    data-testid={`upload-version-${file.id}`}
                    onClick={() => setUploadVersionFile({ fileId: file.id, fileName: displayName })}
                  >
                    Carica nuova versione
                  </button>
                  <button
                    type="button"
                    data-testid={`delete-${file.id}`}
                    onClick={() => handleDelete(file.id)}
                    disabled={file.is_destroyed}
                  >
                    Elimina
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
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
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
          }}
          onClick={(e) => e.target === e.currentTarget && setUploadVersionFile(null)}
        >
          <div
            style={{
              background: 'var(--background)',
              borderRadius: 8,
              padding: 24,
              maxWidth: 420,
              boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginTop: 0 }}>Carica nuova versione: {uploadVersionFile.fileName}</h3>
            <form onSubmit={handleUploadNewVersion}>
              <div style={{ marginBottom: 12 }}>
                <input
                  ref={versionFileInputRef}
                  type="file"
                  required
                  data-testid="upload-version-file-input"
                />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label htmlFor="version-comment">Nota versione (opzionale)</label>
                <input
                  id="version-comment"
                  type="text"
                  value={versionComment}
                  onChange={(e) => setVersionComment(e.target.value)}
                  placeholder="es. Correzioni finali"
                  style={{ width: '100%', marginTop: 4 }}
                  data-testid="version-comment-input"
                />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="submit" disabled={cryptoLoading}>Carica</button>
                <button type="button" onClick={() => { setUploadVersionFile(null); setVersionComment(''); }}>Annulla</button>
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
            flexDirection: 'column',
            gap: '1rem',
            padding: '2rem',
          }}
        >
          <div
            style={{
              background: '#1a2535',
              borderRadius: '8px',
              padding: '1rem',
              width: '100%',
              maxWidth: '900px',
              maxHeight: '80vh',
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span style={{ color: '#fff', fontWeight: 'bold' }}>{previewName}</span>
              <button
                type="button"
                onClick={closePreview}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#fff',
                  fontSize: '1.5rem',
                  cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </div>

            {previewType === 'image' && (
              <img
                src={previewUrl}
                alt={previewName}
                style={{
                  maxWidth: '100%',
                  maxHeight: '60vh',
                  objectFit: 'contain',
                }}
              />
            )}

            {previewType === 'pdf' && (
              <iframe
                src={previewUrl}
                title={previewName}
                style={{ width: '100%', height: '60vh', border: 'none' }}
              />
            )}

            {previewType === 'text' && (
              <pre
                style={{
                  color: '#ccc',
                  overflowY: 'auto',
                  maxHeight: '60vh',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  margin: 0,
                }}
              >
                {previewText}
              </pre>
            )}

            {previewType === 'unsupported' && (
              <div
                style={{
                  color: '#8ab4d0',
                  textAlign: 'center',
                  padding: '2rem',
                }}
              >
                <p style={{ fontSize: '1.2rem' }}>📁 {previewName}</p>
                <p>Questo tipo di file può essere aperto solo con il</p>
                <p style={{ fontWeight: 'bold', color: '#1974CA' }}>
                  Client Desktop AXSHARE
                </p>
                <p style={{ fontSize: '0.85rem', color: '#6b99bc' }}>
                  Installa il client desktop per accedere a questo file
                  tramite il disco virtuale cifrato.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
