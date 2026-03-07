"""
Albero di cartelle con nomi sempre cifrati lato client.
"""

import uuid
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.file import File, Folder
from app.models.user import User

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
    return {"folder_id": str(folder.id)}


@router.get("/{folder_id}/key")
async def get_folder_key(
    folder_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Ritorna la folder_key_encrypted per il proprietario della cartella."""
    # Prima cerca senza filtro owner per vedere se esiste
    result_any = await db.execute(
        select(Folder).where(Folder.id == folder_id)
    )
    folder_any = result_any.scalar_one_or_none()
    if not folder_any:
        raise HTTPException(status_code=404, detail="Cartella non trovata nel DB")
    if folder_any.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Accesso negato - non sei il proprietario")
    return {
        "folder_key_encrypted": folder_any.folder_key_encrypted or "",
    }


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
    if "name_encrypted" in payload:
        folder.name_encrypted = payload["name_encrypted"]
    if "folder_key_encrypted" in payload:
        folder.folder_key_encrypted = payload["folder_key_encrypted"]
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
    await db.commit()
    await db.refresh(folder)
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
    result = await db.execute(
        select(Folder, size_subq.label("total_size_bytes")).where(
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
        }
        for f in files
    ]


@router.get("/{folder_id}/children")
async def list_children(
    folder_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Verifica che la cartella esista e appartenga all'utente
    parent = await db.get(Folder, folder_id)
    if parent is None or parent.owner_id != current_user.id or parent.is_destroyed:
        raise HTTPException(status_code=404, detail="Cartella non trovata")
    size_subq = (
        select(func.coalesce(func.sum(File.size_bytes), 0))
        .where(File.folder_id == Folder.id, File.is_destroyed.is_(False))
        .correlate(Folder)
        .scalar_subquery()
    )
    result = await db.execute(
        select(Folder, size_subq.label("total_size_bytes")).where(
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
        }
        for r in rows
    ]


@router.get("/{folder_id}/files")
async def list_folder_files(
    folder_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    folder = await db.get(Folder, folder_id)
    if folder is None or folder.owner_id != current_user.id or folder.is_destroyed:
        raise HTTPException(status_code=404, detail="Cartella non trovata")
    result = await db.execute(
        select(File).where(
            File.folder_id == folder_id,
            File.is_destroyed.is_(False),
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
        }
        for f in files
    ]
