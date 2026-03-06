"""
Albero di cartelle con nomi sempre cifrati lato client.
"""

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.file import File, Folder
from app.models.user import User

router = APIRouter(prefix="/folders", tags=["folders"])


class FolderCreate(BaseModel):
    name_encrypted: str
    parent_id: Optional[uuid.UUID] = None
    folder_key_encrypted: str  # Chiave cartella cifrata con pubkey owner


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


@router.get("/")
async def list_root_folders(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Folder).where(
            Folder.owner_id == current_user.id,
            Folder.parent_id.is_(None),
            Folder.is_destroyed.is_(False),
        )
    )
    folders = result.scalars().all()
    return [{"id": str(f.id), "name_encrypted": f.name_encrypted} for f in folders]


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
    result = await db.execute(
        select(Folder).where(
            Folder.parent_id == folder_id,
            Folder.is_destroyed.is_(False),
        )
    )
    folders = result.scalars().all()
    return [{"id": str(f.id), "name_encrypted": f.name_encrypted} for f in folders]


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
        )
    )
    files = result.scalars().all()
    return [
        {"id": str(f.id), "name_encrypted": f.name_encrypted, "size": f.size_bytes}
        for f in files
    ]
