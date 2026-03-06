"""Endpoint notifiche in-app: lista, count, segna come lette."""

import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.services.notification_service import NotificationService

router = APIRouter(prefix="/notifications", tags=["notifications"])


class MarkReadBody(BaseModel):
    notification_ids: Optional[List[uuid.UUID]] = None


@router.get("")
async def list_notifications(
    unread_only: bool = Query(default=False),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Lista notifiche con paginazione e filtro solo non lette."""
    return await NotificationService.list_notifications(
        db, current_user.id, unread_only, page, page_size
    )


@router.get("/count")
async def get_unread_count(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Contatore non lette (per badge)."""
    count = await NotificationService.get_unread_count(db, current_user.id)
    return {"unread_count": count}


@router.post("/read")
async def mark_notifications_read(
    body: Optional[MarkReadBody] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Segna come lette: body con notification_ids opzionale; se assente, segna tutte."""
    ids = body.notification_ids if body else None
    await NotificationService.mark_read(db, current_user.id, ids)
    return {"message": "Notifiche segnate come lette"}
