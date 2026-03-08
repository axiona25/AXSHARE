'use client'

/** Tipo di badge condivisione: Privato (né link né condivisioni), Pubblico (ha collegamento), Team (condiviso con utenti interni). */
export type ShareBadgeType = 'privato' | 'pubblico' | 'team'

const BADGE_CONFIG: Record<
  ShareBadgeType,
  { label: string; className: string; icon: React.ReactNode }
> = {
  privato: {
    label: 'Privato',
    className: 'share-badge share-private',
    icon: (
      <svg className="share-badge-icon" width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="11" width="18" height="11" rx="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    ),
  },
  pubblico: {
    label: 'Pubblico',
    className: 'share-badge share-shared',
    icon: (
      <svg className="share-badge-icon" width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  team: {
    label: 'Team',
    className: 'share-badge share-team',
    icon: (
      <svg className="share-badge-icon" width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path d="M20 6L9 17l-5-5" />
      </svg>
    ),
  },
}

export interface ShareBadgeProps {
  type: ShareBadgeType
}

export function ShareBadge({ type }: ShareBadgeProps) {
  const { label, className, icon } = BADGE_CONFIG[type]
  return (
    <span className={className}>
      {icon}
      {label}
    </span>
  )
}

/**
 * Calcola il tipo di badge da mostrare:
 * - Pubblico se c'è almeno un collegamento attivo (solo per file).
 * - Team se ci sono condivisioni con utenti interni (permessi).
 * - Privato altrimenti.
 */
export function getShareBadgeType(options: {
  hasLink: boolean
  hasTeamShare: boolean
  isFolder?: boolean
}): ShareBadgeType {
  const { hasLink, hasTeamShare, isFolder } = options
  if (hasLink) return 'pubblico'
  if (hasTeamShare) return 'team'
  return 'privato'
}
