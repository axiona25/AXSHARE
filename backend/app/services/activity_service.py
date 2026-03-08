"""Helper per registrare attività su file e cartelle."""

import uuid
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import ActivityLog


async def log_activity(
    db: AsyncSession,
    user_id: uuid.UUID,
    action: str,
    target_type: str,
    target_id: uuid.UUID,
    target_name: Optional[str] = None,
    detail: Optional[str] = None,
) -> None:
    """Crea e salva un record ActivityLog."""
    entry = ActivityLog(
        user_id=user_id,
        action=action,
        target_type=target_type,
        target_id=target_id,
        target_name=target_name,
        detail=detail,
    )
    db.add(entry)
    await db.commit()
