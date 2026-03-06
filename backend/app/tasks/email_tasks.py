"""Task Celery: email (invito guest in notification_tasks; erasure qui)."""

import logging

from app.core.celery_app import celery_app
from app.services.email_service import EmailService

logger = logging.getLogger(__name__)


@celery_app.task
def send_email_stub(to: str, subject: str, body: str):
    """Stub per future implementazioni SMTP/SendGrid."""
    logger.info("[EMAIL] stub to=%s subject=%s", to, subject)
    return {"sent": False, "stub": True}


@celery_app.task
def send_erasure_confirmed_email(to_email: str, request_id: str, requested_at: str):
    """Invia email di conferma richiesta cancellazione account (GDPR Art. 17)."""
    import asyncio

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        result = loop.run_until_complete(
            EmailService.send_erasure_confirmed(
                to_email=to_email,
                request_id=request_id,
                requested_at=requested_at,
            )
        )
        return {"sent": result}
    finally:
        loop.close()
