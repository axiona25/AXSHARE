# TASK 1.4 — MinIO Setup & Storage Service
> **Fase:** 1 — Foundation & Infrastruttura
> **Prerequisiti:** Task 1.2 completato (MinIO in esecuzione su localhost:9000)
> **Path progetto:** `/Users/r.amoroso/Documents/Cursor/AXSHARE`
> **Output atteso:** service MinIO pronto, bucket configurati, client Python funzionante

---

## Prompt Cursor

```
Sei un senior backend engineer. Il progetto AXSHARE si trova in
/Users/r.amoroso/Documents/Cursor/AXSHARE.
MinIO e' in esecuzione su localhost:9000 (credenziali: axshare_minio / axshare_minio_secret).

Devi creare il service Python per l'interazione con MinIO, con bucket policy
zero-knowledge (il server non puo' mai aprire i file direttamente).

════════════════════════════════════════════════
STEP 1 — Crea backend/app/services/storage.py
════════════════════════════════════════════════

import uuid
import asyncio
from typing import AsyncGenerator, Optional
from io import BytesIO
from minio import Minio
from minio.error import S3Error
from minio.commonconfig import ENABLED, Filter
from minio.lifecycleconfig import LifecycleConfig, Rule, Expiration
import structlog

from app.config import get_settings

logger = structlog.get_logger()
settings = get_settings()


class StorageService:
    """
    Service MinIO zero-knowledge.
    Il server gestisce solo blob cifrati — mai contenuto in chiaro.
    Il nome dei file su MinIO e' sempre un UUID opaco.
    """

    def __init__(self):
        self.client = Minio(
            f"{settings.minio_endpoint}:{settings.minio_port}",
            access_key=settings.minio_access_key,
            secret_key=settings.minio_secret_key,
            secure=settings.minio_secure,
        )
        self.bucket_files = settings.minio_bucket_files
        self.bucket_keys = settings.minio_bucket_keys

    async def ensure_buckets(self) -> None:
        """Verifica ed eventualmente crea i bucket necessari."""
        loop = asyncio.get_event_loop()

        for bucket_name in [self.bucket_files, self.bucket_keys]:
            exists = await loop.run_in_executor(
                None, self.client.bucket_exists, bucket_name
            )
            if not exists:
                await loop.run_in_executor(
                    None, self.client.make_bucket, bucket_name
                )
                logger.info("Bucket created", bucket=bucket_name)

                # Applica lifecycle rule: elimina oggetti scaduti
                config = LifecycleConfig(
                    [
                        Rule(
                            ENABLED,
                            rule_filter=Filter(prefix="tmp/"),
                            rule_id="delete-tmp",
                            expiration=Expiration(days=1),
                        ),
                    ]
                )
                await loop.run_in_executor(
                    None,
                    self.client.set_bucket_lifecycle,
                    bucket_name,
                    config,
                )
            else:
                logger.info("Bucket already exists", bucket=bucket_name)

    async def upload_encrypted_file(
        self,
        data: bytes,
        content_type: str = "application/octet-stream",
        prefix: str = "files",
    ) -> str:
        """
        Carica dati cifrati su MinIO.
        Restituisce il path opaco (UUID) — mai il nome originale.
        Il contenuto deve essere GIA' CIFRATO prima di chiamare questo metodo.
        """
        storage_path = f"{prefix}/{uuid.uuid4()}"
        loop = asyncio.get_event_loop()

        await loop.run_in_executor(
            None,
            lambda: self.client.put_object(
                self.bucket_files,
                storage_path,
                BytesIO(data),
                length=len(data),
                content_type=content_type,
            ),
        )

        logger.info(
            "Encrypted file uploaded",
            path=storage_path,
            size=len(data),
        )
        return storage_path

    async def download_encrypted_file(self, storage_path: str) -> bytes:
        """
        Scarica dati cifrati da MinIO.
        Il contenuto e' ancora cifrato — la decifratura avviene lato client.
        """
        loop = asyncio.get_event_loop()

        response = await loop.run_in_executor(
            None,
            lambda: self.client.get_object(self.bucket_files, storage_path),
        )

        try:
            data = response.read()
        finally:
            response.close()
            response.release_conn()

        logger.info(
            "Encrypted file downloaded",
            path=storage_path,
            size=len(data),
        )
        return data

    async def delete_file_secure(self, storage_path: str) -> None:
        """
        Eliminazione sicura: rimuove il file da MinIO.
        Per auto-distruzione: prima sovrascrivere con dati casuali (vedi Fase 6).
        """
        loop = asyncio.get_event_loop()

        # Sovrascrittura con dati casuali prima della delete (best-effort)
        try:
            import os
            random_data = os.urandom(1024 * 64)  # 64KB di dati casuali
            await loop.run_in_executor(
                None,
                lambda: self.client.put_object(
                    self.bucket_files,
                    storage_path,
                    BytesIO(random_data),
                    length=len(random_data),
                    content_type="application/octet-stream",
                ),
            )
        except Exception as e:
            logger.warning("Overwrite before delete failed", error=str(e))

        # Eliminazione definitiva
        await loop.run_in_executor(
            None,
            lambda: self.client.remove_object(self.bucket_files, storage_path),
        )

        logger.info("File securely deleted", path=storage_path)

    async def get_presigned_url(
        self, storage_path: str, expires_seconds: int = 300
    ) -> str:
        """
        Genera URL pre-firmato per download diretto (max 5 min).
        Usato per stream di file di grandi dimensioni.
        """
        from datetime import timedelta

        loop = asyncio.get_event_loop()
        url = await loop.run_in_executor(
            None,
            lambda: self.client.presigned_get_object(
                self.bucket_files,
                storage_path,
                expires=timedelta(seconds=expires_seconds),
            ),
        )
        return url

    async def file_exists(self, storage_path: str) -> bool:
        """Verifica se un file esiste su MinIO."""
        loop = asyncio.get_event_loop()
        try:
            await loop.run_in_executor(
                None,
                lambda: self.client.stat_object(self.bucket_files, storage_path),
            )
            return True
        except S3Error:
            return False

    async def get_file_size(self, storage_path: str) -> int:
        """Restituisce la dimensione in bytes del file cifrato."""
        loop = asyncio.get_event_loop()
        stat = await loop.run_in_executor(
            None,
            lambda: self.client.stat_object(self.bucket_files, storage_path),
        )
        return stat.size


# Singleton
_storage_service: Optional[StorageService] = None


def get_storage_service() -> StorageService:
    global _storage_service
    if _storage_service is None:
        _storage_service = StorageService()
    return _storage_service

════════════════════════════════════════════════
STEP 2 — Aggiorna backend/app/main.py
════════════════════════════════════════════════

Modifica la funzione lifespan in backend/app/main.py per inizializzare MinIO:

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting AXSHARE API", version=settings.app_version)
    await init_db()
    # Inizializza MinIO buckets
    from app.services.storage import get_storage_service
    storage = get_storage_service()
    await storage.ensure_buckets()
    yield
    logger.info("Shutting down AXSHARE API")

════════════════════════════════════════════════
STEP 3 — Crea backend/app/services/redis_service.py
════════════════════════════════════════════════

import redis.asyncio as redis
from typing import Optional, Any
import json
import structlog

from app.config import get_settings

logger = structlog.get_logger()
settings = get_settings()

_redis_client: Optional[redis.Redis] = None


async def get_redis() -> redis.Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = redis.from_url(
            settings.redis_url,
            encoding="utf-8",
            decode_responses=True,
        )
    return _redis_client


async def cache_set(key: str, value: Any, ttl_seconds: int = 3600) -> None:
    client = await get_redis()
    serialized = json.dumps(value) if not isinstance(value, str) else value
    await client.setex(key, ttl_seconds, serialized)


async def cache_get(key: str) -> Optional[Any]:
    client = await get_redis()
    value = await client.get(key)
    if value is None:
        return None
    try:
        return json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return value


async def cache_delete(key: str) -> None:
    client = await get_redis()
    await client.delete(key)


async def cache_exists(key: str) -> bool:
    client = await get_redis()
    return bool(await client.exists(key))


# Chiavi per permessi a tempo
def permission_key(user_id: str, resource_id: str) -> str:
    return f"perm:{user_id}:{resource_id}"


# Chiavi per sessioni
def session_key(session_id: str) -> str:
    return f"session:{session_id}"


# Chiavi per rate limiting
def rate_limit_key(user_id: str, action: str) -> str:
    return f"ratelimit:{action}:{user_id}"

════════════════════════════════════════════════
STEP 4 — Verifica MinIO da terminale
════════════════════════════════════════════════

Esegui:

# Verifica bucket via MinIO CLI (mc)
docker exec axshare_minio_init mc alias set local http://localhost:9000 axshare_minio axshare_minio_secret
docker exec axshare_minio_init mc ls local/

# Output atteso:
# [date] axshare-files/
# [date] axshare-keys/

# Oppure apri browser: http://localhost:9001
# Login: axshare_minio / axshare_minio_secret

Al termine aggiorna la sezione Risultato di questo file.
```

---

## Risultato
> *Compilare al completamento del task*

- Data completamento: ___
- Bucket axshare-files: ___
- Bucket axshare-keys: ___
- StorageService funzionante: ___
- RedisService funzionante: ___
- Errori: ___
