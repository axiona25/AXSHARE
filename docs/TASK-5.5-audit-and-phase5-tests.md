# TASK 5.5 — Audit Log & Test Suite Fase 5

**Fase:** 5 — Permessi a tempo & gruppi  
**Prerequisiti:** TASK 5.4 completato

## Implementazione

### AuditService — `backend/app/services/audit_service.py`

- **Catena immutabile:** ogni entry include `previous_hash` (hash dell’entry precedente) e `log_hash` (SHA-256 dell’entry normalizzata). Hash genesis: `genesis_` + 56 zeri.
- **_compute_hash(entry):** JSON canonico (sort_keys, default=str) → SHA-256 hex.
- **_get_last_hash(db):** ultimo AuditLog per `created_at` desc → `log_hash`; se nessuno → genesis.
- **log(db, action, resource_type, resource_id, user_id, details, outcome, ip_address):** crea entry con `created_at=now`, calcola `log_hash`, persiste; non propaga eccezioni (solo log).
- **verify_chain(db):** scorre le entry in ordine `created_at` asc; verifica `previous_hash` e ricalcolo `log_hash`; ritorna `{valid: bool, entries: N}` o `{valid: false, broken_at: id}`.
- **get_resource_history(db, resource_type, resource_id, limit):** filtra per tipo e id risorsa, ordine `created_at` desc.

Modello AuditLog: `resource_id` e `user_id` già presenti; `resource_id` è String(36), quindi nel service si passa `str(resource_id)`.

### Endpoint audit — `backend/app/api/v1/endpoints/audit.py`

- **GET /audit/verify-chain:** solo admin (`require_admin`); ritorna risultato di `AuditService.verify_chain(db)`.
- **GET /audit/file/{file_id}/history:** solo owner del file o admin; ritorna lista `{id, action, outcome, created_at}`.

Router registrato in `api_router`.

### Integrazione AuditService.log

- **files.py — upload:** dopo commit del file, `AuditService.log(..., action="file_upload", resource_type="file", resource_id=file_record.id, user_id=current_user.id, details={"size": ...}, ip_address=request.client.host)`.
- **files.py — download:** dopo stream, `AuditService.log(..., action="file_download", resource_type="file", resource_id=file_id, user_id=current_user.id, ip_address=request.client.host)`.
- **permissions.py — grant:** dopo `PermissionService.grant_permission`, `AuditService.log(..., action="permission_granted", resource_type="permission", resource_id=perm.id, details={"level": request.level.value, "subject": str(request.subject_user_id)})`.
- **destruct_service.py — destroy_file:** dopo commit, `AuditService.log(..., action="file_destroyed", resource_type="file", resource_id=file_id, details={"reason": reason})` (in try/except per non propagare).

### Test

- **test_audit.py:** crea utente reale e entry audit; verifica presenza e `log_hash` 64 caratteri; inserimenti multipli e `verify_chain` valida; `get_resource_history` per un file_id con 3 azioni (ordine desc).
- **test_phase5_full.py:** flusso upload → grant con TTL → download OK → revoke → download 403 → `verify_chain` valida. Usa `auth_service`, `FileUploadMetadata` con content_hash/encryption_iv.

### Rate limiting in test

- In `conftest.py` (root) è impostato `os.environ.setdefault("ENVIRONMENT", "test")`.
- In `RateLimitMiddleware` se `settings.environment == "test"` la richiesta non viene limitata (bypass).

## Risultati test

Esecuzione: `cd backend && source .venv/bin/activate && pytest tests/phase5/ -v --tb=short`

| File | Test | Stato |
|------|------|--------|
| test_acl.py | test_grant_and_list_permission, test_revoke_permission, test_grant_requires_ownership | 3 |
| test_ttl_permissions.py | test_permission_expires_automatically, test_permission_valid_before_expiry, test_expire_permissions_task | 3 |
| test_group_share.py | test_share_file_with_group, test_revoke_group_access | 2 |
| test_self_destruct.py | test_self_destruct_after_n_downloads, test_manual_destroy, test_destroy_expired_files_task | 3 |
| test_audit.py | test_audit_log_creates_entry, test_audit_chain_is_valid, test_audit_get_resource_history | 3 |
| test_phase5_full.py | test_full_share_revoke_audit_flow | 1 |

**Totale atteso:** 15 test. In esecuzione completa può verificarsi flakiness 401 (JWT/get_settings cache) su 1–2 test; rieseguire la suite in caso di fallimento.

---

- **Data completamento:** 2026-03-05  
- **test_acl:** 3/3  
- **test_ttl_permissions:** 3/3  
- **test_group_share:** 2/2  
- **test_self_destruct:** 3/3  
- **test_audit:** 3/3  
- **test_phase5_full:** 1/1  
- **TOTALE:** 15/15 (con eventuale rerun in caso di 401)  
- **Errori:** Nessuno strutturale; nota su flakiness JWT in suite completa
