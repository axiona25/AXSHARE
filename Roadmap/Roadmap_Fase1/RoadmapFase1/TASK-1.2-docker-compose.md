# TASK 1.2 — Docker Compose Stack Completo
> **Fase:** 1 — Foundation & Infrastruttura
> **Prerequisiti:** Task 1.1 completato
> **Path progetto:** `/Users/r.amoroso/Documents/Cursor/AXSHARE`
> **Output atteso:** tutti i servizi Docker attivi e healthy

---

## Prompt Cursor

```
Sei un senior DevOps engineer. Il progetto AXSHARE si trova in
/Users/r.amoroso/Documents/Cursor/AXSHARE.

Devi creare la configurazione Docker Compose completa con:
PostgreSQL 16, Redis 7, MinIO, HashiCorp Vault, Adminer.

════════════════════════════════════════════════
STEP 1 — Crea docker-compose.yml nella root
════════════════════════════════════════════════

version: '3.9'

services:

  postgres:
    image: postgres:16-alpine
    container_name: axshare_postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: axshare
      POSTGRES_PASSWORD: axshare_password
      POSTGRES_DB: axshare_db
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./infra/docker/postgres/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U axshare -d axshare_db"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - axshare_net

  redis:
    image: redis:7-alpine
    container_name: axshare_redis
    restart: unless-stopped
    command: >
      redis-server
      --requirepass axshare_redis_password
      --appendonly yes
      --maxmemory 512mb
      --maxmemory-policy allkeys-lru
    volumes:
      - redis_data:/data
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "axshare_redis_password", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - axshare_net

  minio:
    image: minio/minio:latest
    container_name: axshare_minio
    restart: unless-stopped
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: axshare_minio
      MINIO_ROOT_PASSWORD: axshare_minio_secret
    volumes:
      - minio_data:/data
    ports:
      - "9000:9000"
      - "9001:9001"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
      interval: 15s
      timeout: 10s
      retries: 5
    networks:
      - axshare_net

  minio_init:
    image: minio/mc:latest
    container_name: axshare_minio_init
    depends_on:
      minio:
        condition: service_healthy
    entrypoint: >
      /bin/sh -c "
      mc alias set local http://minio:9000 axshare_minio axshare_minio_secret;
      mc mb --ignore-existing local/axshare-files;
      mc mb --ignore-existing local/axshare-keys;
      mc anonymous set none local/axshare-files;
      mc anonymous set none local/axshare-keys;
      echo 'MinIO buckets ready';
      "
    networks:
      - axshare_net

  vault:
    image: hashicorp/vault:1.15
    container_name: axshare_vault
    restart: unless-stopped
    environment:
      VAULT_DEV_ROOT_TOKEN_ID: dev-root-token
      VAULT_DEV_LISTEN_ADDRESS: 0.0.0.0:8200
    command: server -dev
    cap_add:
      - IPC_LOCK
    ports:
      - "8200:8200"
    healthcheck:
      test: ["CMD", "vault", "status"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - axshare_net

  adminer:
    image: adminer:latest
    container_name: axshare_adminer
    restart: unless-stopped
    depends_on:
      - postgres
    ports:
      - "8080:8080"
    environment:
      ADMINER_DEFAULT_SERVER: postgres
    networks:
      - axshare_net

volumes:
  postgres_data:
  redis_data:
  minio_data:

networks:
  axshare_net:
    driver: bridge
    name: axshare_network

════════════════════════════════════════════════
STEP 2 — Crea infra/docker/postgres/init.sql
════════════════════════════════════════════════

-- AXSHARE PostgreSQL Init
\c axshare_db;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "btree_gin";

CREATE SCHEMA IF NOT EXISTS axshare AUTHORIZATION axshare;

-- Crea anche il DB di test
CREATE DATABASE axshare_test WITH OWNER = axshare ENCODING = 'UTF8';
\c axshare_test;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE SCHEMA IF NOT EXISTS axshare AUTHORIZATION axshare;

════════════════════════════════════════════════
STEP 3 — Crea infra/docker/vault/init.sh
════════════════════════════════════════════════

#!/bin/bash
set -e
export VAULT_ADDR="http://localhost:8200"
export VAULT_TOKEN="dev-root-token"

echo "=== Inizializzazione Vault AXSHARE ==="

vault secrets enable -path=axshare kv-v2 2>/dev/null || echo "KV gia abilitato"
vault secrets enable transit 2>/dev/null || echo "transit gia abilitato"

vault write -f transit/keys/axshare-master-key \
  type=aes256-gcm96 exportable=false allow_plaintext_backup=false

vault policy write axshare-app - <<EOF
path "axshare/*" {
  capabilities = ["create", "read", "update", "delete", "list"]
}
path "transit/encrypt/axshare-master-key" {
  capabilities = ["update"]
}
path "transit/decrypt/axshare-master-key" {
  capabilities = ["update"]
}
EOF

echo "Vault pronto. KV: axshare/ | Transit key: axshare-master-key"

════════════════════════════════════════════════
STEP 4 — Aggiorna .env con password Redis
════════════════════════════════════════════════

Nel file .env sostituisci la riga REDIS_URL con:
REDIS_URL=redis://:axshare_redis_password@localhost:6379/0

Nel file .env.test:
REDIS_URL=redis://:axshare_redis_password@localhost:6379/1

════════════════════════════════════════════════
STEP 5 — Avvia e verifica
════════════════════════════════════════════════

Esegui da terminale:

cd /Users/r.amoroso/Documents/Cursor/AXSHARE

docker-compose up -d
sleep 15

# Inizializza Vault (solo prima volta)
docker exec axshare_vault sh /vault/config/init.sh

# Verifica tutti i servizi
docker-compose ps

# Output atteso: tutti Status = "healthy" o "Up"
# PostgreSQL:  localhost:5432
# Redis:       localhost:6379
# MinIO API:   http://localhost:9000
# MinIO UI:    http://localhost:9001
# Vault UI:    http://localhost:8200
# Adminer:     http://localhost:8080

Al termine aggiorna la sezione Risultato di questo file.
```

---

## Risultato
> *Compilare al completamento del task*

- Data completamento: ___
- PostgreSQL: ___
- Redis: ___
- MinIO: ___
- Vault: ___
- Adminer: ___
- Errori: ___
