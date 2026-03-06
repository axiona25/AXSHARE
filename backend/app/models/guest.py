"""Modelli sessione guest e permessi guest (invito, riscatto token, revoca)."""

import secrets
import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import mapped_column, Mapped, relationship
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.models.base import Base, UUIDMixin, TimestampMixin

if TYPE_CHECKING:
    from app.models.file import File
    from app.models.user import User


class GuestSession(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "guest_sessions"
    __table_args__ = {"schema": "axshare"}

    invited_by: Mapped[uuid.UUID] = mapped_column(
        "owner_id",
        UUID(as_uuid=True),
        ForeignKey("axshare.users.id", ondelete="CASCADE"),
        nullable=False,
    )
    guest_email: Mapped[str] = mapped_column(String(255), nullable=False)
    invite_token: Mapped[str] = mapped_column(
        String(64), unique=True, nullable=False, index=True
    )
    invite_used_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    session_token_jti: Mapped[Optional[str]] = mapped_column(
        String(64), nullable=True
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, server_default="true", nullable=False
    )
    revoked_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    label: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)

    inviter: Mapped["User"] = relationship("User")
    permissions: Mapped[list["GuestPermission"]] = relationship(
        "GuestPermission",
        back_populates="session",
        cascade="all, delete-orphan",
    )

    def __init__(self, **kwargs):
        if "invite_token" not in kwargs or kwargs.get("invite_token") is None:
            kwargs.setdefault("invite_token", secrets.token_urlsafe(32))
        super().__init__(**kwargs)


class GuestPermission(Base, UUIDMixin):
    __tablename__ = "guest_permissions"
    __table_args__ = ({"schema": "axshare"},)

    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("axshare.guest_sessions.id", ondelete="CASCADE"),
        nullable=False,
    )
    file_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("axshare.files.id", ondelete="CASCADE"),
        nullable=False,
    )
    file_key_encrypted_for_guest: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True
    )
    can_download: Mapped[bool] = mapped_column(
        Boolean, server_default="true", nullable=False
    )
    can_preview: Mapped[bool] = mapped_column(
        Boolean, server_default="true", nullable=False
    )

    session: Mapped["GuestSession"] = relationship(
        "GuestSession", back_populates="permissions"
    )
    file: Mapped["File"] = relationship("File")
