"""Task Celery: auto-distruzione file (self_destruct_at)."""

import logging
from datetime import datetime, timezone

from sqlalchemy import select

from app.core.celery_app import celery_app
from app.database import AsyncSessionLocal
from app.models.file import File
from app.services.destruct_service import DestructService

logger = logging.getLogger(__name__)


async def _process_self_destruct_async():
    now = datetime.now(timezone.utc)
    destroyed = 0
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(File).where(
                File.self_destruct_at.isnot(None),
                File.self_destruct_at <= now,
                File.is_destroyed.is_(False),
            )
        )
        files = result.scalars().all()
        for file in files:
            try:
                await DestructService.destroy_file(
                    db, file.id, reason="scheduled_destruct"
                )
                destroyed += 1
                logger.info("File auto-distrutto: %s", file.id)
            except Exception as e:
                logger.error("Errore auto-distruzione %s: %s", file.id, e)
    return destroyed


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)
def process_self_destruct_files(self):
    """
    Elabora tutti i file con self_destruct_at <= now e is_destroyed = False.
    Sostituisce il check sincrono nel middleware/endpoint.
    """
    import asyncio

    try:
        count = asyncio.run(_process_self_destruct_async())
        logger.info("Auto-distruzione: %s file eliminati", count)
        return {"destroyed": count}
    except Exception as exc:
        raise self.retry(exc=exc)


@celery_app.task
def trigger_self_destruct(file_id: str, eta_seconds: int = 0):
    """
    Schedula l'auto-distruzione di un singolo file.
    Chiamato quando un file viene creato con destroy_at.
    """
    process_self_destruct_files.apply_async(countdown=eta_seconds)
    logger.info(
        "Auto-distruzione schedulata per file %s in %ss", file_id, eta_seconds
    )
