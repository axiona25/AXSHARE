import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { OnboardingBanner } from './OnboardingBanner'

describe('OnboardingBanner', () => {
  beforeEach(() => {
    vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(null)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {})
  })

  it('mostra il banner al primo accesso', () => {
    render(<OnboardingBanner />)
    const banners = screen.getAllByTestId('onboarding-banner')
    expect(banners.length).toBeGreaterThan(0)
    const first = within(banners[0])
    expect(first.getByTestId('onboarding-step-indicator').textContent).toBe('1 / 4')
  })

  it('naviga avanti e indietro tra gli step', () => {
    render(<OnboardingBanner />)
    const banners = screen.getAllByTestId('onboarding-banner')
    const first = within(banners[0])
    expect(first.getByTestId('onboarding-step-indicator').textContent).toBe('1 / 4')
    fireEvent.click(first.getByTestId('onboarding-next'))
    expect(first.getByTestId('onboarding-step-indicator').textContent).toBe('2 / 4')
    fireEvent.click(first.getByTestId('onboarding-prev'))
    expect(first.getByTestId('onboarding-step-indicator').textContent).toBe('1 / 4')
  })

  it('salva onboarding_done al click Salta', () => {
    render(<OnboardingBanner />)
    const first = within(screen.getAllByTestId('onboarding-banner')[0])
    fireEvent.click(first.getByTestId('onboarding-skip'))
    expect(localStorage.setItem).toHaveBeenCalledWith('onboarding_done', '1')
  })
})
