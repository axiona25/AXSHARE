import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import BigInteger, Boolean, DateTime, Enum, String, Text
from sqlalchemy.orm import mapped_column, Mapped, relationship
from sqlalchemy.dialects.postgresql import JSONB, UUID
import enum

from app.models.base import Base, UUIDMixin, TimestampMixin


class UserRole(str, enum.Enum):
    ADMIN = "admin"
    USER = "user"
    GUEST = "guest"


class User(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "users"
    __table_args__ = {"schema": "axshare"}

    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    display_name_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    role: Mapped[UserRole] = mapped_column(
        Enum(UserRole, values_callable=lambda obj: [e.value for e in obj]),
        default=UserRole.USER,
        nullable=False,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_email_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Chiave pubblica RSA dell'utente (in chiaro — e' pubblica per definizione)
    public_key_rsa: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Chiave pubblica X25519 per ECDH (in chiaro)
    public_key_x25519: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Chiave privata cifrata con AES-GCM derivato dalla password utente
    # Il server non puo' mai decifrarla
    private_key_encrypted: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Salt per la derivazione chiave (Argon2id)
    key_derivation_salt: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    # Hash del PIN utente (Argon2id) per verifica require_pin su file condivisi
    pin_hash: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # WebAuthn credentials (JSON array cifrato)
    webauthn_credentials: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)

    # TOTP secret cifrato
    totp_secret_encrypted: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    totp_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Chiave pubblica RSA-PSS per firma digitale (separata da OAEP cifratura)
    signing_public_key_pem: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    signing_key_registered_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    last_login_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_login_ip: Mapped[Optional[str]] = mapped_column(String(45), nullable=True)

    # Quota storage in bytes (default 1 GB). Admin può modificare per utente/gruppo.
    storage_quota_bytes: Mapped[int] = mapped_column(
        BigInteger, nullable=False, server_default="1073741824"
    )

    # GDPR (Fase 12)
    gdpr_erasure_requested_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    data_retention_until: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    is_anonymized: Mapped[bool] = mapped_column(
        Boolean, server_default="false", nullable=False
    )

    # Relationships
    owned_files: Mapped[list["File"]] = relationship(
        "File", back_populates="owner", foreign_keys="File.owner_id"
    )
    owned_folders: Mapped[list["Folder"]] = relationship("Folder", back_populates="owner")
    group_memberships: Mapped[list["GroupMember"]] = relationship(
        "GroupMember", back_populates="user"
    )
    permissions: Mapped[list["Permission"]] = relationship(
        "Permission", back_populates="subject_user", foreign_keys="Permission.subject_user_id"
    )
