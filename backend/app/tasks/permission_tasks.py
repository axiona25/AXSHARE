"""
Task Celery per TTL permessi: invalida permessi scaduti e notifica in scadenza.
Pubblica su Redis per future notifiche push.
"""

from datetime import datetime, timezone, timedelta

from celery import shared_task
from sqlalchemy import select, and_
import structlog

logger = structlog.get_logger()


async def _expire_permissions_async():
    from app.database import AsyncSessionLocal
    from app.models.permission import Permission

    now = datetime.now(timezone.utc)
    expired_count = 0

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Permission).where(
                and_(
                    Permission.is_active.is_(True),
                    Permission.expires_at.isnot(None),
                    Permission.expires_at <= now,
                )
            )
        )
        permissions = result.scalars().all()

        for perm in permissions:
            perm.is_active = False
            perm.resource_key_encrypted = None
            expired_count += 1
            logger.info(
                "permission_expired",
                permission_id=str(perm.id),
                subject_user_id=str(perm.subject_user_id),
                resource_file_id=str(perm.resource_file_id) if perm.resource_file_id else None,
            )

        if expired_count > 0:
            await db.commit()
            try:
                import redis.asyncio as aioredis
                from app.config import get_settings
                settings = get_settings()
                r = aioredis.from_url(settings.redis_url, decode_responses=True)
                await r.publish(
                    "permissions:expired",
                    f"{expired_count} permissions expired at {now.isoformat()}",
                )
                await r.aclose()
            except Exception as e:
                logger.warning("redis_publish_failed", error=str(e))

    logger.info("expire_permissions_done", expired_count=expired_count)
    return {"expired": expired_count}


async def _notify_expiring_soon_async():
    from app.database import AsyncSessionLocal
    from app.models.permission import Permission

    now = datetime.now(timezone.utc)
    soon = now + timedelta(hours=24)

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Permission).where(
                and_(
                    Permission.is_active.is_(True),
                    Permission.expires_at.isnot(None),
                    Permission.expires_at > now,
                    Permission.expires_at <= soon,
                )
            )
        )
        expiring = result.scalars().all()

        if expiring:
            try:
                import redis.asyncio as aioredis
                from app.config import get_settings
                r = aioredis.from_url(get_settings().redis_url, decode_responses=True)
                for perm in expiring:
                    await r.publish("permissions:expiring_soon", str(perm.id))
                await r.aclose()
            except Exception as e:
                logger.warning("redis_publish_failed", error=str(e))

    return {"expiring_soon": len(expiring)}


@shared_task(name="tasks.expire_permissions", bind=True, max_retries=3)
def expire_permissions(self):
    """
    Task Celery periodico: invalida permessi scaduti.
    Eseguire ogni 5 minuti via Celery Beat.
    Pubblica su Redis channel 'permissions:expired' per ogni batch.
    """
    import asyncio
    return asyncio.run(_expire_permissions_async())


@shared_task(name="tasks.notify_expiring_soon")
def notify_expiring_soon():
    """
    Notifica permessi in scadenza nelle prossime 24h.
    Pubblica su Redis channel 'permissions:expiring_soon'.
    """
    import asyncio
    return asyncio.run(_notify_expiring_soon_async())
