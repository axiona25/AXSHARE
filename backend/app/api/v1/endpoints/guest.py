"""Endpoint sessioni guest: invito, lista, revoca, riscatto token (JWT temporaneo)."""

import uuid
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit_actions import AuditAction
from app.database import get_db
from app.dependencies import get_current_user
from app.models.file import File
from app.models.guest import GuestPermission, GuestSession
from app.models.user import User
from app.schemas.guest import (
    GuestInviteCreate,
    GuestSessionResponse,
    GuestTokenResponse,
)
from app.services.audit_service import AuditService
from app.services.guest_service import GuestService
from app.services.sync_event_service import SyncEventService

router = APIRouter(prefix="/guest", tags=["guest"])
public_router = APIRouter(tags=["guest"])


@router.post(
    "/invite",
    response_model=GuestSessionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_guest_invite(
    body: GuestInviteCreate,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Crea sessione guest e restituisce invite_token per il link di invito."""
    for file_id in body.file_ids:
        result = await db.execute(
            select(File).where(
                File.id == file_id,
                File.owner_id == current_user.id,
                File.is_destroyed.is_(False),
            )
        )
        if not result.scalar_one_or_none():
            raise HTTPException(
                status_code=404,
                detail=f"File {file_id} non trovato",
            )

    session = await GuestService.create_guest_session(
        db=db,
        invited_by=current_user.id,
        guest_email=str(body.guest_email),
        file_ids=body.file_ids,
        file_keys_encrypted=body.file_keys_encrypted,
        expires_in_hours=body.expires_in_hours,
        label=body.label,
        can_download=body.can_download,
        can_preview=body.can_preview,
    )
    perm_result = await db.execute(
        select(GuestPermission).where(GuestPermission.session_id == session.id)
    )
    perms = perm_result.scalars().all()
    # Invia email invito guest in modo asincrono (Celery)
    try:
        from app.config import get_settings
        from app.tasks.notification_tasks import send_guest_invite_email
        settings = get_settings()
        invite_url = f"{getattr(settings, 'frontend_url', 'http://localhost:3000')}/invite/{session.invite_token}"
        send_guest_invite_email.delay(
            guest_email=str(body.guest_email),
            invite_url=invite_url,
            owner_email=current_user.email,
            expires_in_hours=body.expires_in_hours,
            file_count=len(body.file_ids),
        )
    except Exception as e:
        import structlog
        structlog.get_logger().warning("guest_invite_email_task_failed", error=str(e))
    await AuditService.log_event(
        db,
        action=AuditAction.GUEST_INVITE,
        actor=current_user,
        resource_type="guest_session",
        resource_id=str(session.id),
        details={"guest_email": body.guest_email, "file_count": len(body.file_ids)},
        request=request,
    )
    return GuestSessionResponse(
        id=session.id,
        guest_email=session.guest_email,
        expires_at=session.expires_at,
        is_active=session.is_active,
        label=session.label,
        invite_used=session.invite_used_at is not None,
        created_at=session.created_at,
        accessible_files=[str(p.file_id) for p in perms],
        invite_token=session.invite_token,
    )


@router.get(
    "/sessions",
    response_model=List[GuestSessionResponse],
)
async def list_guest_sessions(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(GuestSession)
        .where(GuestSession.invited_by == current_user.id)
        .order_by(GuestSession.created_at.desc())
    )
    sessions = result.scalars().all()
    items = []
    for s in sessions:
        perm_result = await db.execute(
            select(GuestPermission).where(GuestPermission.session_id == s.id)
        )
        items.append(
            GuestSessionResponse(
                id=s.id,
                guest_email=s.guest_email,
                expires_at=s.expires_at,
                is_active=s.is_active,
                label=s.label,
                invite_used=s.invite_used_at is not None,
                created_at=s.created_at,
                accessible_files=[str(p.file_id) for p in perm_result.scalars().all()],
                invite_token=None,
            )
        )
    return items


@router.delete(
    "/sessions/{session_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def revoke_guest_session(
    session_id: uuid.UUID,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(GuestSession).where(
            GuestSession.id == session_id,
            GuestSession.invited_by == current_user.id,
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Sessione non trovata")
    session.is_active = False
    session.revoked_at = datetime.now(timezone.utc)
    await db.commit()

    await AuditService.log_event(
        db,
        action=AuditAction.GUEST_REVOKE,
        actor=current_user,
        resource_type="guest_session",
        resource_id=str(session_id),
        details={"guest_email": session.guest_email},
        request=request,
    )

    perm_result = await db.execute(
        select(GuestPermission).where(GuestPermission.session_id == session_id)
    )
    for perm in perm_result.scalars().all():
        await SyncEventService.emit_share_revoked(
            db, perm.file_id, current_user.id, reason="guest_revoked"
        )


@public_router.post(
    "/public/guest/redeem",
    response_model=GuestTokenResponse,
)
async def redeem_guest_invite(
    request: Request,
    invite_token: str = Query(..., description="Token di invito one-time"),
    db: AsyncSession = Depends(get_db),
):
    """Riscatta token invito e restituisce JWT guest temporaneo."""
    result = await GuestService.redeem_invite(db, invite_token)
    if not result:
        raise HTTPException(
            status_code=404,
            detail="Invito non valido, già usato o scaduto",
        )
    await AuditService.log_event(
        db,
        action=AuditAction.GUEST_REDEEM,
        actor_email=result.guest_email,
        actor_role="guest",
        resource_type="guest_session",
        resource_id=None,
        details={"accessible_files": len(result.accessible_files)},
        request=request,
        session_type="guest",
    )
    return result
