"""Service per sessioni guest: invito, JWT temporaneo, riscatto token."""

import secrets
import uuid
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Tuple

from jose import jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.guest import GuestPermission, GuestSession


class GuestService:
    @staticmethod
    def create_guest_jwt(
        session_id: str,
        guest_email: str,
        file_ids: List[str],
        expires_at: datetime,
    ) -> Tuple[str, str]:
        """Restituisce (token_jwt, jti)."""
        settings = get_settings()
        jti = secrets.token_urlsafe(32)
        now = datetime.now(timezone.utc)
        payload = {
            "sub": f"guest:{session_id}",
            "email": guest_email,
            "role": "guest",
            "jti": jti,
            "file_ids": file_ids,
            "exp": int(expires_at.timestamp()),
            "iat": int(now.timestamp()),
        }
        token = jwt.encode(
            payload,
            settings.secret_key,
            algorithm="HS256",
        )
        return token, jti

    @staticmethod
    async def create_guest_session(
        db: AsyncSession,
        invited_by: uuid.UUID,
        guest_email: str,
        file_ids: List[uuid.UUID],
        expires_in_hours: int,
        label: Optional[str] = None,
        file_keys_encrypted: Optional[List[str]] = None,
        can_download: bool = True,
        can_preview: bool = True,
    ) -> GuestSession:
        expires_at = datetime.now(timezone.utc) + timedelta(hours=expires_in_hours)
        session = GuestSession(
            invited_by=invited_by,
            guest_email=guest_email,
            expires_at=expires_at,
            label=label,
        )
        db.add(session)
        await db.flush()

        for i, file_id in enumerate(file_ids):
            key_enc = (
                file_keys_encrypted[i]
                if file_keys_encrypted and i < len(file_keys_encrypted)
                else None
            )
            perm = GuestPermission(
                session_id=session.id,
                file_id=file_id,
                file_key_encrypted_for_guest=key_enc,
                can_download=can_download,
                can_preview=can_preview,
            )
            db.add(perm)

        await db.commit()
        await db.refresh(session)
        return session

    @staticmethod
    async def redeem_invite(
        db: AsyncSession, invite_token: str
    ) -> Optional["GuestTokenResponse"]:
        from app.schemas.guest import GuestTokenResponse

        result = await db.execute(
            select(GuestSession).where(
                GuestSession.invite_token == invite_token,
                GuestSession.is_active.is_(True),
                GuestSession.invite_used_at.is_(None),
            )
        )
        session = result.scalar_one_or_none()
        if not session:
            return None

        now = datetime.now(timezone.utc)
        if session.expires_at < now:
            return None

        perm_result = await db.execute(
            select(GuestPermission).where(GuestPermission.session_id == session.id)
        )
        perms = perm_result.scalars().all()
        file_ids = [str(p.file_id) for p in perms]

        token, jti = GuestService.create_guest_jwt(
            str(session.id), session.guest_email, file_ids, session.expires_at
        )
        session.invite_used_at = now
        session.session_token_jti = jti
        await db.commit()

        return GuestTokenResponse(
            access_token=token,
            expires_at=session.expires_at,
            guest_email=session.guest_email,
            accessible_files=file_ids,
        )
