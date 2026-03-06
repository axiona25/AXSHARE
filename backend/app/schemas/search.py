"""Schema Pydantic per ricerca file (TASK 8.2)."""

import uuid
from datetime import datetime
from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, Field


class SortField(str, Enum):
    created_at = "created_at"
    updated_at = "updated_at"
    size_bytes = "size_bytes"
    download_count = "download_count"
    name = "name"  # server usa created_at come proxy


class SortOrder(str, Enum):
    asc = "asc"
    desc = "desc"


class FileSearchParams(BaseModel):
    tags: Optional[List[str]] = None
    tags_any: Optional[List[str]] = None
    mime_category: Optional[str] = None
    is_starred: Optional[bool] = None
    is_pinned: Optional[bool] = None
    color_label: Optional[str] = None
    owner_id: Optional[uuid.UUID] = None
    folder_id: Optional[uuid.UUID] = None
    min_size: Optional[int] = None
    max_size: Optional[int] = None
    created_after: Optional[datetime] = None
    created_before: Optional[datetime] = None
    has_self_destruct: Optional[bool] = None
    shared_with_me: Optional[bool] = None
    is_signed: Optional[bool] = None

    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=20, ge=1, le=100)
    sort_by: SortField = SortField.created_at
    sort_order: SortOrder = SortOrder.desc


class FileSearchResponse(BaseModel):
    items: List[dict]
    total: int
    page: int
    page_size: int
    pages: int
