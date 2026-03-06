/**
 * Hooks per gestione permessi:
 * - useFilePermissions: permessi su un file
 * - useExpiringPermissions: permessi in scadenza
 * - usePermissionMutations: grant, revoke
 */

'use client'

import useSWR, { mutate } from 'swr'
import { useCallback } from 'react'
import { permissionsApi } from '@/lib/api'
import type { Permission, PermissionLevel } from '@/types'

export function useFilePermissions(fileId?: string | null) {
  const { data, error, isLoading, mutate: revalidate } = useSWR<
    Permission[]
  >(fileId ? `/permissions/file/${fileId}` : null)

  return {
    permissions: data ?? [],
    isLoading,
    error,
    revalidate,
  }
}

export function useExpiringPermissions(hours = 24) {
  const { data, error, isLoading } = useSWR<Permission[]>(
    `/permissions/expiring-soon?hours=${hours}`
  )

  return { permissions: data ?? [], isLoading, error }
}

export function usePermissionMutations() {
  const grantPermission = useCallback(
    async (params: {
      subjectUserId: string
      resourceFileId?: string
      resourceFolderId?: string
      level: PermissionLevel
      resourceKeyEncrypted?: string
      expiresAt?: string
    }) => {
      const { data } = await permissionsApi.grant({
        subject_user_id: params.subjectUserId,
        resource_file_id: params.resourceFileId,
        resource_folder_id: params.resourceFolderId,
        level: params.level,
        resource_key_encrypted: params.resourceKeyEncrypted,
        expires_at: params.expiresAt,
      })
      if (params.resourceFileId) {
        await mutate(`/permissions/file/${params.resourceFileId}`)
      }
      return data
    },
    []
  )

  const revokePermission = useCallback(
    async (permissionId: string, fileId?: string) => {
      await permissionsApi.revoke(permissionId)
      if (fileId) await mutate(`/permissions/file/${fileId}`)
      await mutate('/permissions/expiring-soon?hours=24')
    },
    []
  )

  return { grantPermission, revokePermission }
}
