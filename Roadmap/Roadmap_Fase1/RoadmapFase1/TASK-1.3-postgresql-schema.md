# TASK 1.3 — PostgreSQL Schema + RLS + Alembic
> **Fase:** 1 — Foundation & Infrastruttura
> **Prerequisiti:** Task 1.2 completato (PostgreSQL in esecuzione)
> **Path progetto:** `/Users/r.amoroso/Documents/Cursor/AXSHARE`
> **Output atteso:** schema DB completo con RLS, modelli SQLAlchemy, prima migration Alembic

---

## Prompt Cursor

```
Sei un senior backend engineer. Il progetto AXSHARE si trova in
/Users/r.amoroso/Documents/Cursor/AXSHARE.
PostgreSQL 16 e' in esecuzione su localhost:5432.

Devi creare lo schema completo del database con:
- Modelli SQLAlchemy 2.0 async
- Row Level Security (RLS) su PostgreSQL
- Prima migration Alembic
- Tutte le tabelle necessarie per AXSHARE

PRINCIPIO: nomi file e path cifrati — il DB non contiene mai dati in chiaro.

════════════════════════════════════════════════
STEP 1 — Crea backend/app/models/base.py
════════════════════════════════════════════════

import uuid
from datetime import datetime, timezone
from sqlalchemy import DateTime, func
from sqlalchemy.orm import DeclarativeBase, mapped_column, Mapped
from sqlalchemy.dialects.postgresql import UUID


class Base(DeclarativeBase):
    pass


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class UUIDMixin:
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=func.gen_random_uuid(),
    )

════════════════════════════════════════════════
STEP 2 — Crea backend/app/models/user.py
════════════════════════════════════════════════

import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Boolean, Enum, Text, DateTime
from sqlalchemy.orm import mapped_column, Mapped, relationship
from sqlalchemy.dialects.postgresql import UUID, JSONB
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
    role: Mapped[UserRole] = mapped_column(Enum(UserRole), default=UserRole.USER, nullable=False)
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

    # WebAuthn credentials (JSON array cifrato)
    webauthn_credentials: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)

    # TOTP secret cifrato
    totp_secret_encrypted: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    totp_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    last_login_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_login_ip: Mapped[Optional[str]] = mapped_column(String(45), nullable=True)

    # Relationships
    owned_files: Mapped[list["File"]] = relationship("File", back_populates="owner", foreign_keys="File.owner_id")
    owned_folders: Mapped[list["Folder"]] = relationship("Folder", back_populates="owner")
    group_memberships: Mapped[list["GroupMember"]] = relationship("GroupMember", back_populates="user")
    permissions: Mapped[list["Permission"]] = relationship("Permission", back_populates="subject_user", foreign_keys="Permission.subject_user_id")

════════════════════════════════════════════════
STEP 3 — Crea backend/app/models/group.py
════════════════════════════════════════════════

import uuid
from typing import Optional
from sqlalchemy import String, Text, ForeignKey, Enum
from sqlalchemy.orm import mapped_column, Mapped, relationship
from sqlalchemy.dialects.postgresql import UUID, JSONB
import enum

from app.models.base import Base, UUIDMixin, TimestampMixin


class GroupRole(str, enum.Enum):
    OWNER = "owner"
    ADMIN = "admin"
    MEMBER = "member"


class Group(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "groups"
    __table_args__ = {"schema": "axshare"}

    name_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    description_encrypted: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    owner_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("axshare.users.id"), nullable=False)

    # Chiave simmetrica del gruppo cifrata con la KEK del gruppo
    # Ogni membro ha una copia della chiave cifrata con la sua chiave pubblica
    group_key_version: Mapped[int] = mapped_column(default=1, nullable=False)

    members: Mapped[list["GroupMember"]] = relationship("GroupMember", back_populates="group")


class GroupMember(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "group_members"
    __table_args__ = {"schema": "axshare"}

    group_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("axshare.groups.id"), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("axshare.users.id"), nullable=False)
    role: Mapped[GroupRole] = mapped_column(Enum(GroupRole), default=GroupRole.MEMBER, nullable=False)

    # Chiave del gruppo cifrata con la chiave pubblica di questo membro
    # Solo il membro puo' decifrarla con la sua chiave privata
    encrypted_group_key: Mapped[str] = mapped_column(Text, nullable=False)

    group: Mapped["Group"] = relationship("Group", back_populates="members")
    user: Mapped["User"] = relationship("User", back_populates="group_memberships")

════════════════════════════════════════════════
STEP 4 — Crea backend/app/models/file.py
════════════════════════════════════════════════

import uuid
from typing import Optional
from datetime import datetime
from sqlalchemy import String, Text, BigInteger, Boolean, ForeignKey, DateTime, Integer
from sqlalchemy.orm import mapped_column, Mapped, relationship
from sqlalchemy.dialects.postgresql import UUID, JSONB

from app.models.base import Base, UUIDMixin, TimestampMixin


class Folder(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "folders"
    __table_args__ = {"schema": "axshare"}

    # Nome cifrato con la chiave del proprietario — il server non lo vede
    name_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    owner_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("axshare.users.id"), nullable=False)
    parent_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("axshare.folders.id"), nullable=True)

    # Path cifrato (opaco al server)
    path_encrypted: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    is_destroyed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    destroyed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    owner: Mapped["User"] = relationship("User", back_populates="owned_folders")
    files: Mapped[list["File"]] = relationship("File", back_populates="folder")
    children: Mapped[list["Folder"]] = relationship("Folder", back_populates="parent")
    parent: Mapped[Optional["Folder"]] = relationship("Folder", back_populates="children", remote_side="Folder.id")
    permissions: Mapped[list["Permission"]] = relationship("Permission", foreign_keys="Permission.resource_folder_id")


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

    owner_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("axshare.users.id"), nullable=False)
    folder_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("axshare.folders.id"), nullable=True)

    # Versioning
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    is_latest: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    previous_version_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("axshare.files.id"), nullable=True)

    # Auto-distruzione
    is_destroyed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    destroyed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    self_destruct_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    self_destruct_after_downloads: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    download_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Metadati cifrati (JSONB — contenuto opaco al server)
    metadata_encrypted: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Classificazione (in chiaro — necessaria per policy server-side)
    classification: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)  # PUBLIC/INTERNAL/CONFIDENTIAL/SECRET

    owner: Mapped["User"] = relationship("User", back_populates="owned_files", foreign_keys=[owner_id])
    folder: Mapped[Optional["Folder"]] = relationship("Folder", back_populates="files")
    permissions: Mapped[list["Permission"]] = relationship("Permission", foreign_keys="Permission.resource_file_id")
    signatures: Mapped[list["FileSignature"]] = relationship("FileSignature", back_populates="file")

════════════════════════════════════════════════
STEP 5 — Crea backend/app/models/permission.py
════════════════════════════════════════════════

import uuid
from typing import Optional
from datetime import datetime
from sqlalchemy import String, ForeignKey, DateTime, Enum, Boolean
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
    subject_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("axshare.users.id"), nullable=True)
    subject_group_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("axshare.groups.id"), nullable=True)

    # Resource: su cosa (file o folder)
    resource_file_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("axshare.files.id"), nullable=True)
    resource_folder_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("axshare.folders.id"), nullable=True)

    level: Mapped[PermissionLevel] = mapped_column(Enum(PermissionLevel), nullable=False)

    # Permessi a tempo — NULL = permanente
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # Chiave del file/folder cifrata per questo soggetto
    # Permette al soggetto di decifrarla con la propria chiave privata
    resource_key_encrypted: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)

    granted_by_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("axshare.users.id"), nullable=False)

    subject_user: Mapped[Optional["User"]] = relationship("User", back_populates="permissions", foreign_keys=[subject_user_id])

════════════════════════════════════════════════
STEP 6 — Crea backend/app/models/audit.py
════════════════════════════════════════════════

import uuid
from typing import Optional
from sqlalchemy import String, Text, ForeignKey
from sqlalchemy.orm import mapped_column, Mapped
from sqlalchemy.dialects.postgresql import UUID, JSONB

from app.models.base import Base, UUIDMixin, TimestampMixin


class AuditLog(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "audit_logs"
    __table_args__ = {"schema": "axshare"}

    # Chi ha eseguito l'azione
    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("axshare.users.id"), nullable=True)
    user_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # Tipo di azione
    action: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    # Es: FILE_UPLOAD, FILE_DOWNLOAD, FILE_DELETE, FILE_SHARE,
    #     FOLDER_CREATE, PERMISSION_GRANT, PERMISSION_REVOKE,
    #     USER_LOGIN, USER_LOGOUT, FILE_SIGN, FILE_DESTROY

    # Risorsa coinvolta
    resource_type: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    resource_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)

    # Contesto (IP, user agent, ecc.)
    ip_address: Mapped[Optional[str]] = mapped_column(String(45), nullable=True)
    user_agent: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Dettagli aggiuntivi (JSON — opzionale)
    details: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)

    # Hash del log precedente (per catena immutabile)
    previous_hash: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    log_hash: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)

    outcome: Mapped[str] = mapped_column(String(16), default="success", nullable=False)  # success / failure

════════════════════════════════════════════════
STEP 7 — Crea backend/app/models/signature.py
════════════════════════════════════════════════

import uuid
from typing import Optional
from datetime import datetime
from sqlalchemy import String, Text, ForeignKey, DateTime
from sqlalchemy.orm import mapped_column, Mapped, relationship
from sqlalchemy.dialects.postgresql import UUID

from app.models.base import Base, UUIDMixin, TimestampMixin


class FileSignature(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "file_signatures"
    __table_args__ = {"schema": "axshare"}

    file_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("axshare.files.id"), nullable=False)
    signer_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("axshare.users.id"), nullable=False)

    # Tipo firma: CAdES, PAdES
    signature_type: Mapped[str] = mapped_column(String(16), nullable=False)

    # Firma digitale (base64)
    signature_data: Mapped[str] = mapped_column(Text, nullable=False)

    # Hash del file al momento della firma
    file_hash: Mapped[str] = mapped_column(String(128), nullable=False)

    # Certificato usato (PEM)
    certificate_pem: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    signed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    is_valid: Mapped[bool] = mapped_column(default=True, nullable=False)

    file: Mapped["File"] = relationship("File", back_populates="signatures")

════════════════════════════════════════════════
STEP 8 — Aggiorna backend/app/models/__init__.py
════════════════════════════════════════════════

from app.models.base import Base, UUIDMixin, TimestampMixin
from app.models.user import User, UserRole
from app.models.group import Group, GroupMember, GroupRole
from app.models.file import File, Folder
from app.models.permission import Permission, PermissionLevel
from app.models.audit import AuditLog
from app.models.signature import FileSignature

__all__ = [
    "Base",
    "UUIDMixin",
    "TimestampMixin",
    "User",
    "UserRole",
    "Group",
    "GroupMember",
    "GroupRole",
    "File",
    "Folder",
    "Permission",
    "PermissionLevel",
    "AuditLog",
    "FileSignature",
]

════════════════════════════════════════════════
STEP 9 — Configura Alembic
════════════════════════════════════════════════

Crea backend/alembic.ini:

[alembic]
script_location = alembic
prepend_sys_path = .
version_path_separator = os
sqlalchemy.url = driver://user:pass@localhost/dbname

[post_write_hooks]

[loggers]
keys = root,sqlalchemy,alembic

[handlers]
keys = console

[formatters]
keys = generic

[logger_root]
level = WARN
handlers = console
qualname =

[logger_sqlalchemy]
level = WARN
handlers =
qualname = sqlalchemy.engine

[logger_alembic]
level = INFO
handlers =
qualname = alembic

[handler_console]
class = StreamHandler
args = (sys.stderr,)
level = NOTSET
formatter = generic

[formatter_generic]
format = %(levelname)-5.5s [%(name)s] %(message)s
datefmt = %H:%M:%S

Crea backend/alembic/env.py:

import asyncio
from logging.config import fileConfig
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config
from alembic import context

from app.config import get_settings
from app.models import Base

settings = get_settings()
config = context.config
config.set_main_option("sqlalchemy.url", settings.database_url)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        include_schemas=True,
        version_table_schema="axshare",
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        include_schemas=True,
        version_table_schema="axshare",
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()

════════════════════════════════════════════════
STEP 10 — Crea prima migration e applica RLS
════════════════════════════════════════════════

Esegui da terminale:

cd /Users/r.amoroso/Documents/Cursor/AXSHARE/backend

# Installa dipendenze se non ancora fatto
pip install -r requirements.txt

# Crea prima migration
alembic revision --autogenerate -m "initial_schema"

# Applica migration
alembic upgrade head

# Verifica le tabelle create
docker exec axshare_postgres psql -U axshare -d axshare_db -c "\dt axshare.*"

# Output atteso:
# axshare.users
# axshare.groups
# axshare.group_members
# axshare.files
# axshare.folders
# axshare.permissions
# axshare.audit_logs
# axshare.file_signatures

Dopo la migration, applica RLS:

docker exec axshare_postgres psql -U axshare -d axshare_db <<'EOF'

-- Abilita RLS su tutte le tabelle sensibili
ALTER TABLE axshare.files ENABLE ROW LEVEL SECURITY;
ALTER TABLE axshare.folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE axshare.permissions ENABLE ROW LEVEL SECURITY;

-- Policy: ogni utente vede solo i propri file
-- (l'applicazione setta axshare.current_user_id tramite SET LOCAL)
CREATE POLICY files_owner_policy ON axshare.files
  USING (owner_id::text = current_setting('axshare.current_user_id', true));

CREATE POLICY folders_owner_policy ON axshare.folders
  USING (owner_id::text = current_setting('axshare.current_user_id', true));

EOF

Al termine aggiorna la sezione Risultato di questo file.
```

---

## Risultato
> *Compilare al completamento del task*

- Data completamento: ___
- Tabelle create: ___
- Migration applicata: ___
- RLS abilitato: ___
- Errori: ___
