"""
Quando un share link o una guest session viene revocata,
emette un evento di sync che tutti i client (desktop, mobile, web)
intercettano per eliminare il file locale.
"""

import json
import uuid
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.sync_event import SyncEvent


class SyncEventType:
    FILE_DELETED = "file_deleted"
    SHARE_REVOKED = "share_revoked"
    GUEST_REVOKED = "guest_revoked"


class SyncEventService:
    @staticmethod
    async def emit_share_revoked(
        db: AsyncSession,
        file_id: uuid.UUID,
        triggered_by: uuid.UUID,
        reason: str = "share_revoked",
    ) -> None:
        """
        Emette evento share_revoked.
        Il sync engine desktop (Task 7.4) intercetta questo evento
        e cancella il file dalla cache locale e dal disco virtuale.
        Il client mobile e web rimuovono il file dalla lista condivisi.
        """
        event = SyncEvent(
            file_id=file_id,
            event_type=SyncEventType.SHARE_REVOKED,
            triggered_by=triggered_by,
            payload=json.dumps({"reason": reason, "file_id": str(file_id)}),
        )
        db.add(event)
        await db.commit()
