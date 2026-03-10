"""Endpoint share link (creazione, revoca, download pubblico) e eventi sync."""

import io
import uuid
from datetime import datetime, timezone
from typing import List, Optional

import structlog
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.dependencies import get_current_user
from app.models.file import File
from app.models.permission import Permission
from app.services.permission_service import PermissionService as PermSvc
from app.models.share_link import ShareLink
from app.models.user import User
from app.schemas.share_link import (
    ShareLinkAccessRequest,
    ShareLinkCreate,
    ShareLinkResponse,
)
from app.core.audit_actions import AuditAction
from app.services.activity_service import log_activity
from app.services.audit_service import AuditService
from app.services.notification_service import NotificationService
from app.services.share_link_service import ShareLinkService
from app.services.storage import get_storage_service

router = APIRouter(tags=["share-links"])
sync_router = APIRouter(prefix="/sync", tags=["sync"])


def _link_to_response(link: ShareLink) -> ShareLinkResponse:
    settings = get_settings()
    base = getattr(settings, "frontend_url", "http://localhost:3000")
    now = datetime.now(timezone.utc)
    is_expired = bool(link.expires_at and link.expires_at < now)
    return ShareLinkResponse(
        id=link.id,
        file_id=link.file_id,
        token=link.token,
        is_password_protected=link.is_password_protected,
        require_recipient_pin=link.require_recipient_pin,
        expires_at=link.expires_at,
        block_delete=getattr(link, "block_delete", False),
        require_pin=getattr(link, "require_pin", False),
        max_downloads=link.max_downloads,
        download_count=link.download_count,
        is_active=link.is_active,
        label=link.label,
        created_at=link.created_at,
        share_url=f"{base}/share/{link.token}",
        is_expired=is_expired,
    )


# ─── Owner endpoints ─────────────────────────────────────────────────────────


@router.post(
    "/files/{file_id}/share-links",
    response_model=ShareLinkResponse,
    status_code=201,
)
async def create_share_link(
    file_id: uuid.UUID,
    body: ShareLinkCreate,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(File).where(File.id == file_id, File.is_destroyed.is_(False))
    )
    file = result.scalar_one_or_none()
    if not file:
        raise HTTPException(status_code=404, detail="File non trovato")
    if file.owner_id != current_user.id:
        perm = await PermSvc.get_permission_for_file(db, current_user.id, file_id)
        if perm and getattr(perm, "block_link", False):
            raise HTTPException(status_code=403, detail="Non puoi creare link pubblici per questo file")
        raise HTTPException(status_code=403, detail="Non autorizzato")

    if body.require_pin and not (body.pin and body.pin.strip()):
        raise HTTPException(status_code=400, detail="PIN obbligatorio quando 'Proteggi con PIN' è attivo")

    link = await ShareLinkService.create_link(
        db=db,
        file_id=file_id,
        owner_id=current_user.id,
        file_key_encrypted_for_link=body.file_key_encrypted_for_link,
        password=body.password,
        require_recipient_pin=body.require_recipient_pin or False,
        expires_at=body.expires_at,
        max_downloads=body.max_downloads,
        label=body.label,
        block_delete=body.block_delete,
        require_pin=body.require_pin,
        pin=body.pin,
    )
    await AuditService.log_event(
        db,
        action=AuditAction.SHARE_LINK_CREATE,
        actor=current_user,
        resource_type="file",
        resource_id=str(file_id),
        details={"link_id": str(link.id), "label": body.label},
        request=request,
    )
    await log_activity(db, current_user.id, "share_link", "file", file_id, detail=body.label or "Collegamento creato")
    await NotificationService.create_notification(
        db=db,
        user_id=current_user.id,
        type="share_link_created",
        title="Collegamento creato",
        body="Collegamento creato per il file",
        resource_type="file",
        resource_id=str(file_id),
        severity="info",
    )
    return _link_to_response(link)


@router.get(
    "/files/{file_id}/share-links",
    response_model=List[ShareLinkResponse],
)
async def list_share_links(
    file_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        result = await db.execute(
            select(ShareLink)
            .where(
                ShareLink.file_id == file_id,
                ShareLink.owner_id == current_user.id,
            )
            .order_by(ShareLink.created_at.desc())
        )
        return [_link_to_response(l) for l in result.scalars().all()]
    except Exception as e:
        structlog.get_logger().warning("list_share_links_error", file_id=str(file_id), error=str(e))
        return []


@router.delete("/share-links/{link_id}", status_code=204)
async def revoke_share_link(
    link_id: uuid.UUID,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ShareLink).where(
            ShareLink.id == link_id,
            ShareLink.owner_id == current_user.id,
        )
    )
    link = result.scalar_one_or_none()
    if not link:
        raise HTTPException(status_code=404, detail="Link non trovato")
    link.is_active = False
    link.revoked_at = datetime.now(timezone.utc)
    await db.commit()
    # Registra subito l'attività "Collegamento rimosso" così è visibile in colonna Attività
    await log_activity(db, current_user.id, "share_revoke", "file", link.file_id, detail="Collegamento rimosso")
    await AuditService.log_event(
        db,
        action=AuditAction.SHARE_LINK_REVOKE,
        actor=current_user,
        resource_type="file",
        resource_id=str(link.file_id),
        details={"link_id": str(link_id)},
        request=request,
    )


