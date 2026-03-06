"""Endpoint audit: verifica catena hash, storia risorse, query e export CSV."""

import io
import uuid
from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user, require_admin
from app.models.audit import AuditLog
from app.models.file import File
from app.models.user import User, UserRole
from app.schemas.reports import (
    AdminDashboard,
    TimeSeriesReport,
    UserDashboard,
)
from app.services.audit_service import AuditService
from app.services.report_service import ReportService

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("/verify-chain")
async def verify_audit_chain(
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Verifica integrità catena hash audit. Solo admin."""
    return await AuditService.verify_chain(db)


@router.get("/file/{file_id}/history")
async def get_file_history(
    file_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Storia audit di un file. Solo owner o admin."""
    file = await db.get(File, file_id)
    if not file:
        raise HTTPException(status_code=404, detail="File non trovato")
    if file.owner_id != current_user.id and current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Non autorizzato")
    entries = await AuditService.get_resource_history(db, "file", file_id)
    return [
        {
            "id": str(e.id),
            "action": e.action,
            "outcome": e.outcome,
            "created_at": e.created_at.isoformat(),
        }
        for e in entries
    ]


@router.get("/logs")
async def get_audit_logs(
    action: Optional[str] = Query(None),
    resource_type: Optional[str] = Query(None),
    resource_id: Optional[str] = Query(None),
    outcome: Optional[str] = Query(None),
    date_from: Optional[datetime] = Query(None),
    date_to: Optional[datetime] = Query(None),
    session_type: Optional[str] = Query(None),
    actor_id: Optional[uuid.UUID] = Query(None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Query audit log con filtri e paginazione. Admin vede tutto, utente solo propri eventi."""
    is_admin = current_user.role == UserRole.ADMIN
    return await AuditService.query(
        db=db,
        actor_id=actor_id if is_admin else None,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        outcome=outcome,
        date_from=date_from,
        date_to=date_to,
        session_type=session_type,
        page=page,
        page_size=page_size,
        admin_view=is_admin,
        requesting_user_id=current_user.id,
    )


@router.get("/logs/export/csv")
async def export_audit_csv(
    date_from: Optional[datetime] = Query(None),
    date_to: Optional[datetime] = Query(None),
    action: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Esporta log come CSV. Admin: tutto. Utente: solo propri log."""
    is_admin = current_user.role == UserRole.ADMIN
    csv_data = await AuditService.export_csv(
        db=db,
        admin_view=is_admin,
        requesting_user_id=current_user.id,
        action=action,
        date_from=date_from,
        date_to=date_to,
    )
    filename = f"audit_log_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
    return StreamingResponse(
        io.BytesIO(csv_data.encode("utf-8")),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.get("/logs/summary")
async def get_audit_summary(
    date_from: Optional[datetime] = Query(None),
    date_to: Optional[datetime] = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Riepilogo conteggi per azione (per dashboard)."""
    q = select(
        AuditLog.action,
        AuditLog.outcome,
        func.count(AuditLog.id).label("count"),
    )
    if current_user.role != UserRole.ADMIN:
        q = q.where(
            (AuditLog.actor_id == current_user.id)
            | (AuditLog.user_id == current_user.id)
        )
    if date_from:
        q = q.where(AuditLog.created_at >= date_from)
    if date_to:
        q = q.where(AuditLog.created_at <= date_to)
    q = q.group_by(AuditLog.action, AuditLog.outcome)

    result = await db.execute(q)
    return [
        {"action": r.action, "outcome": r.outcome, "count": r.count}
        for r in result
    ]


@router.get("/dashboard/me", response_model=UserDashboard)
async def get_my_dashboard(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Dashboard statistiche personali."""
    return await ReportService.get_user_dashboard(db, current_user.id)


@router.get("/dashboard/admin", response_model=AdminDashboard)
async def get_admin_dashboard(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Dashboard admin — solo amministratori."""
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Accesso negato")
    return await ReportService.get_admin_dashboard(db)


@router.get("/dashboard/timeseries", response_model=TimeSeriesReport)
async def get_time_series(
    metric: str = Query(..., pattern="^(uploads|downloads|logins|shares)$"),
    days: int = Query(default=30, ge=7, le=365),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Serie temporale per una metrica (ultimi N giorni)."""
    is_admin = current_user.role == UserRole.ADMIN
    user_id = None if is_admin else current_user.id
    return await ReportService.get_time_series(db, metric, days, user_id)
