"""Modelli per metadati cifrati e tag (TASK 8.1)."""

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, UUIDMixin, TimestampMixin

if TYPE_CHECKING:
    from app.models.file import File
    from app.models.user import User


class FileMetadata(Base, UUIDMixin, TimestampMixin):
    """Metadati cifrati per file (descrizione, note, custom, thumbnail)."""

    __tablename__ = "file_metadata"
    __table_args__ = {"schema": "axshare"}

    file_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("axshare.files.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    description_encrypted: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    notes_encrypted: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    custom_fields_encrypted: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    thumbnail_encrypted: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    file: Mapped["File"] = relationship("File", back_populates="file_metadata_row")


class FileTag(Base, UUIDMixin):
    """Tag non cifrati per filtri server-side."""

    __tablename__ = "file_tags"
    __table_args__ = (
        UniqueConstraint("file_id", "tag", name="uq_file_tag"),
        {"schema": "axshare"},
    )

    file_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("axshare.files.id", ondelete="CASCADE"),
        nullable=False,
    )
    tag: Mapped[str] = mapped_column(String(64), nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("axshare.users.id", ondelete="CASCADE"),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    file: Mapped["File"] = relationship("File", back_populates="tags")
    creator: Mapped["User"] = relationship("User")
