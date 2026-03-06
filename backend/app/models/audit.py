import uuid
from typing import Optional
from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import mapped_column, Mapped, relationship
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.models.base import Base, UUIDMixin, TimestampMixin


class AuditLog(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "audit_logs"
    __table_args__ = {"schema": "axshare"}

    # Chi ha eseguito l'azione (legacy + centralizzato)
    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("axshare.users.id"), nullable=True
    )
    user_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    actor_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("axshare.users.id", ondelete="SET NULL"),
        nullable=True,
    )
    actor_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    actor_role: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)

    # Tipo di azione (es. file.upload, auth.login)
    action: Mapped[str] = mapped_column(String(64), nullable=False, index=True)

    # Risorsa coinvolta
    resource_type: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    resource_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    resource_name_encrypted: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Contesto (IP, user agent, session)
    ip_address: Mapped[Optional[str]] = mapped_column(String(45), nullable=True)
    user_agent: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    session_type: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)

    # Dettagli e esito
    details: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    outcome: Mapped[str] = mapped_column(
        String(16), default="success", nullable=False
    )
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Hash del log precedente (per catena immutabile)
    previous_hash: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    log_hash: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)

    actor = relationship("User", foreign_keys=[actor_id])
