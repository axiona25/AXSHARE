'use client'

import React, { useState, useEffect } from 'react'

const STEPS = [
  {
    id: 'keys',
    title: '🔑 Le tue chiavi crittografiche',
    body:
      'I tuoi file vengono cifrati nel browser prima del caricamento. ' +
      "Nessuno — nemmeno noi — può leggere i tuoi file senza la tua passphrase.",
  },
  {
    id: 'upload',
    title: '📤 Come caricare un file',
    body:
      'Clicca su "Scegli file" in dashboard e inserisci la tua passphrase. ' +
      "Il file viene cifrato automaticamente prima dell'invio al server.",
  },
  {
    id: 'share',
    title: '🔗 Condividere in sicurezza',
    body:
      'Puoi creare link di condivisione con password, scadenza automatica e ' +
      'limite di download. Il destinatario riceve solo il file cifrato.',
  },
  {
    id: 'passphrase',
    title: '⚠️ La passphrase è tutto',
    body:
      'La passphrase protegge le tue chiavi private. ' +
      'NON è recuperabile se la perdi. Salvala in un password manager.',
  },
]

export function OnboardingBanner() {
  const [visible, setVisible] = useState(false)
  const [step, setStep] = useState(0)

  useEffect(() => {
    const done = localStorage.getItem('onboarding_done')
    if (!done) setVisible(true)
  }, [])

  function handleNext() {
    if (step < STEPS.length - 1) {
      setStep((s) => s + 1)
    } else {
      handleDismiss()
    }
  }

  function handleDismiss() {
    localStorage.setItem('onboarding_done', '1')
    setVisible(false)
  }

  if (!visible) return null

  const current = STEPS[step]

  return (
    <aside data-testid="onboarding-banner" role="complementary">
      <h3>{current.title}</h3>
      <p>{current.body}</p>
      <nav>
        <span data-testid="onboarding-step-indicator">
          {step + 1} / {STEPS.length}
        </span>
        {step > 0 && (
          <button
            data-testid="onboarding-prev"
            type="button"
            onClick={() => setStep((s) => s - 1)}
          >
            ← Indietro
          </button>
        )}
        <button data-testid="onboarding-next" type="button" onClick={handleNext}>
          {step < STEPS.length - 1 ? 'Avanti →' : '✓ Capito, inizia'}
        </button>
        <button data-testid="onboarding-skip" type="button" onClick={handleDismiss}>
          Salta
        </button>
      </nav>
    </aside>
  )
}
