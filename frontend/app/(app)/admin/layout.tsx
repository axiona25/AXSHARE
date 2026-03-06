'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuthContext } from '@/context/AuthContext'

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { user, isLoading } = useAuthContext()
  const router = useRouter()

  useEffect(() => {
    if (!isLoading && (!user || user.role !== 'admin')) {
      router.replace('/dashboard')
    }
  }, [user, isLoading, router])

  if (isLoading) return <p data-testid="admin-layout-loading">Caricamento...</p>
  if (!user || user.role !== 'admin') return null

  return (
    <div>
      <nav data-testid="admin-nav">
        <strong>ADMIN</strong>
        <span> | </span>
        <Link href="/admin" data-testid="admin-nav-home">Dashboard</Link>
        <span> | </span>
        <Link href="/admin/audit" data-testid="admin-nav-audit">Audit Log</Link>
        <span> | </span>
        <Link href="/admin/users" data-testid="admin-nav-users">Utenti</Link>
        <span> | </span>
        <Link href="/dashboard" data-testid="admin-nav-back">App</Link>
      </nav>
      <hr />
      {children}
    </div>
  )
}
