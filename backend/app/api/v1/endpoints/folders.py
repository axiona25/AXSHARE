"""
Albero di cartelle con nomi sempre cifrati lato client.
"""

import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.file import File, Folder
from app.models.permission import Permission
from app.models.user import User
from app.services.activity_service import log_activity
from app.services.permission_service import PermissionService as PermSvc

router = APIRouter(prefix="/folders", tags=["folders"])


class FolderCreate(BaseModel):
    name_encrypted: str
    parent_id: Optional[uuid.UUID] = None
    folder_key_encrypted: Optional[str] = None  # Chiave cartella cifrata con pubkey owner (opzionale)


@router.post("/")
async def create_folder(
    payload: FolderCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    folder = Folder(
        name_encrypted=payload.name_encrypted,
        parent_id=payload.parent_id,
        owner_id=current_user.id,
        folder_key_encrypted=payload.folder_key_encrypted,
    )
    db.add(folder)
    await db.commit()
    await db.refresh(folder)
    await log_activity(db, current_user.id, "create_folder", "folder", folder.id)
    return {"folder_id": str(folder.id)}


@router.get("/shared-with-me")
async def list_shared_folders(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Cartelle condivise con l'utente corrente (per pagina Condivisi)."""
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(Folder, User.id, User.email, User.display_name_encrypted, Permission.expires_at)
        .select_from(Permission)
        .join(Folder, Folder.id == Permission.resource_folder_id)
        .join(User, User.id == Folder.owner_id)
        .where(
            Permission.subject_user_id == current_user.id,
            Permission.is_active.is_(True),
            (Permission.expires_at.is_(None)) | (Permission.expires_at > now),
            Folder.is_destroyed.is_(False),
        )
    )
    rows = result.all()
    return [
        {
            "id": str(r[0].id),
            "name_encrypted": r[0].name_encrypted,
            "owner_id": str(r[1]),
            "owner_email": r[2] or "",
            "owner_display_name": r[3] or "",
            "updated_at": r[0].updated_at.isoformat() if r[0].updated_at else None,
            "type": "folder",
            "permission_expires_at": r[4].isoformat() if r[4] else None,
        }
        for r in rows
    ]


@router.get("/{folder_id}/key")
async def get_folder_key(
    folder_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Ritorna la folder_key_encrypted per l'utente (owner: folder.folder_key_encrypted; condiviso: permission.resource_key_encrypted). Incluso owner_id per AAD in decrypt nome cartella."""
    result = await db.execute(select(Folder).where(Folder.id == folder_id))
    folder = result.scalar_one_or_none()
    if not folder:
        raise HTTPException(status_code=404, detail="Cartella non trovata nel DB")
    owner_id_str = str(folder.owner_id)
    if folder.owner_id == current_user.id:
        return {"folder_key_encrypted": folder.folder_key_encrypted or "", "owner_id": owner_id_str}
    perm = await PermSvc._get_permission(
        db, current_user.id, resource_folder_id=folder_id
    )
    if perm and getattr(perm, "resource_key_encrypted", None):
        return {"folder_key_encrypted": perm.resource_key_encrypted or "", "owner_id": owner_id_str}
    raise HTTPException(status_code=403, detail="Accesso negato alla cartella")


@router.delete("/{folder_id}")
async def delete_folder(
    folder_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Folder).where(Folder.id == folder_id, Folder.owner_id == current_user.id)
    )
    folder = result.scalar_one_or_none()
    if not folder:
        raise HTTPException(status_code=404, detail="Cartella non trovata")
    await db.delete(folder)
    await db.commit()
    await log_activity(db, current_user.id, "delete", "folder", folder_id)
    return {"deleted": True}


async def _folder_is_descendant(db: AsyncSession, folder_id: uuid.UUID, ancestor_id: uuid.UUID) -> bool:
    """True se folder_id è discendente di ancestor_id (o uguale)."""
    current = folder_id
    while current:
        if current == ancestor_id:
            return True
        result = await db.execute(select(Folder.parent_id).where(Folder.id == current))
        row = result.scalar_one_or_none()
        if row is None:
            return False
        current = row[0]
    return False


async def _get_descendant_folder_ids(
    db: AsyncSession, root_id: uuid.UUID, owner_id: uuid.UUID
) -> list[uuid.UUID]:
    """Restituisce root_id + tutti gli ID delle cartelle discendenti (stesso owner)."""
    out: list[uuid.UUID] = [root_id]
    frontier = [root_id]
    while frontier:
        result = await db.execute(
            select(Folder.id).where(
                Folder.parent_id.in_(frontier),
                Folder.owner_id == owner_id,
                Folder.is_destroyed.is_(False),
            )
        )
        next_ids = [r[0] for r in result.all()]
        frontier = next_ids
        out.extend(next_ids)
    return out


@router.patch("/{folder_id}")
async def update_folder(
    folder_id: uuid.UUID,
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Folder).where(Folder.id == folder_id, Folder.owner_id == current_user.id)
    )
    folder = result.scalar_one_or_none()
    if not folder:
        raise HTTPException(status_code=404, detail="Cartella non trovata")
    action = None
    if "name_encrypted" in payload:
        folder.name_encrypted = payload["name_encrypted"]
        action = "rename"
    if "folder_key_encrypted" in payload:
        folder.folder_key_encrypted = payload["folder_key_encrypted"]
    if "color" in payload:
        folder.color = payload["color"]
    if "parent_id" in payload:
        new_parent = payload["parent_id"]
        if new_parent is None or new_parent == "":
            folder.parent_id = None
        else:
            try:
                parent_uuid = uuid.UUID(new_parent) if isinstance(new_parent, str) else new_parent
            except (ValueError, TypeError):
                raise HTTPException(status_code=400, detail="parent_id non valido")
            if parent_uuid == folder_id:
                raise HTTPException(status_code=400, detail="Una cartella non può essere spostata in sé stessa")
            parent_result = await db.execute(
                select(Folder).where(
                    Folder.id == parent_uuid,
                    Folder.owner_id == current_user.id,
                    Folder.is_destroyed.is_(False),
                )
            )
            if parent_result.scalar_one_or_none() is None:
                raise HTTPException(status_code=404, detail="Cartella di destinazione non trovata")
            if await _folder_is_descendant(db, parent_uuid, folder_id):
                raise HTTPException(status_code=400, detail="Non puoi spostare una cartella in una sua sottocartella")
            folder.parent_id = parent_uuid
        action = "move"
    await db.commit()
    await db.refresh(folder)
    if action:
        await log_activity(db, current_user.id, action, "folder", folder_id)
    return {"updated": True}


