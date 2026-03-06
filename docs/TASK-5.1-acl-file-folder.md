# TASK 5.1 — ACL per File e Folder (read/write/share/admin)

**Fase:** 5 — Permessi a tempo & gruppi  
**Prerequisiti:** Fase 4 completata

## Implementazione

### Livelli (PermissionLevel)
- **read:** scarica e visualizza file
- **write:** carica nuove versioni, modifica metadati
- **share:** può condividere con altri (non più di quanto possiede)
- **admin:** gestisce i permessi di altri sulla risorsa

### Zero-knowledge
Quando si concede un permesso su un file, il mittente cifra la file_key con la chiave pubblica del destinatario e la salva in `permission.resource_key_encrypted`. Il server non decifra mai la chiave.

### Service — `backend/app/services/permission_service.py`
- **grant_permission:** concede permesso su file o cartella; grantor deve essere owner o avere livello SHARE/ADMIN; gestisce aggiornamento permesso esistente; richiede `resource_file_id` o `resource_folder_id`.
- **revoke_permission:** revoca permesso (is_active=False, resource_key_encrypted=None); solo owner della risorsa, grantor o chi ha ADMIN sulla risorsa.
- **list_permissions:** elenco permessi su una risorsa; solo owner o chi ha ADMIN sulla risorsa.
- **check_permission:** verifica se l’utente ha almeno il livello richiesto (owner sempre true; altrimenti permission attiva, non scaduta, livello >= richiesto).
- **_get_permission:** helper per trovare la permission attiva di un utente su file/folder.

### Endpoint — `backend/app/api/v1/endpoints/permissions.py`
- **POST /** — grant (body: subject_user_id, resource_file_id o resource_folder_id, level, resource_key_encrypted opzionale, expires_at opzionale); 201 + PermissionResponse.
- **DELETE /{permission_id}** — revoke; 204.
- **GET /file/{file_id}** — list permessi su file.
- **GET /folder/{folder_id}** — list permessi su cartella.

### Modello
- **Permission.level** in DB deve usare valori lowercase; in `app/models/permission.py` è stato impostato `Enum(PermissionLevel, values_callable=lambda obj: [e.value for e in obj])` per allineamento con l’enum PostgreSQL `permissionlevel`.

## Risultati test

Esecuzione: `cd backend && source .venv/bin/activate && pytest tests/phase5/test_acl.py -v --tb=short`

| Test | Stato | Note |
|------|--------|------|
| test_grant_and_list_permission | OK | Owner concede read, list restituisce il permesso per l’altro utente |
| test_revoke_permission | OK | Owner revoca; download con other_token → 403 |
| test_grant_requires_ownership | OK | Stranger non può concedere permesso sul file dell’owner → 403 |

Nei test è usato `get_settings.cache_clear()` prima dell’upload per evitare 401 da cache JWT.

## File creati/modificati

- `backend/app/services/permission_service.py` — nuovo
- `backend/app/api/v1/endpoints/permissions.py` — nuovo
- `backend/app/api/v1/router.py` — incluso `permissions.router`
- `backend/app/models/permission.py` — `level` con `values_callable` per enum
- `backend/tests/phase5/__init__.py` — nuovo
- `backend/tests/phase5/test_acl.py` — nuovo
