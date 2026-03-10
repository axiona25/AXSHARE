/**
 * Placeholder mostrato in UI finché il nome file/cartella non è decifrato.
 * Il nome cifrato (name_encrypted) non deve mai essere mostrato all'utente.
 */
export const NAME_PLACEHOLDER = '...'

/** Restituisce il nome da mostrare: decifrato se presente, altrimenti placeholder. */
export function getSafeDisplayName(decrypted: string | undefined): string {
  const t = decrypted?.trim()
  return t || NAME_PLACEHOLDER
}
