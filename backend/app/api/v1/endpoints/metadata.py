"""Endpoint metadati cifrati e tag (TASK 8.1) + thumbnail (TASK 8.3)."""

import json
import uuid
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel as PydanticBaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.file import File
from app.models.metadata import FileMetadata, FileTag
from app.models.user import User
from app.schemas.metadata import (
    FileLabelsUpdate,
    FileMetadataCreate,
    FileMetadataResponse,
    TagCreate,
    TagResponse,
)


class ThumbnailUpload(PydanticBaseModel):
    """Body per upload thumbnail cifrata."""

    thumbnail_encrypted: str  # base64 del blob cifrato AES-GCM
    thumbnail_key_encrypted: str  # chiave thumbnail cifrata con pubkey owner (RSA-OAEP)

router = APIRouter(prefix="/files", tags=["metadata"])


async def _get_file_owned(
    file_id: uuid.UUID, user: User, db: AsyncSession
) -> File:
    result = await db.execute(
        select(File).where(
            File.id == file_id,
            File.owner_id == user.id,
            File.is_destroyed.is_(False),
        )
    )
    file = result.scalar_one_or_none()
    if not file:
        raise HTTPException(status_code=404, detail="File non trovato")
    return file


# ─── Metadati cifrati ─────────────────────────────────────────────────────────


@router.put("/{file_id}/metadata", response_model=FileMetadataResponse)
async def upsert_metadata(
    file_id: uuid.UUID,
    body: FileMetadataCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_file_owned(file_id, current_user, db)
    result = await db.execute(
        select(FileMetadata).where(FileMetadata.file_id == file_id)
    )
    meta = result.scalar_one_or_none()
    if meta:
        for k, v in body.model_dump(exclude_unset=True).items():
            setattr(meta, k, v)
    else:
        meta = FileMetadata(file_id=file_id, **body.model_dump())
        db.add(meta)
    await db.commit()
    await db.refresh(meta)
    return meta


@router.get("/{file_id}/metadata", response_model=FileMetadataResponse)
async def get_metadata(
    file_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(FileMetadata).where(FileMetadata.file_id == file_id)
    )
    meta = result.scalar_one_or_none()
    if not meta:
        raise HTTPException(status_code=404, detail="Nessun metadato trovato")
    return meta


@router.delete("/{file_id}/metadata", status_code=status.HTTP_204_NO_CONTENT)
async def delete_metadata(
    file_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_file_owned(file_id, current_user, db)
    result = await db.execute(
        select(FileMetadata).where(FileMetadata.file_id == file_id)
    )
    meta = result.scalar_one_or_none()
    if meta:
        await db.delete(meta)
        await db.commit()


# ─── Tag ─────────────────────────────────────────────────────────────────────


@router.post(
    "/{file_id}/tags",
    response_model=TagResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_tag(
    file_id: uuid.UUID,
    body: TagCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_file_owned(file_id, current_user, db)
    tag_val = body.tag.lower().strip()[:64]
    if not tag_val:
        raise HTTPException(status_code=422, detail="Tag vuoto")
    result = await db.execute(
        select(FileTag).where(
            FileTag.file_id == file_id, FileTag.tag == tag_val
        )
    )
    if result.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Tag già presente")
    tag = FileTag(
        file_id=file_id, tag=tag_val, created_by=current_user.id
    )
    db.add(tag)
    await db.commit()
    await db.refresh(tag)
    return tag


@router.get("/{file_id}/tags", response_model=List[TagResponse])
async def list_tags(
    file_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(FileTag).where(FileTag.file_id == file_id).order_by(FileTag.created_at)
    )
    return list(result.scalars().all())


@router.delete(
    "/{file_id}/tags/{tag}", status_code=status.HTTP_204_NO_CONTENT
)
async def remove_tag(
    file_id: uuid.UUID,
    tag: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_file_owned(file_id, current_user, db)
    result = await db.execute(
        select(FileTag).where(
            FileTag.file_id == file_id,
            FileTag.tag == tag.lower().strip(),
        )
    )
    tag_obj = result.scalar_one_or_none()
    if not tag_obj:
        raise HTTPException(status_code=404, detail="Tag non trovato")
    await db.delete(tag_obj)
    await db.commit()


# ─── Label / Starred / Pinned ─────────────────────────────────────────────────


@router.patch("/{file_id}/labels")
async def update_labels(
    file_id: uuid.UUID,
    body: FileLabelsUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    file = await _get_file_owned(file_id, current_user, db)
    if body.is_starred is not None:
        file.is_starred = body.is_starred
    if body.is_pinned is not None:
        file.is_pinned = body.is_pinned
    if body.color_label is not None:
        allowed = {"red", "blue", "green", "yellow", "orange", "purple", ""}
        if body.color_label not in allowed:
            raise HTTPException(
                status_code=422, detail="Colore non valido"
            )
        file.color_label = body.color_label or None
    await db.commit()
    await db.refresh(file)
    return {
        "file_id": str(file_id),
        "is_starred": file.is_starred,
        "is_pinned": file.is_pinned,
        "color_label": file.color_label,
    }


# ─── Thumbnail cifrate (TASK 8.3) ─────────────────────────────────────────────


@router.put("/{file_id}/thumbnail")
async def upload_thumbnail(
    file_id: uuid.UUID,
    body: ThumbnailUpload,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Upload thumbnail cifrata. Il server non la decifra mai.
    thumbnail_key_encrypted: la thumbnail key cifrata con la pubkey dell'owner.
    """
    await _get_file_owned(file_id, current_user, db)
    result = await db.execute(
        select(FileMetadata).where(FileMetadata.file_id == file_id)
    )
    meta = result.scalar_one_or_none()
    if meta:
        meta.thumbnail_encrypted = body.thumbnail_encrypted
        existing = {}
        if meta.custom_fields_encrypted:
            try:
                existing = json.loads(meta.custom_fields_encrypted)
            except Exception:
                pass
        existing["thumbnail_key_encrypted"] = body.thumbnail_key_encrypted
        meta.custom_fields_encrypted = json.dumps(existing)
    else:
        meta = FileMetadata(
            file_id=file_id,
            thumbnail_encrypted=body.thumbnail_encrypted,
            custom_fields_encrypted=json.dumps(
                {"thumbnail_key_encrypted": body.thumbnail_key_encrypted}
            ),
        )
        db.add(meta)
    await db.commit()
    return {"file_id": str(file_id), "thumbnail": "uploaded"}


@router.get("/{file_id}/thumbnail")
async def get_thumbnail(
    file_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Restituisce thumbnail cifrata e chiave cifrata per l'utente corrente."""
    result = await db.execute(
        select(FileMetadata).where(FileMetadata.file_id == file_id)
    )
    meta = result.scalar_one_or_none()
    if not meta or not meta.thumbnail_encrypted:
        raise HTTPException(
            status_code=404, detail="Thumbnail non disponibile"
        )
    custom = {}
    if meta.custom_fields_encrypted:
        try:
            custom = json.loads(meta.custom_fields_encrypted)
        except Exception:
            pass
    return {
        "file_id": str(file_id),
        "thumbnail_encrypted": meta.thumbnail_encrypted,
        "thumbnail_key_encrypted": custom.get("thumbnail_key_encrypted"),
    }
