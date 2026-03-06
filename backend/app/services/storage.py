"""
MinIO storage service — zero-knowledge.
Il server gestisce solo blob cifrati; nomi su MinIO sono sempre UUID opachi.
"""

import uuid
import asyncio
from typing import Optional
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

    async def health_check(self) -> None:
        """Verifica che lo storage (MinIO) sia raggiungibile."""
        loop = asyncio.get_event_loop()
        exists = await loop.run_in_executor(
            None, self.client.bucket_exists, self.bucket_files
        )
        if not exists:
            raise RuntimeError("Bucket files non trovato o MinIO non raggiungibile")

    async def upload_encrypted_file(
        self,
        user_id: uuid.UUID,
        file_id: uuid.UUID,
        data: bytes,
        content_type: str = "application/octet-stream",
        path_suffix: Optional[str] = None,
    ) -> str:
        """
        Carica dati cifrati su MinIO per un file associato a un utente.
        Restituisce il path opaco (files/{user_id}/{file_id} o .../file_id/suffix per versioni).
        Il contenuto deve essere GIA' CIFRATO prima di chiamare questo metodo.
        """
        base = f"files/{user_id}/{file_id}"
        storage_path = f"{base}/{path_suffix}" if path_suffix else base
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
        import os

        loop = asyncio.get_event_loop()

        # Sovrascrittura con dati casuali prima della delete (best-effort)
        try:
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
                lambda: self.client.stat_object(
                    self.bucket_files, storage_path
                ),
            )
            return True
        except S3Error:
            return False

    async def get_file_size(self, storage_path: str) -> int:
        """Restituisce la dimensione in bytes del file cifrato."""
        loop = asyncio.get_event_loop()
        stat = await loop.run_in_executor(
            None,
            lambda: self.client.stat_object(
                self.bucket_files, storage_path
            ),
        )
        return stat.size


# Singleton
_storage_service: Optional[StorageService] = None


def get_storage_service() -> StorageService:
    global _storage_service
    if _storage_service is None:
        _storage_service = StorageService()
    return _storage_service
