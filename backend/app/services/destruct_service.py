"""Servizio di auto-distruzione file: MinIO, Vault, DB, revoca permessi."""

from uuid import UUID
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession
import structlog

logger = structlog.get_logger()


class DestructService:
    @staticmethod
    async def destroy_file(
        db: AsyncSession, file_id: UUID, reason: str = "manual"
    ) -> bool:
        """
        Distrugge un file:
        1. Elimina blob da MinIO (sovrascrittura sicura)
        2. Elimina chiavi da Vault
        3. Imposta is_destroyed=True e azzera file_key_encrypted nel DB
        4. Revoca tutti i permessi attivi
        Restituisce True se distrutto, False se già distrutto.
        """
        from app.models.file import File
        from app.models.permission import Permission
        from app.services.storage import get_storage_service

        file = await db.get(File, file_id)
        if not file:
            raise HTTPException(status_code=404, detail="File non trovato")
        if file.is_destroyed:
            return False

        # 1. Elimina da MinIO (sovrascrittura sicura)
        try:
            storage = get_storage_service()
            await storage.delete_file_secure(file.storage_path)
        except Exception as e:
            logger.warning(
                "minio_delete_failed", file_id=str(file_id), error=str(e)
            )

        # 2. Elimina chiavi da Vault
        try:
            from app.crypto.vault import get_vault_service

            vault = get_vault_service()
            vault.delete_file_key(str(file_id))
        except Exception as e:
            logger.warning(
                "vault_key_delete_failed", file_id=str(file_id), error=str(e)
            )

        # 3. Aggiorna DB (azzera chiavi; colonne non nullable → stringa vuota)
        file.is_destroyed = True
        file.file_key_encrypted = ""
        file.encryption_iv = ""
        file.storage_path = f"destroyed/{file_id}"

        # 4. Revoca tutti i permessi
        result = await db.execute(
            select(Permission).where(
                and_(
                    Permission.resource_file_id == file_id,
                    Permission.is_active.is_(True),
                )
            )
        )
        for perm in result.scalars().all():
            perm.is_active = False
            perm.resource_key_encrypted = None

        await db.commit()

        try:
            from app.services.audit_service import AuditService

            await AuditService.log(
                db,
                action="file_destroyed",
                resource_type="file",
                resource_id=file_id,
                details={"reason": reason},
            )
        except Exception as e:
            logger.warning(
                "audit_after_destroy_failed",
                file_id=str(file_id),
                error=str(e),
            )

        logger.info("file_destroyed", file_id=str(file_id), reason=reason)
        return True

    @staticmethod
    async def check_and_destroy_on_download(
        db: AsyncSession, file_id: UUID
    ) -> None:
        """
        Chiamare dopo ogni download.
        Se il file ha raggiunto il limite di download, lo distrugge.
        """
        from app.models.file import File

        file = await db.get(File, file_id)
        if not file or file.is_destroyed:
            return

        if (
            file.self_destruct_after_downloads is not None
            and file.download_count >= file.self_destruct_after_downloads
        ):
            await DestructService.destroy_file(
                db, file_id, reason="download_limit"
            )

    @staticmethod
    async def set_self_destruct(
        db: AsyncSession,
        owner_id: UUID,
        file_id: UUID,
        after_downloads: Optional[int] = None,
        destruct_at: Optional[datetime] = None,
    ) -> dict:
        """
        Imposta le condizioni di auto-distruzione su un file.
        Solo l'owner può configurarle.
        """
        from app.models.file import File

        file = await db.get(File, file_id)
        if not file:
            raise HTTPException(status_code=404, detail="File non trovato")
        if file.owner_id != owner_id:
            raise HTTPException(status_code=403, detail="Non autorizzato")
        if file.is_destroyed:
            raise HTTPException(status_code=410, detail="File già distrutto")

        if after_downloads is not None:
            if after_downloads < 1:
                raise HTTPException(
                    status_code=400,
                    detail="after_downloads deve essere >= 1",
                )
            file.self_destruct_after_downloads = after_downloads

        if destruct_at is not None:
            if destruct_at <= datetime.now(timezone.utc):
                raise HTTPException(
                    status_code=400,
                    detail="destruct_at deve essere nel futuro",
                )
            file.self_destruct_at = destruct_at

        await db.commit()
        return {
            "file_id": str(file_id),
            "self_destruct_after_downloads": file.self_destruct_after_downloads,
            "self_destruct_at": (
                file.self_destruct_at.isoformat()
                if file.self_destruct_at
                else None
            ),
        }
