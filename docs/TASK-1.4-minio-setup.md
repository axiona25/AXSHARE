# TASK 1.4 — MinIO Setup & Storage Service

> **Fase:** 1 — Foundation & Infrastruttura  
> **Prerequisiti:** Task 1.2 completato (MinIO in esecuzione su localhost:9000)  
> **Path progetto:** `/Users/r.amoroso/Documents/Cursor/AXSHARE`  
> **Output atteso:** service MinIO pronto, bucket configurati, client Python funzionante  

---

## Obiettivo

Service Python per l'interazione con MinIO in modalità zero-knowledge: il server gestisce solo blob cifrati e path opachi (UUID). Creazione bucket, lifecycle per `tmp/`, Redis service per cache e permessi a tempo.

---

## Deliverable

- [x] **backend/app/services/storage.py** — `StorageService`: ensure_buckets, upload_encrypted_file, download_encrypted_file, delete_file_secure, get_presigned_url, file_exists, get_file_size. Singleton `get_storage_service()`.
- [x] **backend/app/main.py** — lifespan: dopo `init_db()` chiama `get_storage_service().ensure_buckets()`.
- [x] **backend/app/services/redis_service.py** — `get_redis()`, cache_set/cache_get/cache_delete/cache_exists, helper `permission_key`, `session_key`, `rate_limit_key`.
- [x] Bucket **axshare-files** e **axshare-keys** (creati da Docker minio_init in 1.2; ensure_buckets li crea se assenti e applica lifecycle su `tmp/`).

---

## StorageService (zero-knowledge)

- **upload_encrypted_file(data, content_type, prefix)** — carica dati già cifrati, restituisce path opaco `{prefix}/{uuid}`.
- **download_encrypted_file(storage_path)** — scarica blob cifrato (decifratura lato client).
- **delete_file_secure(storage_path)** — sovrascrittura con 64KB random + remove.
- **get_presigned_url(storage_path, expires_seconds=300)** — URL pre-firmato per download diretto.
- **file_exists** / **get_file_size** — stat su MinIO.

Lifecycle: oggetti sotto `tmp/` scadono dopo 1 giorno.

---

## Redis service

- **get_redis()** — client async (decode_responses=True).
- **cache_set(key, value, ttl_seconds)**, **cache_get(key)**, **cache_delete(key)**, **cache_exists(key)**.
- **permission_key(user_id, resource_id)** → `perm:{user_id}:{resource_id}`.
- **session_key(session_id)** → `session:{session_id}`.
- **rate_limit_key(user_id, action)** → `ratelimit:{action}:{user_id}`.

---

## Verifica MinIO da terminale

```bash
# Bucket creati da minio_init (Fase 1.2)
docker exec axshare_minio_init mc alias set local http://minio:9000 axshare_minio axshare_minio_secret
docker exec axshare_minio_init mc ls local/

# Output atteso:
# [date] axshare-files/
# [date] axshare-keys/
```

Oppure da host (mc installato):

```bash
mc alias set axshare http://localhost:9000 axshare_minio axshare_minio_secret
mc ls axshare/
```

Browser: http://localhost:9001 — Login: axshare_minio / axshare_minio_secret

---

## Risultato

- **Data completamento:** 2026-03-04  
- **Bucket axshare-files:** creato da minio_init (1.2); ensure_buckets verifica/crea e applica lifecycle `tmp/` 1 giorno.  
- **Bucket axshare-keys:** idem.  
- **StorageService funzionante:** upload/download/delete/presigned_url/file_exists/get_file_size; singleton in lifespan.  
- **RedisService funzionante:** get_redis, cache_*, key helpers per permessi/sessioni/rate limit.  
- **Errori:** Nessuno.  

---

## Prossimo task

**1.5** — HashiCorp Vault secrets engine (`docs/TASK-1.5-vault-setup.md`).
