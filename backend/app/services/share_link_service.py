"""Service per creazione e gestione share link (token sicuro, password, audit)."""

import uuid
from datetime import datetime, timezone
from typing import Optional

import bcrypt
from fastapi import HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit_actions import AuditAction
from app.models.file import File
from app.models.share_link import ShareLink, ShareLinkAccess
from app.services.audit_service import AuditService


class ShareLinkService:
    @staticmethod
    def hash_password(password: str) -> str:
        return bcrypt.hashpw(
            password.encode("utf-8"), bcrypt.gensalt()
        ).decode("utf-8")

    @staticmethod
    def verify_password(password: str, hashed: str) -> bool:
        return bcrypt.checkpw(
            password.encode("utf-8"), hashed.encode("utf-8")
        )

    @staticmethod
    async def create_link(
        db: AsyncSession,
        file_id: uuid.UUID,
        owner_id: uuid.UUID,
        file_key_encrypted_for_link: Optional[str] = None,
        password: Optional[str] = None,
        expires_at: Optional[datetime] = None,
        max_downloads: Optional[int] = None,
        label: Optional[str] = None,
    ) -> ShareLink:
        password_hash = None
        is_password_protected = False
        if password:
            password_hash = ShareLinkService.hash_password(password)
            is_password_protected = True

        link = ShareLink(
            file_id=file_id,
            owner_id=owner_id,
            file_key_encrypted_for_link=file_key_encrypted_for_link,
            password_hash=password_hash,
            is_password_protected=is_password_protected,
            expires_at=expires_at,
            max_downloads=max_downloads,
            label=label,
        )
        db.add(link)
        await db.commit()
        await db.refresh(link)
        return link

    @staticmethod
    async def get_link_for_download(
        db: AsyncSession,
        token: str,
        password: Optional[str],
        request: Request,
    ) -> tuple[ShareLink, File]:
        """
        Valida token e password, registra accesso.
        Restituisce (link, file) se valido, altrimenti raise HTTPException.
        """
        result = await db.execute(
            select(ShareLink).where(ShareLink.token == token)
        )
        link = result.scalar_one_or_none()

        async def log_access(outcome: str, link_id: Optional[uuid.UUID] = None):
            access = ShareLinkAccess(
                link_id=link_id or (link.id if link else None),
                ip_address=request.client.host if request.client else None,
                user_agent=(request.headers.get("user-agent") or "")[:256],
                outcome=outcome,
            )
            db.add(access)
            await db.commit()

        if not link:
            raise HTTPException(status_code=404, detail="Link non trovato")

        if not link.is_active:
            await log_access("revoked", link.id)
            raise HTTPException(status_code=410, detail="Link revocato")

        now = datetime.now(timezone.utc)
        if link.expires_at and link.expires_at < now:
            await log_access("expired", link.id)
            raise HTTPException(status_code=410, detail="Link scaduto")

        if (
            link.max_downloads is not None
            and link.download_count >= link.max_downloads
        ):
            await log_access("limit_reached", link.id)
            raise HTTPException(
                status_code=410, detail="Limite download raggiunto"
            )

        if link.is_password_protected:
            if not password:
                raise HTTPException(
                    status_code=401, detail="Password richiesta"
                )
            if not ShareLinkService.verify_password(
                password, link.password_hash or ""
            ):
                await log_access("wrong_password", link.id)
                raise HTTPException(status_code=401, detail="Password errata")

        file_result = await db.execute(
            select(File).where(
                File.id == link.file_id,
                File.is_destroyed.is_(False),
            )
        )
        file = file_result.scalar_one_or_none()
        if not file:
            raise HTTPException(
                status_code=404, detail="File non disponibile"
            )

        link.download_count += 1
        access = ShareLinkAccess(
            link_id=link.id,
            ip_address=request.client.host if request.client else None,
            user_agent=(request.headers.get("user-agent") or "")[:256],
            outcome="success",
        )
        db.add(access)
        await db.commit()
        await db.refresh(link)
        await AuditService.log_event(
            db,
            action=AuditAction.SHARE_LINK_ACCESS,
            actor_id=None,
            actor_email=None,
            actor_role=None,
            resource_type="file",
            resource_id=str(link.file_id),
            request=request,
            session_type="api",
        )
        return link, file
