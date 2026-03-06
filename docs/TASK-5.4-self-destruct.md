# TASK 5.4 — Auto-distruzione File (Self-Destruct)

**Fase:** 5 — Permessi a tempo & gruppi  
**Prerequisiti:** TASK 5.3 completato

## Comportamento

- **self_destruct_after_downloads:** dopo N download il file viene distrutto automaticamente (al termine del download che raggiunge il limite).
- **self_destruct_at:** alla data/ora indicata un task Celery periodico distrugge il file.
- **Distruzione:** cancellazione blob da MinIO (con sovrascrittura sicura), eliminazione chiavi da Vault (se presenti), `is_destroyed=True` e azzeramento di `file_key_encrypted`/`encryption_iv`/`storage_path` nel DB, revoca di tutti i permessi attivi. I metadati restano per audit.
- Il download di un file distrutto restituisce **410 Gone**.

## Implementazione

### Service — `backend/app/services/destruct_service.py`

- **destroy_file(db, file_id, reason):** verifica che il file esista e non sia già distrutto; elimina il blob da MinIO con `delete_file_secure`; elimina la chiave da Vault con `delete_file_key` (in try/except); imposta `is_destroyed=True`, `file_key_encrypted=""`, `encryption_iv=""`, `storage_path="destroyed/{file_id}"`; revoca tutte le permission attive sul file; commit. Restituisce `True` se distrutto, `False` se già distrutto.
- **check_and_destroy_on_download(db, file_id):** da chiamare dopo ogni download; se il file ha `self_destruct_after_downloads` e `download_count >= self_destruct_after_downloads`, chiama `destroy_file` con reason `"download_limit"`.
- **set_self_destruct(db, owner_id, file_id, after_downloads, destruct_at):** solo owner; imposta `self_destruct_after_downloads` (≥ 1) e/o `self_destruct_at` (nel futuro); restituisce un dict con `file_id`, `self_destruct_after_downloads`, `self_destruct_at` (isoformat o None).

### Task Celery — `backend/app/tasks/destruct_tasks.py`

- **destroy_expired_files:** task periodico (Beat ogni minuto) che seleziona i file con `is_destroyed=False`, `self_destruct_at` non nullo e `self_destruct_at <= now`, e per ciascuno chiama `DestructService.destroy_file` con reason `"scheduled_destruct"`.

### Endpoint — `backend/app/api/v1/endpoints/files.py`

- **POST /files/{file_id}/self-destruct:** body `SelfDestructRequest` (after_downloads, destruct_at opzionali). Delega a `DestructService.set_self_destruct`.
- **DELETE /files/{file_id}/destroy:** distruzione manuale; solo owner; restituisce `{"destroyed": bool, "file_id": "..."}`.
- **GET /files/{file_id}/download:** dopo l’incremento di `download_count` e il commit, viene chiamato `DestructService.check_and_destroy_on_download(db, file_id)`.

### Test — `backend/tests/phase5/test_self_destruct.py`

- **test_self_destruct_after_n_downloads:** imposta self-destruct dopo 2 download; 1° e 2° download 200 (il 2° può triggerare la distruzione); 3° download 410.
- **test_manual_destroy:** owner chiama DELETE destroy; download successivo 410.
- **test_destroy_expired_files_task:** imposta `self_destruct_at` nel passato nel DB; esegue `_destroy_expired_files_async()`; verifica `destroyed >= 1` e `file.is_destroyed is True`.

## Risultati test

Esecuzione: `cd backend && source .venv/bin/activate && pytest tests/phase5/test_self_destruct.py -v --tb=short`

| Test | Stato |
|------|--------|
| test_self_destruct_after_n_downloads | OK |
| test_manual_destroy | OK |
| test_destroy_expired_files_task | OK |

**Risultato:** 3/3 passed.

---

- **Data completamento:** 2026-03-05  
- **Test passati:** 3/3  
- **Errori:** Nessuno
