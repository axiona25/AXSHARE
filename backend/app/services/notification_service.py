"""Servizio notifiche in-app e alerting."""

import uuid
from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.notification_types import NotificationSeverity, NotificationType
from app.models.notification import Notification


class NotificationService:
    @staticmethod
    async def create(
        db: AsyncSession,
        user_id: uuid.UUID,
        type: str,
        title: str,
        body: Optional[str] = None,
        resource_type: Optional[str] = None,
        resource_id: Optional[str] = None,
        action_url: Optional[str] = None,
        severity: str = NotificationSeverity.INFO,
    ) -> Notification:
        notif = Notification(
            user_id=user_id,
            type=type,
            title=title,
            body=body,
            resource_type=resource_type,
            resource_id=resource_id,
            action_url=action_url,
            severity=severity,
        )
        db.add(notif)
        await db.commit()
        await db.refresh(notif)
        return notif

    @staticmethod
    async def notify_permission_expiring(
        db: AsyncSession,
        user_id: uuid.UUID,
        file_id: str,
        file_name_encrypted: str,
        hours_remaining: int,
    ) -> None:
        await NotificationService.create(
            db=db,
            user_id=user_id,
            type=NotificationType.PERMISSION_EXPIRING,
            title=f"Accesso in scadenza tra {hours_remaining}h",
            body="Il tuo accesso a un file condiviso scade presto.",
            resource_type="file",
            resource_id=file_id,
            action_url=f"/files/{file_id}",
            severity=NotificationSeverity.WARNING,
        )

    @staticmethod
    async def notify_signature_invalid(
        db: AsyncSession,
        user_id: uuid.UUID,
        file_id: str,
        version: int,
    ) -> None:
        await NotificationService.create(
            db=db,
            user_id=user_id,
            type=NotificationType.SIGNATURE_INVALID,
            title="Firma digitale non valida",
            body=f"La firma della versione {version} non è valida. Il file potrebbe essere stato modificato.",
            resource_type="file",
            resource_id=file_id,
            action_url=f"/files/{file_id}",
            severity=NotificationSeverity.ERROR,
        )

    @staticmethod
    async def notify_guest_accessed(
        db: AsyncSession,
        owner_id: uuid.UUID,
        guest_email: str,
        file_id: str,
    ) -> None:
        await NotificationService.create(
            db=db,
            user_id=owner_id,
            type=NotificationType.GUEST_ACCESS,
            title=f"Accesso guest da {guest_email}",
            body="Un utente guest ha acceduto a un tuo file.",
            resource_type="file",
            resource_id=file_id,
            action_url="/sharing",
            severity=NotificationSeverity.INFO,
        )

    @staticmethod
    async def notify_share_revoked(
        db: AsyncSession,
        user_id: uuid.UUID,
        file_id: str,
    ) -> None:
        await NotificationService.create(
            db=db,
            user_id=user_id,
            type=NotificationType.SHARE_REVOKED,
            title="Condivisione revocata",
            body="Un file condiviso con te non è più accessibile.",
            resource_type="file",
            resource_id=file_id,
            severity=NotificationSeverity.WARNING,
        )

    @staticmethod
    async def notify_security_alert(
        db: AsyncSession,
        user_id: uuid.UUID,
        message: str,
        details: Optional[str] = None,
    ) -> None:
        await NotificationService.create(
            db=db,
            user_id=user_id,
            type=NotificationType.SECURITY_ALERT,
            title="Alert di sicurezza",
            body=f"{message}. {details or ''}",
            severity=NotificationSeverity.ERROR,
        )

    @staticmethod
    async def get_unread_count(db: AsyncSession, user_id: uuid.UUID) -> int:
        result = await db.execute(
            select(func.count(Notification.id)).where(
                Notification.user_id == user_id,
                Notification.is_read.is_(False),
            )
        )
        return result.scalar_one()

    @staticmethod
    async def list_notifications(
        db: AsyncSession,
        user_id: uuid.UUID,
        unread_only: bool = False,
        page: int = 1,
        page_size: int = 20,
    ) -> dict:
        query = select(Notification).where(Notification.user_id == user_id)
        if unread_only:
            query = query.where(Notification.is_read.is_(False))

        unread_count = (
            await db.execute(
                select(func.count(Notification.id)).where(
                    Notification.user_id == user_id,
                    Notification.is_read.is_(False),
                )
            )
        ).scalar_one()

        query = (
            query.order_by(Notification.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        result = await db.execute(query)
        notifications = result.scalars().all()

        return {
            "items": [
                {
                    "id": str(n.id),
                    "type": n.type,
                    "title": n.title,
                    "body": n.body,
                    "resource_type": n.resource_type,
                    "resource_id": n.resource_id,
                    "action_url": n.action_url,
                    "is_read": n.is_read,
                    "severity": n.severity,
                    "created_at": n.created_at.isoformat() if n.created_at else None,
                }
                for n in notifications
            ],
            "unread_count": unread_count,
        }

    @staticmethod
    async def mark_read(
        db: AsyncSession,
        user_id: uuid.UUID,
        notification_ids: Optional[List[uuid.UUID]] = None,
    ) -> None:
        """Segna come lette. Se notification_ids è None, segna tutte."""
        stmt = (
            update(Notification)
            .where(
                Notification.user_id == user_id,
                Notification.is_read.is_(False),
            )
            .values(is_read=True, read_at=datetime.now(timezone.utc))
        )
        if notification_ids:
            stmt = stmt.where(Notification.id.in_(notification_ids))
        await db.execute(stmt)
        await db.commit()
