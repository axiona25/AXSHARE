'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import useSWR from 'swr'
import { useFiles, useFolders, useFileMutations } from '@/hooks/useFiles'
import { useCrypto } from '@/hooks/useCrypto'
import { useSubmitLock, useUploadQueue } from '@/hooks/useRateLimit'
import { searchApi } from '@/lib/api'
import { OnboardingBanner } from '@/components/OnboardingBanner'
import { PassphraseModal } from '@/components/PassphraseModal'
import type { FileItem, Folder } from '@/types'

export default function DashboardPage() {
  const router = useRouter()
  const t = useTranslations('dashboard')
  const [currentFolderId, setCurrentFolderId] = useState<string | undefined>()
  const [breadcrumb, setBreadcrumb] = useState<{ id: string; name: string }[]>([])

  const { files, isLoading: filesLoading, revalidate: reloadFiles } = useFiles(currentFolderId)
  const { folders, isLoading: foldersLoading, revalidate: reloadFolders } = useFolders(currentFolderId)
  const { deleteFile, createFolder } = useFileMutations()
  const { uploadFile, downloadAndDecrypt, isLoading: cryptoLoading, error: cryptoError } = useCrypto()
  const { lock: lockUpload, isLocked: uploadLocked } = useSubmitLock(1500)
  const { startUpload, activeUploads, canUpload } = useUploadQueue()

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploadStatus, setUploadStatus] = useState('')
  const [newFolderName, setNewFolderName] = useState('')

  const [modal, setModal] = useState<{
    action: 'upload' | 'download'
    file?: File
    fileId?: string
    fileName?: string
  } | null>(null)

  const [searchQuery, setSearchQuery] = useState('')
  const { data: searchData, isLoading: searchLoading } = useSWR(
    searchQuery.trim() ? ['/search/files', searchQuery] : null,
    () => searchApi.searchFiles({ page: 1, page_size: 100 }).then((r) => r.data)
  )
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

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setModal({ action: 'upload', file })
  }

  async function handleUpload(passphrase: string) {
    const file = modal?.file
    const folderId = currentFolderId
    if (!file) return
    setModal(null)
    await lockUpload(async () =>
      startUpload(async () => {
        setUploadStatus('Upload in corso...')
        try {
          await uploadFile({ file, folderId, passphrase })
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

  function requestDownload(file: FileItem) {
    setModal({
      action: 'download',
      fileId: file.id,
      fileName: file.name_encrypted,
    })
  }

  async function handleDownload(passphrase: string) {
    if (!modal?.fileId) return
    const fileName = modal.fileName ?? 'download'
    setModal(null)
    try {
      const blob = await downloadAndDecrypt(modal.fileId, passphrase)
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      alert('Errore durante il download.')
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

  const isLoading = filesLoading || foldersLoading

  return (
    <div>
      <OnboardingBanner />

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
          <p data-testid="crypto-error" role="alert">{cryptoError}</p>
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
          {searchResults.length === 0 && !searchLoading && (
            <p data-testid="search-no-results">Nessun risultato.</p>
          )}
          <ul>
            {searchResults.map((file) => (
              <li key={file.id} data-testid="search-result-item">
                <span>{file.name_encrypted}</span>
                <button type="button" onClick={() => requestDownload(file)}>Scarica</button>
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
          {isLoading && <p>Caricamento...</p>}
          {!isLoading && files.length === 0 && (
            <p data-testid="empty-state">{t('empty')}</p>
          )}
          <ul>
            {files.map((file) => (
              <li key={file.id} data-testid="file-item">
                <span data-testid={`file-name-${file.id}`}>
                  {file.name_encrypted}
                </span>
                <span> — {file.size_bytes} bytes</span>
                <button
                  type="button"
                  data-testid={`download-${file.id}`}
                  onClick={() => requestDownload(file)}
                  disabled={file.is_destroyed}
                >
                  Scarica
                </button>
                <button
                  type="button"
                  data-testid={`details-${file.id}`}
                  onClick={() => router.push(`/files/${file.id}`)}
                >
                  Dettagli
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
            ))}
          </ul>
        </section>
      )}

      {modal && (
        <PassphraseModal
          title={modal.action === 'upload' ? 'Passphrase per cifrare' : 'Passphrase per decifrare'}
          onConfirm={modal.action === 'upload' ? handleUpload : handleDownload}
          onCancel={() => setModal(null)}
        />
      )}
    </div>
  )
}
