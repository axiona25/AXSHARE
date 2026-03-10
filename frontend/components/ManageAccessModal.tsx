'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { permissionsApi } from '@/lib/api'
import type { Permission } from '@/types'

const LEVEL_LABEL: Record<string, string> = {
  read: 'Lettura',
  write: 'Scrittura',
  share: 'Condivisione',
  admin: 'Amministratore',
}

const LEVEL_OPTIONS: { value: string; label: string }[] = [
  { value: 'read', label: 'Lettura' },
  { value: 'write', label: 'Scrittura' },
]

function getInitials(email: string | null | undefined, displayName: string | null | undefined): string {
  if (displayName?.trim()) {
    const parts = displayName.trim().split(/\s+/).filter(Boolean)
    if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase()
    return (displayName.slice(0, 2) || '?').toUpperCase()
  }
  if (email?.trim()) {
    const part = email.split('@')[0]?.trim() || ''
    return (part.slice(0, 2) || '?').toUpperCase()
  }
  return '?'
}

function formatExpiresAt(expiresAt: string | null | undefined): string {
  if (expiresAt == null || !expiresAt) return '—'
  const d = new Date(expiresAt)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Valori modificabili per un permesso (draft). */
export interface PermissionDraft {
  level?: string
  block_delete?: boolean
  block_link?: boolean
  require_pin?: boolean
  expires_at?: string | null
}

function getMinDateTomorrow(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toISOString().split('T')[0]!
}

function permToDraft(perm: Permission): PermissionDraft {
  const exp =
    perm.expires_at && typeof perm.expires_at === 'string'
      ? perm.expires_at
      : (perm as { expires_at?: string }).expires_at
  return {
    level: perm.level,
    block_delete: perm.block_delete ?? false,
    block_link: perm.block_link ?? false,
    require_pin: perm.require_pin ?? false,
    expires_at: exp ?? null,
  }
}

function draftDiffersFromPerm(draft: PermissionDraft, perm: Permission): boolean {
  const exp = perm.expires_at && typeof perm.expires_at === 'string' ? perm.expires_at : (perm as { expires_at?: string }).expires_at
  if (draft.level !== undefined && draft.level !== perm.level) return true
  if (draft.block_delete !== undefined && draft.block_delete !== (perm.block_delete ?? false)) return true
  if (draft.block_link !== undefined && draft.block_link !== (perm.block_link ?? false)) return true
  if (draft.require_pin !== undefined && draft.require_pin !== (perm.require_pin ?? false)) return true
  const draftDate = draft.expires_at ?? null
  const permDate = exp ?? null
  if (draftDate !== permDate) return true
  return false
}

export interface ManageAccessModalProps {
  resourceType: 'file' | 'folder'
  resourceId: string
  resourceName: string
  onClose: () => void
  onRevoked?: () => void
  onUpdated?: () => void
  showToast?: (message: string) => void
}

export function ManageAccessModal({
  resourceType,
  resourceId,
  resourceName,
  onClose,
  onRevoked,
  onUpdated,
  showToast,
}: ManageAccessModalProps) {
  const [list, setList] = useState<Permission[]>([])
  const [loading, setLoading] = useState(true)
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, PermissionDraft>>({})
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set())
  const [saveErrorById, setSaveErrorById] = useState<Record<string, string>>({})

  const hasChanges = useMemo(() => {
    return list.some((perm) => {
      const draft = drafts[perm.id]
      return draft && draftDiffersFromPerm(draft, perm)
    })
  }, [list, drafts])

  const load = useCallback(async () => {
    setLoading(true)
    setDrafts({})
    setSaveErrorById({})
    try {
      const res = await permissionsApi.listForResource(
        resourceType === 'file' ? { resourceFileId: resourceId } : { resourceFolderId: resourceId }
      )
      setList(Array.isArray(res.data) ? res.data : [])
    } catch {
      setList([])
    } finally {
      setLoading(false)
    }
  }, [resourceType, resourceId])

  useEffect(() => {
    void load()
  }, [load])

  const getEffectiveDraft = useCallback((perm: Permission): PermissionDraft => {
    const base = permToDraft(perm)
    const d = drafts[perm.id]
    return d ? { ...base, ...d } : base
  }, [drafts])

  const setDraft = useCallback((permId: string, updates: Partial<PermissionDraft>) => {
    setDrafts((prev) => {
      const next = { ...prev }
      const current = next[permId] ?? {}
      next[permId] = { ...current, ...updates }
      return next
    })
    setSaveErrorById((prev) => {
      const next = { ...prev }
      delete next[permId]
      return next
    })
  }, [])

  const handleRevoke = useCallback(
    async (perm: Permission) => {
      if (confirmRevokeId !== perm.id) {
        setConfirmRevokeId(perm.id)
        return
      }
      setRevokingId(perm.id)
      try {
        await permissionsApi.revoke(perm.id)
        setList((prev) => prev.filter((p) => p.id !== perm.id))
        setDrafts((prev) => {
          const next = { ...prev }
          delete next[perm.id]
          return next
        })
        setConfirmRevokeId(null)
        showToast?.('Accesso revocato')
        onRevoked?.()
      } catch {
        showToast?.('Errore durante la revoca')
      } finally {
        setRevokingId(null)
      }
    },
    [confirmRevokeId, onRevoked, showToast]
  )

  const handleSaveChanges = useCallback(async () => {
    const toSave = list.filter((perm) => {
      const draft = drafts[perm.id]
      return draft && draftDiffersFromPerm(draft, perm)
    })
    if (toSave.length === 0) return
    setSavingIds((prev) => new Set([...Array.from(prev), ...toSave.map((p) => p.id)]))
    setSaveErrorById({})
    let anyOk = false
    for (const perm of toSave) {
      const draft = drafts[perm.id]!
      try {
        await permissionsApi.update(perm.id, {
          ...(draft.level !== undefined && { level: draft.level }),
          ...(draft.block_delete !== undefined && { block_delete: draft.block_delete }),
          ...(draft.block_link !== undefined && { block_link: draft.block_link }),
          ...(draft.require_pin !== undefined && { require_pin: draft.require_pin }),
          ...(draft.expires_at !== undefined && { expires_at: draft.expires_at }),
        })
        setDrafts((prev) => {
          const next = { ...prev }
          delete next[perm.id]
          return next
        })
        anyOk = true
      } catch {
        setSaveErrorById((prev) => ({ ...prev, [perm.id]: 'Errore durante il salvataggio' }))
      }
    }
    setSavingIds((prev) => {
      const next = new Set(prev)
      toSave.forEach((p) => next.delete(p.id))
      return next
    })
    if (anyOk) {
      await load()
      showToast?.('Modifiche salvate')
      onUpdated?.()
    }
  }, [list, drafts, load, showToast, onUpdated])

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-labelledby="manage-access-title"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="rounded-xl shadow-xl border border-[var(--ax-blue)] max-h-[85vh] flex flex-col"
        style={{
          background: 'var(--ax-navy-900, #0D2645)',
          minWidth: 480,
          maxWidth: 560,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-white/10">
          <h2 id="manage-access-title" className="text-lg font-semibold text-white">
            Gestisci accessi — {resourceName || (resourceType === 'file' ? 'File' : 'Cartella')}
          </h2>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <p className="text-sm text-gray-400">Caricamento...</p>
          ) : list.length === 0 ? (
            <p className="text-sm text-gray-400">Nessun utente con accesso.</p>
          ) : (
            <ul className="space-y-4">
              {list.map((perm) => {
                const email = perm.subject_user_email ?? ''
                const displayName = perm.subject_user_display_name ?? ''
                const label = displayName.trim() || email || 'Utente'
                const initials = getInitials(email, displayName)
                const isConfirming = confirmRevokeId === perm.id
                const isRevoking = revokingId === perm.id
                const effective = getEffectiveDraft(perm)
                const isSaving = savingIds.has(perm.id)
                const errorMsg = saveErrorById[perm.id]
                const expiresAtStr =
                  effective.expires_at != null && effective.expires_at !== ''
                    ? (typeof effective.expires_at === 'string'
                        ? effective.expires_at.slice(0, 10)
                        : new Date(effective.expires_at as unknown as string).toISOString().slice(0, 10))
                    : ''

                return (
                  <li
                    key={perm.id}
                    className="p-4 rounded-lg border border-white/10 bg-white/5 space-y-3"
                  >
                    <div className="flex items-center gap-4">
                      <span
                        className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0"
                        style={{ background: 'var(--ax-blue)', color: '#fff' }}
                      >
                        {initials}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate">{label}</p>
                        {email && email !== label && (
                          <p className="text-xs text-gray-400 truncate">{email}</p>
                        )}
                      </div>
                      <div className="flex-shrink-0">
                        {isConfirming ? (
                          <span className="flex items-center gap-2">
                            <button
                              type="button"
                              className="text-xs px-3 py-1.5 rounded border border-red-500/50 text-red-400 hover:bg-red-500/20 transition-colors"
                              onClick={() => setConfirmRevokeId(null)}
                            >
                              Annulla
                            </button>
                            <button
                              type="button"
                              disabled={isRevoking}
                              className="text-xs px-3 py-1.5 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
                              onClick={() => void handleRevoke(perm)}
                            >
                              {isRevoking ? '...' : 'Conferma revoca'}
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            disabled={isRevoking}
                            className="text-xs px-3 py-1.5 rounded border border-red-500/60 text-red-400 hover:bg-red-500/20 disabled:opacity-50 transition-colors"
                            onClick={() => void handleRevoke(perm)}
                          >
                            Revoca
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3 pl-14">
                      <div className="flex flex-wrap items-center gap-4">
                        <label className="flex items-center gap-2 text-sm text-gray-300">
                          <span>Livello:</span>
                          <select
                            value={effective.level ?? 'read'}
                            onChange={(e) => setDraft(perm.id, { level: e.target.value })}
                            className="rounded border border-white/20 bg-white/10 text-white text-sm px-2 py-1.5 min-w-[120px]"
                          >
                            {LEVEL_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="flex items-center gap-2 text-sm text-gray-300">
                          <input
                            type="checkbox"
                            checked={effective.block_delete ?? false}
                            onChange={(e) => setDraft(perm.id, { block_delete: e.target.checked })}
                            className="rounded"
                          />
                          Non può eliminare
                        </label>
                        <label className="flex items-center gap-2 text-sm text-gray-300">
                          <input
                            type="checkbox"
                            checked={effective.block_link ?? false}
                            onChange={(e) => setDraft(perm.id, { block_link: e.target.checked })}
                            className="rounded"
                          />
                          Non può creare link
                        </label>
                        <label className="flex items-center gap-2 text-sm text-gray-300">
                          <input
                            type="checkbox"
                            checked={effective.require_pin ?? false}
                            onChange={(e) => setDraft(perm.id, { require_pin: e.target.checked })}
                            className="rounded"
                          />
                          Richiedi PIN
                        </label>
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="text-sm text-gray-300">Scadenza:</label>
                        <input
                          type="date"
                          min={getMinDateTomorrow()}
                          value={expiresAtStr}
                          onChange={(e) =>
                            setDraft(perm.id, {
                              expires_at: e.target.value ? e.target.value : null,
                            })
                          }
                          className="rounded border border-white/20 bg-white/10 text-white text-sm px-2 py-1.5"
                        />
                        <span className="text-xs text-gray-500">(vuoto = nessuna scadenza)</span>
                      </div>
                      {errorMsg && (
                        <p className="text-xs text-red-400" role="alert">
                          {errorMsg}
                        </p>
                      )}
                    </div>
                    {isSaving && (
                      <p className="text-xs text-amber-400 pl-14">Salvataggio in corso...</p>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        <div className="px-6 py-4 border-t border-white/10 flex justify-between items-center gap-4">
          <div />
          <div className="flex gap-3">
            {hasChanges && (
              <button
                type="button"
                onClick={() => void handleSaveChanges()}
                disabled={savingIds.size > 0}
                className="px-4 py-2 rounded-lg bg-[var(--ax-blue)] text-white hover:opacity-90 disabled:opacity-50 transition-opacity font-medium"
              >
                Salva modifiche
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-white/20 text-white hover:bg-white/10 transition-colors"
            >
              Chiudi
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
