import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Optional
from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import mapped_column, Mapped, relationship
from sqlalchemy.dialects.postgresql import UUID

from app.models.base import Base, UUIDMixin, TimestampMixin

if TYPE_CHECKING:
    from app.models.metadata import FileMetadata, FileTag
    from app.models.share_link import ShareLink


class Folder(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "folders"
    __table_args__ = {"schema": "axshare"}

    # Nome cifrato con la chiave del proprietario — il server non lo vede
    name_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    owner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("axshare.users.id"), nullable=False
    )
    parent_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("axshare.folders.id"), nullable=True
    )

    # Path cifrato (opaco al server)
    path_encrypted: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Chiave cartella cifrata con pubkey owner (E2E)
    folder_key_encrypted: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    is_destroyed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    destroyed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    owner: Mapped["User"] = relationship("User", back_populates="owned_folders")
    files: Mapped[list["File"]] = relationship("File", back_populates="folder")
    children: Mapped[list["Folder"]] = relationship(
        "Folder", back_populates="parent"
    )
    parent: Mapped[Optional["Folder"]] = relationship(
        "Folder", back_populates="children", remote_side="Folder.id"
    )
    permissions: Mapped[list["Permission"]] = relationship(
        "Permission", foreign_keys="Permission.resource_folder_id"
    )


class File(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "files"
    __table_args__ = {"schema": "axshare"}

    # Nome e mime type cifrati — il server non li vede mai
    name_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    mime_type_encrypted: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Chiave di cifratura del file, cifrata con la chiave del proprietario
    # Il server non puo' mai decifrarla
    file_key_encrypted: Mapped[str] = mapped_column(Text, nullable=False)

    # Path su MinIO (UUID opaco, non rivela nulla del contenuto)
    storage_path: Mapped[str] = mapped_column(String(512), nullable=False, unique=True)
    size_bytes: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)

    # Hash del file cifrato (per integrità, non rivela contenuto)
    content_hash: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)

    # IV/nonce usato per AES-GCM (pubblico, necessario per decrypt)
    encryption_iv: Mapped[str] = mapped_column(String(64), nullable=False)

    owner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("axshare.users.id"), nullable=False
    )
    folder_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("axshare.folders.id"), nullable=True
    )

    # Versioning
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    is_latest: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    previous_version_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("axshare.files.id"), nullable=True
    )

    # Auto-distruzione
    is_destroyed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    destroyed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    self_destruct_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    self_destruct_after_downloads: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True
    )
    download_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Metadati cifrati (JSONB — contenuto opaco al server)
    metadata_encrypted: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Classificazione (in chiaro — necessaria per policy server-side)
    classification: Mapped[Optional[str]] = mapped_column(
        String(20), nullable=True
    )  # PUBLIC/INTERNAL/CONFIDENTIAL/SECRET

    # Categoria MIME non cifrata per filtri ricerca (TASK 8.2)
    mime_category: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)

    # Label non cifrati (TASK 8.1)
    is_starred: Mapped[bool] = mapped_column(
        Boolean, server_default="false", nullable=False
    )
    is_pinned: Mapped[bool] = mapped_column(
        Boolean, server_default="false", nullable=False
    )
    color_label: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)

    # Firma digitale (TASK 9.1)
    is_signed: Mapped[bool] = mapped_column(
        Boolean, server_default="false", nullable=False
    )

    owner: Mapped["User"] = relationship(
        "User", back_populates="owned_files", foreign_keys=[owner_id]
    )
    folder: Mapped[Optional["Folder"]] = relationship(
        "Folder", back_populates="files"
    )
    permissions: Mapped[list["Permission"]] = relationship(
        "Permission", foreign_keys="Permission.resource_file_id"
    )
    signatures: Mapped[list["FileSignature"]] = relationship(
        "FileSignature",
        back_populates="file",
        cascade="all, delete-orphan",
        order_by="FileSignature.version",
    )
    version_history: Mapped[list["FileVersion"]] = relationship(
        "FileVersion", back_populates="file", foreign_keys="FileVersion.file_id"
    )
    file_metadata_row: Mapped[Optional["FileMetadata"]] = relationship(
        "FileMetadata",
        back_populates="file",
        uselist=False,
        cascade="all, delete-orphan",
    )
    tags: Mapped[list["FileTag"]] = relationship(
        "FileTag", back_populates="file", cascade="all, delete-orphan"
    )
    share_links: Mapped[list["ShareLink"]] = relationship(
        "ShareLink", back_populates="file", cascade="all, delete-orphan"
    )


class FileVersion(Base, UUIDMixin, TimestampMixin):
    """Snapshot di una versione precedente di un file (per rollback)."""

    __tablename__ = "file_versions"
    __table_args__ = {"schema": "axshare"}

    file_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("axshare.files.id"), nullable=False
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    storage_path: Mapped[str] = mapped_column(String(512), nullable=False)
    file_key_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    encryption_iv: Mapped[str] = mapped_column(String(64), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("axshare.users.id"), nullable=False
    )

    file: Mapped["File"] = relationship(
        "File", back_populates="version_history", foreign_keys=[file_id]
    )
