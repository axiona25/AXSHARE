'use client'

import { useSigning, type SignatureInfo } from '@/hooks/useSigning'
import { ShieldCheck, ShieldAlert, FileSignature } from 'lucide-react'

interface SignatureBadgeProps {
  fileId: string
  onSignClick?: (fileId: string) => void
  onVerifyClick?: (fileId: string, version: number) => void
  className?: string
}

export function SignatureBadge({
  fileId,
  onSignClick,
  onVerifyClick,
  className = '',
}: SignatureBadgeProps) {
  const {
    signatures,
    isLoading,
    isSigning,
    isVerifying,
    hasSigningKey,
    error,
    signFileAction,
    verifySignature,
    clearError,
  } = useSigning(fileId)

  const hasSignatures = signatures.length > 0
  const allVerified = hasSignatures && signatures.every((s) => s.isValid === true)
  const someUnverified =
    hasSignatures && signatures.some((s) => s.isValid === null || s.isValid === false)

  if (isLoading && !hasSignatures) {
    return (
      <span
        className={`inline-flex items-center gap-1 text-xs text-gray-500 ${className}`}
      >
        <FileSignature className="h-3.5 w-3.5" />
        Firma...
      </span>
    )
  }

  return (
    <div className={`inline-flex flex-col gap-1 ${className}`}>
      <div className="inline-flex items-center gap-2 flex-wrap">
        {hasSignatures && allVerified && (
          <span
            className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-100 dark:bg-green-900/30 dark:text-green-400 px-1.5 py-0.5 rounded"
            title="File firmato e verificato"
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            Firmato
          </span>
        )}
        {hasSignatures && someUnverified && (
          <span
            className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400 px-1.5 py-0.5 rounded"
            title="Firma da verificare"
          >
            <ShieldAlert className="h-3.5 w-3.5" />
            Da verificare
          </span>
        )}
        {!hasSignatures && hasSigningKey && onSignClick && (
          <button
            type="button"
            onClick={() => onSignClick(fileId)}
            disabled={isSigning}
            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 px-1.5 py-0.5 rounded hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-50"
          >
            <FileSignature className="h-3.5 w-3.5" />
            {isSigning ? 'Firma in corso...' : 'Firma file'}
          </button>
        )}
      </div>
      {signatures.length > 0 && (
        <ul className="text-xs text-gray-600 dark:text-gray-400 list-none pl-0 space-y-0.5">
          {signatures.map((s: SignatureInfo) => (
            <li key={s.id} className="flex items-center gap-2">
              <span>v{s.version}</span>
              {s.isValid === true && (
                <span className="text-green-600 dark:text-green-500">Verificata</span>
              )}
              {s.isValid === false && (
                <span className="text-red-600 dark:text-red-500">Non valida</span>
              )}
              {(s.isValid === null || s.isValid === false) && onVerifyClick && (
                <button
                  type="button"
                  onClick={() => {
                    verifySignature(fileId, s.version)
                    onVerifyClick(fileId, s.version)
                  }}
                  disabled={isVerifying}
                  className="text-blue-600 hover:underline disabled:opacity-50"
                >
                  {isVerifying ? 'Verifica...' : 'Verifica'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">
          {error}
          <button
            type="button"
            onClick={clearError}
            className="ml-1 underline hover:no-underline"
          >
            Chiudi
          </button>
        </p>
      )}
    </div>
  )
}