# ─── Public endpoint (no auth) ───────────────────────────────────────────────


@router.get("/public/share/{token}")
async def get_share_link_info(
    token: str,
    db: AsyncSession = Depends(get_db),
):
    """Info pubblica sul link (senza scaricare il file). Controlli: scadenza 410, requires_pin in response."""
    result = await db.execute(
        select(ShareLink).where(
            ShareLink.token == token,
            ShareLink.is_active.is_(True),
        )
    )
    link = result.scalar_one_or_none()
    if not link:
        raise HTTPException(status_code=404, detail="Link non trovato")
    now = datetime.now(timezone.utc)
    is_expired = bool(link.expires_at and link.expires_at < now)
    if is_expired:
        raise HTTPException(status_code=410, detail="Link scaduto")
    return {
        "token": token,
        "is_password_protected": link.is_password_protected,
        "require_recipient_pin": link.require_recipient_pin,
        "requires_pin": getattr(link, "require_pin", False),
        "expires_at": (
            link.expires_at.isoformat() if link.expires_at else None
        ),
        "is_expired": False,
        "max_downloads": link.max_downloads,
        "download_count": link.download_count,
        "label": link.label,
        "block_delete": getattr(link, "block_delete", False),
        "require_pin": getattr(link, "require_pin", False),
    }


class VerifyShareLinkPinRequest(BaseModel):
    pin: str


@router.post("/public/share/{token}/verify-pin")
async def verify_share_link_pin(
    token: str,
    body: VerifyShareLinkPinRequest,
    db: AsyncSession = Depends(get_db),
):
    """Verifica il PIN del link (pubblico, no JWT). Restituisce { valid: true } o { valid: false }."""
    result = await db.execute(
        select(ShareLink).where(
            ShareLink.token == token,
            ShareLink.is_active.is_(True),
        )
    )
    link = result.scalar_one_or_none()
    if not link or not getattr(link, "require_pin", False):
        return {"valid": False}
    pin_hash = getattr(link, "pin_hash", None)
    if not pin_hash:
        return {"valid": False}
    from app.crypto.kdf import verify_password
    return {"valid": verify_password(body.pin, pin_hash)}


@router.post("/public/share/{token}/download")
async def download_via_share_link(
    token: str,
    body: ShareLinkAccessRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Restituisce metadati file (chiave, IV, nome cifrato) senza incrementare download_count."""
    link, file = await ShareLinkService.get_link_for_download(
        db, token, body.password, request, increment_count=False, pin=body.pin
    )
    await NotificationService.create_notification(
        db=db,
        user_id=link.owner_id,
        type="link_accessed",
        title="File visualizzato",
        body="Il tuo collegamento è stato aperto",
        resource_type="file",
        resource_id=str(link.file_id),
        action_url="/i-miei-file",
        severity="info",
    )
    return {
        "file_id": str(file.id),
        "name_encrypted": file.name_encrypted,
        "file_key_encrypted_for_link": link.file_key_encrypted_for_link,
        "encryption_iv": file.encryption_iv,
        "size_bytes": file.size_bytes,
        "download_count": link.download_count,
    }


@router.get("/public/share/{token}/stream")
async def stream_share_link_file(
    token: str,
    request: Request,
    x_link_password: Optional[str] = Header(None, alias="X-Link-Password"),
    x_link_pin: Optional[str] = Header(None, alias="X-Link-Pin"),
    db: AsyncSession = Depends(get_db),
):
    """Stream del file cifrato per link pubblico. Incrementa download_count. Password in X-Link-Password, PIN in X-Link-Pin se richiesti."""
    link, file = await ShareLinkService.get_link_for_download(
        db, token, x_link_password, request, increment_count=True, pin=x_link_pin
    )
    storage = get_storage_service()
    encrypted_data = await storage.download_encrypted_file(file.storage_path)
    return StreamingResponse(
        io.BytesIO(encrypted_data),
        media_type="application/octet-stream",
        headers={
            "X-File-IV": file.encryption_iv or "",
            "Content-Disposition": "attachment",
        },
    )


# ─── Sync events (propagazione revoca) ───────────────────────────────────────


@sync_router.get("/events")
async def get_sync_events(
    since: datetime = Query(..., description="ISO datetime dall'ultimo check"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.models.sync_event import SyncEvent

    result = await db.execute(
        select(SyncEvent)
        .where(SyncEvent.created_at > since)
        .order_by(SyncEvent.created_at)
        .limit(100)
    )
    events = result.scalars().all()
    return [
        {
            "id": str(e.id),
            "file_id": str(e.file_id) if e.file_id else None,
            "event_type": e.event_type,
            "created_at": e.created_at.isoformat(),
            "payload": e.payload,
        }
        for e in events
    ]
