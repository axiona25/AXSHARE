"""Endpoint ricerca file (TASK 8.2)."""

import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.file import File
from app.models.metadata import FileTag
from app.models.user import User, UserRole
from app.schemas.search import (
    FileSearchParams,
    FileSearchResponse,
    SortField,
    SortOrder,
)
from app.services.search_service import SearchService

router = APIRouter(prefix="/search", tags=["search"])


@router.get("/files")
async def search_files(
    tags: Optional[str] = Query(None, description="Tag separati da virgola (AND)"),
    tags_any: Optional[str] = Query(
        None, description="Tag separati da virgola (OR)"
    ),
    mime_category: Optional[str] = Query(None),
    is_starred: Optional[bool] = Query(None),
    is_pinned: Optional[bool] = Query(None),
    color_label: Optional[str] = Query(None),
    owner_id: Optional[uuid.UUID] = Query(None),
    folder_id: Optional[uuid.UUID] = Query(None),
    min_size: Optional[int] = Query(None),
    max_size: Optional[int] = Query(None),
    created_after: Optional[datetime] = Query(None),
    created_before: Optional[datetime] = Query(None),
    has_self_destruct: Optional[bool] = Query(None),
    shared_with_me: Optional[bool] = Query(None),
    is_signed: Optional[bool] = Query(None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    sort_by: SortField = Query(default=SortField.created_at),
    sort_order: SortOrder = Query(default=SortOrder.desc),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    params = FileSearchParams(
        tags=[t.strip() for t in tags.split(",")] if tags else None,
        tags_any=(
            [t.strip() for t in tags_any.split(",")] if tags_any else None
        ),
        mime_category=mime_category,
        is_starred=is_starred,
        is_pinned=is_pinned,
        color_label=color_label,
        owner_id=owner_id
        if current_user.role == UserRole.ADMIN
        else None,
        folder_id=folder_id,
        min_size=min_size,
        max_size=max_size,
        created_after=created_after,
        created_before=created_before,
        has_self_destruct=has_self_destruct,
        shared_with_me=shared_with_me,
        is_signed=is_signed,
        page=page,
        page_size=page_size,
        sort_by=sort_by,
        sort_order=sort_order,
    )
    is_admin = current_user.role == UserRole.ADMIN
    return await SearchService.search_files(
        db, current_user.id, params, is_admin
    )


@router.get("/tags/suggest")
async def suggest_tags(
    q: str = Query(..., min_length=1, max_length=32),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(FileTag.tag, func.count(FileTag.id).label("count"))
        .join(File, File.id == FileTag.file_id)
        .where(
            File.owner_id == current_user.id,
            File.is_destroyed.is_(False),
            FileTag.tag.ilike(f"{q}%"),
        )
        .group_by(FileTag.tag)
        .order_by(func.count(FileTag.id).desc())
        .limit(10)
    )
    return [{"tag": row.tag, "count": row.count} for row in result]
