"""Schema Pydantic per metadati cifrati e tag (TASK 8.1)."""

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class FileMetadataCreate(BaseModel):
    description_encrypted: Optional[str] = None
    notes_encrypted: Optional[str] = None
    custom_fields_encrypted: Optional[str] = None
    thumbnail_encrypted: Optional[str] = None


class FileMetadataUpdate(BaseModel):
    description_encrypted: Optional[str] = None
    notes_encrypted: Optional[str] = None
    custom_fields_encrypted: Optional[str] = None
    thumbnail_encrypted: Optional[str] = None


class FileMetadataResponse(BaseModel):
    id: uuid.UUID
    file_id: uuid.UUID
    description_encrypted: Optional[str] = None
    notes_encrypted: Optional[str] = None
    custom_fields_encrypted: Optional[str] = None
    thumbnail_encrypted: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class TagCreate(BaseModel):
    tag: str = Field(..., max_length=64)


class TagResponse(BaseModel):
    id: uuid.UUID
    file_id: uuid.UUID
    tag: str
    created_by: uuid.UUID
    created_at: datetime

    model_config = {"from_attributes": True}


class FileLabelsUpdate(BaseModel):
    is_starred: Optional[bool] = None
    is_pinned: Optional[bool] = None
    color_label: Optional[str] = None  # "red"|"blue"|"green"|"yellow"|None
