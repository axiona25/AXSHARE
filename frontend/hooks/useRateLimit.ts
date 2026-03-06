'use client'

import { useRef, useCallback, useState } from 'react'

interface RateLimitOptions {
  /** Millisecondi di cooldown tra un'invocazione e l'altra */
  cooldownMs?: number
  /** Max invocazioni nell'intervallo (default: 1) */
  maxCalls?: number
  /** Messaggio di errore da mostrare */
  errorMessage?: string
}

/**
 * Hook per proteggere da double-submit e spam click.
 *
 * Uso:
 *   const { execute, isLimited, cooldownLeft } = useRateLimit();
 *   const handleSubmit = execute(async () => { ... }, { cooldownMs: 2000 });
 */
export function useRateLimit() {
  const callTimes = useRef<number[]>([])
  const [isLimited, setIsLimited] = useState(false)
  const [cooldownLeft, setCooldownLeft] = useState(0)

  const execute = useCallback(
    <T>(fn: () => Promise<T>, options: RateLimitOptions = {}): (() => Promise<T | null>) => {
      const {
        cooldownMs = 1000,
        maxCalls = 1,
        errorMessage = 'Operazione in corso, attendere...',
      } = options

      return async () => {
        const now = Date.now()
        callTimes.current = callTimes.current.filter((t) => now - t < cooldownMs)

        if (callTimes.current.length >= maxCalls) {
          const oldest = callTimes.current[0]
          const remaining = cooldownMs - (now - oldest)
          setIsLimited(true)
          setCooldownLeft(Math.ceil(remaining / 1000))

          const interval = setInterval(() => {
            setCooldownLeft((prev) => {
              if (prev <= 1) {
                clearInterval(interval)
                setIsLimited(false)
                return 0
              }
              return prev - 1
            })
          }, 1000)

          console.warn(`[RateLimit] ${errorMessage}`)
          return null
        }

        callTimes.current.push(now)
        return fn()
      }
    },
    [],
  )

  return { execute, isLimited, cooldownLeft }
}

/**
 * Hook semplificato per prevenire double-submit su form.
 * Disabilita il pulsante per `lockMs` ms dopo il primo click.
 */
export function useSubmitLock(lockMs = 2000) {
  const [isLocked, setIsLocked] = useState(false)

  const lock = useCallback(
    async <T>(fn: () => Promise<T>): Promise<T | null> => {
      if (isLocked) return null
      setIsLocked(true)
      try {
        return await fn()
      } finally {
        setTimeout(() => setIsLocked(false), lockMs)
      }
    },
    [isLocked, lockMs],
  )

  return { lock, isLocked }
}

/**
 * Protezione upload multipli simultanei.
 * Permette fino a MAX_CONCURRENT upload alla volta.
 */
const MAX_CONCURRENT = 3

export function useUploadQueue() {
  const [activeUploads, setActiveUploads] = useState(0)

  const canUpload = activeUploads < MAX_CONCURRENT

  const startUpload = useCallback(
    async <T>(fn: () => Promise<T>): Promise<T | null> => {
      if (activeUploads >= MAX_CONCURRENT) {
        console.warn(
          `[UploadQueue] Max upload simultanei (${MAX_CONCURRENT}) raggiunto`,
        )
        return null
      }
      setActiveUploads((c) => c + 1)
      try {
        return await fn()
      } finally {
        setActiveUploads((c) => c - 1)
      }
    },
    [activeUploads],
  )

  return { startUpload, activeUploads, canUpload }
}
