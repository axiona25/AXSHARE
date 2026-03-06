/**
 * Hooks per gestione gruppi:
 * - useGroups: lista gruppi dell'utente
 * - useGroupMutations: crea, aggiungi membro, rimuovi membro, condividi file
 */

'use client'

import useSWR, { mutate } from 'swr'
import { useCallback } from 'react'
import { groupsApi, filesApi } from '@/lib/api'
import type { Group } from '@/types'

export function useGroups() {
  const { data, error, isLoading, mutate: revalidate } =
    useSWR<Group[]>('/groups/')

  return {
    groups: data ?? [],
    isLoading,
    error,
    revalidate,
  }
}

export function useGroupMutations() {
  const createGroup = useCallback(
    async (name: string, description?: string) => {
      const { data } = await groupsApi.create(name, description)
      await mutate('/groups/')
      return data.id
    },
    []
  )

  const addMember = useCallback(
    async (
      groupId: string,
      userId: string,
      encryptedGroupKey: string
    ) => {
      await groupsApi.addMember(groupId, userId, encryptedGroupKey)
      await mutate('/groups/')
    },
    []
  )

  const removeMember = useCallback(
    async (groupId: string, userId: string) => {
      await groupsApi.removeMember(groupId, userId)
      await mutate('/groups/')
    },
    []
  )

  const shareFileWithGroup = useCallback(
    async (
      fileId: string,
      groupId: string,
      fileKeyEncryptedForGroup: string,
      level: 'read' | 'write' = 'read'
    ) => {
      const { data } = await filesApi.shareWithGroup(
        fileId,
        groupId,
        fileKeyEncryptedForGroup,
        level
      )
      return data
    },
    []
  )

  return {
    createGroup,
    addMember,
    removeMember,
    shareFileWithGroup,
  }
}
