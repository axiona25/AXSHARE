"""Task Celery: retention GDPR e elaborazione erasure pendenti."""

import logging

from sqlalchemy import select

from app.core.celery_app import celery_app
from app.database import AsyncSessionLocal
from app.models.gdpr import GdprDeletionRequest
from app.services.gdpr_service import GdprService

logger = logging.getLogger(__name__)


@celery_app.task
def run_retention_cleanup(retention_days: int = 365):
    """Retention GDPR automatica (ogni notte alle 2:00)."""
    import asyncio

    async def _run():
        async with AsyncSessionLocal() as db:
            return await GdprService.run_retention_cleanup(db, retention_days)

    summary = asyncio.run(_run())
    logger.info("Retention cleanup: %s", summary)
    return summary


@celery_app.task
def process_pending_erasures():
    """Elabora richieste di erasure GDPR pendenti (ogni notte alle 3:00)."""
    import asyncio

    async def _run():
        processed = 0
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(GdprDeletionRequest).where(
                    GdprDeletionRequest.status == "pending"
                )
            )
            for req in result.scalars().all():
                try:
                    await GdprService.process_erasure(db, req)
                    processed += 1
                    logger.info("Erasure elaborata: %s", req.id)
                except Exception as e:
                    logger.error("Errore erasure %s: %s", req.id, e)
        return processed

    count = asyncio.run(_run())
    logger.info("Erasure GDPR elaborate: %s", count)
    return {"processed": count}
