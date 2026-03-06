'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/hooks/useAuth'

export default function RegisterPage() {
  const router = useRouter()
  const { startRegistration, startLogin, isLoading, error, clearError } = useAuth()

  const [email, setEmail] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    clearError()

    const registered = await startRegistration(email)
    if (!registered) return

    const loggedIn = await startLogin(email)
    if (loggedIn) {
      router.push('/setup-keys')
    }
  }

  return (
    <main>
      <h1>AXSHARE</h1>
      <h2>Crea un account</h2>

      {error && (
        <p data-testid="error-message" role="alert">
          {error}
        </p>
      )}

      <form onSubmit={handleSubmit} data-testid="register-form">
        <div>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            data-testid="email-input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            placeholder="email@esempio.com"
          />
        </div>

        <button
          type="submit"
          data-testid="register-button"
          disabled={isLoading}
        >
          {isLoading ? 'Registrazione...' : 'Registrati'}
        </button>
      </form>

      <hr />
      <p>
        Hai già un account?{' '}
        <Link href="/login" data-testid="login-link">
          Accedi
        </Link>
      </p>
    </main>
  )
}
