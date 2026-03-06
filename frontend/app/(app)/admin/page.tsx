'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useAdminDashboard, useTimeSeries } from '@/hooks/useReports'
import type { UserSummary } from '@/lib/api'

export default function AdminDashboardPage() {
  const { dashboard, isLoading } = useAdminDashboard()
  const [metric, setMetric] = useState<'uploads' | 'downloads' | 'logins'>('uploads')
  const [days, setDays] = useState(30)
  const { series } = useTimeSeries(metric, days)

  if (isLoading) return <p data-testid="admin-loading">Caricamento...</p>

  return (
    <div>
      <h1>Admin Dashboard</h1>

      <section data-testid="system-stats">
        <h2>Statistiche sistema</h2>
        <dl>
          <dt>Utenti totali</dt>
          <dd data-testid="stat-total-users">
            {dashboard?.total_users ?? 0}
          </dd>
          <dt>Utenti attivi (30gg)</dt>
          <dd data-testid="stat-active-users">
            {dashboard?.active_users_last_30d ?? 0}
          </dd>
          <dt>File totali</dt>
          <dd data-testid="stat-total-files">
            {dashboard?.total_files ?? 0}
          </dd>
          <dt>Storage totale</dt>
          <dd data-testid="stat-total-storage">
            {dashboard?.total_storage_gb != null
              ? dashboard.total_storage_gb.toFixed(2)
              : '0'}{' '}
            GB
          </dd>
        </dl>
      </section>

      <hr />

      <section data-testid="top-users-section">
        <h2>Top utenti per storage</h2>
        {(!dashboard?.top_users || dashboard.top_users.length === 0) && (
          <p>Nessun dato.</p>
        )}
        <table data-testid="top-users-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>File</th>
              <th>Storage (MB)</th>
            </tr>
          </thead>
          <tbody>
            {dashboard?.top_users?.map((u: UserSummary) => (
              <tr key={u.user_id} data-testid="top-user-row">
                <td>{u.email}</td>
                <td>{u.total_files}</td>
                <td>
                  {((u.total_size_bytes ?? 0) / 1_048_576).toFixed(1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <hr />

      <section data-testid="timeseries-section">
        <h2>Attività nel tempo</h2>
        <div>
          <label htmlFor="metric-select">Metrica</label>
          <select
            id="metric-select"
            data-testid="metric-select"
            value={metric}
            onChange={(e) =>
              setMetric(e.target.value as 'uploads' | 'downloads' | 'logins')
            }
          >
            <option value="uploads">Upload</option>
            <option value="downloads">Download</option>
            <option value="logins">Login</option>
          </select>
          <label htmlFor="days-select">Periodo</label>
          <select
            id="days-select"
            data-testid="days-select"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            <option value={7}>7 giorni</option>
            <option value={30}>30 giorni</option>
            <option value={90}>90 giorni</option>
          </select>
        </div>
        <table data-testid="timeseries-table">
          <thead>
            <tr>
              <th>Data</th>
              <th>Conteggio</th>
            </tr>
          </thead>
          <tbody>
            {series?.points?.map((p: { date: string; value: number }) => (
              <tr key={p.date} data-testid="timeseries-row">
                <td>{p.date}</td>
                <td>{p.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <hr />

      <section data-testid="admin-actions">
        <h2>Azioni</h2>
        <ul>
          <li>
            <Link href="/admin/audit" data-testid="link-audit">
              Visualizza Audit Log completo
            </Link>
          </li>
          <li>
            <Link href="/admin/users" data-testid="link-users">
              Gestisci utenti
            </Link>
          </li>
        </ul>
      </section>
    </div>
  )
}
