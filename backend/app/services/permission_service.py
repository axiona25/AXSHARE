"""
ACL per file e folder: grant, revoke, list, check.
Zero-knowledge: resource_key_encrypted è la file_key cifrata con la pubkey del destinatario.
"""

from uuid import UUID
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.file import File, Folder
from app.models.permission import Permission, PermissionLevel
from app.models.user import User


class PermissionService:
    @staticmethod
    async def grant_permission(
        db: AsyncSession,
        grantor: User,
        subject_user_id: UUID,
        resource_file_id: Optional[UUID],
        resource_folder_id: Optional[UUID],
        level: PermissionLevel,
        resource_key_encrypted: Optional[str] = None,
        expires_at: Optional[datetime] = None,
    ) -> Permission:
        """
        Concede un permesso su file o cartella.
        Il grantor deve essere owner o avere livello >= share sulla risorsa.
        resource_key_encrypted: file_key cifrata con pubkey del destinatario.
        """
        subject = await db.get(User, subject_user_id)
        if not subject or not subject.is_active:
            raise HTTPException(status_code=404, detail="Utente destinatario non trovato")

        if resource_file_id:
            file = await db.get(File, resource_file_id)
            if not file:
                raise HTTPException(status_code=404, detail="File non trovato")
            if file.owner_id != grantor.id:
                existing = await PermissionService._get_permission(
                    db, grantor.id, resource_file_id=resource_file_id
                )
                if not existing or existing.level not in (
                    PermissionLevel.SHARE,
                    PermissionLevel.ADMIN,
                ):
                    raise HTTPException(
                        status_code=403, detail="Non autorizzato a condividere"
                    )

        if resource_folder_id:
            folder = await db.get(Folder, resource_folder_id)
            if not folder:
                raise HTTPException(status_code=404, detail="Cartella non trovata")
            if folder.owner_id != grantor.id:
                existing = await PermissionService._get_permission(
                    db, grantor.id, resource_folder_id=resource_folder_id
                )
                if not existing or existing.level not in (
                    PermissionLevel.SHARE,
                    PermissionLevel.ADMIN,
                ):
                    raise HTTPException(
                        status_code=403, detail="Non autorizzato a condividere"
                    )

        existing_perm = await PermissionService._get_permission(
            db,
            subject_user_id,
            resource_file_id=resource_file_id,
            resource_folder_id=resource_folder_id,
        )
        if existing_perm:
            existing_perm.level = level
            existing_perm.expires_at = expires_at
            existing_perm.resource_key_encrypted = resource_key_encrypted
            existing_perm.is_active = True
            await db.commit()
            await db.refresh(existing_perm)
            return existing_perm

        permission = Permission(
            subject_user_id=subject_user_id,
            resource_file_id=resource_file_id,
            resource_folder_id=resource_folder_id,
            level=level,
            expires_at=expires_at,
            resource_key_encrypted=resource_key_encrypted,
            granted_by_id=grantor.id,
            is_active=True,
        )
        db.add(permission)
        await db.commit()
        await db.refresh(permission)
        return permission

    @staticmethod
    async def revoke_permission(
        db: AsyncSession,
        revoker: User,
        permission_id: UUID,
    ) -> None:
        """Revoca un permesso. Solo owner, grantor o admin sulla risorsa."""
        perm = await db.get(Permission, permission_id)
        if not perm:
            raise HTTPException(status_code=404, detail="Permesso non trovato")

        if perm.granted_by_id == revoker.id:
            pass
        elif perm.resource_file_id:
            file = await db.get(File, perm.resource_file_id)
            if file and file.owner_id == revoker.id:
                pass
            elif not await PermissionService.check_permission(
                db, revoker, resource_file_id=perm.resource_file_id, required_level=PermissionLevel.ADMIN
            ):
                raise HTTPException(status_code=403, detail="Non autorizzato a revocare")
        elif perm.resource_folder_id:
            folder = await db.get(Folder, perm.resource_folder_id)
            if folder and folder.owner_id == revoker.id:
                pass
            elif not await PermissionService.check_permission(
                db, revoker, resource_folder_id=perm.resource_folder_id, required_level=PermissionLevel.ADMIN
            ):
                raise HTTPException(status_code=403, detail="Non autorizzato a revocare")
        else:
            raise HTTPException(status_code=403, detail="Non autorizzato a revocare")

        perm.is_active = False
        perm.resource_key_encrypted = None
        await db.commit()

    @staticmethod
    async def list_permissions(
        db: AsyncSession,
        requester: User,
        resource_file_id: Optional[UUID] = None,
        resource_folder_id: Optional[UUID] = None,
    ) -> list[Permission]:
        """Lista permessi su una risorsa. Solo owner o admin sulla risorsa."""
        if resource_file_id:
            file = await db.get(File, resource_file_id)
            if not file:
                raise HTTPException(status_code=404, detail="File non trovato")
            if file.owner_id != requester.id and not await PermissionService.check_permission(
                db, requester, resource_file_id=resource_file_id, required_level=PermissionLevel.ADMIN
            ):
                raise HTTPException(status_code=403, detail="Non autorizzato a listare i permessi")
        if resource_folder_id:
            folder = await db.get(Folder, resource_folder_id)
            if not folder:
                raise HTTPException(status_code=404, detail="Cartella non trovata")
            if folder.owner_id != requester.id and not await PermissionService.check_permission(
                db, requester, resource_folder_id=resource_folder_id, required_level=PermissionLevel.ADMIN
            ):
                raise HTTPException(status_code=403, detail="Non autorizzato a listare i permessi")

        conditions = [Permission.is_active == True]
        if resource_file_id:
            conditions.append(Permission.resource_file_id == resource_file_id)
        if resource_folder_id:
            conditions.append(Permission.resource_folder_id == resource_folder_id)

        result = await db.execute(select(Permission).where(and_(*conditions)))
        return list(result.scalars().all())

    @staticmethod
    async def check_permission(
        db: AsyncSession,
        user: User,
        resource_file_id: Optional[UUID] = None,
        resource_folder_id: Optional[UUID] = None,
        required_level: PermissionLevel = PermissionLevel.READ,
    ) -> bool:
        """
        Verifica se un utente ha almeno il livello richiesto su una risorsa.
        Owner ha sempre accesso completo.
        """
        if resource_file_id:
            file = await db.get(File, resource_file_id)
            if file and file.owner_id == user.id:
                return True
        if resource_folder_id:
            folder = await db.get(Folder, resource_folder_id)
            if folder and folder.owner_id == user.id:
                return True

        perm = await PermissionService._get_permission(
            db,
            user.id,
            resource_file_id=resource_file_id,
            resource_folder_id=resource_folder_id,
        )
        if not perm or not perm.is_active:
            return False

        if perm.expires_at and perm.expires_at < datetime.now(timezone.utc):
            perm.is_active = False
            await db.commit()
            return False

        level_order = {
            PermissionLevel.READ: 1,
            PermissionLevel.WRITE: 2,
            PermissionLevel.SHARE: 3,
            PermissionLevel.ADMIN: 4,
        }
        return level_order[perm.level] >= level_order[required_level]

    @staticmethod
    async def _get_permission(
        db: AsyncSession,
        user_id: UUID,
        resource_file_id: Optional[UUID] = None,
        resource_folder_id: Optional[UUID] = None,
    ) -> Optional[Permission]:
        conditions = [
            Permission.subject_user_id == user_id,
            Permission.is_active == True,
        ]
        if resource_file_id:
            conditions.append(Permission.resource_file_id == resource_file_id)
        if resource_folder_id:
            conditions.append(Permission.resource_folder_id == resource_folder_id)

        result = await db.execute(
            select(Permission).where(and_(*conditions)).limit(1)
        )
        return result.scalar_one_or_none()
