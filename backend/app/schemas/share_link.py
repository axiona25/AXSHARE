"""Schema per share link (link di condivisione con token sicuro)."""

from datetime import datetime
from typing import Optional
import uuid

from pydantic import BaseModel, Field


class ShareLinkCreate(BaseModel):
    file_key_encrypted_for_link: Optional[str] = None
    password: Optional[str] = None
    require_recipient_pin: Optional[bool] = None
    expires_at: Optional[datetime] = None
    max_downloads: Optional[int] = Field(default=None, ge=1)
    label: Optional[str] = Field(default=None, max_length=128)


class ShareLinkResponse(BaseModel):
    id: uuid.UUID
    file_id: uuid.UUID
    token: str
    is_password_protected: bool
    require_recipient_pin: bool = False
    expires_at: Optional[datetime] = None
    max_downloads: Optional[int] = None
    download_count: int
    is_active: bool
    label: Optional[str] = None
    created_at: datetime
    share_url: str

    model_config = {"from_attributes": True}


class ShareLinkAccessRequest(BaseModel):
    password: Optional[str] = None
