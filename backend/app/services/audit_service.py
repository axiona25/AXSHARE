"""Servizio audit log immutabile con catena di hash e log centralizzato."""

import csv
import hashlib
import io
import json
import logging
import math
from datetime import datetime, timezone
from typing import Optional, Any
from uuid import UUID

from fastapi import Request
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
import structlog

logger = structlog.get_logger()
audit_logger = logging.getLogger("audit")

GENESIS_HASH = "genesis_" + "0" * 56


class AuditService:
    @staticmethod
    def _compute_hash(entry: dict) -> str:
        """Calcola SHA-256 di un log entry normalizzato."""
        canonical = json.dumps(entry, sort_keys=True, default=str)
        return hashlib.sha256(canonical.encode()).hexdigest()

    @staticmethod
    async def _get_last_hash(db: AsyncSession) -> str:
        """Restituisce l'hash dell'ultimo log o hash genesis se vuoto."""
        from app.models.audit import AuditLog

        result = await db.execute(
            select(AuditLog).order_by(AuditLog.created_at.desc()).limit(1)
        )
        last = result.scalar_one_or_none()
        if last:
            return last.log_hash or GENESIS_HASH
        return GENESIS_HASH

    @staticmethod
    async def log(
        db: AsyncSession,
        action: str,
        resource_type: str,
        resource_id: Optional[UUID] = None,
        user_id: Optional[UUID] = None,
        details: Optional[dict[str, Any]] = None,
        outcome: str = "success",
        ip_address: Optional[str] = None,
    ) -> None:
        """
        Crea un entry audit immutabile con catena di hash.
        Non solleva mai eccezioni — errori vengono loggati ma non propagati.
        """
        from app.models.audit import AuditLog

        try:
            previous_hash = await AuditService._get_last_hash(db)
            now = datetime.now(timezone.utc)

            entry_data = {
                "action": action,
                "resource_type": resource_type,
                "resource_id": str(resource_id) if resource_id else None,
                "user_id": str(user_id) if user_id else None,
                "details": details or {},
                "outcome": outcome,
                "timestamp": now.isoformat(),
                "previous_hash": previous_hash,
            }
            log_hash = AuditService._compute_hash(entry_data)

            entry = AuditLog(
                action=action,
                resource_type=resource_type,
                resource_id=str(resource_id) if resource_id else None,
                user_id=user_id,
                details=details or {},
                outcome=outcome,
                ip_address=ip_address,
                previous_hash=previous_hash,
                log_hash=log_hash,
                created_at=now,
            )
            db.add(entry)
            await db.commit()
        except Exception as e:
            logger.error("audit_log_failed", action=action, error=str(e))

    @staticmethod
    async def log_event(
        db: AsyncSession,
        action: str,
        actor: Optional[Any] = None,
        actor_id: Optional[UUID] = None,
        actor_email: Optional[str] = None,
        actor_role: Optional[str] = None,
        resource_type: Optional[str] = None,
        resource_id: Optional[str] = None,
        resource_name_encrypted: Optional[str] = None,
        details: Optional[dict] = None,
        outcome: str = "success",
        error_message: Optional[str] = None,
        request: Optional[Request] = None,
        session_type: str = "user",
    ) -> Optional[Any]:
        """Inserisce un evento nel log centralizzato. Mai solleva eccezioni."""
        from app.models.audit import AuditLog

        try:
            ip = None
            ua = None
            if request:
                ip = request.client.host if request.client else None
                ua = (request.headers.get("user-agent") or "")[:256]

            uid = None
            email = None
            role = None
            if actor is not None:
                uid = getattr(actor, "id", None)
                email = getattr(actor, "email", None)
                r = getattr(actor, "role", None)
                role = (
                    str(r.value) if r is not None and hasattr(r, "value") else str(r) if r is not None else None
                )
            if uid is None:
                uid = actor_id
            if email is None:
                email = actor_email
            if role is None:
                role = actor_role

            now = datetime.now(timezone.utc)
            previous_hash = await AuditService._get_last_hash(db)
            entry_data = {
                "action": action,
                "resource_type": resource_type,
                "resource_id": str(resource_id) if resource_id else None,
                "user_id": str(uid) if uid else None,
                "details": details or {},
                "outcome": outcome,
                "timestamp": now.isoformat(),
                "previous_hash": previous_hash,
            }
            log_hash = AuditService._compute_hash(entry_data)

            entry = AuditLog(
                actor_id=uid,
                actor_email=email,
                actor_role=role,
                user_id=uid,
                user_email=email,
                action=action,
                resource_type=resource_type,
                resource_id=str(resource_id) if resource_id is not None else None,
                resource_name_encrypted=resource_name_encrypted,
                details=details,
                outcome=outcome,
                error_message=error_message,
                ip_address=ip,
                user_agent=ua,
                session_type=session_type,
                previous_hash=previous_hash,
                log_hash=log_hash,
                created_at=now,
            )
            db.add(entry)
            await db.commit()
            await db.refresh(entry)
            return entry
        except Exception as e:
            audit_logger.error("Audit log failed: %s", e)
            return None

    @staticmethod
    async def query(
        db: AsyncSession,
        actor_id: Optional[UUID] = None,
        action: Optional[str] = None,
        resource_type: Optional[str] = None,
        resource_id: Optional[str] = None,
        outcome: Optional[str] = None,
        date_from: Optional[datetime] = None,
        date_to: Optional[datetime] = None,
        session_type: Optional[str] = None,
        page: int = 1,
        page_size: int = 50,
        admin_view: bool = False,
        requesting_user_id: Optional[UUID] = None,
    ) -> dict:
        """Query audit log con filtri e paginazione. Admin vede tutto, utente solo propri."""
        from app.models.audit import AuditLog

        q = select(AuditLog)

        if not admin_view and requesting_user_id is not None:
            q = q.where(
                (AuditLog.actor_id == requesting_user_id)
                | (AuditLog.user_id == requesting_user_id)
            )
        elif actor_id is not None:
            q = q.where(
                (AuditLog.actor_id == actor_id) | (AuditLog.user_id == actor_id)
            )

        if action:
            if action.endswith("*"):
                prefix = action[:-1]
                q = q.where(AuditLog.action.like(f"{prefix}%"))
            else:
                q = q.where(AuditLog.action == action)
        if resource_type:
            q = q.where(AuditLog.resource_type == resource_type)
        if resource_id:
            q = q.where(AuditLog.resource_id == resource_id)
        if outcome:
            q = q.where(AuditLog.outcome == outcome)
        if date_from:
            q = q.where(AuditLog.created_at >= date_from)
        if date_to:
            q = q.where(AuditLog.created_at <= date_to)
        if session_type:
            q = q.where(AuditLog.session_type == session_type)

        count_q = select(func.count()).select_from(q.subquery())
        total = (await db.execute(count_q)).scalar_one()

        q = (
            q.order_by(AuditLog.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        result = await db.execute(q)
        logs = result.scalars().all()

        return {
            "items": [
                {
                    "id": str(l.id),
                    "actor_id": str(l.actor_id) if l.actor_id else (str(l.user_id) if l.user_id else None),
                    "actor_email": l.actor_email or l.user_email,
                    "actor_role": l.actor_role,
                    "action": l.action,
                    "resource_type": l.resource_type,
                    "resource_id": l.resource_id,
                    "details": l.details,
                    "outcome": l.outcome,
                    "error_message": l.error_message,
                    "ip_address": l.ip_address,
                    "session_type": l.session_type,
                    "created_at": l.created_at.isoformat() if l.created_at else None,
                }
                for l in logs
            ],
            "total": total,
            "page": page,
            "page_size": page_size,
            "pages": math.ceil(total / page_size) if total > 0 else 0,
        }

    @staticmethod
    async def export_csv(
        db: AsyncSession,
        admin_view: bool = False,
        requesting_user_id: Optional[UUID] = None,
        action: Optional[str] = None,
        date_from: Optional[datetime] = None,
        date_to: Optional[datetime] = None,
        page_size: int = 10000,
    ) -> str:
        """Esporta audit log come CSV (compliance)."""
        result = await AuditService.query(
            db=db,
            page_size=page_size,
            admin_view=admin_view,
            requesting_user_id=requesting_user_id,
            action=action,
            date_from=date_from,
            date_to=date_to,
        )
        out = io.StringIO()
        writer = csv.DictWriter(
            out,
            fieldnames=[
                "id",
                "actor_email",
                "actor_role",
                "action",
                "resource_type",
                "resource_id",
                "outcome",
                "error_message",
                "ip_address",
                "session_type",
                "created_at",
            ],
        )
        writer.writeheader()
        for item in result["items"]:
            writer.writerow({k: item.get(k, "") for k in writer.fieldnames})
        return out.getvalue()

    @staticmethod
    async def verify_chain(db: AsyncSession) -> dict:
        """
        Verifica l'integrità della catena di hash audit.
        Restituisce {'valid': True, 'entries': N} o {'valid': False, 'broken_at': id}.
        """
        from app.models.audit import AuditLog

        result = await db.execute(
            select(AuditLog).order_by(AuditLog.created_at.asc())
        )
        entries = result.scalars().all()

        if not entries:
            return {"valid": True, "entries": 0}

        prev_hash = GENESIS_HASH
        for entry in entries:
            if entry.previous_hash != prev_hash:
                return {"valid": False, "broken_at": str(entry.id)}
            entry_data = {
                "action": entry.action,
                "resource_type": entry.resource_type,
                "resource_id": str(entry.resource_id) if entry.resource_id else None,
                "user_id": str(entry.user_id) if entry.user_id else None,
                "details": entry.details or {},
                "outcome": entry.outcome,
                "timestamp": entry.created_at.isoformat(),
                "previous_hash": entry.previous_hash,
            }
            expected_hash = AuditService._compute_hash(entry_data)
            if entry.log_hash != expected_hash:
                return {"valid": False, "broken_at": str(entry.id)}
            prev_hash = entry.log_hash or GENESIS_HASH

        return {"valid": True, "entries": len(entries)}

    @staticmethod
    async def get_resource_history(
        db: AsyncSession,
        resource_type: str,
        resource_id: UUID,
        limit: int = 50,
    ) -> list:
        """Restituisce la storia audit di una risorsa specifica."""
        from app.models.audit import AuditLog

        result = await db.execute(
            select(AuditLog)
            .where(
                AuditLog.resource_type == resource_type,
                AuditLog.resource_id == str(resource_id),
            )
            .order_by(AuditLog.created_at.desc())
            .limit(limit)
        )
        return list(result.scalars().all())
