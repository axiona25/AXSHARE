# TASK 4.4 — File Versioning

**Progetto:** AXSHARE | **Fase:** 4 — File System & Storage E2E  
**Dipendenze:** TASK 4.1 completato

## Implementazione

- **Modello `FileVersion`** (tabella `axshare.file_versions`): snapshot di una versione precedente con `file_id`, `version_number`, `storage_path`, `file_key_encrypted`, `encryption_iv`, `size_bytes`, `created_by`, `created_at`. Migration `c3d4e5f6a7b8_file_versions_table`.

- **Storage:** `upload_encrypted_file(..., path_suffix=None)`: se `path_suffix` è impostato (es. `v2`), il path diventa `files/{user_id}/{file_id}/{suffix}` per non sovrascrivere la versione corrente.

- **Helper `_get_file_with_write_permission`:** come `_get_file_with_permission_check` ma richiede permesso di scrittura: owner oppure permission con level in (WRITE, SHARE, ADMIN).

- **Endpoint in `files.py`:**
  - **POST `/{file_id}/version`** — `upload_new_version`: multipart (metadata JSON + file). Salva lo stato corrente in `FileVersion`, carica il nuovo blob con `path_suffix=f"v{version+1}"`, aggiorna il record file (storage_path, file_key_encrypted, encryption_iv, size_bytes, version) e commit.
  - **GET `/{file_id}/versions`** — `list_versions`: dopo controllo lettura, restituisce le righe di `FileVersion` per quel file ordinate per `version_number` (version, created_at).
  - **POST `/{file_id}/versions/{version_number}/restore`** — `restore_version`: dopo controllo scrittura, archivia lo stato corrente in `FileVersion`, poi copia dalla versione richiesta in `file` (storage_path, file_key_encrypted, encryption_iv, size_bytes) e commit.

## Risultati Test

Esecuzione: `cd backend && pytest tests/phase4/ -k "version" -v`

| Test | Stato | Note |
|------|--------|------|
| `test_upload_3_versions` | OK | Upload file, poi 2 nuove versioni → version=3, list_versions con 2 snapshot (v1, v2). |
| `test_restore_version_1` | OK | 3 versioni, restore a v1 → download restituisce bytes della v1 (enc1). |

## File modificati/creati

- `backend/app/models/file.py` — Aggiunto modello `FileVersion` e relazione `version_history` su `File`.
- `backend/app/models/__init__.py` — Esportato `FileVersion`.
- `backend/alembic/versions/c3d4e5f6a7b8_file_versions_table.py` — Migration tabella `file_versions`.
- `backend/app/services/storage.py` — Parametro opzionale `path_suffix` in `upload_encrypted_file`.
- `backend/app/api/v1/endpoints/files.py` — `_get_file_with_write_permission`, POST version, GET versions, POST restore.
- `backend/tests/phase4/test_files_upload.py` — Test `test_upload_3_versions`, `test_restore_version_1`.
