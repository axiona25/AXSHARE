'use client'

import { useState, useCallback, useEffect } from 'react'
import useSWR from 'swr'
import { signaturesApi, filesApi } from '@/lib/api'
import { signFile } from '@/lib/signing'
import { signingKeyManager } from '@/lib/signingKeys'
import { useAuthContext } from '@/context/AuthContext'

export interface SignatureInfo {
  id: string
  version: number
  signerEmail?: string
  signerId?: string
  algorithm: string
  isValid: boolean | null
  verifiedAt?: string
  createdAt: string
}

interface UseSigningResult {
  signatures: SignatureInfo[]
  isLoading: boolean
  isSigning: boolean
  isVerifying: boolean
  hasSigningKey: boolean
  error: string | null
  signFileAction: (fileId: string, passphrase: string) => Promise<boolean>
  verifySignature: (fileId: string, version: number) => Promise<boolean | null>
  clearError: () => void
}

export function useSigning(fileId: string): UseSigningResult {
  const { user } = useAuthContext()
  const [isSigning, setIsSigning] = useState(false)
  const [isVerifying, setIsVerifying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasSigningKey, setHasSigningKey] = useState<boolean>(false)

  const { data: signaturesData, isLoading, mutate } = useSWR(
    fileId ? `/files/${fileId}/signatures` : null,
    () => signaturesApi.list(fileId).then((r) => r.data),
    { revalidateOnFocus: false }
  )

  const checkSigningKey = useCallback(async () => {
    if (!user) return
    const has = await signingKeyManager.hasKeys(user.id)
    setHasSigningKey(has)
  }, [user])

  useEffect(() => {
    checkSigningKey()
  }, [checkSigningKey])

  const signFileAction = useCallback(
    async (fileIdParam: string, passphrase: string): Promise<boolean> => {
      if (!user) {
        setError('Utente non autenticato')
        return false
      }
      setIsSigning(true)
      setError(null)
      try {
        const fileResp = await filesApi.download(fileIdParam)
        const raw = fileResp.data as ArrayBuffer
        const encryptedBytes = new Uint8Array(raw)

        const metaResp = await filesApi.get(fileIdParam)
        const version = (metaResp.data as { current_version?: number })
          ?.current_version ?? 1

        const sigResult = await signFile(
          encryptedBytes,
          fileIdParam,
          version,
          user.id,
          passphrase
        )

        await signaturesApi.sign(fileIdParam, {
          version,
          signature_b64: sigResult.signatureB64,
          file_hash_sha256: sigResult.fileHashSha256,
          public_key_pem_snapshot: sigResult.publicKeyPemSnapshot,
          algorithm: sigResult.algorithm,
        })

        await mutate()
        return true
      } catch (e: unknown) {
        const msg =
          e && typeof e === 'object' && 'message' in e
            ? String((e as { message: unknown }).message)
            : 'Errore durante la firma'
        setError(msg)
        return false
      } finally {
        setIsSigning(false)
      }
    },
    [user, mutate]
  )

  const verifySignature = useCallback(
    async (
      fileIdParam: string,
      version: number
    ): Promise<boolean | null> => {
      setIsVerifying(true)
      setError(null)
      try {
        const resp = await signaturesApi.verify(fileIdParam, version)
        await mutate()
        return (resp.data as { is_valid: boolean }).is_valid
      } catch (e: unknown) {
        const msg =
          e && typeof e === 'object' && 'message' in e
            ? String((e as { message: unknown }).message)
            : 'Errore durante la verifica'
        setError(msg)
        return null
      } finally {
        setIsVerifying(false)
      }
    },
    [mutate]
  )

  const signatures: SignatureInfo[] = ((signaturesData as unknown[]) ?? []).map(
    (value: unknown) => {
      const s = value as Record<string, unknown>
      return {
        id: String(s.id),
        version: Number(s.version),
        signerEmail: s.signer_email as string | undefined,
        signerId: s.signer_id as string | undefined,
        algorithm: String(s.algorithm ?? ''),
        isValid: s.is_valid as boolean | null,
        verifiedAt: s.verified_at as string | undefined,
        createdAt: String(s.created_at ?? ''),
      }
    }
  )

  return {
    signatures,
    isLoading,
    isSigning,
    isVerifying,
    hasSigningKey,
    error,
    signFileAction,
    verifySignature,
    clearError: () => setError(null),
  }
}
