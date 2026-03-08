"""Endpoint cestino: lista, sposta nel cestino, ripristina, elimina definitivamente."""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.file import File, Folder
from app.models.user import User
from app.services.activity_service import log_activity

router = APIRouter(prefix="/trash", tags=["trash"])


@router.get("")
async def list_trash(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Lista file e cartelle nel cestino."""
    files_result = await db.execute(
        select(File).where(
            File.owner_id == current_user.id,
            File.is_trashed.is_(True),
            File.is_destroyed.is_(False),
        )
    )
    folders_result = await db.execute(
        select(Folder).where(
            Folder.owner_id == current_user.id,
            Folder.is_trashed.is_(True),
        )
    )
    files = files_result.scalars().all()
    folders = folders_result.scalars().all()
    return {
        "files": [
            {
                "id": str(f.id),
                "name_encrypted": f.name_encrypted,
                "size_bytes": f.size_bytes,
                "trashed_at": f.trashed_at.isoformat() if f.trashed_at else None,
                "original_folder_id": str(f.original_folder_id) if f.original_folder_id else None,
                "type": "file",
            }
            for f in files
        ],
        "folders": [
            {
                "id": str(fo.id),
                "name_encrypted": fo.name_encrypted,
                "trashed_at": fo.trashed_at.isoformat() if fo.trashed_at else None,
                "original_folder_id": str(fo.original_folder_id) if fo.original_folder_id else None,
                "type": "folder",
            }
            for fo in folders
        ],
    }


@router.post("/file/{file_id}")
async def trash_file(
    file_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Sposta un file nel cestino."""
    result = await db.execute(
        select(File).where(File.id == file_id, File.owner_id == current_user.id)
    )
    file = result.scalar_one_or_none()
    if not file:
        raise HTTPException(status_code=404, detail="File non trovato")
    file.is_trashed = True
    file.trashed_at = datetime.now(timezone.utc)
    file.original_folder_id = file.folder_id
    await db.commit()
    await log_activity(db, current_user.id, "trash", "file", file_id)
    return {"trashed": True, "file_id": str(file_id)}


@router.post("/folder/{folder_id}")
async def trash_folder(
    folder_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Sposta una cartella nel cestino."""
    result = await db.execute(
        select(Folder).where(
            Folder.id == folder_id, Folder.owner_id == current_user.id
        )
    )
    folder = result.scalar_one_or_none()
    if not folder:
        raise HTTPException(status_code=404, detail="Cartella non trovata")
    folder.is_trashed = True
    folder.trashed_at = datetime.now(timezone.utc)
    folder.original_folder_id = folder.parent_id
    await db.commit()
    await log_activity(db, current_user.id, "trash", "folder", folder_id)
    return {"trashed": True, "folder_id": str(folder_id)}


@router.post("/restore/file/{file_id}")
async def restore_file(
    file_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Ripristina un file dal cestino."""
    result = await db.execute(
        select(File).where(File.id == file_id, File.owner_id == current_user.id)
    )
    file = result.scalar_one_or_none()
    if not file:
        raise HTTPException(status_code=404, detail="File non trovato")
    file.is_trashed = False
    file.trashed_at = None
    file.folder_id = file.original_folder_id
    file.original_folder_id = None
    await db.commit()
    await log_activity(db, current_user.id, "restore", "file", file_id)
    return {
        "restored": True,
        "file_id": str(file_id),
        "folder_id": str(file.folder_id) if file.folder_id else None,
    }


@router.post("/restore/folder/{folder_id}")
async def restore_folder(
    folder_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Ripristina una cartella dal cestino."""
    result = await db.execute(
        select(Folder).where(
            Folder.id == folder_id, Folder.owner_id == current_user.id
        )
    )
    folder = result.scalar_one_or_none()
    if not folder:
        raise HTTPException(status_code=404, detail="Cartella non trovata")
    folder.is_trashed = False
    folder.trashed_at = None
    folder.parent_id = folder.original_folder_id
    folder.original_folder_id = None
    await db.commit()
    await log_activity(db, current_user.id, "restore", "folder", folder_id)
    return {"restored": True, "folder_id": str(folder_id)}


@router.delete("/file/{file_id}")
async def destroy_trashed_file(
    file_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Elimina definitivamente un file dal cestino."""
    from app.services.destruct_service import DestructService

    result = await db.execute(
        select(File).where(
            File.id == file_id,
            File.owner_id == current_user.id,
            File.is_trashed.is_(True),
        )
    )
    file = result.scalar_one_or_none()
    if not file:
        raise HTTPException(status_code=404, detail="File non trovato nel cestino")
    destroyed = await DestructService.destroy_file(
        db, file_id, reason="manual_trash"
    )
    return {"destroyed": destroyed, "file_id": str(file_id)}


@router.delete("/folder/{folder_id}")
async def destroy_trashed_folder(
    folder_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Elimina definitivamente una cartella dal cestino."""
    result = await db.execute(
        select(Folder).where(
            Folder.id == folder_id,
            Folder.owner_id == current_user.id,
            Folder.is_trashed.is_(True),
        )
    )
    folder = result.scalar_one_or_none()
    if not folder:
        raise HTTPException(
            status_code=404, detail="Cartella non trovata nel cestino"
        )
    await db.delete(folder)
    await db.commit()
    await log_activity(db, current_user.id, "destroy", "folder", folder_id)
    return {"destroyed": True, "folder_id": str(folder_id)}


@router.delete("/empty")
async def empty_trash(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Svuota il cestino: elimina definitivamente tutti i file e le cartelle."""
    from app.services.destruct_service import DestructService

    files_result = await db.execute(
        select(File).where(
            File.owner_id == current_user.id,
            File.is_trashed.is_(True),
            File.is_destroyed.is_(False),
        )
    )
    folders_result = await db.execute(
        select(Folder).where(
            Folder.owner_id == current_user.id,
            Folder.is_trashed.is_(True),
        )
    )
    files = files_result.scalars().all()
    folders = folders_result.scalars().all()

    destroyed_count = 0
    for f in files:
        ok = await DestructService.destroy_file(
            db, f.id, reason="empty_trash"
        )
        if ok:
            destroyed_count += 1
    for fo in folders:
        await db.delete(fo)
        destroyed_count += 1
    await db.commit()
    return {"emptied": True, "destroyed_count": destroyed_count}
