# TASK 1.2 — Docker Compose Stack Completo

> **Fase:** 1 — Foundation & Infrastruttura  
> **Prerequisiti:** Task 1.1 completato  
> **Path progetto:** `/Users/r.amoroso/Documents/Cursor/AXSHARE`  
> **Output atteso:** tutti i servizi Docker attivi e healthy  

---

## Obiettivo

Configurazione Docker Compose completa con PostgreSQL 16, Redis 7, MinIO (con creazione bucket), HashiCorp Vault, Adminer. Tutti i servizi con healthcheck dove possibile; variabili coerenti con `.env.example`.

---

## Deliverable

- [x] `docker-compose.yml` (version 3.9) con: **postgres**, **redis**, **minio**, **minio_init**, **vault**, **adminer**
- [x] `infra/docker/postgres/init.sql` — estensioni (uuid-ossp, pgcrypto, pg_trgm, btree_gin), schema `axshare`, DB `axshare_test`
- [x] `infra/docker/vault/init.sh` — KV v2 su path `axshare`, Transit key `axshare-master-key`, policy `axshare-app`
- [x] `.env.example` e `.env.test` — `REDIS_URL` con password: `redis://:axshare_redis_password@localhost:6379/0` (e `/1` per test)
- [x] Rete `axshare_net`, volumi nominati, healthcheck su postgres, redis, minio, vault
- [x] Documentazione comandi e sezione Risultato

---

## Servizi

| Servizio    | Container           | Image / Command                    | Porte      | Note |
|------------|---------------------|------------------------------------|------------|------|
| postgres   | axshare_postgres    | postgres:16-alpine                 | 5432       | init.sql in docker-entrypoint-initdb.d |
| redis      | axshare_redis       | redis:7-alpine + requirepass       | 6379       | appendonly, maxmemory 512mb |
| minio      | axshare_minio       | minio (tag con curl per healthcheck) | 9000, 9001 | console :9001 |
| minio_init | axshare_minio_init  | minio/mc — crea bucket             | —          | dipende da minio healthy |
| vault      | axshare_vault       | hashicorp/vault:1.15               | 8200       | dev mode, volume init.sh |
| adminer    | axshare_adminer     | adminer:latest                     | 8080       | dipende da postgres healthy |

---

## Comandi

```bash
cd /Users/r.amoroso/Documents/Cursor/AXSHARE

# Avvio stack
docker compose up -d

# Attesa (opzionale)
sleep 15
# oppure
./scripts/wait-for-infra.sh

# Inizializzazione Vault (solo prima volta)
docker exec axshare_vault sh /vault/config/init.sh

# Verifica
docker compose ps
# Output atteso: tutti Status = "healthy" o "Up"
```

**URL servizi:**

- PostgreSQL: localhost:5432  
- Redis: localhost:6379  
- MinIO API: http://localhost:9000  
- MinIO Console: http://localhost:9001  
- Vault: http://localhost:8200  
- Adminer: http://localhost:8080  

---

## ALLOWED_ORIGINS e REDIS

- In `.env`: `ALLOWED_ORIGINS=["http://localhost:3000"]` (JSON array).
- Redis con password: `REDIS_URL=redis://:axshare_redis_password@localhost:6379/0` (in `.env.example` e `.env.test`).

---

## Risultato

- **Data completamento:** 2026-03-04  
- **PostgreSQL:** axshare_postgres, init.sql applicato, schema axshare, DB axshare_test creato.  
- **Redis:** axshare_redis, password `axshare_redis_password`, healthcheck con `redis-cli -a ... ping`.  
- **MinIO:** axshare_minio (healthcheck curl), minio_init crea bucket `axshare-files` e `axshare-keys`, anonymous set none.  
- **Vault:** axshare_vault 1.15, volume mount per init.sh; esecuzione manuale `docker exec axshare_vault sh /vault/config/init.sh` per KV e Transit.  
- **Adminer:** axshare_adminer su 8080, ADMINER_DEFAULT_SERVER=postgres.  
- **Errori:** Nessuno. Nota: immagine MinIO pinnata a tag con curl per healthcheck (RELEASE.2023-10-25); immagini più recenti potrebbero non includere curl.

---

## Prossimo task

**1.3** — PostgreSQL schema + RLS + Alembic (`docs/TASK-1.3-postgresql-schema.md`).
