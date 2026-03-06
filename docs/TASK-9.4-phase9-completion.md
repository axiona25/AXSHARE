# TASK 9.4 — Test Suite Completa Fase 9 (Firma Digitale)

## Schema crittografico

- **Algoritmo firma:** RSA-PSS con SHA-256
- **Salt length:** 32 byte (compatibile Web Crypto API e `cryptography`)
- **Payload firmato:** stringa `{file_hash_sha256}:{file_id}:{version}` in UTF-8
- **Hash:** SHA-256 del **file cifrato** (blob come memorizzato su server), in esadecimale
- **Verifica server:** `SignatureService.verify_rsa_pss()` con chiave pubblica PEM salvata (snapshot al momento della firma)

## Keypair separati

- **Keypair #1 (OAEP):** RSA-OAEP 2048-bit per cifratura `file_key`; chiave pubblica su `users.public_key_rsa`
- **Keypair #2 (PSS):** RSA-PSS 2048-bit solo per firma; chiave pubblica su `users.signing_public_key_pem`
- Entrambi protetti con la stessa passphrase KEK in IndexedDB (frontend); il server conserva solo le chiavi pubbliche

## Flusso firma E2E

1. **Generazione:** client genera keypair RSA-PSS (o usa keypair dedicato da TASK 9.2)
2. **Registrazione:** `POST /users/me/signing-key` con `signing_public_key_pem`
3. **Upload file:** file cifrato caricato come di consueto
4. **Firma:** client calcola `file_hash = SHA256(blob_cifrato)`, costruisce `payload = file_hash:file_id:version`, firma con RSA-PSS (salt 32), invia `POST /files/{file_id}/sign` con `signature_b64`, `file_hash_sha256`, `public_key_pem_snapshot`
5. **Verifica:** server (o client) chiama `POST /files/{file_id}/verify/{version}`; il server ricalcola il payload, verifica la firma con la pubkey snapshot e aggiorna `is_valid` e `verified_at`

## Endpoint aggiunti (Fase 9)

| Metodo | Path | Descrizione |
|--------|------|-------------|
| POST | `/files/{file_id}/sign` | Upload firma (owner); body: `version`, `signature_b64`, `file_hash_sha256`, `public_key_pem_snapshot`, `algorithm` |
| GET | `/files/{file_id}/signatures` | Lista firme del file |
| POST | `/files/{file_id}/verify/{version}` | Verifica server-side firma; aggiorna `is_valid`, `verified_at` |
| POST | `/users/me/signing-key` | Registra chiave pubblica RSA-PSS per firma |
| GET | `/users/me/signing-key` | Stato chiave firma (`has_signing_key`, `registered_at`) |
| GET | `/users/{user_id}/signing-key` | Chiave pubblica firma di un utente (per verifica) |

## Ricerca e flag `is_signed`

- Parametro di ricerca **`is_signed`** (opzionale): filtra i file per `File.is_signed` (true/false).
- Impostato a `True` quando viene caricata almeno una firma per il file (`POST /files/{file_id}/sign`).

## Note sicurezza

- **Snapshot pubkey:** in `file_signatures.public_key_pem_snapshot` viene salvata la chiave pubblica usata per la firma; la verifica resta valida anche se l’utente rigenera le chiavi.
- **`is_valid`:** `null` = non ancora verificata, `true` = verifica OK, `false` = verifica fallita (firma o payload non coerenti).
- La firma è sul **file cifrato**; il server non decifra il contenuto e non vede il plaintext.

## Esecuzione test

```bash
# Backend (da backend/)
source .venv/bin/activate
pytest tests/phase9/ -v --tb=short

# Frontend (da frontend/)
npx vitest run hooks/useSigning.test lib/signing.test
```

- **Backend:** 11 test (test_signatures, test_signing_keys, test_phase9_full con chiavi RSA-PSS reali e verifica vera/falsa).
- **Frontend:** 6 test (useSigning hook, sha256Hex).
