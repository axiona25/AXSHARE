'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { authApi, usersApi } from '@/lib/api'
import { saveTokensSecure } from '@/lib/auth'
import { keyManager } from '@/lib/keyManager'
import { useAuthContext } from '@/context/AuthContext'

export default function RegisterPage() {
  const router = useRouter()
  const { refreshUser, setSessionKey } = useAuthContext()
  const [regStep, setRegStep] = useState<'form' | 'pin'>('form')
  const [regNome, setRegNome] = useState('')
  const [regCognome, setRegCognome] = useState('')
  const [regEmail, setRegEmail] = useState('')
  const [regPassword, setRegPassword] = useState('')
  const [regPasswordConfirm, setRegPasswordConfirm] = useState('')
  const [regPin, setRegPin] = useState('')
  const [regPinConfirm, setRegPinConfirm] = useState('')
  const [regError, setRegError] = useState('')
  const [regLoading, setRegLoading] = useState(false)
  const [regSuccessToast, setRegSuccessToast] = useState(false)
  const [regToast, setRegToast] = useState<string | null>(null)

  useEffect(() => {
    if (!regToast) return
    const t = setTimeout(() => setRegToast(null), 3000)
    return () => clearTimeout(t)
  }, [regToast])

  function validatePassword(pwd: string, confirm: string): string {
    if (pwd.length < 8) return 'La password deve avere almeno 8 caratteri.'
    if (!/[A-Z]/.test(pwd)) return 'La password deve contenere almeno una lettera maiuscola.'
    if (!/[0-9]/.test(pwd)) return 'La password deve contenere almeno un numero.'
    if (!/[^A-Za-z0-9]/.test(pwd)) return 'La password deve contenere almeno un simbolo.'
    if (pwd !== confirm) return 'Le password non coincidono.'
    return ''
  }

  function handleRegPinInput(value: string, setter: (v: string) => void) {
    const alphanumeric = value.replace(/[^A-Za-z0-9]/g, '').slice(0, 8)
    setter(alphanumeric)
  }

  async function handleRegisterSubmit(e: React.FormEvent) {
    e.preventDefault()
    setRegError('')
    setRegToast(null)
    if (regStep === 'form') {
      if (!regNome.trim()) {
        setRegError('Inserisci il nome.')
        return
      }
      if (!regCognome.trim()) {
        setRegError('Inserisci il cognome.')
        return
      }
      const emailTrim = regEmail.trim()
      if (!emailTrim) {
        setRegError('Inserisci l\'email.')
        return
      }
      const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailRe.test(emailTrim)) {
        setRegError('Email non valida.')
        return
      }
      try {
        const { data } = await authApi.checkEmailAvailable(emailTrim)
        if (!data.available) {
          setRegToast('Email già esistente')
          return
        }
      } catch {
        // Endpoint non disponibile o errore di rete: si procede; in fase di registrazione il backend risponderà se l'email esiste già
      }
      const pwdErr = validatePassword(regPassword, regPasswordConfirm)
      if (pwdErr) {
        setRegError(pwdErr)
        return
      }
      setRegStep('pin')
      setRegError('')
      return
    }
    if (regStep === 'pin') {
      const pinAlphanumeric = /^[A-Za-z0-9]{8}$/
      if (!pinAlphanumeric.test(regPin)) {
        setRegError('Il PIN deve essere di 8 caratteri alfanumerici.')
        return
      }
      if (regPin !== regPinConfirm) {
        setRegError('I PIN non coincidono.')
        return
      }
    }
    try {
      setRegLoading(true)
      setRegError('')

      // Step 1: Registra utente (con nome e cognome per display)
      const displayName = `${regNome.trim()} ${regCognome.trim()}`.trim()
      const { data } = await authApi.devRegister(regEmail.trim(), regPassword, displayName || undefined)
      if (!data.access_token) throw new Error('Registrazione fallita')

      // Step 2: Salva token
      await saveTokensSecure(data.access_token, data.refresh_token)

      // Step 3: Carica utente
      await refreshUser()

      // Step 4: Ottieni utente aggiornato per userId e email
      const { data: meData } = await usersApi.getMe()
      if (!meData?.id || !meData?.email) throw new Error('Utente non caricato')

      // Step 5: Genera e salva chiavi con PIN
      await keyManager.generateAndStoreWithPin(meData.id, meData.email, regPin)

      // Step 6: Sblocca sessione (come fa setup-keys)
      const keyResp = await usersApi.getPrivateKey()
      const bundle = keyResp.data?.encrypted_private_key
      if (!bundle) throw new Error('Chiave privata non trovata')
      const privateKey = await keyManager.unlockWithPin(meData.email, regPin, bundle)
      setSessionKey(privateKey)
      if (typeof sessionStorage !== 'undefined') sessionStorage.setItem('axshare_session_pin', regPin)

      // Step 7: Toast successo e redirect
      setRegSuccessToast(true)
      setTimeout(() => {
        setRegStep('form')
        setRegNome('')
        setRegCognome('')
        setRegEmail('')
        setRegPassword('')
        setRegPasswordConfirm('')
        setRegPin('')
        setRegPinConfirm('')
        setRegSuccessToast(false)
        router.push('/dashboard')
      }, 2000)
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } }; message?: string }
      setRegError(e?.response?.data?.detail ?? e?.message ?? 'Errore durante la registrazione')
    } finally {
      setRegLoading(false)
    }
  }

  return (
    <main className="ax-login-page">
      <div className="ax-login-bg">
        <div className="ax-login-orb ax-login-orb-1" aria-hidden />
        <div className="ax-login-orb ax-login-orb-2" aria-hidden />
        <div className="ax-login-orb ax-login-orb-3" aria-hidden />
        <div className="ax-login-grid" aria-hidden />
      </div>

      <div className="ax-login-card-wrap">
        <div className="ax-login-logo-area">
          <img
            src="/Logo.png"
            alt="AXSHARE"
            style={{ height: '64px', width: 'auto', objectFit: 'contain' }}
          />
          <div className="ax-login-logo-tagline">
            Condivisione sicura. End-to-end encrypted.
          </div>
        </div>

        <div className="ax-login-card">
          {regSuccessToast ? (
            <div className="ax-reg-success-toast" role="status">
              Account creato! Reindirizzamento...
            </div>
          ) : (
            <>
              {regStep === 'form' && (
                <>
                  <div className="ax-login-form-heading">Registrati</div>
                  <div className="ax-login-form-subheading">
                    Crea il tuo account per continuare.
                  </div>
                </>
              )}
              {regStep === 'pin' && (
                <>
                  <button
                    type="button"
                    className="ax-login-modal-back"
                    onClick={() => setRegStep('form')}
                    style={{ marginBottom: 8 }}
                    aria-label="Indietro"
                  >
                    ← Indietro
                  </button>
                  <div className="ax-login-form-heading">Imposta PIN di cifratura</div>
                  <div className="ax-login-form-subheading">
                    Il PIN protegge le tue chiavi di cifratura. Non è recuperabile: conservalo in un posto sicuro.
                  </div>
                  <p className="ax-reg-pin-help">
                    Il PIN deve essere di 8 caratteri alfanumerici (lettere e numeri).
                  </p>
                </>
              )}

              <form onSubmit={handleRegisterSubmit}>
                {regToast && (
                  <div className="ax-reg-toast" role="status">
                    {regToast}
                  </div>
                )}
                {regError && <p className="ax-login-error" role="alert">{regError}</p>}
                {regStep === 'form' && (
                  <>
                    <div className="ax-login-field">
                      <label className="ax-login-field-label" htmlFor="reg-nome">Nome</label>
                      <input
                        id="reg-nome"
                        className="ax-login-field-input"
                        type="text"
                        value={regNome}
                        onChange={(e) => setRegNome(e.target.value)}
                        placeholder="Mario"
                        autoComplete="given-name"
                      />
                    </div>
                    <div className="ax-login-field">
                      <label className="ax-login-field-label" htmlFor="reg-cognome">Cognome</label>
                      <input
                        id="reg-cognome"
                        className="ax-login-field-input"
                        type="text"
                        value={regCognome}
                        onChange={(e) => setRegCognome(e.target.value)}
                        placeholder="Rossi"
                        autoComplete="family-name"
                      />
                    </div>
                    <div className="ax-login-field">
                      <label className="ax-login-field-label" htmlFor="reg-email">Email</label>
                      <input
                        id="reg-email"
                        className="ax-login-field-input"
                        type="email"
                        value={regEmail}
                        onChange={(e) => setRegEmail(e.target.value)}
                        required
                        placeholder="nome@esempio.com"
                        autoComplete="email"
                      />
                    </div>
                    <div className="ax-login-field">
                      <label className="ax-login-field-label" htmlFor="reg-password">Password</label>
                      <input
                        id="reg-password"
                        className="ax-login-field-input"
                        type="password"
                        value={regPassword}
                        onChange={(e) => setRegPassword(e.target.value)}
                        required
                        placeholder="••••••••"
                        autoComplete="new-password"
                      />
                      <ul className="ax-reg-criteria">
                        <li className={regPassword.length >= 8 ? 'ax-reg-criterion ok' : 'ax-reg-criterion'}>Almeno 8 caratteri</li>
                        <li className={/[A-Z]/.test(regPassword) ? 'ax-reg-criterion ok' : 'ax-reg-criterion'}>Una maiuscola</li>
                        <li className={/[0-9]/.test(regPassword) ? 'ax-reg-criterion ok' : 'ax-reg-criterion'}>Un numero</li>
                        <li className={/[^A-Za-z0-9]/.test(regPassword) ? 'ax-reg-criterion ok' : 'ax-reg-criterion'}>Un simbolo</li>
                        <li className={regPassword === regPasswordConfirm && regPassword.length > 0 ? 'ax-reg-criterion ok' : 'ax-reg-criterion'}>Conferma uguale</li>
                      </ul>
                    </div>
                    <div className="ax-login-field">
                      <label className="ax-login-field-label" htmlFor="reg-password-confirm">Conferma password</label>
                      <input
                        id="reg-password-confirm"
                        className="ax-login-field-input"
                        type="password"
                        value={regPasswordConfirm}
                        onChange={(e) => setRegPasswordConfirm(e.target.value)}
                        required
                        placeholder="••••••••"
                        autoComplete="new-password"
                      />
                    </div>
                    <button type="submit" className="ax-login-btn-primary">
                      Avanti
                    </button>
                  </>
                )}
                {regStep === 'pin' && (
                  <>
                    <div className="ax-login-field">
                      <label className="ax-login-field-label" htmlFor="reg-pin">PIN di sicurezza</label>
                      <input
                        id="reg-pin"
                        className="ax-login-field-input"
                        type="password"
                        value={regPin}
                        onChange={(e) => handleRegPinInput(e.target.value, setRegPin)}
                        placeholder="8 caratteri (lettere e numeri)"
                        maxLength={8}
                        autoComplete="off"
                      />
                      <div className="ax-reg-pin-dots" aria-hidden>
                        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                          <span key={i} className={regPin.length > i ? 'ax-reg-pin-dot filled' : 'ax-reg-pin-dot'}>
                            {regPin.length > i ? '●' : '○'}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="ax-login-field">
                      <label className="ax-login-field-label" htmlFor="reg-pin-confirm">Conferma PIN</label>
                      <input
                        id="reg-pin-confirm"
                        className="ax-login-field-input"
                        type="password"
                        value={regPinConfirm}
                        onChange={(e) => handleRegPinInput(e.target.value, setRegPinConfirm)}
                        placeholder="8 caratteri (lettere e numeri)"
                        maxLength={8}
                        autoComplete="off"
                      />
                      <div className="ax-reg-pin-dots" aria-hidden>
                        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                          <span key={i} className={regPinConfirm.length > i ? 'ax-reg-pin-dot filled' : 'ax-reg-pin-dot'}>
                            {regPinConfirm.length > i ? '●' : '○'}
                          </span>
                        ))}
                      </div>
                    </div>
                    <button
                      type="submit"
                      className="ax-login-btn-primary"
                      disabled={regLoading || regPin.length !== 8 || regPinConfirm.length !== 8}
                    >
                      {regLoading ? 'Registrazione...' : 'Crea account'}
                    </button>
                  </>
                )}
              </form>
            </>
          )}

          <div className="ax-login-card-footer">
            Hai già un account?{' '}
            <Link href="/login" className="ax-login-card-footer-link" data-testid="login-link">
              Accedi
            </Link>
          </div>

          <div className="ax-login-encrypt-badge">
            🔒 AES-256-GCM · End-to-end encrypted · Zero-knowledge
          </div>
        </div>
      </div>
    </main>
  )
}
