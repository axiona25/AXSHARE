'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { isRunningInTauri, onDeepLink } from '@/lib/tauri'

export function DeepLinkListener() {
  const router = useRouter()

  useEffect(() => {
    if (!isRunningInTauri()) return
    let unlisten: (() => void) | undefined
    onDeepLink((path) => {
      router.push(path)
    }).then((fn) => {
      unlisten = fn
    })
    return () => {
      unlisten?.()
    }
  }, [router])

  return null
}
