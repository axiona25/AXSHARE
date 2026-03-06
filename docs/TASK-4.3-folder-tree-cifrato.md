# TASK 4.3 — Folder Tree Cifrato

**Progetto:** AXSHARE | **Fase:** 4 — File System & Storage E2E  
**Dipendenze:** TASK 4.1 completato

## Implementazione

- **Modello:** Aggiunta colonna `folder_key_encrypted` (Text, nullable) al modello `Folder` e migration Alembic `b2c3d4e5f6a7_add_folder_key_encrypted`.

- **Endpoint in `backend/app/api/v1/endpoints/folders.py`:**
  - **POST /** — `create_folder`: body `FolderCreate` (name_encrypted, parent_id opzionale, folder_key_encrypted); crea cartella con owner_id = current_user; ritorna `folder_id`.
  - **GET /** — `list_root_folders`: cartelle con owner_id = current_user, parent_id = NULL, is_destroyed = false; ritorna lista `{id, name_encrypted}`.
  - **GET /{folder_id}/children** — `list_children`: verifica che la cartella esista, sia di proprietà dell’utente e non distrutta; ritorna le sottocartelle (parent_id = folder_id, is_destroyed = false).
  - **GET /{folder_id}/files** — `list_folder_files`: stessa verifica sulla cartella; ritorna i file nella cartella (folder_id, is_destroyed = false) con `id`, `name_encrypted`, `size` (= size_bytes).

- **Router:** `folders.router` incluso in `app/api/v1/router.py`.

## Risultati Test

Esecuzione: `cd backend && pytest tests/phase4/ -k "folder" -v`

| Test | Stato | Note |
|------|--------|------|
| `test_create_nested_folders` | OK | Crea root → sub1 → sub2; lista root, children di root (sub1), children di sub1 (sub2). |
| `test_folder_name_opaque_on_server` | OK | name_encrypted inviato viene restituito identico (opaco al server). |

## File modificati/creati

- `backend/app/models/file.py` — Aggiunto `folder_key_encrypted` a `Folder`.
- `backend/alembic/versions/b2c3d4e5f6a7_add_folder_key_encrypted.py` — Migration.
- `backend/app/api/v1/endpoints/folders.py` — Nuovo.
- `backend/app/api/v1/router.py` — Incluso `folders.router`.
- `backend/tests/phase4/test_folders.py` — Nuovo.
