"""ACL: grant, revoke, list permissions su file e cartelle."""

from uuid import UUID
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.file import File
from app.models.permission import Permission, PermissionLevel
from app.models.user import User
from app.services.audit_service import AuditService
from app.services.permission_service import PermissionService

router = APIRouter(prefix="/permissions", tags=["permissions"])


class GrantPermissionRequest(BaseModel):
    subject_user_id: UUID
    resource_file_id: Optional[UUID] = None
    resource_folder_id: Optional[UUID] = None
    level: PermissionLevel
    resource_key_encrypted: Optional[str] = None
    expires_at: Optional[datetime] = None


class PermissionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    subject_user_id: Optional[UUID]
    resource_file_id: Optional[UUID]
    resource_folder_id: Optional[UUID]
    level: PermissionLevel
    expires_at: Optional[datetime]
    is_active: bool
    granted_by_id: UUID


@router.post("/", response_model=PermissionResponse, status_code=201)
async def grant_permission(
    request: GrantPermissionRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Concede un permesso su file o cartella."""
    if not request.resource_file_id and not request.resource_folder_id:
        raise HTTPException(
            status_code=400,
            detail="Specificare resource_file_id o resource_folder_id",
        )
    perm = await PermissionService.grant_permission(
        db=db,
        grantor=current_user,
        subject_user_id=request.subject_user_id,
        resource_file_id=request.resource_file_id,
        resource_folder_id=request.resource_folder_id,
        level=request.level,
        resource_key_encrypted=request.resource_key_encrypted,
        expires_at=request.expires_at,
    )
    await AuditService.log(
        db,
        action="permission_granted",
        resource_type="permission",
        resource_id=perm.id,
        user_id=current_user.id,
        details={
            "level": request.level.value,
            "subject": str(request.subject_user_id),
        },
    )
    return perm


@router.delete("/{permission_id}", status_code=204)
async def revoke_permission(
    permission_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Revoca un permesso."""
    await PermissionService.revoke_permission(db, current_user, permission_id)


@router.get("/file/{file_id}", response_model=list[PermissionResponse])
async def list_file_permissions(
    file_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Lista permessi su un file."""
    return await PermissionService.list_permissions(
        db, current_user, resource_file_id=file_id
    )


@router.get("/folder/{folder_id}", response_model=list[PermissionResponse])
async def list_folder_permissions(
    folder_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Lista permessi su una cartella."""
    return await PermissionService.list_permissions(
        db, current_user, resource_folder_id=folder_id
    )


@router.get("/expiring-soon", response_model=list[PermissionResponse])
async def list_expiring_permissions(
    hours: int = 24,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Lista permessi concessi da current_user che scadono nelle prossime N ore.
    Utile per mostrare alert nell'UI prima che i permessi scadano.
    """
    now = datetime.now(timezone.utc)
    soon = now + timedelta(hours=hours)

    result = await db.execute(
        select(Permission).where(
            and_(
                Permission.granted_by_id == current_user.id,
                Permission.is_active.is_(True),
                Permission.expires_at.isnot(None),
                Permission.expires_at > now,
                Permission.expires_at <= soon,
            )
        )
    )
    return list(result.scalars().all())


class ExtendPermissionRequest(BaseModel):
    subject_user_id: UUID
    new_expires_at: datetime


@router.post("/file/{file_id}/extend", response_model=PermissionResponse)
async def extend_permission(
    file_id: UUID,
    body: ExtendPermissionRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Estende la scadenza di un permesso esistente su un file."""
    perm = await PermissionService._get_permission(
        db, body.subject_user_id, resource_file_id=file_id
    )
    if not perm:
        raise HTTPException(status_code=404, detail="Permesso non trovato")

    file = await db.get(File, file_id)
    if not file or file.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Non autorizzato")

    perm.expires_at = body.new_expires_at
    await db.commit()
    await db.refresh(perm)
    return perm
