'use client'

import { useRouter, usePathname } from 'next/navigation'

import { useMyDashboard } from '@/hooks/useReports'

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

export function AppSidebar() {
  const router = useRouter()
  const pathname = usePathname() ?? ''
  const { dashboard: storageDashboard } = useMyDashboard()

  const isDashboard = pathname === '/dashboard'
  const isIMieiFile = pathname === '/i-miei-file'
  const isCondivisi = pathname === '/condivisi'
  const isMedia = pathname === '/media'
  const isPreferiti = pathname === '/preferiti'
  const isCestino = pathname === '/cestino'

  return (
    <aside className="sidebar">
      <div className="nav-section-label">Principale</div>
      <div
        className={`nav-item${isDashboard ? ' active' : ''}`}
        onClick={() => router.push('/dashboard')}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); router.push('/dashboard') } }}
      >
        <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" />
        </svg>
        Home
      </div>
      <div
        className={`nav-item${isIMieiFile ? ' active' : ''}`}
        onClick={() => router.push('/i-miei-file')}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); router.push('/i-miei-file') } }}
      >
        <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /><polyline points="2 10 22 10" />
        </svg>
        I miei file
      </div>
      <div className="nav-section-label">Libreria</div>
      <div
        className={`nav-item${isCondivisi ? ' active' : ''}`}
        onClick={() => router.push('/condivisi')}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); router.push('/condivisi') } }}
      >
        <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
        Condivisi
      </div>
      <div
        className={`nav-item${isMedia ? ' active' : ''}`}
        onClick={() => router.push('/media')}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); router.push('/media') } }}
      >
        <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
        Media
      </div>
      <div
        className={`nav-item${isPreferiti ? ' active' : ''}`}
        onClick={() => router.push('/preferiti')}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); router.push('/preferiti') } }}
      >
        <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
        </svg>
        Preferiti
      </div>
      <div className="nav-section-label">Altro</div>
      <div
        className={`nav-item${isCestino ? ' active' : ''}`}
        onClick={() => router.push('/cestino')}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); router.push('/cestino') } }}
      >
        <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" />
        </svg>
        Cestino
      </div>
      <div className="sidebar-footer">
        <div className="storage-label">
          Spazio usato <span className="storage-pct">{storageDashboard?.storage ? Math.min(100, Math.round((storageDashboard.storage.total_size_bytes / (storageDashboard.storage.storage_quota_bytes || 1)) * 100)) : 0}%</span>
        </div>
        <div className="storage-track">
          <div className="storage-fill" style={{ width: `${storageDashboard?.storage ? Math.min(100, (storageDashboard.storage.total_size_bytes / (storageDashboard.storage.storage_quota_bytes || 1)) * 100) : 0}%` }} />
        </div>
        <div className="storage-sub">
          {storageDashboard?.storage
            ? `${formatFileSize(storageDashboard.storage.total_size_bytes)} di ${formatFileSize(storageDashboard.storage.storage_quota_bytes)} usati`
            : '0 B di 1 GB usati'}
        </div>
      </div>
    </aside>
  )
}
