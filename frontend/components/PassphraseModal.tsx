'use client'

import { useState } from 'react'

interface Props {
  title?: string
  onConfirm: (passphrase: string) => void
  onCancel: () => void
}

export function PassphraseModal({
  title = 'Inserisci passphrase',
  onConfirm,
  onCancel,
}: Props) {
  const [passphrase, setPassphrase] = useState('')

  return (
    <dialog open data-testid="passphrase-modal">
      <h3>{title}</h3>
      <p>Inserisci la tua passphrase per procedere.</p>
      <div>
        <label htmlFor="modal-passphrase">Passphrase</label>
        <input
          id="modal-passphrase"
          data-testid="passphrase-input"
          type="password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          autoFocus
          autoComplete="current-password"
        />
      </div>
      <button
        type="button"
        data-testid="confirm-passphrase"
        onClick={() => onConfirm(passphrase)}
        disabled={!passphrase}
      >
        Conferma
      </button>
      <button
        type="button"
        data-testid="cancel-passphrase"
        onClick={onCancel}
      >
        Annulla
      </button>
    </dialog>
  )
}
