import uuid
from typing import Optional
from sqlalchemy import Enum, ForeignKey, Text
from sqlalchemy.orm import mapped_column, Mapped, relationship
from sqlalchemy.dialects.postgresql import UUID
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
    owner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("axshare.users.id"), nullable=False
    )

    # Chiave simmetrica del gruppo cifrata con la KEK del gruppo
    # Ogni membro ha una copia della chiave cifrata con la sua chiave pubblica
    group_key_version: Mapped[int] = mapped_column(default=1, nullable=False)

    members: Mapped[list["GroupMember"]] = relationship(
        "GroupMember", back_populates="group"
    )


class GroupMember(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "group_members"
    __table_args__ = {"schema": "axshare"}

    group_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("axshare.groups.id"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("axshare.users.id"), nullable=False
    )
    role: Mapped[GroupRole] = mapped_column(
        Enum(GroupRole, values_callable=lambda obj: [e.value for e in obj]),
        default=GroupRole.MEMBER,
        nullable=False,
    )

    # Chiave del gruppo cifrata con la chiave pubblica di questo membro
    # Solo il membro puo' decifrarla con la sua chiave privata
    encrypted_group_key: Mapped[str] = mapped_column(Text, nullable=False)

    group: Mapped["Group"] = relationship("Group", back_populates="members")
    user: Mapped["User"] = relationship("User", back_populates="group_memberships")
