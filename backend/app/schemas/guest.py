"""Schema per invito guest e risposta JWT."""

from datetime import datetime
from typing import List, Optional
import uuid

from pydantic import BaseModel, Field


class GuestInviteCreate(BaseModel):
    guest_email: str = Field(..., min_length=1, max_length=255)
    file_ids: List[uuid.UUID] = Field(min_length=1, max_length=20)
    file_keys_encrypted: Optional[List[str]] = None
    expires_in_hours: int = Field(default=48, ge=1, le=168)
    label: Optional[str] = Field(default=None, max_length=128)
    can_download: bool = True
    can_preview: bool = True


class GuestTokenResponse(BaseModel):
    access_token: str
    expires_at: datetime
    guest_email: str
    accessible_files: List[str]


class GuestSessionResponse(BaseModel):
    id: uuid.UUID
    guest_email: str
    expires_at: datetime
    is_active: bool
    label: Optional[str] = None
    invite_used: bool
    created_at: datetime
    accessible_files: List[str]
    invite_token: Optional[str] = None  # per costruire il link di invito

    model_config = {"from_attributes": True}
