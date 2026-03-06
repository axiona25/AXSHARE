import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, String
from sqlalchemy.orm import mapped_column, Mapped, relationship
from sqlalchemy.dialects.postgresql import UUID
import enum

from app.models.base import Base, UUIDMixin, TimestampMixin


class PermissionLevel(str, enum.Enum):
    READ = "read"
    WRITE = "write"
    SHARE = "share"
    ADMIN = "admin"


class Permission(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "permissions"
    __table_args__ = {"schema": "axshare"}

    # Subject: chi ha il permesso (user o group)
    subject_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("axshare.users.id"), nullable=True
    )
    subject_group_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("axshare.groups.id"), nullable=True
    )

    # Resource: su cosa (file o folder)
    resource_file_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("axshare.files.id"), nullable=True
    )
    resource_folder_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("axshare.folders.id"), nullable=True
    )

    level: Mapped[PermissionLevel] = mapped_column(
        Enum(PermissionLevel, values_callable=lambda obj: [e.value for e in obj]),
        nullable=False,
    )

    # Permessi a tempo — NULL = permanente
    expires_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # Chiave del file/folder cifrata per questo soggetto
    # Permette al soggetto di decifrarla con la propria chiave privata
    resource_key_encrypted: Mapped[Optional[str]] = mapped_column(
        String(1024), nullable=True
    )

    granted_by_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("axshare.users.id"), nullable=False
    )

    subject_user: Mapped[Optional["User"]] = relationship(
        "User", back_populates="permissions", foreign_keys=[subject_user_id]
    )
