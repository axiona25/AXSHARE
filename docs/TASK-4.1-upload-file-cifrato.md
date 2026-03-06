# TASK 4.1 — Upload File Cifrato (Chunked E2E)

**Progetto:** AXSHARE | **Fase:** 4 — File System & Storage E2E  
**Dipendenze:** TASK 2.1, 3.4, 1.4

## Implementazione

- **Endpoint:** `POST /api/v1/files/upload`
  - Multipart: `metadata` (JSON `FileUploadMetadata`) + `file` (bytes già cifrati).
  - Autenticazione: JWT obbligatorio.
  - Salvataggio blob su MinIO tramite `storage_service.upload_encrypted_file(user_id, file_id, encrypted_data)`.
  - Record in DB: `axshare.files` con `name_encrypted`, `mime_type_encrypted`, `file_key_encrypted`, `encryption_iv`, `content_hash`, `storage_path`, `size_bytes`, `owner_id`, `folder_id` (opzionale).

- **Storage:** `StorageService.upload_encrypted_file(user_id, file_id, data)` carica su path `files/{user_id}/{file_id}` (signatura aggiornata rispetto al vecchio overload).

- **Crypto:** Aggiunta classe `AESCipher` in `app/crypto/aes.py` con `generate_key()` e `encrypt_file_chunked(plaintext, key, file_id)` per test/client (formato: nonce + ciphertext+tag).

## Risultati Test

Esecuzione: `cd backend && pytest tests/phase4/ -k "upload" -v`

| Test | Stato | Note |
|------|--------|------|
| `test_upload_encrypted_file` | OK | Cifratura lato “client” con AESCipher, POST multipart → 200; verifica su MinIO che il blob salvato ≠ original e = encrypted |
| `test_upload_requires_auth` | OK | POST senza JWT → 403 |

## File modificati/creati

- `backend/app/api/v1/endpoints/files.py` — nuovo
- `backend/app/api/v1/router.py` — incluso `files.router`
- `backend/app/services/storage.py` — `upload_encrypted_file(user_id, file_id, data)`
- `backend/app/crypto/aes.py` — classe `AESCipher` + `encrypt_file_chunked`
- `backend/tests/phase4/conftest.py` — nuovo
- `backend/tests/phase4/test_files_upload.py` — nuovo
