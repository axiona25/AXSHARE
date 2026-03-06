"""Modello share link (link di condivisione con token sicuro, TTL, password)."""

import secrets
import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import mapped_column, Mapped, relationship
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.models.base import Base, UUIDMixin, TimestampMixin

if TYPE_CHECKING:
    from app.models.file import File
    from app.models.user import User


class ShareLink(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "share_links"
    __table_args__ = {"schema": "axshare"}

    file_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("axshare.files.id", ondelete="CASCADE"),
        nullable=False,
    )
    owner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("axshare.users.id", ondelete="CASCADE"),
        nullable=False,
    )
    token: Mapped[str] = mapped_column(
        String(64), unique=True, nullable=False, index=True
    )
    file_key_encrypted_for_link: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True
    )
    password_hash: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_password_protected: Mapped[bool] = mapped_column(
        Boolean, server_default="false", nullable=False
    )
    expires_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    max_downloads: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    download_count: Mapped[int] = mapped_column(
        Integer, server_default="0", nullable=False
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, server_default="true", nullable=False
    )
    revoked_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    label: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)

    file: Mapped["File"] = relationship("File", back_populates="share_links")
    owner: Mapped["User"] = relationship("User")
    accesses: Mapped[list["ShareLinkAccess"]] = relationship(
        "ShareLinkAccess",
        back_populates="link",
        cascade="all, delete-orphan",
    )

    def __init__(self, **kwargs):
        if "token" not in kwargs or kwargs.get("token") is None:
            kwargs.setdefault("token", secrets.token_urlsafe(32))
        super().__init__(**kwargs)


class ShareLinkAccess(Base, UUIDMixin):
    """Audit accessi a un share link."""

    __tablename__ = "share_link_accesses"
    __table_args__ = {"schema": "axshare"}

    link_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("axshare.share_links.id", ondelete="CASCADE"),
        nullable=False,
    )
    ip_address: Mapped[Optional[str]] = mapped_column(String(45), nullable=True)
    user_agent: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    accessed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    outcome: Mapped[str] = mapped_column(
        String(32), nullable=False, server_default="success"
    )

    link: Mapped["ShareLink"] = relationship(
        "ShareLink", back_populates="accesses"
    )
