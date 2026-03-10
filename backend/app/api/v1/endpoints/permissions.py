"""ACL: grant, revoke, list permissions su file e cartelle."""

from uuid import UUID
from datetime import datetime, timezone, timedelta
from typing import Dict, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select, and_, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.file import File, Folder
from app.models.permission import Permission, PermissionLevel
from app.models.user import User
from app.services.audit_service import AuditService
from app.services.permission_service import PermissionService
from app.services.notification_service import NotificationService
from app.core.notification_types import NotificationType, NotificationSeverity
from app.core.redis_pubsub import publish_notification

router = APIRouter(prefix="/permissions", tags=["permissions"])


class GrantPermissionRequest(BaseModel):
    subject_user_id: UUID
    resource_file_id: Optional[UUID] = None
    resource_folder_id: Optional[UUID] = None
    level: PermissionLevel
    resource_key_encrypted: Optional[str] = None
    expires_at: Optional[datetime] = None
    block_delete: bool = False
    block_link: bool = False
    require_pin: bool = False
    # Solo per grant su cartella: chiavi file (id -> cifrata per destinatario) per permessi ereditati
    file_keys_encrypted: Optional[Dict[str, str]] = None


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
    block_delete: bool = False
    block_link: bool = False
    require_pin: bool = False
    inherited_from_folder_id: Optional[UUID] = None


class PermissionListResponse(PermissionResponse):
    """Come PermissionResponse con email e display name del destinatario per avatar/UI."""

    subject_user_email: Optional[str] = None
    subject_user_display_name: Optional[str] = None


