# TASK 1.5 — HashiCorp Vault: Secrets Engine + Policy + Client Python

> **Fase:** 1 — Foundation & Infrastruttura  
> **Prerequisiti:** Task 1.2 completato (Vault in esecuzione su localhost:8200)  
> **Path progetto:** `/Users/r.amoroso/Documents/Cursor/AXSHARE`  
> **Output atteso:** Vault configurato con KV e Transit engine, client Python hvac funzionante, test di fine fase VERDE  

---

## Obiettivo

Client Python per Vault (hvac), configurazione KV v2 e Transit, policy per l’applicazione. Il Vault protegge le KEK (key encryption keys), non decifra il contenuto dei file.

---

## Deliverable

- [x] **backend/app/crypto/vault.py** — `VaultService`: health_check, write_secret, read_secret, delete_secret, list_secrets (KV v2); wrap_key, unwrap_key, rewrap_key, rotate_master_key (Transit); store_user_public_key, get_user_public_key, delete_user_keys. Singleton `get_vault_service()`.
- [x] **infra/docker/vault/init.sh** — policy aggiornata con path `transit/rewrap/axshare-master-key` e `transit/keys/axshare-master-key/rotate`.
- [x] **backend/tests/phase1/test_infra.py** — suite completa: PostgreSQL (connection, extensions, schema), Redis (connection, set/get), MinIO (connection, buckets, upload/download), Vault (health, KV, Transit wrap/unwrap), API /health.
- [x] **backend/tests/conftest.py** — load_dotenv da backend/.env.test o repo root, fixture event_loop (session).

---

## Inizializzazione Vault (da terminale)

Dopo `docker compose up -d`:

```bash
docker exec axshare_vault sh /vault/config/init.sh
```

Oppure manuale nel container:

```bash
docker exec -it axshare_vault sh
export VAULT_ADDR="http://127.0.0.1:8200"
export VAULT_TOKEN="dev-root-token"
vault secrets enable -path=axshare kv-v2
vault secrets enable transit
vault write -f transit/keys/axshare-master-key type=aes256-gcm96 exportable=false allow_plaintext_backup=false
vault policy write axshare-app - <<'EOF'
path "axshare/*" { capabilities = ["create", "read", "update", "delete", "list"] }
path "transit/encrypt/axshare-master-key" { capabilities = ["update"] }
path "transit/decrypt/axshare-master-key" { capabilities = ["update"] }
path "transit/rewrap/axshare-master-key" { capabilities = ["update"] }
path "transit/keys/axshare-master-key/rotate" { capabilities = ["update"] }
EOF
exit
```

---

## Test di fine Fase 1

Con stack Docker attivo, `.env`/`.env.test` configurati e (per test_api_health) backend in ascolto su 8000:

```bash
cd backend
source .venv/bin/activate
pytest tests/phase1/ -v --tb=short
```

Output atteso: **12 passed** (postgresql_connection, postgresql_extensions, postgresql_schema, redis_connection, redis_set_get, minio_connection, minio_buckets_exist, minio_upload_download, vault_health, vault_kv_engine, vault_transit_wrap_unwrap, api_health).

---

## Risultato

- **Data completamento:** 2026-03-04  
- **Vault KV engine:** path `axshare/`, mount_point da `VAULT_MOUNT_PATH`; write/read/delete/list da `VaultService`.  
- **Vault Transit engine:** chiave `axshare-master-key` (aes256-gcm96); wrap/unwrap/rewrap/rotate da `VaultService`.  
- **Key wrap/unwrap test:** test_vault_transit_wrap_unwrap passa (32 bytes wrap → unwrap → stesso plaintext).  
- **Test suite fase 1:** 12 test (PostgreSQL 3, Redis 2, MinIO 3, Vault 3, API 1); tutti passano con stack e .env configurati.  
- **Errori:** Nessuno.  

**FASE 1 COMPLETATA.**

---

## Prossimo

**FASE 2** — Crittografia & Key Management (2.1 → 2.5).
