# TASK 4.5 — Preview Client-Side

**Progetto:** AXSHARE | **Fase:** 4 — File System & Storage E2E  
**Dipendenze:** TASK 4.2 completato

## Implementazione

La preview viene generata **solo nel browser**: il server non decifra mai il contenuto (zero-knowledge).

### `frontend/lib/crypto.ts`
- **hexToBytes**, **bytesToHex** — conversione hex ↔ Uint8Array.
- **generateKey()** — genera DEK 32 bytes (AES-256) con `crypto.getRandomValues`.
- **encryptFileChunked(plaintext, key, fileId)** — AES-256-GCM, formato `[12 bytes nonce][ciphertext+tag]`, AAD = fileId.
- **decryptFileChunked(encrypted, key, fileId?)** — decifra il formato sopra; AAD opzionale per compatibilità con backend.

### `frontend/lib/preview.ts`
- **decryptAndPreview(encryptedBlob, dekHex, mimeType, fileId?)** — legge il blob, decifra con DEK (hex), crea `Blob` in chiaro e restituisce `URL.createObjectURL(blob)`.
- **generateThumbnail(decryptedBlob)** — crea un’immagine da blob, la disegna su canvas 200×200 e restituisce `toDataURL('image/jpeg', 0.8)`.

### `frontend/components/FilePreview.tsx`
- Componente client (`'use client'`): riceve `fileId`, `dekHex`, `mimeType`.
- In `useEffect`: GET `/api/v1/files/{fileId}/download` con `Authorization: Bearer ${localStorage.getItem('token')}`, decifra con `decryptAndPreview(..., fileId)` e imposta l’object URL.
- Cleanup: revoca l’object URL (anche su cambio dipendenze) tramite ref.
- Render: se `image/*` → `<img>`, se `application/pdf` → `<iframe>`, altrimenti messaggio “Anteprima non disponibile”.

## Risultati Test

Esecuzione: `cd frontend && npx vitest run preview` (oppure `npm run test -- --run preview` se `vitest` è in PATH).

| Test | Stato | Note |
|------|--------|------|
| `decryptAndPreview returns valid object URL` | OK | generateKey → encryptFileChunked(..., 'test-id') → Blob → decryptAndPreview(..., 'test-id') → URL con prefisso `blob:`; revoca URL in cleanup. |

## File creati/modificati

- `frontend/lib/crypto.ts` — Implementazione AES-256-GCM (hexToBytes, bytesToHex, generateKey, encryptFileChunked, decryptFileChunked).
- `frontend/lib/preview.ts` — decryptAndPreview, generateThumbnail.
- `frontend/lib/preview.test.ts` — Test Vitest per decryptAndPreview.
- `frontend/components/FilePreview.tsx` — Componente React per preview (immagine / PDF / non disponibile).
