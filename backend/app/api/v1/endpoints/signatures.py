"""Endpoint firma digitale file (RSA-PSS) — TASK 9.1."""

import uuid
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit_actions import AuditAction
from app.database import get_db
from app.dependencies import get_current_user
from app.models.file import File
from app.models.signature import FileSignature
from app.models.user import User
from app.schemas.signature import (
    SignatureResponse,
    SignatureUpload,
    VerifyResponse,
)
from app.services.audit_service import AuditService
from app.services.notification_service import NotificationService
from app.services.signature_service import SignatureService

router = APIRouter(prefix="/files", tags=["signatures"])


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


async def _get_file_exists(
    file_id: uuid.UUID, db: AsyncSession
) -> File:
    result = await db.execute(
        select(File).where(
            File.id == file_id,
            File.is_destroyed.is_(False),
        )
    )
    file = result.scalar_one_or_none()
    if not file:
        raise HTTPException(status_code=404, detail="File non trovato")
    return file


@router.post(
    "/{file_id}/sign",
    response_model=SignatureResponse,
    status_code=status.HTTP_201_CREATED,
)
async def sign_file(
    file_id: uuid.UUID,
    body: SignatureUpload,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Upload firma RSA-PSS per un file. Solo owner."""
    file = await _get_file_owned(file_id, current_user, db)

    existing = await db.execute(
        select(FileSignature).where(
            FileSignature.file_id == file_id,
            FileSignature.version == body.version,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=409,
            detail=f"Firma per versione {body.version} già presente",
        )

    sig = FileSignature(
        file_id=file_id,
        version=body.version,
        signer_id=current_user.id,
        signature_b64=body.signature_b64,
        file_hash_sha256=body.file_hash_sha256,
        public_key_pem_snapshot=body.public_key_pem_snapshot,
        algorithm=body.algorithm,
    )
    db.add(sig)
    file.is_signed = True
    await db.commit()
    await db.refresh(sig)
    await AuditService.log_event(
        db,
        action=AuditAction.FILE_SIGN,
        actor=current_user,
        resource_type="file",
        resource_id=str(file_id),
        details={"version": body.version},
        request=request,
    )
    return sig


@router.get(
    "/{file_id}/signatures",
    response_model=List[SignatureResponse],
)
async def list_signatures(
    file_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Lista tutte le firme di un file."""
    await _get_file_exists(file_id, db)
    result = await db.execute(
        select(FileSignature)
        .where(FileSignature.file_id == file_id)
        .order_by(FileSignature.version)
    )
    return list(result.scalars().all())


@router.post(
    "/{file_id}/verify/{version}",
    response_model=VerifyResponse,
)
async def verify_signature(
    file_id: uuid.UUID,
    version: int,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Verifica server-side la firma RSA-PSS di una versione file."""
    file = await _get_file_exists(file_id, db)
    result = await db.execute(
        select(FileSignature).where(
            FileSignature.file_id == file_id,
            FileSignature.version == version,
        )
    )
    sig = result.scalar_one_or_none()
    if not sig:
        raise HTTPException(status_code=404, detail="Firma non trovata")

    is_valid = SignatureService.verify_rsa_pss(
        signature_b64=sig.signature_b64,
        file_hash_sha256=sig.file_hash_sha256,
        file_id=str(file_id),
        version=version,
        public_key_pem=sig.public_key_pem_snapshot,
    )

    sig.is_valid = is_valid
    sig.verified_at = datetime.now(timezone.utc)
    await db.commit()

    await AuditService.log_event(
        db,
        action=AuditAction.FILE_VERIFY,
        actor=current_user,
        resource_type="file",
        resource_id=str(file_id),
        details={"version": version, "is_valid": is_valid},
        request=request,
    )

    if not is_valid:
        await NotificationService.notify_signature_invalid(
            db, file.owner_id, str(file_id), version
        )

    signer_email = None
    if sig.signer_id:
        user_result = await db.execute(
            select(User).where(User.id == sig.signer_id)
        )
        signer = user_result.scalar_one_or_none()
        if signer:
            signer_email = signer.email

    return VerifyResponse(
        file_id=file_id,
        version=version,
        is_valid=is_valid,
        signer_email=signer_email,
        verified_at=sig.verified_at,
        message="Firma valida" if is_valid else "Firma NON valida o file modificato",
    )
