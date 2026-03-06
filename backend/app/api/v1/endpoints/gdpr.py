"""Endpoint GDPR: diritto all'oblio (Art. 17), portabilità (Art. 20), consensi, retention."""

import hmac
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user, require_admin
from app.models.gdpr import GdprConsentLog, GdprDeletionRequest
from app.models.user import User
from app.services.gdpr_service import GdprService
from app.services.email_service import EmailService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/gdpr", tags=["gdpr"])


class ConsentRequest(BaseModel):
    consent_type: str
    granted: bool
    version: str


@router.get("/unsubscribe")
async def unsubscribe(
    email: str,
    type: str,
    token: str,
):
    """Gestisce unsubscribe GDPR (Art. 21) da link in email. Route pubblica."""
    expected = EmailService._generate_unsubscribe_token(email, type)
    if not hmac.compare_digest(token, expected):
        raise HTTPException(status_code=400, detail="Token non valido")
    logger.info("Unsubscribe: %s da %s", email, type)
    return {"unsubscribed": True, "email": email, "type": type}


@router.post("/erasure", status_code=status.HTTP_202_ACCEPTED)
async def request_erasure(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Art. 17 GDPR — Richiesta cancellazione dati (diritto all'oblio)."""
    if getattr(current_user, "gdpr_erasure_requested_at", None):
        raise HTTPException(
            status_code=409,
            detail="Richiesta di cancellazione già presente",
        )
    req = await GdprService.request_erasure(db, current_user, request)
    return {
        "message": "Richiesta di cancellazione ricevuta. "
        "I tuoi dati saranno eliminati entro 30 giorni.",
        "request_id": str(req.id),
        "requested_at": req.requested_at.isoformat(),
    }


@router.get("/erasure/status")
async def get_erasure_status(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Stato dell'eventuale richiesta di cancellazione."""
    result = await db.execute(
        select(GdprDeletionRequest)
        .where(GdprDeletionRequest.user_id == current_user.id)
        .order_by(GdprDeletionRequest.requested_at.desc())
        .limit(1)
    )
    req = result.scalar_one_or_none()
    if not req:
        return {"has_erasure_request": False}
    return {
        "has_erasure_request": True,
        "status": req.status,
        "requested_at": req.requested_at.isoformat(),
        "completed_at": req.completed_at.isoformat() if req.completed_at else None,
    }


@router.get("/export")
async def export_my_data(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Art. 20 GDPR — Esporta tutti i dati in formato JSON (portabilità)."""
    data = await GdprService.export_user_data(db, current_user.id)
    return JSONResponse(
        content=data,
        headers={
            "Content-Disposition": "attachment; filename=axshare_data_export.json"
        },
    )


@router.post("/consent")
async def record_consent(
    body: ConsentRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Registra consenso utente (es. accettazione ToS, privacy policy)."""
    await GdprService.record_consent(
        db=db,
        user_id=current_user.id,
        consent_type=body.consent_type,
        granted=body.granted,
        version=body.version,
        request=request,
    )
    return {
        "message": "Consenso registrato",
        "consent_type": body.consent_type,
        "granted": body.granted,
    }


@router.get("/consent/history")
async def get_consent_history(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Storico consensi dell'utente."""
    result = await db.execute(
        select(GdprConsentLog)
        .where(GdprConsentLog.user_id == current_user.id)
        .order_by(GdprConsentLog.created_at.desc())
    )
    return [
        {
            "consent_type": c.consent_type,
            "granted": c.granted,
            "version": c.version,
            "created_at": c.created_at.isoformat(),
        }
        for c in result.scalars().all()
    ]


@router.post("/admin/process-erasure/{request_id}")
async def admin_process_erasure(
    request_id: uuid.UUID,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Esegue la procedura di cancellazione per una richiesta pending (solo admin)."""
    result = await db.execute(
        select(GdprDeletionRequest).where(
            GdprDeletionRequest.id == request_id,
            GdprDeletionRequest.status == "pending",
        )
    )
    req = result.scalar_one_or_none()
    if not req:
        raise HTTPException(
            status_code=404,
            detail="Richiesta non trovata o già elaborata",
        )
    summary = await GdprService.process_erasure(db, req)
    return {"message": "Erasure completato", "summary": summary}


@router.post("/admin/retention-cleanup")
async def run_retention_cleanup(
    retention_days: int = 365,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Esegue cleanup retention (solo admin)."""
    summary = await GdprService.run_retention_cleanup(db, retention_days)
    return {"message": "Retention cleanup completato", "summary": summary}
