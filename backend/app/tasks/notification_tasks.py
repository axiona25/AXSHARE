"""Task Celery: notifiche permessi in scadenza, email invito guest."""

import logging
from datetime import datetime, timezone, timedelta

from sqlalchemy import select

from app.core.celery_app import celery_app
from app.database import AsyncSessionLocal
from app.models.permission import Permission
from app.models.user import User
from app.services.notification_service import NotificationService
from app.services.email_service import EmailService

logger = logging.getLogger(__name__)


async def _notify_expiring_permissions_async():
    now = datetime.now(timezone.utc)
    threshold = now + timedelta(hours=24)
    notified = 0
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Permission).where(
                Permission.expires_at.isnot(None),
                Permission.expires_at >= now,
                Permission.expires_at <= threshold,
                Permission.is_active.is_(True),
            )
        )
        for perm in result.scalars().all():
            if perm.subject_user_id is None:
                continue
            hours_left = int(
                (perm.expires_at - now).total_seconds() / 3600
            )
            await NotificationService.notify_permission_expiring(
                db=db,
                user_id=perm.subject_user_id,
                file_id=str(perm.resource_file_id) if perm.resource_file_id else "",
                file_name_encrypted="",
                hours_remaining=hours_left,
            )
            user_result = await db.execute(select(User).where(User.id == perm.subject_user_id))
            user = user_result.scalar_one_or_none()
            if user and user.email:
                await EmailService.send_permission_expiring(
                    to_email=user.email,
                    hours_remaining=hours_left,
                )
            notified += 1
    return notified


@celery_app.task
def notify_expiring_permissions():
    """
    Controlla permessi che scadono nelle prossime 24h
    e invia notifica in-app + email all'utente.
    """
    import asyncio

    count = asyncio.run(_notify_expiring_permissions_async())
    logger.info("Notifiche scadenza permessi inviate: %s", count)
    return {"notified": count}


@celery_app.task
def send_guest_invite_email(
    guest_email: str,
    invite_url: str,
    owner_email: str,
    expires_in_hours: int,
    file_count: int = 1,
):
    """
    Invia email di invito guest.
    Chiamato da POST /guest/invite in modo asincrono.
    """
    import asyncio

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        result = loop.run_until_complete(
            EmailService.send_guest_invite(
                guest_email=guest_email,
                invite_url=invite_url,
                owner_email=owner_email,
                file_count=file_count,
                expires_in_hours=expires_in_hours,
            )
        )
        logger.info(
            "Email guest invite %s: %s",
            "inviata" if result else "FALLITA",
            guest_email,
        )
        return {"sent": result, "to": guest_email}
    finally:
        loop.close()
