"""Modelli GDPR: richieste cancellazione (Art. 17) e log consensi (Art. 13/14)."""

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import mapped_column, Mapped, relationship
from sqlalchemy.sql import func

from app.models.base import Base


class GdprDeletionRequest(Base):
    __tablename__ = "gdpr_deletion_requests"
    __table_args__ = {"schema": "axshare"}

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("axshare.users.id", ondelete="SET NULL"),
        nullable=True,
    )
    user_email_snapshot: Mapped[str] = mapped_column(String(255), nullable=False)
    requested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    status: Mapped[str] = mapped_column(
        String(32), nullable=False, server_default="pending"
    )
    completed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    deletion_summary: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    requested_by_ip: Mapped[Optional[str]] = mapped_column(String(45), nullable=True)


class GdprConsentLog(Base):
    __tablename__ = "gdpr_consent_log"
    __table_args__ = {"schema": "axshare"}

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("axshare.users.id", ondelete="CASCADE"),
        nullable=False,
    )
    consent_type: Mapped[str] = mapped_column(String(64), nullable=False)
    granted: Mapped[bool] = mapped_column(Boolean(), nullable=False)
    version: Mapped[str] = mapped_column(String(16), nullable=False)
    ip_address: Mapped[Optional[str]] = mapped_column(String(45), nullable=True)
    user_agent: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    user = relationship("User")
