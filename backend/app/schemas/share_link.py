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
    block_delete: bool = False
    require_pin: bool = False
    pin: Optional[str] = None  # PIN in chiaro, verrà hashato nel backend


class ShareLinkResponse(BaseModel):
    id: uuid.UUID
    file_id: uuid.UUID
    token: str
    is_password_protected: bool
    require_recipient_pin: bool = False
    expires_at: Optional[datetime] = None
    block_delete: bool = False
    require_pin: bool = False
    max_downloads: Optional[int] = None
    download_count: int
    is_active: bool
    label: Optional[str] = None
    created_at: datetime
    share_url: str
    is_expired: bool = False  # calcolato: expires_at < now

    model_config = {"from_attributes": True}


class ShareLinkAccessRequest(BaseModel):
    password: Optional[str] = None
    pin: Optional[str] = None  # per link con require_pin
