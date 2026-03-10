"""
ACL per file e folder: grant, revoke, list, check.
Zero-knowledge: resource_key_encrypted è la file_key cifrata con la pubkey del destinatario.
Ereditarietà: i permessi su cartella si propagano ai file (e sottocartelle) con inherited_from_folder_id.
La cartella vince sempre sul permesso diretto su file per lo stesso utente.
"""

from uuid import UUID
from datetime import datetime, timezone
from typing import Dict, Optional

from fastapi import HTTPException, status
from sqlalchemy import select, and_, text
from sqlalchemy.orm import joinedload
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.file import File, Folder
from app.models.permission import Permission, PermissionLevel
from app.models.user import User


class PermissionService:
    @staticmethod
    async def _get_file_ids_in_folder_tree(
        db: AsyncSession, folder_id: UUID
    ) -> list[UUID]:
        """Restituisce tutti gli id file nella cartella e nelle sottocartelle (ricorsivo)."""
        # CTE ricorsiva: tutte le cartelle nel sottoalbero
        result = await db.execute(
            text("""
                WITH RECURSIVE tree AS (
                    SELECT id FROM axshare.folders WHERE id = :fid AND is_destroyed = false
                    UNION ALL
                    SELECT f.id FROM axshare.folders f
                    INNER JOIN tree t ON f.parent_id = t.id
                    WHERE f.is_destroyed = false
                )
                SELECT id FROM axshare.files
                WHERE folder_id IN (SELECT id FROM tree)
                AND is_destroyed = false
            """),
            {"fid": str(folder_id)},
        )
        rows = result.fetchall()
        return [UUID(str(r[0])) for r in rows]

    @staticmethod
    async def get_permission_for_file(
        db: AsyncSession,
        user_id: UUID,
        file_id: UUID,
    ) -> Optional[Permission]:
        """
        Restituisce il permesso effettivo dell'utente sul file.
        Priorità: permesso ereditato (inherited_from_folder_id non null) > permesso diretto.
        """
        now = datetime.now(timezone.utc)
        conditions = [
            Permission.subject_user_id == user_id,
            Permission.resource_file_id == file_id,
            Permission.is_active.is_(True),
            (Permission.expires_at.is_(None)) | (Permission.expires_at > now),
        ]
        result = await db.execute(
            select(Permission)
            .where(and_(*conditions))
            .order_by(Permission.inherited_from_folder_id.desc().nulls_last())
            .limit(1)
        )
        return result.scalar_one_or_none()

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
        block_delete: bool = False,
        block_link: bool = False,
        require_pin: bool = False,
        file_keys_encrypted: Optional[Dict[UUID, str]] = None,
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

        # Su file: se esiste già un permesso ereditato da cartella, non sovrascrivere (cartella vince)
        if resource_file_id:
            effective = await PermissionService.get_permission_for_file(
                db, subject_user_id, resource_file_id
            )
            if effective and getattr(effective, "inherited_from_folder_id", None) is not None:
                await db.refresh(effective)
                return effective

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
            existing_perm.block_delete = block_delete
            existing_perm.block_link = block_link
            existing_perm.require_pin = require_pin
            await db.commit()
            await db.refresh(existing_perm)
            if resource_folder_id:
                await PermissionService._propagate_folder_permission_to_files(
                    db, grantor, resource_folder_id, subject_user_id,
                    level, expires_at, block_delete, block_link, require_pin,
                    file_keys_encrypted=file_keys_encrypted,
                )
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
            block_delete=block_delete,
            block_link=block_link,
            require_pin=require_pin,
        )
        db.add(permission)
        await db.commit()
        await db.refresh(permission)
        if resource_folder_id:
            await PermissionService._propagate_folder_permission_to_files(
                db, grantor, resource_folder_id, subject_user_id,
                level, expires_at, block_delete, block_link, require_pin,
                file_keys_encrypted=file_keys_encrypted,
            )
        return permission

    @staticmethod
    async def _propagate_folder_permission_to_files(
        db: AsyncSession,
        grantor: User,
        folder_id: UUID,
        subject_user_id: UUID,
        level: PermissionLevel,
        expires_at: Optional[datetime],
        block_delete: bool,
        block_link: bool,
        require_pin: bool,
        file_keys_encrypted: Optional[Dict[UUID, str]] = None,
    ) -> None:
        """Crea/aggiorna permessi ereditati su tutti i file nella cartella e sottocartelle.
        file_keys_encrypted: opzionale mappa file_id -> chiave file cifrata per il destinatario (zero-knowledge: fornita dal client).
        """
        file_ids = await PermissionService._get_file_ids_in_folder_tree(db, folder_id)
        for file_id in file_ids:
            key_for_file = (
                file_keys_encrypted.get(file_id)
                if file_keys_encrypted and file_id in file_keys_encrypted
                else None
            )
            existing = await db.execute(
                select(Permission).where(
                    Permission.subject_user_id == subject_user_id,
                    Permission.resource_file_id == file_id,
                    Permission.is_active.is_(True),
                )
            )
            perm = existing.scalar_one_or_none()
            if perm:
                perm.level = level
                perm.expires_at = expires_at
                perm.block_delete = block_delete
                perm.block_link = block_link
                perm.require_pin = require_pin
                perm.inherited_from_folder_id = folder_id
                if key_for_file is not None:
                    perm.resource_key_encrypted = key_for_file
            else:
                perm = Permission(
                    subject_user_id=subject_user_id,
                    resource_file_id=file_id,
                    resource_folder_id=None,
                    inherited_from_folder_id=folder_id,
                    level=level,
                    expires_at=expires_at,
                    resource_key_encrypted=key_for_file,
                    granted_by_id=grantor.id,
                    is_active=True,
                    block_delete=block_delete,
                    block_link=block_link,
                    require_pin=require_pin,
                )
                db.add(perm)
        await db.commit()

    @staticmethod
    async def apply_folder_permissions_to_file(
        db: AsyncSession,
        file_id: UUID,
        folder_id: UUID,
    ) -> None:
        """
        Quando un file viene creato o spostato in una cartella, applica tutti i permessi
        attivi sulla cartella al file (ereditati con inherited_from_folder_id).
        """
        result = await db.execute(
            select(Permission).where(
                Permission.resource_folder_id == folder_id,
                Permission.is_active.is_(True),
            )
        )
        folder_perms = result.scalars().all()
        for fp in folder_perms:
            if not fp.subject_user_id:
                continue
            existing = await db.execute(
                select(Permission).where(
                    Permission.subject_user_id == fp.subject_user_id,
                    Permission.resource_file_id == file_id,
                )
            )
            perm = existing.scalar_one_or_none()
            if perm:
                perm.level = fp.level
                perm.expires_at = fp.expires_at
                perm.block_delete = fp.block_delete
                perm.block_link = fp.block_link
                perm.require_pin = fp.require_pin
                perm.inherited_from_folder_id = folder_id
                perm.is_active = True
            else:
                perm = Permission(
                    subject_user_id=fp.subject_user_id,
                    resource_file_id=file_id,
                    resource_folder_id=None,
                    inherited_from_folder_id=folder_id,
                    level=fp.level,
                    expires_at=fp.expires_at,
                    resource_key_encrypted=None,
                    granted_by_id=fp.granted_by_id,
                    is_active=True,
                    block_delete=fp.block_delete,
                    block_link=fp.block_link,
                    require_pin=fp.require_pin,
                )
                db.add(perm)
        await db.commit()

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

        # Cascade: revoca (disattiva) tutti i permessi ereditati sui file figli
        if perm.resource_folder_id:
            result = await db.execute(
                select(Permission).where(
                    Permission.inherited_from_folder_id == perm.resource_folder_id,
                    Permission.subject_user_id == perm.subject_user_id,
                )
            )
            for p in result.scalars().all():
                p.is_active = False
                p.resource_key_encrypted = None
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

        result = await db.execute(
            select(Permission)
            .options(joinedload(Permission.subject_user))
            .where(and_(*conditions))
        )
        return list(result.unique().scalars().all())

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
        now = datetime.now(timezone.utc)
        conditions = [
            Permission.subject_user_id == user_id,
            Permission.is_active == True,
            (Permission.expires_at.is_(None)) | (Permission.expires_at > now),
        ]
        if resource_file_id:
            conditions.append(Permission.resource_file_id == resource_file_id)
        if resource_folder_id:
            conditions.append(Permission.resource_folder_id == resource_folder_id)

        result = await db.execute(
            select(Permission).where(and_(*conditions)).limit(1)
        )
        return result.scalar_one_or_none()

    @staticmethod
    async def update_permission(
        db: AsyncSession,
        permission_id: UUID,
        updater: User,
        level: Optional[PermissionLevel] = None,
        block_delete: Optional[bool] = None,
        block_link: Optional[bool] = None,
        require_pin: Optional[bool] = None,
        expires_at: Optional[datetime] = None,
    ) -> Permission:
        """Aggiorna un permesso (patch parziale). Solo owner della risorsa. Propaga agli ereditati se inherited."""
        perm = await db.get(Permission, permission_id)
        if not perm:
            raise HTTPException(status_code=404, detail="Permesso non trovato")

        if perm.resource_file_id:
            file = await db.get(File, perm.resource_file_id)
            if not file or file.owner_id != updater.id:
                raise HTTPException(status_code=403, detail="Non autorizzato a modificare questo permesso")
        elif perm.resource_folder_id:
            folder = await db.get(Folder, perm.resource_folder_id)
            if not folder or folder.owner_id != updater.id:
                raise HTTPException(status_code=403, detail="Non autorizzato a modificare questo permesso")
        else:
            raise HTTPException(status_code=403, detail="Permesso non valido")

        def apply_to(p: Permission) -> None:
            if level is not None:
                p.level = level
            if block_delete is not None:
                p.block_delete = block_delete
            if block_link is not None:
                p.block_link = block_link
            if require_pin is not None:
                p.require_pin = require_pin
            if expires_at is not None:
                p.expires_at = expires_at

        apply_to(perm)

        if perm.inherited_from_folder_id and perm.subject_user_id:
            result = await db.execute(
                select(Permission).where(
                    Permission.inherited_from_folder_id == perm.inherited_from_folder_id,
                    Permission.subject_user_id == perm.subject_user_id,
                    Permission.id != perm.id,
                )
            )
            for other in result.scalars().all():
                apply_to(other)

        await db.commit()
        await db.refresh(perm)
        return perm
