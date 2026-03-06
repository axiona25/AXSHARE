"""
GDPR Service — gestisce i diritti degli utenti (Art. 17, 20, 5(1)(e), 13/14).
Operazioni idempotenti dove possibile; audit log per tracciabilità.
"""

import uuid
from datetime import datetime, timezone, timedelta

from fastapi import Request
from sqlalchemy import select, update, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit_actions import AuditAction
from app.models.audit import AuditLog
from app.models.file import File
from app.models.gdpr import GdprConsentLog, GdprDeletionRequest
from app.models.guest import GuestSession
from app.models.share_link import ShareLink
from app.models.user import User
from app.services.audit_service import AuditService


class GdprService:
    # ─── Art. 17 — Diritto alla cancellazione ───────────────────────────────

    @staticmethod
    async def request_erasure(
        db: AsyncSession,
        user: User,
        request: Request,
    ) -> GdprDeletionRequest:
        """
        Avvia procedura cancellazione dati utente (Art. 17).
        Lo stato resta 'pending' finché process_erasure non viene eseguito.
        """
        user.gdpr_erasure_requested_at = datetime.now(timezone.utc)

        req = GdprDeletionRequest(
            user_id=user.id,
            user_email_snapshot=user.email,
            status="pending",
            requested_by_ip=request.client.host if request.client else None,
        )
        db.add(req)
        await db.commit()
        await db.refresh(req)

        try:
            from app.tasks.email_tasks import send_erasure_confirmed_email

            send_erasure_confirmed_email.delay(
                to_email=str(user.email),
                request_id=str(req.id),
                requested_at=req.requested_at.isoformat(),
            )
        except Exception:
            pass

        await AuditService.log_event(
            db=db,
            action=AuditAction.GDPR_ERASURE_REQUESTED,
            actor=user,
            request=request,
        )
        return req

    @staticmethod
    async def process_erasure(
        db: AsyncSession,
        deletion_request: GdprDeletionRequest,
    ) -> dict:
        """
        Esegue la cancellazione GDPR.
        1. Revoca tutti i share link
        2. Revoca tutte le sessioni guest
        3. Elimina tutti i file (storage fisico + DB)
        4. Anonimizza il profilo utente
        5. Anonimizza i log audit (actor_email/user_email → [deleted])
        """
        from app.services.storage import get_storage_service

        storage = get_storage_service()
        summary = {
            "files_deleted": 0,
            "links_revoked": 0,
            "guest_sessions_revoked": 0,
            "audit_anonymized": 0,
        }

        user_id = deletion_request.user_id
        if not user_id:
            return summary

        now = datetime.now(timezone.utc)

        # 1. Revoca share link
        links_result = await db.execute(
            select(ShareLink).where(
                ShareLink.owner_id == user_id,
                ShareLink.is_active.is_(True),
            )
        )
        for link in links_result.scalars().all():
            link.is_active = False
            link.revoked_at = now
            summary["links_revoked"] += 1

        # 2. Revoca sessioni guest
        guests_result = await db.execute(
            select(GuestSession).where(
                GuestSession.invited_by == user_id,
                GuestSession.is_active.is_(True),
            )
        )
        for session in guests_result.scalars().all():
            session.is_active = False
            session.revoked_at = now
            summary["guest_sessions_revoked"] += 1

        # 3. File: elimina da storage fisico e DB
        files_result = await db.execute(select(File).where(File.owner_id == user_id))
        for file in files_result.scalars().all():
            try:
                await storage.delete_file_secure(file.storage_path)
            except Exception:
                pass
            await db.delete(file)
            summary["files_deleted"] += 1

        # 4. Anonimizza profilo utente
        user_result = await db.execute(select(User).where(User.id == user_id))
        user = user_result.scalar_one_or_none()
        if user:
            user.email = f"deleted_{user_id}@axshare.deleted"
            user.display_name_encrypted = "[deleted]"
            user.public_key_rsa = None
            user.public_key_x25519 = None
            user.private_key_encrypted = None
            user.signing_public_key_pem = None
            user.is_active = False
            user.is_anonymized = True

        # 5. Anonimizza audit log
        r = await db.execute(
            update(AuditLog)
            .where(
                (AuditLog.actor_id == user_id) | (AuditLog.user_id == user_id)
            )
            .values(
                actor_email="[deleted]",
                actor_id=None,
                user_email="[deleted]",
                user_id=None,
            )
        )
        summary["audit_anonymized"] = r.rowcount or 0

        # Aggiorna richiesta
        deletion_request.status = "completed"
        deletion_request.completed_at = now
        deletion_request.deletion_summary = summary

        await db.commit()
        return summary

    # ─── Art. 20 — Portabilità dati ─────────────────────────────────────────

    @staticmethod
    async def export_user_data(
        db: AsyncSession, user_id: uuid.UUID
    ) -> dict:
        """
        Genera export JSON dei dati dell'utente (Art. 20).
        Include: profilo, file (metadati non cifrati), share link, audit log propri.
        NON include: chiavi private, password.
        """
        user_result = await db.execute(select(User).where(User.id == user_id))
        user = user_result.scalar_one_or_none()
        if not user:
            return {}

        files_result = await db.execute(
            select(File).where(File.owner_id == user_id)
        )
        files = [
            {
                "id": str(f.id),
                "name_encrypted": f.name_encrypted,
                "size_bytes": f.size_bytes,
                "mime_category": f.mime_category,
                "is_starred": f.is_starred,
                "is_signed": f.is_signed,
                "download_count": f.download_count,
                "created_at": f.created_at.isoformat(),
            }
            for f in files_result.scalars().all()
        ]

        links_result = await db.execute(
            select(ShareLink).where(ShareLink.owner_id == user_id)
        )
        links = [
            {
                "id": str(l.id),
                "file_id": str(l.file_id),
                "label": l.label,
                "is_password_protected": l.is_password_protected,
                "expires_at": l.expires_at.isoformat() if l.expires_at else None,
                "download_count": l.download_count,
                "is_active": l.is_active,
                "created_at": l.created_at.isoformat(),
            }
            for l in links_result.scalars().all()
        ]

        audit_result = await db.execute(
            select(AuditLog)
            .where(
                (AuditLog.actor_id == user_id) | (AuditLog.user_id == user_id)
            )
            .order_by(AuditLog.created_at.desc())
            .limit(1000)
        )
        audit = [
            {
                "action": a.action,
                "resource_type": a.resource_type,
                "resource_id": a.resource_id,
                "outcome": a.outcome,
                "created_at": a.created_at.isoformat() if a.created_at else None,
            }
            for a in audit_result.scalars().all()
        ]

        return {
            "export_date": datetime.now(timezone.utc).isoformat(),
            "gdpr_article": "Art. 20 GDPR — Data Portability",
            "user": {
                "id": str(user.id),
                "email": user.email,
                "role": user.role.value if hasattr(user.role, "value") else str(user.role),
                "created_at": user.created_at.isoformat(),
                "is_active": user.is_active,
            },
            "files": files,
            "share_links": links,
            "audit_log": audit,
        }

    # ─── Data Retention automatica (Art. 5(1)(e)) ──────────────────────────

    @staticmethod
    async def run_retention_cleanup(
        db: AsyncSession,
        retention_days: int = 365,
    ) -> dict:
        """
        Task periodico (cron): elimina dati oltre la retention.
        - File distrutti (is_destroyed=True) oltre 30 giorni
        - Audit log oltre retention_days giorni
        - Share link inattivi e creati oltre 90 giorni
        - Sessioni guest scadute oltre 90 giorni
        """
        now = datetime.now(timezone.utc)
        summary = {}

        from app.services.storage import get_storage_service

        storage = get_storage_service()

        # File distrutti da più di 30 giorni
        cutoff_destroyed = now - timedelta(days=30)
        destroyed_result = await db.execute(
            select(File).where(
                File.is_destroyed.is_(True),
                File.destroyed_at < cutoff_destroyed,
            )
        )
        destroyed_count = 0
        for file in destroyed_result.scalars().all():
            try:
                await storage.delete_file_secure(file.storage_path)
            except Exception:
                pass
            await db.delete(file)
            destroyed_count += 1
        summary["destroyed_files_cleaned"] = destroyed_count

        # Audit log oltre retention
        cutoff_audit = now - timedelta(days=retention_days)
        r = await db.execute(delete(AuditLog).where(AuditLog.created_at < cutoff_audit))
        summary["audit_logs_deleted"] = r.rowcount or 0

        # Share link inattivi e vecchi oltre 90 giorni
        cutoff_links = now - timedelta(days=90)
        r2 = await db.execute(
            delete(ShareLink).where(
                ShareLink.is_active.is_(False),
                ShareLink.created_at < cutoff_links,
            )
        )
        summary["expired_links_deleted"] = r2.rowcount or 0

        # Sessioni guest scadute oltre 90 giorni
        r3 = await db.execute(
            delete(GuestSession).where(GuestSession.expires_at < cutoff_links)
        )
        summary["expired_guest_sessions_deleted"] = r3.rowcount or 0

        await db.commit()
        return summary

    # ─── Consensi (Art. 13/14) ───────────────────────────────────────────────

    @staticmethod
    async def record_consent(
        db: AsyncSession,
        user_id: uuid.UUID,
        consent_type: str,
        granted: bool,
        version: str,
        request: Request,
    ) -> GdprConsentLog:
        """Registra consenso utente (ToS, privacy policy, marketing, ecc.)."""
        log = GdprConsentLog(
            user_id=user_id,
            consent_type=consent_type,
            granted=granted,
            version=version,
            ip_address=request.client.host if request.client else None,
            user_agent=(request.headers.get("user-agent") or "")[:256],
        )
        db.add(log)
        await db.commit()
        await db.refresh(log)
        return log
