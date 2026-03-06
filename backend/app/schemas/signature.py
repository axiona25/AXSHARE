"""Schema Pydantic per firma digitale file (RSA-PSS)."""

from datetime import datetime
from typing import List, Optional
import uuid

from pydantic import BaseModel


class SignatureUpload(BaseModel):
    """Payload upload firma da client."""

    version: int = 1
    signature_b64: str
    file_hash_sha256: str  # hex SHA-256 del file cifrato
    public_key_pem_snapshot: str
    algorithm: str = "RSA-PSS-SHA256"


class SignatureResponse(BaseModel):
    """Risposta lettura firma."""

    id: uuid.UUID
    file_id: uuid.UUID
    version: int
    signer_id: Optional[uuid.UUID]
    signature_b64: str
    file_hash_sha256: str
    public_key_pem_snapshot: str
    algorithm: str
    is_valid: Optional[bool]
    verified_at: Optional[datetime]
    created_at: datetime

    model_config = {"from_attributes": True}


class VerifyResponse(BaseModel):
    """Risposta verifica firma."""

    file_id: uuid.UUID
    version: int
    is_valid: bool
    signer_email: Optional[str]
    verified_at: datetime
    message: str