@router.get("/")
async def list_root_folders(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    size_subq = (
        select(func.coalesce(func.sum(File.size_bytes), 0))
        .where(File.folder_id == Folder.id, File.is_destroyed.is_(False))
        .correlate(Folder)
        .scalar_subquery()
    )
    count_subq = (
        select(func.count(File.id))
        .where(File.folder_id == Folder.id, File.is_destroyed.is_(False))
        .correlate(Folder)
        .scalar_subquery()
    )
    result = await db.execute(
        select(Folder, size_subq.label("total_size_bytes"), count_subq.label("file_count")).where(
            Folder.owner_id == current_user.id,
            Folder.parent_id.is_(None),
            Folder.is_destroyed.is_(False),
        )
    )
    rows = result.all()
    return [
        {
            "id": str(r[0].id),
            "name_encrypted": r[0].name_encrypted,
            "created_at": r[0].created_at.isoformat() if r[0].created_at else None,
            "updated_at": r[0].updated_at.isoformat() if r[0].updated_at else None,
            "total_size_bytes": int(r[1]) if r[1] is not None else 0,
            "file_count": int(r[2]) if r[2] is not None else 0,
            "color": r[0].color,
        }
        for r in rows
    ]


@router.get("/root/files")
async def list_root_files(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """File in root (folder_id IS NULL) per l'utente corrente. Esclude file junk (size <= 100)."""
    result = await db.execute(
        select(File).where(
            File.owner_id == current_user.id,
            File.folder_id.is_(None),
            File.is_destroyed.is_(False),
            File.is_trashed.is_(False),
            File.size_bytes > 100,
        )
    )
    files = result.scalars().all()
    return [
        {
            "id": str(f.id),
            "name_encrypted": f.name_encrypted,
            "size": f.size_bytes,
            "current_version": f.version,
            "created_at": f.created_at.isoformat() if f.created_at else None,
            "updated_at": f.updated_at.isoformat() if f.updated_at else None,
            "is_signed": f.is_signed,
            "owner_id": str(current_user.id),
            "owner_email": current_user.email,
            "owner_display_name": None,
        }
        for f in files
    ]


@router.get("/{folder_id}/children")
async def list_children(
    folder_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    parent = await db.get(Folder, folder_id)
    if parent is None or parent.is_destroyed:
        raise HTTPException(status_code=404, detail="Cartella non trovata")
    if parent.owner_id != current_user.id:
        perm = await PermSvc._get_permission(
            db, current_user.id, resource_folder_id=folder_id
        )
        if perm is None:
            raise HTTPException(status_code=404, detail="Cartella non trovata")
    size_subq = (
        select(func.coalesce(func.sum(File.size_bytes), 0))
        .where(File.folder_id == Folder.id, File.is_destroyed.is_(False))
        .correlate(Folder)
        .scalar_subquery()
    )
    count_subq = (
        select(func.count(File.id))
        .where(File.folder_id == Folder.id, File.is_destroyed.is_(False))
        .correlate(Folder)
        .scalar_subquery()
    )
    result = await db.execute(
        select(Folder, size_subq.label("total_size_bytes"), count_subq.label("file_count")).where(
            Folder.parent_id == folder_id,
            Folder.is_destroyed.is_(False),
        )
    )
    rows = result.all()
    return [
        {
            "id": str(r[0].id),
            "name_encrypted": r[0].name_encrypted,
            "created_at": r[0].created_at.isoformat() if r[0].created_at else None,
            "updated_at": r[0].updated_at.isoformat() if r[0].updated_at else None,
            "total_size_bytes": int(r[1]) if r[1] is not None else 0,
            "file_count": int(r[2]) if r[2] is not None else 0,
            "color": r[0].color,
        }
        for r in rows
    ]


@router.get("/{folder_id}/stats")
async def get_folder_stats(
    folder_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Restituisce total_size_bytes e file_count per una cartella (inclusi file nelle sottocartelle)."""
    folder = await db.get(Folder, folder_id)
    if folder is None or folder.owner_id != current_user.id or folder.is_destroyed:
        raise HTTPException(status_code=404, detail="Cartella non trovata")
    folder_ids = await _get_descendant_folder_ids(db, folder_id, folder.owner_id)
    size_result = await db.execute(
        select(func.coalesce(func.sum(File.size_bytes), 0)).where(
            File.folder_id.in_(folder_ids),
            File.is_destroyed.is_(False),
        )
    )
    count_result = await db.execute(
        select(func.count(File.id)).where(
            File.folder_id.in_(folder_ids),
            File.is_destroyed.is_(False),
        )
    )
    total_size = int(size_result.scalar() or 0)
    file_count = int(count_result.scalar() or 0)
    return {"total_size_bytes": total_size, "file_count": file_count}


@router.get("/{folder_id}/files")
async def list_folder_files(
    folder_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    folder = await db.get(Folder, folder_id)
    if folder is None or folder.is_destroyed:
        raise HTTPException(status_code=404, detail="Cartella non trovata")
    if folder.owner_id != current_user.id:
        perm = await PermSvc._get_permission(
            db, current_user.id, resource_folder_id=folder_id
        )
        if perm is None:
            raise HTTPException(status_code=404, detail="Cartella non trovata")
    result = await db.execute(
        select(File).where(
            File.folder_id == folder_id,
            File.is_destroyed.is_(False),
            File.is_trashed.is_(False),
            File.size_bytes > 100,
        )
    )
    files = result.scalars().all()
    if folder.owner_id == current_user.id:
        return [
            {
                "id": str(f.id),
                "name_encrypted": f.name_encrypted,
                "size": f.size_bytes,
                "current_version": f.version,
                "created_at": f.created_at.isoformat() if f.created_at else None,
                "updated_at": f.updated_at.isoformat() if f.updated_at else None,
                "is_signed": f.is_signed,
                "owner_id": str(current_user.id),
                "owner_email": current_user.email,
                "owner_display_name": None,
            }
            for f in files
        ]
    owner_ids = list({f.owner_id for f in files})
    owners_result = await db.execute(select(User).where(User.id.in_(owner_ids)))
    owners = {u.id: u for u in owners_result.scalars().all()}
    return [
        {
            "id": str(f.id),
            "name_encrypted": f.name_encrypted,
            "size": f.size_bytes,
            "current_version": f.version,
            "created_at": f.created_at.isoformat() if f.created_at else None,
            "updated_at": f.updated_at.isoformat() if f.updated_at else None,
            "is_signed": f.is_signed,
            "owner_id": str(f.owner_id),
            "owner_email": (owners[f.owner_id].email if f.owner_id in owners else ""),
            "owner_display_name": (owners[f.owner_id].display_name_encrypted if f.owner_id in owners else "") or "",
        }
        for f in files
    ]
