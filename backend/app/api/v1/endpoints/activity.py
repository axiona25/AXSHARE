"""Activity log API: ultime attività per file, cartella o utente."""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.activity import ActivityLog
from app.models.user import User

router = APIRouter(prefix="/activity", tags=["activity"])


def _row_to_item(row: ActivityLog) -> dict:
    return {
        "id": str(row.id),
        "user_id": str(row.user_id),
        "action": row.action,
        "target_type": row.target_type,
        "target_id": str(row.target_id),
        "target_name": row.target_name,
        "detail": row.detail,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


@router.get("/file/{file_id}")
async def get_file_activity(
    file_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Ultime 20 attività su quel file (solo per l'utente corrente)."""
    result = await db.execute(
        select(ActivityLog)
        .where(
            ActivityLog.target_type == "file",
            ActivityLog.target_id == file_id,
            ActivityLog.user_id == current_user.id,
        )
        .order_by(ActivityLog.created_at.desc())
        .limit(20)
    )
    rows = result.scalars().all()
    return [_row_to_item(r) for r in rows]


@router.get("/folder/{folder_id}")
async def get_folder_activity(
    folder_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Ultime 20 attività su quella cartella (solo per l'utente corrente)."""
    result = await db.execute(
        select(ActivityLog)
        .where(
            ActivityLog.target_type == "folder",
            ActivityLog.target_id == folder_id,
            ActivityLog.user_id == current_user.id,
        )
        .order_by(ActivityLog.created_at.desc())
        .limit(20)
    )
    rows = result.scalars().all()
    return [_row_to_item(r) for r in rows]


@router.get("/recent")
async def get_recent_activity(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Ultime 50 attività dell'utente corrente."""
    result = await db.execute(
        select(ActivityLog)
        .where(ActivityLog.user_id == current_user.id)
        .order_by(ActivityLog.created_at.desc())
        .limit(50)
    )
    rows = result.scalars().all()
    return [_row_to_item(r) for r in rows]
