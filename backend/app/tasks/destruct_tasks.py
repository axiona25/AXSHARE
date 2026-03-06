"""Task Celery per distruzione file scaduti (self_destruct_at)."""

from celery import shared_task
import structlog

logger = structlog.get_logger()


async def _destroy_expired_files_async():
    from datetime import datetime, timezone

    from sqlalchemy import select, and_

    from app.database import AsyncSessionLocal
    from app.models.file import File
    from app.services.destruct_service import DestructService

    now = datetime.now(timezone.utc)
    destroyed_count = 0

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(File).where(
                and_(
                    File.is_destroyed.is_(False),
                    File.self_destruct_at.isnot(None),
                    File.self_destruct_at <= now,
                )
            )
        )
        files = result.scalars().all()
        for file in files:
            try:
                await DestructService.destroy_file(
                    db, file.id, reason="scheduled_destruct"
                )
                destroyed_count += 1
            except Exception as e:
                logger.error(
                    "destroy_failed", file_id=str(file.id), error=str(e)
                )

    logger.info(
        "destroy_expired_files_done", destroyed_count=destroyed_count
    )
    return {"destroyed": destroyed_count}


@shared_task(name="tasks.destroy_expired_files", bind=True, max_retries=3)
def destroy_expired_files(self):
    """
    Task Celery: distrugge file la cui self_destruct_at è passata.
    Eseguire ogni minuto via Celery Beat.
    """
    import asyncio

    return asyncio.run(_destroy_expired_files_async())
