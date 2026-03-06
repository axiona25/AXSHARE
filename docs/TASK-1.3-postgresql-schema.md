# TASK 1.3 — PostgreSQL Schema + RLS + Alembic

> **Fase:** 1 — Foundation & Infrastruttura  
> **Prerequisiti:** Task 1.2 completato (PostgreSQL in esecuzione)  
> **Path progetto:** `/Users/r.amoroso/Documents/Cursor/AXSHARE`  
> **Output atteso:** schema DB completo con RLS, modelli SQLAlchemy, prima migration Alembic  

---

## Obiettivo

Schema completo del database con modelli SQLAlchemy 2.0 async, Row Level Security su PostgreSQL e migrazioni Alembic. Nomi file/path cifrati: il DB non contiene mai dati in chiaro.

---

## Deliverable

- [x] **backend/app/models/base.py** — Base, TimestampMixin, UUIDMixin
- [x] **backend/app/models/user.py** — User, UserRole (email, display_name_encrypted, chiavi, webauthn, totp)
- [x] **backend/app/models/group.py** — Group, GroupMember, GroupRole
- [x] **backend/app/models/file.py** — Folder, File (name_encrypted, file_key_encrypted, storage_path, versioning, auto-destroy)
- [x] **backend/app/models/permission.py** — Permission, PermissionLevel (subject user/group, resource file/folder, expires_at)
- [x] **backend/app/models/audit.py** — AuditLog (action, resource_type, details JSONB, log_hash)
- [x] **backend/app/models/signature.py** — FileSignature (CAdES/PAdES)
- [x] **backend/app/models/__init__.py** — export di tutti i modelli
- [x] **backend/app/database.py** — usa `from app.models import Base`
- [x] **backend/alembic.ini** — script_location, loggers
- [x] **backend/alembic/env.py** — async migrations, `include_schemas=True`, `version_table_schema="axshare"`
- [x] **Prima migration** — `fac610d5a3f1_initial_schema.py` (schema axshare, enum, tabelle)
- [x] **Migration RLS** — `a1b2c3d4e5f6_enable_rls.py` (RLS su files, folders, permissions; policy owner)

---

## Tabelle (schema axshare)

| Tabella          | Descrizione |
|------------------|-------------|
| users            | Utenti, chiavi pubbliche/private cifrate, WebAuthn, TOTP |
| groups           | Gruppi, name/description cifrati |
| group_members    | Membri gruppo, encrypted_group_key |
| folders          | Cartelle, name_encrypted, path_encrypted, parent_id |
| files            | File, name/mime cifrati, file_key_encrypted, storage_path, versioning, self_destruct |
| permissions      | Permessi user/group su file/folder, expires_at, resource_key_encrypted |
| audit_logs       | Audit (action, resource_type, details, log_hash) |
| file_signatures  | Firma digitale (CAdES/PAdES) |

---

## RLS

- **files**: policy `files_owner_policy` — `owner_id::text = current_setting('axshare.current_user_id', true)`
- **folders**: policy `folders_owner_policy` — stessa logica
- **permissions**: policy `permissions_owner_policy` — granted_by o subject_user = current_user_id

In sessione (es. middleware FastAPI):

```sql
SET LOCAL axshare.current_user_id = '<uuid_utente>';
```

---

## Comandi

```bash
cd /Users/r.amoroso/Documents/Cursor/AXSHARE/backend

# Dipendenze
pip install -r requirements.txt

# Migration (DB attivo e .env con DATABASE_URL)
alembic upgrade head

# Verifica tabelle
docker exec axshare_postgres psql -U axshare -d axshare_db -c "\\dt axshare.*"

# Rollback (se necessario)
alembic downgrade -1
```

---

## Risultato

- **Data completamento:** 2026-03-04  
- **Tabelle create:** axshare.users, axshare.groups, axshare.group_members, axshare.folders, axshare.files, axshare.permissions, axshare.audit_logs, axshare.file_signatures  
- **Migration applicata:** fac610d5a3f1 (initial_schema) + a1b2c3d4e5f6 (enable_rls)  
- **RLS abilitato:** files, folders, permissions con policy owner/current_user_id  
- **Errori:** Nessuno.  

---

## Prossimo task

**1.4** — MinIO bucket policy + config (`docs/TASK-1.4-minio-setup.md`).
