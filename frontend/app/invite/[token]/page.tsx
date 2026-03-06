'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { guestApi } from '@/lib/api'

export default function InvitePage() {
  const params = useParams<{ token: string }>()
  const token = (Array.isArray(params.token) ? params.token[0] : params.token) ?? ''
  const router = useRouter()
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  async function handleRedeem() {
    setStatus('loading')
    try {
      const { data } = await guestApi.redeemInvite(token)
      if (typeof window !== 'undefined') {
        localStorage.setItem('guest_token', data.access_token)
        localStorage.setItem('guest_files', JSON.stringify(data.accessible_files ?? []))
      }
      setStatus('success')
      setTimeout(() => router.push('/guest/dashboard'), 1500)
    } catch {
      setStatus('error')
      setErrorMsg('Invito non valido, scaduto o già utilizzato.')
    }
  }

  return (
    <main data-testid="invite-page">
      <h1>AXSHARE — Invito accesso file</h1>

      {status === 'idle' && (
        <div>
          <p>Hai ricevuto un invito per accedere a dei file condivisi.</p>
          <p>Cliccando il pulsante otterrai un accesso temporaneo ai file.</p>
          <button
            type="button"
            data-testid="redeem-button"
            onClick={handleRedeem}
          >
            Accetta invito
          </button>
        </div>
      )}

      {status === 'loading' && (
        <p data-testid="redeem-loading">Riscatto invito in corso...</p>
      )}

      {status === 'success' && (
        <div data-testid="redeem-success">
          <h2>Invito accettato!</h2>
          <p>Redirect in corso alla tua area file...</p>
        </div>
      )}

      {status === 'error' && (
        <div data-testid="redeem-error">
          <h2>Errore</h2>
          <p role="alert">{errorMsg}</p>
          <Link href="/" data-testid="invite-home-link">Torna alla home</Link>
        </div>
      )}
    </main>
  )
}
