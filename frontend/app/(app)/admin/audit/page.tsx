'use client'

import { useState } from 'react'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'

interface AuditLogEntry {
  id: string
  created_at: string
  actor_email?: string
  action: string
  resource_type?: string
  resource_id?: string
  outcome: string
  ip_address?: string
}

export default function AdminAuditPage() {
  const [filters, setFilters] = useState({
    action: '',
    outcome: '',
    resource_type: '',
    date_from: '',
    date_to: '',
  })
  const [logs, setLogs] = useState<AuditLogEntry[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [isLoading, setIsLoading] = useState(false)
  const PAGE_SIZE = 50

  function getAuthToken(): string {
    if (typeof window === 'undefined') return ''
    return localStorage.getItem('axshare_access_token') ?? ''
  }

  async function fetchLogs(p = 1) {
    setIsLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(p),
        page_size: String(PAGE_SIZE),
        ...(filters.action && { action: filters.action }),
        ...(filters.outcome && { outcome: filters.outcome }),
        ...(filters.resource_type && { resource_type: filters.resource_type }),
        ...(filters.date_from && { date_from: filters.date_from }),
        ...(filters.date_to && { date_to: filters.date_to }),
      })
      const resp = await fetch(`${API_BASE}/audit/logs?${params}`, {
        headers: {
          Authorization: `Bearer ${getAuthToken()}`,
        },
      })
      const data = (await resp.json()) as { logs?: AuditLogEntry[]; total?: number }
      setLogs(data.logs ?? [])
      setTotal(data.total ?? 0)
      setPage(p)
    } finally {
      setIsLoading(false)
    }
  }

  async function exportCsv() {
    const params = new URLSearchParams()
    if (filters.action) params.set('action', filters.action)
    if (filters.outcome) params.set('outcome', filters.outcome)
    if (filters.resource_type) params.set('resource_type', filters.resource_type)
    if (filters.date_from) params.set('date_from', filters.date_from)
    if (filters.date_to) params.set('date_to', filters.date_to)
    const resp = await fetch(`${API_BASE}/audit/logs/export/csv?${params}`, {
      headers: {
        Authorization: `Bearer ${getAuthToken()}`,
      },
    })
    const blob = await resp.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'audit_log.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleFilter(e: React.FormEvent) {
    e.preventDefault()
    fetchLogs(1)
  }

  return (
    <div>
      <h1>Audit Log</h1>

      <form onSubmit={handleFilter} data-testid="audit-filter-form">
        <div>
          <label htmlFor="filter-action">Azione (es. file.*, auth.login)</label>
          <input
            id="filter-action"
            data-testid="filter-action"
            value={filters.action}
            onChange={(e) =>
              setFilters((f) => ({ ...f, action: e.target.value }))
            }
            placeholder="es. file.* o auth.login"
          />
        </div>
        <div>
          <label htmlFor="filter-outcome">Esito</label>
          <select
            id="filter-outcome"
            data-testid="filter-outcome"
            value={filters.outcome}
            onChange={(e) =>
              setFilters((f) => ({ ...f, outcome: e.target.value }))
            }
          >
            <option value="">Tutti</option>
            <option value="success">Successo</option>
            <option value="failure">Fallimento</option>
            <option value="denied">Negato</option>
          </select>
        </div>
        <div>
          <label htmlFor="filter-resource-type">Tipo risorsa</label>
          <input
            id="filter-resource-type"
            data-testid="filter-resource-type"
            value={filters.resource_type}
            onChange={(e) =>
              setFilters((f) => ({ ...f, resource_type: e.target.value }))
            }
            placeholder="es. file, user"
          />
        </div>
        <div>
          <label htmlFor="filter-date-from">Da data</label>
          <input
            id="filter-date-from"
            data-testid="filter-date-from"
            type="datetime-local"
            value={filters.date_from}
            onChange={(e) =>
              setFilters((f) => ({ ...f, date_from: e.target.value }))
            }
          />
        </div>
        <div>
          <label htmlFor="filter-date-to">A data</label>
          <input
            id="filter-date-to"
            data-testid="filter-date-to"
            type="datetime-local"
            value={filters.date_to}
            onChange={(e) =>
              setFilters((f) => ({ ...f, date_to: e.target.value }))
            }
          />
        </div>
        <button type="submit" data-testid="apply-filters-button">
          Applica filtri
        </button>
        <button
          type="button"
          onClick={exportCsv}
          data-testid="export-csv-button"
        >
          Esporta CSV
        </button>
      </form>

      <hr />

      {isLoading && <p>Caricamento...</p>}

      {!isLoading && logs.length === 0 && (
        <p data-testid="no-logs">
          Nessun evento. Applica i filtri per cercare.
        </p>
      )}

      {total > 0 && (
        <p data-testid="logs-total">
          {total} eventi totali — pagina {page} di{' '}
          {Math.ceil(total / PAGE_SIZE)}
        </p>
      )}

      <table data-testid="audit-table">
        <thead>
          <tr>
            <th>Data</th>
            <th>Utente</th>
            <th>Azione</th>
            <th>Risorsa</th>
            <th>Esito</th>
            <th>IP</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <tr key={log.id} data-testid="audit-row">
              <td>{new Date(log.created_at).toLocaleString('it')}</td>
              <td>{log.actor_email ?? '[deleted]'}</td>
              <td>{log.action}</td>
              <td>
                {log.resource_type} {log.resource_id ?? ''}
              </td>
              <td>{log.outcome}</td>
              <td>{log.ip_address ?? ''}</td>
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
            onClick={() => fetchLogs(page - 1)}
          >
            Precedente
          </button>
          <span>Pagina {page}</span>
          <button
            type="button"
            data-testid="next-page"
            disabled={page >= Math.ceil(total / PAGE_SIZE)}
            onClick={() => fetchLogs(page + 1)}
          >
            Successiva
          </button>
        </div>
      )}
    </div>
  )
}
