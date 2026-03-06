"""Condivisione file con gruppi — zero-knowledge: file_key cifrata con group key."""

from datetime import datetime
from uuid import UUID
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession
import structlog

from app.models.file import File
from app.models.group import Group, GroupMember
from app.models.permission import Permission, PermissionLevel
from app.models.user import User

logger = structlog.get_logger()


class GroupShareService:
    @staticmethod
    async def share_file_with_group(
        db: AsyncSession,
        owner: User,
        file_id: UUID,
        group_id: UUID,
        file_key_encrypted_for_group: str,
        level: PermissionLevel = PermissionLevel.READ,
        expires_at: Optional[datetime] = None,
    ) -> list[Permission]:
        """
        Condivide un file con tutti i membri attivi di un gruppo.
        file_key_encrypted_for_group: file_key cifrata con la group_master_key.
        Crea una Permission per ogni membro (escluso owner se già owner del file).
        """
        file = await db.get(File, file_id)
        if not file:
            raise HTTPException(status_code=404, detail="File non trovato")
        if file.owner_id != owner.id:
            raise HTTPException(
                status_code=403, detail="Non sei il proprietario del file"
            )

        group = await db.get(Group, group_id)
        if not group:
            raise HTTPException(status_code=404, detail="Gruppo non trovato")

        result = await db.execute(
            select(GroupMember).where(
                and_(
                    GroupMember.group_id == group_id,
                    GroupMember.user_id == owner.id,
                )
            )
        )
        if not result.scalar_one_or_none():
            raise HTTPException(
                status_code=403, detail="Non sei membro del gruppo"
            )

        result = await db.execute(
            select(GroupMember).where(GroupMember.group_id == group_id)
        )
        members = result.scalars().all()

        permissions = []
        for member in members:
            if member.user_id == owner.id:
                continue

            existing_result = await db.execute(
                select(Permission).where(
                    and_(
                        Permission.subject_user_id == member.user_id,
                        Permission.resource_file_id == file_id,
                        Permission.is_active.is_(True),
                    )
                )
            )
            existing_perm = existing_result.scalar_one_or_none()

            if existing_perm:
                existing_perm.level = level
                existing_perm.expires_at = expires_at
                existing_perm.resource_key_encrypted = file_key_encrypted_for_group
                permissions.append(existing_perm)
            else:
                perm = Permission(
                    subject_user_id=member.user_id,
                    resource_file_id=file_id,
                    level=level,
                    expires_at=expires_at,
                    resource_key_encrypted=file_key_encrypted_for_group,
                    granted_by_id=owner.id,
                    is_active=True,
                )
                db.add(perm)
                permissions.append(perm)

        await db.commit()
        for p in permissions:
            await db.refresh(p)

        logger.info(
            "file_shared_with_group",
            file_id=str(file_id),
            group_id=str(group_id),
            members_count=len(permissions),
        )
        return permissions

    @staticmethod
    async def revoke_group_access(
        db: AsyncSession,
        owner: User,
        file_id: UUID,
        group_id: UUID,
    ) -> int:
        """Revoca accesso di tutti i membri del gruppo a un file."""
        file = await db.get(File, file_id)
        if not file or file.owner_id != owner.id:
            raise HTTPException(status_code=403, detail="Non autorizzato")

        result = await db.execute(
            select(GroupMember).where(GroupMember.group_id == group_id)
        )
        members = result.scalars().all()
        member_ids = [m.user_id for m in members]

        revoked = 0
        for uid in member_ids:
            result = await db.execute(
                select(Permission).where(
                    and_(
                        Permission.subject_user_id == uid,
                        Permission.resource_file_id == file_id,
                        Permission.is_active.is_(True),
                    )
                )
            )
            perm = result.scalar_one_or_none()
            if perm:
                perm.is_active = False
                perm.resource_key_encrypted = None
                revoked += 1

        await db.commit()
        logger.info(
            "group_access_revoked",
            file_id=str(file_id),
            group_id=str(group_id),
            revoked=revoked,
        )
        return revoked
