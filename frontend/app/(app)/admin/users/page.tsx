'use client'

import { useState, useEffect } from 'react'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'

interface AdminUser {
  id: string
  email: string
  role: string
  is_active: boolean
  created_at: string
  gdpr_erasure_requested_at?: string | null
  is_anonymized?: boolean
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [isLoading, setIsLoading] = useState(false)
  const [search, setSearch] = useState('')
  const PAGE_SIZE = 20

  function getAuthToken(): string {
    if (typeof window === 'undefined') return ''
    return localStorage.getItem('axshare_access_token') ?? ''
  }

  async function fetchUsers(p = 1, q = search) {
    setIsLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(p),
        page_size: String(PAGE_SIZE),
        ...(q && { search: q }),
      })
      const resp = await fetch(`${API_BASE}/users/?${params}`, {
        headers: {
          Authorization: `Bearer ${getAuthToken()}`,
        },
      })
      const data = (await resp.json()) as {
        users?: AdminUser[]
        total?: number
      }
      setUsers(data.users ?? [])
      setTotal(data.total ?? 0)
      setPage(p)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchUsers()
  }, [])

  async function toggleActive(userId: string, currentActive: boolean) {
    const action = currentActive ? 'deactivate' : 'activate'
    await fetch(`${API_BASE}/users/${userId}/${action}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${getAuthToken()}`,
      },
    })
    fetchUsers(page)
  }

  async function processErasure(requestId: string) {
    if (
      !confirm(
        'Elaborare la richiesta di erasure GDPR? Irreversibile.'
      )
    )
      return
    await fetch(`${API_BASE}/gdpr/admin/process-erasure/${requestId}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${getAuthToken()}`,
      },
    })
    fetchUsers(page)
  }

  async function runRetentionCleanup() {
    if (
      !confirm(
        'Avviare retention cleanup? Eliminerà dati oltre la soglia.'
      )
    )
      return
    const resp = await fetch(`${API_BASE}/gdpr/admin/retention-cleanup`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${getAuthToken()}`,
      },
    })
    const data = (await resp.json()) as { summary?: unknown }
    alert(`Cleanup completato: ${JSON.stringify(data.summary ?? data)}`)
  }

  return (
    <div>
      <h1>Gestione utenti</h1>

      <div>
        <label htmlFor="user-search">Cerca utente</label>
        <input
          id="user-search"
          data-testid="user-search-input"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="email o ID"
        />
        <button
          type="button"
          data-testid="search-users-button"
          onClick={() => fetchUsers(1, search)}
        >
          Cerca
        </button>
        <button
          type="button"
          data-testid="retention-cleanup-button"
          onClick={runRetentionCleanup}
        >
          Esegui retention cleanup GDPR
        </button>
      </div>

      {isLoading && <p>Caricamento...</p>}

      {total > 0 && (
        <p data-testid="users-total">{total} utenti totali</p>
      )}

      <table data-testid="users-table">
        <thead>
          <tr>
            <th>Email</th>
            <th>Ruolo</th>
            <th>Attivo</th>
            <th>Creato</th>
            <th>Erasure</th>
            <th>Azioni</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} data-testid="user-row" data-user-id={u.id}>
              <td data-testid="user-email">{u.email}</td>
              <td>{u.role}</td>
              <td>{u.is_active ? 'Sì' : 'No'}</td>
              <td>{new Date(u.created_at).toLocaleDateString('it')}</td>
              <td>
                {u.gdpr_erasure_requested_at
                  ? `Richiesta il ${new Date(u.gdpr_erasure_requested_at).toLocaleDateString('it')}`
                  : '—'}
              </td>
              <td>
                <button
                  type="button"
                  data-testid={`toggle-active-${u.id}`}
                  onClick={() => toggleActive(u.id, u.is_active)}
                >
                  {u.is_active ? 'Disattiva' : 'Attiva'}
                </button>
                {u.gdpr_erasure_requested_at && !u.is_anonymized && (
                  <button
                    type="button"
                    data-testid={`process-erasure-${u.id}`}
                    onClick={() => processErasure(u.id)}
                  >
                    Processa erasure
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {total > PAGE_SIZE && (
        <div data-testid="pagination">
          <button
            type="button"
            data-testid="prev-page"
            disabled={page <= 1}
            onClick={() => fetchUsers(page - 1)}
          >
            Precedente
          </button>
          <span>
            Pagina {page} di {Math.ceil(total / PAGE_SIZE)}
          </span>
          <button
            type="button"
            data-testid="next-page"
            disabled={page >= Math.ceil(total / PAGE_SIZE)}
            onClick={() => fetchUsers(page + 1)}
          >
            Successiva
          </button>
        </div>
      )}
    </div>
  )
}
