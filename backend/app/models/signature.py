"""Modello firma digitale file (RSA-PSS)."""

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import mapped_column, Mapped, relationship
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.models.base import Base, UUIDMixin


class FileSignature(Base, UUIDMixin):
    """Firma RSA-PSS su una versione di file. Server conserva firma e pubkey snapshot."""

    __tablename__ = "file_signatures"
    __table_args__ = (
        UniqueConstraint("file_id", "version", name="uq_file_signature_version"),
        {"schema": "axshare"},
    )

    file_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("axshare.files.id", ondelete="CASCADE"),
        nullable=False,
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")
    signer_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("axshare.users.id", ondelete="SET NULL"),
        nullable=True,
    )
    signature_b64: Mapped[str] = mapped_column(Text, nullable=False)
    file_hash_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    public_key_pem_snapshot: Mapped[str] = mapped_column(Text, nullable=False)
    algorithm: Mapped[str] = mapped_column(
        String(32), nullable=False, server_default="RSA-PSS-SHA256"
    )
    is_valid: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    verified_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    file: Mapped["File"] = relationship("File", back_populates="signatures")
    signer: Mapped[Optional["User"]] = relationship("User")
