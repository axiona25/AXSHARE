# TASK 4.2 — Download File + Streaming

**Progetto:** AXSHARE | **Fase:** 4 — File System & Storage E2E  
**Dipendenze:** TASK 4.1 completato

## Implementazione

- **Helper:** `_get_file_with_permission_check(file_id, current_user, db)`  
  Carica il file per ID e verifica accesso: owner oppure permission attiva (subject_user_id, resource_file_id, is_active, expires_at non scaduto). Altrimenti 404 o 403.

- **GET `/{file_id}`** — Metadati file  
  Ritorna: `id`, `name_encrypted`, `size_encrypted` (= `size_bytes`), `current_version` (= `version`), `created_at` (ISO).

- **GET `/{file_id}/download`** — Stream file cifrato  
  - Controllo `is_destroyed` → 410 se eliminato.  
  - Download da MinIO con `storage.download_encrypted_file(storage_path)`.  
  - Incremento `download_count` e commit.  
  - Eventuale auto-distruzione dopo N download: placeholder (TODO quando modulo tasks disponibile).  
  - Risposta: `StreamingResponse(io.BytesIO(encrypted_data), media_type="application/octet-stream", headers={"X-File-IV": file.encryption_iv})`.

- **GET `/{file_id}/key`** — DEK cifrata per l’utente  
  - Owner: `file.file_key_encrypted`.  
  - Utente condiviso: `permission.resource_key_encrypted` se presente.  
  - Sempre: `encryption_iv` dal file.

## Risultati Test

Esecuzione: `cd backend && pytest tests/phase4/ -k "download" -v`

| Test | Stato | Note |
|------|--------|------|
| `test_download_returns_encrypted_bytes` | OK | GET download → 200, body = bytes cifrati, header X-File-IV |
| `test_download_counter_increments` | OK | Due download → download_count ≥ 2 (verifica via DB) |
| `test_download_without_permission_fails` | OK | Download da utente non owner e senza permission → 403 |

## File modificati/creati

- `backend/app/api/v1/endpoints/files.py` — Aggiunti `_get_file_with_permission_check`, GET `/{file_id}`, GET `/{file_id}/download`, GET `/{file_id}/key`.
- `backend/tests/phase4/test_files_upload.py` — Aggiunti helper `_upload_one_file` e test `test_download_returns_encrypted_bytes`, `test_download_counter_increments`, `test_download_without_permission_fails`.
