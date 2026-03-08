"""Activity log per file e cartelle (upload, download, rename, move, delete, share, create_folder)."""

import uuid
from typing import Optional

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID

from app.models.base import Base, UUIDMixin, TimestampMixin


class ActivityLog(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "activity_logs"
    __table_args__ = {"schema": "axshare"}

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("axshare.users.id"), nullable=False
    )
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    # es: "upload", "download", "rename", "move", "delete", "share", "create_folder"
    target_type: Mapped[str] = mapped_column(String(16), nullable=False)
    # "file" o "folder"
    target_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    target_name: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    detail: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
