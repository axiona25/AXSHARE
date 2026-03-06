'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useFile, useFileVersions } from '@/hooks/useFiles'
import { useSigning } from '@/hooks/useSigning'
import { useShareLinks } from '@/hooks/useShareLinks'
import { useFilePermissions, usePermissionMutations } from '@/hooks/usePermissions'
import { filesApi } from '@/lib/api'
import { PassphraseModal } from '@/components/PassphraseModal'

export default function FileDetailPage() {
  const params = useParams<{ id: string }>()
  const id = Array.isArray(params.id) ? params.id[0] : params.id ?? ''
  const router = useRouter()

  const { file, isLoading } = useFile(id)
  const { versions } = useFileVersions(id)
  const {
    signatures,
    signFileAction,
    verifySignature,
    hasSigningKey,
  } = useSigning(id)
  const { links, createLink, revokeLink } = useShareLinks(id)
  const { permissions } = useFilePermissions(id)
  const { grantPermission, revokePermission } = usePermissionMutations()

  const [modal, setModal] = useState<'sign' | null>(null)
  const [shareLabel, setShareLabel] = useState('')
  const [sharePassword, setSharePassword] = useState('')
  const [shareExpiry, setShareExpiry] = useState('')
  const [shareMaxDl, setShareMaxDl] = useState('')
  const [permEmail, setPermEmail] = useState('')
  const [permLevel, setPermLevel] = useState<'read' | 'write'>('read')
  const [sdDownloads, setSdDownloads] = useState('')
  const [sdDate, setSdDate] = useState('')
  const [statusMsg, setStatusMsg] = useState('')

  if (isLoading) return <p data-testid="file-loading">Caricamento...</p>
  if (!file) return <p data-testid="not-found">File non trovato.</p>

  async function handleSign(passphrase: string) {
    setModal(null)
    setStatusMsg('Firma in corso...')
    await signFileAction(id, passphrase)
    setStatusMsg('File firmato.')
  }

  async function handleVerify(version: number) {
    setStatusMsg('Verifica...')
    const valid = await verifySignature(id, version)
    setStatusMsg(valid ? 'Firma valida.' : 'Firma non valida.')
  }

  async function handleCreateLink(e: React.FormEvent) {
    e.preventDefault()
    await createLink({
      label: shareLabel,
      password: sharePassword || undefined,
      expiresAt: shareExpiry ? new Date(shareExpiry) : undefined,
      maxDownloads: shareMaxDl ? Number(shareMaxDl) : undefined,
    })
    setShareLabel('')
    setSharePassword('')
    setShareExpiry('')
    setShareMaxDl('')
    setStatusMsg('Link creato.')
  }

  async function handleGrantPermission(e: React.FormEvent) {
    e.preventDefault()
    await grantPermission({
      subjectUserId: permEmail,
      resourceFileId: id,
      level: permLevel,
    })
    setPermEmail('')
    setStatusMsg('Permesso concesso.')
  }

  async function handleSelfDestruct(e: React.FormEvent) {
    e.preventDefault()
    await filesApi.setSelfDestruct(
      id,
      sdDownloads ? Number(sdDownloads) : undefined,
      sdDate || undefined
    )
    setStatusMsg('Auto-distruzione impostata.')
  }

  return (
    <div>
      <button type="button" onClick={() => router.back()} data-testid="back-button">
        Indietro
      </button>

      <h1>Dettaglio file</h1>

      {statusMsg && (
        <p data-testid="status-message">{statusMsg}</p>
      )}

      <section data-testid="file-info">
        <h2>Informazioni</h2>
        <dl>
          <dt>ID</dt>
          <dd data-testid="file-id">{file.id}</dd>
          <dt>Dimensione</dt>
          <dd>{file.size_bytes} bytes</dd>
          <dt>Creato</dt>
          <dd>{new Date(file.created_at).toLocaleString('it')}</dd>
          <dt>Download</dt>
          <dd>{file.download_count}</dd>
          <dt>Distrutto</dt>
          <dd>{file.is_destroyed ? 'Sì' : 'No'}</dd>
        </dl>
      </section>

      <section data-testid="versions-section">
        <h2>Versioni</h2>
        {versions.length === 0 && <p>Nessuna versione.</p>}
        <ul>
          {versions.map((v) => (
            <li key={v.version_number} data-testid="version-item">
              v{v.version_number} — {new Date(v.created_at).toLocaleString('it')}
            </li>
          ))}
        </ul>
      </section>

      <section data-testid="signature-section">
        <h2>Firma digitale</h2>
        {signatures.length > 0 && (
          <ul data-testid="signatures-list">
            {signatures.map((s) => (
              <li key={s.id} data-testid="signature-item">
                <span>v{s.version}</span>
                {s.isValid === true && <span> Verificata</span>}
                {s.isValid === false && <span> Non valida</span>}
                {(s.isValid === null || s.isValid === false) && (
                  <button
                    type="button"
                    data-testid={`verify-sig-${s.version}`}
                    onClick={() => handleVerify(s.version)}
                  >
                    Verifica
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {hasSigningKey && (
          <button
            type="button"
            data-testid="sign-file-button"
            onClick={() => setModal('sign')}
          >
            Firma file
          </button>
        )}
        {!hasSigningKey && (
          <p>
            Nessuna chiave firma configurata.{' '}
            <Link href="/settings/security" data-testid="settings-security-link">
              Configura in Impostazioni
            </Link>
          </p>
        )}
      </section>

      <section data-testid="share-links-section">
        <h2>Link di condivisione</h2>

        <form onSubmit={handleCreateLink} data-testid="create-link-form">
          <div>
            <label htmlFor="link-label">Etichetta</label>
            <input
              id="link-label"
              data-testid="link-label-input"
              value={shareLabel}
              onChange={(e) => setShareLabel(e.target.value)}
              placeholder="es. Collega esterno"
            />
          </div>
          <div>
            <label htmlFor="link-password">Password (opzionale)</label>
            <input
              id="link-password"
              data-testid="link-password-input"
              type="password"
              value={sharePassword}
              onChange={(e) => setSharePassword(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="link-expiry">Scadenza (opzionale)</label>
            <input
              id="link-expiry"
              data-testid="link-expiry-input"
              type="datetime-local"
              value={shareExpiry}
              onChange={(e) => setShareExpiry(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="link-maxdl">Max download (opzionale)</label>
            <input
              id="link-maxdl"
              data-testid="link-maxdl-input"
              type="number"
              min={1}
              value={shareMaxDl}
              onChange={(e) => setShareMaxDl(e.target.value)}
            />
          </div>
          <button type="submit" data-testid="create-link-button">
            Crea link
          </button>
        </form>

        <ul data-testid="links-list">
          {links.map((link) => (
            <li key={link.id} data-testid="link-item">
              <code data-testid={`link-token-${link.id}`}>
                {typeof window !== 'undefined'
                  ? `${window.location.origin}/share/${link.token}`
                  : `/share/${link.token}`}
              </code>
              <span> — {link.is_active ? 'Attivo' : 'Revocato'}</span>
              <span> — {link.download_count} download</span>
              {link.is_active && (
                <button
                  type="button"
                  data-testid={`revoke-link-${link.id}`}
                  onClick={() => revokeLink(link.id)}
                >
                  Revoca
                </button>
              )}
              <button
                type="button"
                data-testid={`copy-link-${link.id}`}
                onClick={() =>
                  navigator.clipboard?.writeText(
                    `${window.location.origin}/share/${link.token}`
                  )
                }
              >
                Copia
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section data-testid="permissions-section">
        <h2>Permessi utenti</h2>

        <form onSubmit={handleGrantPermission} data-testid="grant-permission-form">
          <div>
            <label htmlFor="perm-user">User ID o email</label>
            <input
              id="perm-user"
              data-testid="perm-user-input"
              value={permEmail}
              onChange={(e) => setPermEmail(e.target.value)}
              required
              placeholder="user-id o email"
            />
          </div>
          <div>
            <label htmlFor="perm-level">Livello</label>
            <select
              id="perm-level"
              data-testid="perm-level-select"
              value={permLevel}
              onChange={(e) => setPermLevel(e.target.value as 'read' | 'write')}
            >
              <option value="read">Lettura</option>
              <option value="write">Scrittura</option>
            </select>
          </div>
          <button type="submit" data-testid="grant-button">
            Concedi permesso
          </button>
        </form>

        <ul data-testid="permissions-list">
          {permissions.map((p) => (
            <li key={p.id} data-testid="permission-item">
              {p.subject_user_id} — {p.level}
              {p.expires_at &&
                ` — scade: ${new Date(p.expires_at).toLocaleString('it')}`}
              <button
                type="button"
                data-testid={`revoke-perm-${p.id}`}
                onClick={() => revokePermission(p.id, id)}
              >
                Revoca
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section data-testid="self-destruct-section">
        <h2>Auto-distruzione</h2>
        <form onSubmit={handleSelfDestruct} data-testid="self-destruct-form">
          <div>
            <label htmlFor="sd-downloads">Dopo N download</label>
            <input
              id="sd-downloads"
              data-testid="sd-downloads-input"
              type="number"
              min={1}
              value={sdDownloads}
              onChange={(e) => setSdDownloads(e.target.value)}
              placeholder="es. 3"
            />
          </div>
          <div>
            <label htmlFor="sd-date">Oppure alla data</label>
            <input
              id="sd-date"
              data-testid="sd-date-input"
              type="datetime-local"
              value={sdDate}
              onChange={(e) => setSdDate(e.target.value)}
            />
          </div>
          <button type="submit" data-testid="set-self-destruct-button">
            Imposta auto-distruzione
          </button>
        </form>
      </section>

      {modal === 'sign' && (
        <PassphraseModal
          title="Passphrase per firmare"
          onConfirm={handleSign}
          onCancel={() => setModal(null)}
        />
      )}
    </div>
  )
}
