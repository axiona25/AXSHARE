"""Endpoint notifiche in-app: lista, count, segna come lette, SSE stream."""
import asyncio
import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user, _get_user_from_token
from app.models.user import User
from app.services.notification_service import NotificationService
from app.core.redis_pubsub import get_redis, notification_channel

router = APIRouter(prefix="/notifications", tags=["notifications"])


class MarkReadBody(BaseModel):
    notification_ids: Optional[List[uuid.UUID]] = None


# ── dipendenza auth per SSE (token da query param) ──────────────────────────

async def _get_current_user_sse(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> User:
    """
    Legge il JWT da Authorization header OPPURE da ?token= query param.
    Necessario per SSE: EventSource del browser non supporta header custom.
    """
    token: Optional[str] = None
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header.removeprefix("Bearer ").strip()
    else:
        token = request.query_params.get("token")

    if not token:
        raise HTTPException(status_code=401, detail="Token mancante")

    # Riusa la funzione interna esistente in dependencies.py
    user = await _get_user_from_token(token, db)
    return user


# ── endpoint esistenti (invariati) ──────────────────────────────────────────

@router.get("")
async def list_notifications(
    unread_only: bool = Query(default=False),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await NotificationService.list_notifications(
        db, current_user.id, unread_only, page, page_size
    )


@router.get("/count")
async def get_unread_count(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    count = await NotificationService.get_unread_count(db, current_user.id)
    return {"unread_count": count}


@router.post("/read")
async def mark_notifications_read(
    body: Optional[MarkReadBody] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ids = body.notification_ids if body else None
    await NotificationService.mark_read(db, current_user.id, ids)
    return {"message": "Notifiche segnate come lette"}


@router.delete("/{notification_id}", status_code=204)
async def delete_notification(
    notification_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    deleted = await NotificationService.delete_one(db, current_user.id, notification_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Notifica non trovata")


# ── SSE stream ───────────────────────────────────────────────────────────────

@router.get("/stream")
async def stream_notifications(
    current_user: User = Depends(_get_current_user_sse),
    db: AsyncSession = Depends(get_db),
):
    """
    SSE: invia event: notification per ogni nuova notifica dell'utente.
    Keepalive ogni 25s per evitare timeout di proxy/nginx.
    """
    channel = notification_channel(str(current_user.id))

    async def event_generator():
        r = await get_redis()
        pubsub = r.pubsub()
        await pubsub.subscribe(channel)
        try:
            yield ": keepalive\n\n"
            while True:
                # timeout=25: dopo 25s senza messaggi get_message restituisce None -> inviamo keepalive
                message = await pubsub.get_message(
                    ignore_subscribe_messages=True,
                    timeout=25.0,
                )
                if message is None:
                    yield ": keepalive\n\n"
                    continue
                if message.get("type") == "message":
                    yield f"event: notification\ndata: {message['data']}\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            await pubsub.unsubscribe(channel)
            await pubsub.aclose()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
