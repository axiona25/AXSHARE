# TASK 5.3 — Condivisione File nei Gruppi

**Fase:** 5 — Permessi a tempo & gruppi  
**Prerequisiti:** TASK 5.2 completato

## Flusso E2E (zero-knowledge)

1. L’owner del file chiama **POST /api/v1/files/{file_id}/share-group**.
2. Nel body invia la **file_key cifrata con la group_master_key** (`file_key_encrypted_for_group`).
3. Il server crea una **Permission** per ogni membro del gruppo (escluso l’owner del file, che ha già accesso).
4. Ogni membro usa la propria copia della group key (`GroupMember.encrypted_group_key`) per decifrare la group key e poi la file_key.
5. Il server non conosce mai né la group key né la file_key.

## Implementazione

### Service — `backend/app/services/group_share_service.py`

- **share_file_with_group:**  
  Verifica che il file esista e che l’utente sia owner; che il gruppo esista e che l’utente ne sia membro. Carica tutti i membri del gruppo; per ogni membro (escluso l’owner del file) crea o aggiorna una `Permission` con `resource_key_encrypted = file_key_encrypted_for_group`, `level`, `expires_at`, `granted_by_id = owner`. Commit e refresh delle permission create/aggiornate. Log e return della lista di permission.
- **revoke_group_access:**  
  Verifica ownership del file. Per ogni membro del gruppo revoca la permission sul file (`is_active = False`, `resource_key_encrypted = None`). Commit e return del numero di permission revocate.

### Endpoint — `backend/app/api/v1/endpoints/files.py`

- **POST /files/{file_id}/share-group**  
  Body: `ShareWithGroupRequest` (group_id, file_key_encrypted_for_group, level, expires_at opzionale). Risposta: `{"shared_with": N, "group_id": "..."}`.
- **DELETE /files/{file_id}/share-group/{group_id}**  
  Revoca l’accesso del gruppo al file. Risposta: `{"revoked": N}`.

### Test — `backend/tests/phase5/test_group_share.py`

- **test_share_file_with_group:** Crea owner e due membri, crea gruppo, aggiunge i due membri, upload file, share con gruppo; verifica `shared_with == 2` e che entrambi i membri possano scaricare il file (200).
- **test_revoke_group_access:** Crea owner e un membro, gruppo con un membro, upload, share; verifica download 200; revoca accesso gruppo; verifica download 403 e `revoked == 1`.

## Risultati test

Esecuzione: `cd backend && source .venv/bin/activate && pytest tests/phase5/test_group_share.py -v --tb=short`

| Test | Stato |
|------|--------|
| test_share_file_with_group | OK |
| test_revoke_group_access | OK |

**Risultato:** 2/2 passed.

---

- **Data completamento:** 2026-03-05  
- **Test passati:** 2/2  
- **Errori:** Nessuno
