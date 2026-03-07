'use client'

interface ConfirmModalProps {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'default'
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = 'Conferma',
  cancelLabel = 'Annulla',
  variant = 'default',
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  if (!open) return null

  return (
    <div
      className="ax-confirm-overlay"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ax-confirm-title"
    >
      <div className="ax-confirm-modal" onClick={(e) => e.stopPropagation()} data-testid="confirm-modal">
        <div className="ax-confirm-modal-header">
          <h2 id="ax-confirm-title" className="ax-confirm-modal-title">
            {title}
          </h2>
          <button
            type="button"
            className="ax-confirm-modal-close"
            onClick={onCancel}
            aria-label="Chiudi"
          >
            <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="ax-confirm-modal-body">
          <p className="ax-confirm-modal-message">{message}</p>
        </div>
        <div className="ax-confirm-modal-footer">
          <button
            type="button"
            className="ax-confirm-btn ax-confirm-btn-secondary"
            onClick={onCancel}
            data-testid="confirm-modal-cancel"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`ax-confirm-btn ax-confirm-btn-primary ${variant === 'danger' ? 'ax-confirm-btn-danger' : ''}`}
            onClick={onConfirm}
            data-testid="confirm-modal-confirm"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