class UpdatePermissionRequest(BaseModel):
    """Patch parziale per modifica permesso."""

    level: Optional[str] = None  # "read" | "write"
    block_delete: Optional[bool] = None
    block_link: Optional[bool] = None
    require_pin: Optional[bool] = None
    expires_at: Optional[datetime] = None


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
    file_keys_uuid: Optional[Dict[UUID, str]] = None
    if request.file_keys_encrypted:
        try:
            file_keys_uuid = {UUID(k): v for k, v in request.file_keys_encrypted.items()}
        except (ValueError, TypeError):
            raise HTTPException(
                status_code=400,
                detail="file_keys_encrypted: chiavi devono essere UUID validi",
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
        block_delete=request.block_delete,
        block_link=request.block_link,
        require_pin=request.require_pin,
        file_keys_encrypted=file_keys_uuid,
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

    # Notifica al destinatario (con data/ora e publish Redis per toast in tempo reale)
    sender_label = current_user.email
    now = datetime.now(timezone.utc)
    date_time_str = now.strftime("%d/%m/%Y alle %H:%M")
    if request.resource_file_id:
        notif = await NotificationService.create(
            db=db,
            user_id=request.subject_user_id,
            type=NotificationType.FILE_SHARED_WITH_ME,
            title="File condiviso con te",
            body=f"{sender_label} ha condiviso un file con te il {date_time_str}.",
            resource_type="file",
            resource_id=str(request.resource_file_id),
            action_url=f"/condivisi?highlight={request.resource_file_id}",
            severity=NotificationSeverity.INFO,
        )
        try:
            await publish_notification(
                str(request.subject_user_id),
                {
                    "id": str(notif.id),
                    "type": notif.type,
                    "title": notif.title,
                    "body": notif.body,
                    "resource_type": notif.resource_type,
                    "resource_id": notif.resource_id,
                    "action_url": notif.action_url,
                    "created_at": notif.created_at.isoformat() if notif.created_at else None,
                },
            )
        except Exception:
            pass  # Redis non disponibile: la notifica resta in DB, il client la vedrà al refresh
    if request.resource_folder_id:
        notif = await NotificationService.create(
            db=db,
            user_id=request.subject_user_id,
            type=NotificationType.FOLDER_SHARED_WITH_ME,
            title="Cartella condivisa con te",
            body=f"{sender_label} ha condiviso una cartella con te il {date_time_str}.",
            resource_type="folder",
            resource_id=str(request.resource_folder_id),
            action_url=f"/condivisi?highlight={request.resource_folder_id}",
            severity=NotificationSeverity.INFO,
        )
        try:
            await publish_notification(
                str(request.subject_user_id),
                {
                    "id": str(notif.id),
                    "type": notif.type,
                    "title": notif.title,
                    "body": notif.body,
                    "resource_type": notif.resource_type,
                    "resource_id": notif.resource_id,
                    "action_url": notif.action_url,
                    "created_at": notif.created_at.isoformat() if notif.created_at else None,
                },
            )
        except Exception:
            pass

    return perm


@router.delete("/{permission_id}")
async def revoke_permission(
    permission_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Revoca un permesso: disattiva il permesso, cascade su ereditati, notifica il destinatario."""
    perm = await db.get(Permission, permission_id)
    if not perm:
        raise HTTPException(status_code=404, detail="Permesso non trovato")
    revoked_user_id = perm.subject_user_id
    resource_file_id = perm.resource_file_id
    resource_folder_id = perm.resource_folder_id
    revoker_email = current_user.email or ""

    await PermissionService.revoke_permission(db, current_user, permission_id)

    if revoked_user_id:
        try:
            notif = await NotificationService.create(
                db=db,
                user_id=revoked_user_id,
                type=NotificationType.PERMISSION_REVOKED,
                title="Accesso revocato",
                body=f"{revoker_email} ha revocato il tuo accesso a un file/cartella.",
                resource_type="file" if resource_file_id else "folder",
                resource_id=str(resource_file_id or resource_folder_id or ""),
                severity=NotificationSeverity.WARNING,
            )
            await publish_notification(
                str(revoked_user_id),
                {
                    "id": str(notif.id),
                    "type": notif.type,
                    "title": notif.title,
                    "body": notif.body or "",
                    "resource_type": notif.resource_type or "",
                    "resource_id": notif.resource_id or "",
                    "action_url": getattr(notif, "action_url", None),
                    "created_at": notif.created_at.isoformat() if notif.created_at else None,
                },
            )
        except Exception:
            pass

    return {"revoked": True}


@router.patch("/{permission_id}", response_model=PermissionResponse)
async def update_permission(
    permission_id: UUID,
    body: UpdatePermissionRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Modifica un permesso (patch parziale). Solo owner. Propaga agli ereditati se inherited. Notifica il destinatario."""
    level_enum: Optional[PermissionLevel] = None
    if body.level is not None:
        level_map = {"read": PermissionLevel.READ, "write": PermissionLevel.WRITE}
        if body.level not in level_map:
            raise HTTPException(status_code=400, detail="level deve essere 'read' o 'write'")
        level_enum = level_map[body.level]

    perm = await PermissionService.update_permission(
        db=db,
        permission_id=permission_id,
        updater=current_user,
        level=level_enum,
        block_delete=body.block_delete,
        block_link=body.block_link,
        require_pin=body.require_pin,
        expires_at=body.expires_at,
    )

    if perm.subject_user_id:
        try:
            notif = await NotificationService.create(
                db=db,
                user_id=perm.subject_user_id,
                type=NotificationType.PERMISSION_UPDATED,
                title="Accesso modificato",
                body=f"{current_user.email or ''} ha modificato il tuo accesso a un file/cartella.",
                resource_type="file" if perm.resource_file_id else "folder",
                resource_id=str(perm.resource_file_id or perm.resource_folder_id or ""),
                severity=NotificationSeverity.INFO,
            )
            await publish_notification(
                str(perm.subject_user_id),
                {
                    "id": str(notif.id),
                    "type": notif.type,
                    "title": notif.title,
                    "body": notif.body or "",
                    "resource_type": notif.resource_type or "",
                    "resource_id": notif.resource_id or "",
                    "action_url": getattr(notif, "action_url", None),
                    "created_at": notif.created_at.isoformat() if notif.created_at else None,
                },
            )
        except Exception:
            pass

    return perm


def _permission_to_list_response(perm: Permission) -> dict:
    """Costruisce PermissionListResponse da Permission con subject_user caricato."""
    return {
        "id": perm.id,
        "subject_user_id": perm.subject_user_id,
        "resource_file_id": perm.resource_file_id,
        "resource_folder_id": perm.resource_folder_id,
        "level": perm.level,
        "expires_at": perm.expires_at,
        "is_active": perm.is_active,
        "granted_by_id": perm.granted_by_id,
        "block_delete": getattr(perm, "block_delete", False),
        "block_link": getattr(perm, "block_link", False),
        "require_pin": getattr(perm, "require_pin", False),
        "inherited_from_folder_id": getattr(perm, "inherited_from_folder_id", None),
        "subject_user_email": perm.subject_user.email if perm.subject_user else None,
        "subject_user_display_name": perm.subject_user.display_name_encrypted if perm.subject_user else None,
    }


@router.get("/file/{file_id}", response_model=list[PermissionListResponse])
async def list_file_permissions(
    file_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Lista permessi su un file (con email destinatario per UI)."""
    perms = await PermissionService.list_permissions(
        db, current_user, resource_file_id=file_id
    )
    return [_permission_to_list_response(p) for p in perms]


@router.get("/folder/{folder_id}", response_model=list[PermissionListResponse])
async def list_folder_permissions(
    folder_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Lista permessi su una cartella (con email destinatario per UI)."""
    perms = await PermissionService.list_permissions(
        db, current_user, resource_folder_id=folder_id
    )
    return [_permission_to_list_response(p) for p in perms]


@router.get("/my-shared-resources")
async def list_my_shared_resources(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Risorse (file e cartelle) di cui current_user è owner e ha almeno un permesso attivo concesso."""
    # File condivisi da me (owner = current_user, con almeno un permesso attivo)
    file_subq = (
        select(File.id, File.name_encrypted, func.count(Permission.id).label("permission_count"))
        .join(Permission, and_(Permission.resource_file_id == File.id, Permission.is_active.is_(True)))
        .where(File.owner_id == current_user.id, File.is_destroyed.is_(False))
        .group_by(File.id, File.name_encrypted)
    )
    file_result = await db.execute(file_subq)
    file_rows = file_result.all()

    # Cartelle condivise da me
    folder_subq = (
        select(Folder.id, Folder.name_encrypted, func.count(Permission.id).label("permission_count"))
        .join(Permission, and_(Permission.resource_folder_id == Folder.id, Permission.is_active.is_(True)))
        .where(Folder.owner_id == current_user.id, Folder.is_destroyed.is_(False))
        .group_by(Folder.id, Folder.name_encrypted)
    )
    folder_result = await db.execute(folder_subq)
    folder_rows = folder_result.all()

    items = []
    for row in file_rows:
        items.append({
            "type": "file",
            "id": str(row.id),
            "name_encrypted": row.name_encrypted,
            "permission_count": row.permission_count,
        })
    for row in folder_rows:
        items.append({
            "type": "folder",
            "id": str(row.id),
            "name_encrypted": row.name_encrypted,
            "permission_count": row.permission_count,
        })
    return {"items": items}


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
