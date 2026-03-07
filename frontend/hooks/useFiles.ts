/**
 * Hooks per gestione file system:
 * - useFiles: lista file in una cartella
 * - useFolders: cartelle root o figlie
 * - useFile: metadati di un singolo file
 * - useFileVersions: versioni di un file
 * - useFileMutations: create folder, delete file, restore version, setSelfDestruct
 */

'use client'

import useSWR, { mutate } from 'swr'
import { useCallback, useEffect } from 'react'
import { filesApi, foldersApi } from '@/lib/api'
import type { FileItem, Folder, FileVersion } from '@/types'

// ─── useFiles ────────────────────────────────────────────────────────────────

export function useFiles(folderId?: string | null) {
  const key =
    folderId != null && folderId !== ''
      ? `/folders/${folderId}/files`
      : '/folders/root/files'
  const { data, error, isLoading, mutate: revalidate } =
    useSWR<FileItem[]>(key)

  useEffect(() => {
    if (key) console.log('[FILES] Fetch lista file...', { key })
  }, [key])
  useEffect(() => {
    if (data) console.log('[FILES] File ricevuti:', data.length)
  }, [data])

  return {
    files: data ?? [],
    isLoading,
    error,
    revalidate,
  }
}

// ─── useFolders ───────────────────────────────────────────────────────────────

export function useFolders(parentId?: string | null) {
  const key = parentId ? `/folders/${parentId}/children` : '/folders/'
  const { data, error, isLoading, mutate: revalidate } =
    useSWR<Folder[]>(key)

  return {
    folders: data ?? [],
    isLoading,
    error,
    revalidate,
  }
}

// ─── useFile ──────────────────────────────────────────────────────────────────

export function useFile(fileId?: string | null) {
  const { data, error, isLoading } = useSWR<FileItem>(
    fileId ? `/files/${fileId}` : null
  )

  return { file: data, isLoading, error }
}

// ─── useFileVersions ─────────────────────────────────────────────────────────

export function useFileVersions(fileId?: string | null) {
  const { data, error, isLoading, mutate: revalidate } = useSWR<FileVersion[]>(
    fileId ? `/files/${fileId}/versions` : null
  )

  return { versions: data ?? [], isLoading, error, revalidate }
}

// ─── useFileMutations ────────────────────────────────────────────────────────

export function useFileMutations() {
  const createFolder = useCallback(
    async (
      nameEncrypted: string,
      parentId?: string,
      folderKeyEncrypted?: string
    ) => {
      const { data } = await foldersApi.create(
        nameEncrypted,
        parentId,
        folderKeyEncrypted
      )
      await mutate(parentId ? `/folders/${parentId}/children` : '/folders/')
      return data.folder_id
    },
    []
  )

  const deleteFile = useCallback(
    async (fileId: string, folderId?: string) => {
      await filesApi.destroy(fileId)
      if (folderId) {
        await mutate(`/folders/${folderId}/files`)
      } else {
        await mutate('/folders/root/files')
      }
    },
    []
  )

  const deleteFolder = useCallback(
    async (folderId: string, parentId?: string) => {
      await foldersApi.destroy(folderId)
      await mutate(parentId ? `/folders/${parentId}/children` : '/folders/')
    },
    []
  )

  const renameFolder = useCallback(
    async (
      folderId: string,
      nameEncrypted: string,
      folderKeyEncrypted?: string,
      parentId?: string
    ) => {
      await foldersApi.rename(folderId, nameEncrypted, folderKeyEncrypted)
      await mutate(parentId ? `/folders/${parentId}/children` : '/folders/')
    },
    []
  )

  const restoreVersion = useCallback(
    async (fileId: string, versionNumber: number) => {
      await filesApi.restoreVersion(fileId, versionNumber)
      await mutate(`/files/${fileId}`)
      await mutate(`/files/${fileId}/versions`)
    },
    []
  )

  const deleteVersion = useCallback(
    async (fileId: string, versionNumber: number) => {
      await filesApi.deleteVersion(fileId, versionNumber)
      await mutate(`/files/${fileId}/versions`)
    },
    []
  )

  const setSelfDestruct = useCallback(
    async (
      fileId: string,
      afterDownloads?: number,
      destructAt?: string
    ) => {
      await filesApi.setSelfDestruct(fileId, afterDownloads, destructAt)
      await mutate(`/files/${fileId}`)
    },
    []
  )

  const moveFile = useCallback(
    async (
      fileId: string,
      targetFolderId: string | null,
      sourceFolderId?: string | null
    ) => {
      await filesApi.move(fileId, targetFolderId)
      const sourceKey =
        sourceFolderId != null && sourceFolderId !== ''
          ? `/folders/${sourceFolderId}/files`
          : '/folders/root/files'
      const targetKey =
        targetFolderId != null && targetFolderId !== ''
          ? `/folders/${targetFolderId}/files`
          : '/folders/root/files'
      await Promise.all([mutate(sourceKey), mutate(targetKey)])
    },
    []
  )

  const moveFolder = useCallback(
    async (
      folderId: string,
      targetParentId: string | null,
      sourceParentId?: string | null
    ) => {
      await foldersApi.move(folderId, targetParentId)
      const sourceKey =
        sourceParentId != null && sourceParentId !== ''
          ? `/folders/${sourceParentId}/children`
          : '/folders/'
      const targetKey =
        targetParentId != null && targetParentId !== ''
          ? `/folders/${targetParentId}/children`
          : '/folders/'
      await Promise.all([mutate(sourceKey), mutate(targetKey)])
    },
    []
  )

  return {
    createFolder,
    deleteFile,
    deleteFolder,
    renameFolder,
    restoreVersion,
    deleteVersion,
    setSelfDestruct,
    moveFile,
    moveFolder,
  }
}
