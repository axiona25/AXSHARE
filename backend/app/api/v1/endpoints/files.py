"""
Upload/download file cifrati E2E — DEK e storage MinIO.
Il server gestisce solo blob cifrati; metadati (nome, MIME) sono già cifrati lato client.
"""

import io
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.file import File as FileModel, FileVersion
from app.models.permission import Permission, PermissionLevel
from app.models.user import User
from app.core.audit_actions import AuditAction
from app.core.metrics import file_uploads_total
from app.services.audit_service import AuditService
from app.services.destruct_service import DestructService
from app.services.group_share_service import GroupShareService
from app.services.storage import get_storage_service

router = APIRouter(prefix="/files", tags=["files"])


class ShareWithGroupRequest(BaseModel):
    """Body per condividere un file con un gruppo."""

    group_id: uuid.UUID
    file_key_encrypted_for_group: str
    level: PermissionLevel = PermissionLevel.READ
    expires_at: Optional[datetime] = None


class SelfDestructRequest(BaseModel):
    """Body per impostare auto-distruzione su un file."""

    after_downloads: Optional[int] = None
    destruct_at: Optional[datetime] = None


class FileUploadMetadata(BaseModel):
    """Metadati upload: nome/MIME/chiave già cifrati lato client."""

    name_encrypted: str  # Nome file GIA CIFRATO lato client
    mime_type_encrypted: str  # MIME type cifrato
    file_key_encrypted: str  # DEK AES cifrata con pubkey utente (base64)
    encryption_iv: str  # Nonce AES-GCM (hex)
    content_hash: str  # SHA-256 del file originale (per verifica client-side)
    folder_id: Optional[str] = None  # UUID cartella padre (opzionale)
    size_original: Optional[int] = None  # Dimensione originale (opzionale)
    mime_category: Optional[str] = None  # Categoria non cifrata: image|pdf|video|audio|document|archive


@router.post(
    "/upload",
    summary="Upload file cifrato",
    description="""
Upload di un file cifrato lato client.

Il file deve essere cifrato con AES-256-GCM prima dell'invio.
I metadati (nome, tipo MIME) devono essere cifrati separatamente.

**Nota zero-knowledge**: il server non accede mai al contenuto
del file né alle chiavi di cifratura.
    """,
)
async def upload_file(
    request: Request,
    metadata: str = Form(..., description="JSON di FileUploadMetadata"),
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Upload file pre-cifrato. Il server riceve solo bytes cifrati e metadati opachi.
    """
    try:
        meta = FileUploadMetadata.model_validate_json(metadata)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Metadati non validi: {e}")

    file_id = uuid.uuid4()
    encrypted_data = await file.read()

    storage = get_storage_service()
    object_name = await storage.upload_encrypted_file(
        current_user.id,
        file_id,
        encrypted_data,
    )

    folder_uuid = None
    if meta.folder_id:
        try:
            folder_uuid = uuid.UUID(meta.folder_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="folder_id non valido")

    file_record = FileModel(
        id=file_id,
        name_encrypted=meta.name_encrypted,
        mime_type_encrypted=meta.mime_type_encrypted,
        size_bytes=len(encrypted_data),
        storage_path=object_name,
        file_key_encrypted=meta.file_key_encrypted,
        encryption_iv=meta.encryption_iv,
        content_hash=meta.content_hash,
        owner_id=current_user.id,
        folder_id=folder_uuid,
        mime_category=meta.mime_category,
    )
    db.add(file_record)
    await db.commit()
    await AuditService.log_event(
        db,
        action=AuditAction.FILE_UPLOAD,
        actor=current_user,
        resource_type="file",
        resource_id=str(file_record.id),
        details={"size": len(encrypted_data)},
        request=request,
    )
    file_uploads_total.labels(outcome="success").inc()
    return {"file_id": str(file_id), "storage_path": object_name}


async def _get_file_with_permission_check(
    file_id: uuid.UUID,
    current_user: User,
    db: AsyncSession,
) -> FileModel:
    """Carica il file e verifica che l'utente abbia accesso (owner o permission READ+)."""
    result = await db.execute(
        select(FileModel).where(FileModel.id == file_id)
    )
    file = result.scalar_one_or_none()
    if file is None:
        raise HTTPException(status_code=404, detail="File non trovato")
    if file.owner_id == current_user.id:
        return file
    now = datetime.now(timezone.utc)
    perm_result = await db.execute(
        select(Permission).where(
            Permission.resource_file_id == file_id,
            Permission.subject_user_id == current_user.id,
            Permission.is_active.is_(True),
            (Permission.expires_at.is_(None)) | (Permission.expires_at > now),
        )
    )
    perm = perm_result.scalar_one_or_none()
    if perm is None:
        raise HTTPException(status_code=403, detail="Accesso negato al file")
    return file


def _has_write_permission(file: FileModel, current_user: User, perm: Permission) -> bool:
    """True se il permesso consente scrittura (WRITE, SHARE, ADMIN)."""
    return perm.level in (PermissionLevel.WRITE, PermissionLevel.SHARE, PermissionLevel.ADMIN)


async def _get_file_with_write_permission(
    file_id: uuid.UUID,
    current_user: User,
    db: AsyncSession,
) -> FileModel:
    """Carica il file e verifica che l'utente abbia permesso di scrittura (owner o permission WRITE+)."""
    result = await db.execute(
        select(FileModel).where(FileModel.id == file_id)
    )
    file = result.scalar_one_or_none()
    if file is None:
        raise HTTPException(status_code=404, detail="File non trovato")
    if file.owner_id == current_user.id:
        return file
    now = datetime.now(timezone.utc)
    perm_result = await db.execute(
        select(Permission).where(
            Permission.resource_file_id == file_id,
            Permission.subject_user_id == current_user.id,
            Permission.is_active.is_(True),
            (Permission.expires_at.is_(None)) | (Permission.expires_at > now),
        )
    )
    perm = perm_result.scalar_one_or_none()
    if perm is None or not _has_write_permission(file, current_user, perm):
        raise HTTPException(status_code=403, detail="Permesso di scrittura negato")
    return file


@router.get("/{file_id}")
async def get_file_metadata(
    file_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Metadati del file (nome cifrato, size, versione, created_at)."""
    file = await _get_file_with_permission_check(file_id, current_user, db)
    return {
        "id": str(file.id),
        "name_encrypted": file.name_encrypted,
        "size_encrypted": file.size_bytes,
        "current_version": file.version,
        "created_at": file.created_at.isoformat(),
    }


@router.get("/{file_id}/download")
async def download_file(
    request: Request,
    file_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Stream del file cifrato da MinIO; header X-File-IV con nonce; incrementa download_count."""
    file = await _get_file_with_permission_check(file_id, current_user, db)
    if file.is_destroyed:
        raise HTTPException(status_code=410, detail="File eliminato")
    storage = get_storage_service()
    encrypted_data = await storage.download_encrypted_file(file.storage_path)
    file.download_count += 1
    await db.commit()
    await DestructService.check_and_destroy_on_download(db, file_id)
    await AuditService.log_event(
        db,
        action=AuditAction.FILE_DOWNLOAD,
        actor=current_user,
        resource_type="file",
        resource_id=str(file_id),
        request=request,
    )
    return StreamingResponse(
        io.BytesIO(encrypted_data),
        media_type="application/octet-stream",
        headers={"X-File-IV": file.encryption_iv},
    )


@router.get("/{file_id}/key")
async def get_file_dek(
    file_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Ritorna la DEK cifrata per l'utente (owner: file_key_encrypted; condiviso: resource_key_encrypted)."""
    file = await _get_file_with_permission_check(file_id, current_user, db)
    file_key_encrypted = file.file_key_encrypted
    if file.owner_id != current_user.id:
        now = datetime.now(timezone.utc)
        perm_result = await db.execute(
            select(Permission).where(
                Permission.resource_file_id == file_id,
                Permission.subject_user_id == current_user.id,
                Permission.is_active.is_(True),
                (Permission.expires_at.is_(None)) | (Permission.expires_at > now),
            )
        )
        perm = perm_result.scalar_one_or_none()
        if perm and perm.resource_key_encrypted:
            file_key_encrypted = perm.resource_key_encrypted
    return {
        "file_key_encrypted": file_key_encrypted,
        "encryption_iv": file.encryption_iv,
    }


@router.post("/{file_id}/version")
async def upload_new_version(
    file_id: uuid.UUID,
    metadata: str = Form(..., description="JSON di FileUploadMetadata"),
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Carica una nuova versione del file; la precedente viene salvata in FileVersion."""
    try:
        meta = FileUploadMetadata.model_validate_json(metadata)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Metadati non validi: {e}")

    existing = await _get_file_with_write_permission(file_id, current_user, db)
    if existing.is_destroyed:
        raise HTTPException(status_code=410, detail="File eliminato")

    encrypted_data = await file.read()

    # Salva vecchia versione come FileVersion
    old_version = FileVersion(
        file_id=file_id,
        version_number=existing.version,
        storage_path=existing.storage_path,
        file_key_encrypted=existing.file_key_encrypted,
        encryption_iv=existing.encryption_iv,
        size_bytes=existing.size_bytes,
        created_by=current_user.id,
    )
    db.add(old_version)
    await db.flush()

    # Upload nuova versione con path distinto (evita overwrite e rispetta unique su storage_path)
    storage = get_storage_service()
    new_version_num = existing.version + 1
    new_object_name = await storage.upload_encrypted_file(
        current_user.id,
        file_id,
        encrypted_data,
        path_suffix=f"v{new_version_num}",
    )

    existing.storage_path = new_object_name
    existing.file_key_encrypted = meta.file_key_encrypted
    existing.encryption_iv = meta.encryption_iv
    existing.size_bytes = len(encrypted_data)
    existing.version = new_version_num
    if meta.content_hash:
        existing.content_hash = meta.content_hash

    await db.commit()
    return {"version": existing.version}


@router.get("/{file_id}/versions")
async def list_versions(
    file_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Elenco delle versioni precedenti (snapshot in FileVersion)."""
    await _get_file_with_permission_check(file_id, current_user, db)
    result = await db.execute(
        select(FileVersion)
        .where(FileVersion.file_id == file_id)
        .order_by(FileVersion.version_number)
    )
    versions = result.scalars().all()
    return [
        {"version": v.version_number, "created_at": v.created_at.isoformat()}
        for v in versions
    ]


@router.post("/{file_id}/versions/{version_number}/restore")
async def restore_version(
    file_id: uuid.UUID,
    version_number: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Ripristina una versione storica: lo stato attuale viene archiviato in FileVersion, il file punta alla versione richiesta."""
    existing = await _get_file_with_write_permission(file_id, current_user, db)
    if existing.is_destroyed:
        raise HTTPException(status_code=410, detail="File eliminato")

    result = await db.execute(
        select(FileVersion).where(
            FileVersion.file_id == file_id,
            FileVersion.version_number == version_number,
        )
    )
    to_restore = result.scalar_one_or_none()
    if to_restore is None:
        raise HTTPException(status_code=404, detail="Versione non trovata")

    # Archivia lo stato attuale come nuova riga in FileVersion
    old_current = FileVersion(
        file_id=file_id,
        version_number=existing.version,
        storage_path=existing.storage_path,
        file_key_encrypted=existing.file_key_encrypted,
        encryption_iv=existing.encryption_iv,
        size_bytes=existing.size_bytes,
        created_by=current_user.id,
    )
    db.add(old_current)
    await db.flush()

    # Ripristina i dati della versione richiesta nel record file corrente
    existing.storage_path = to_restore.storage_path
    existing.file_key_encrypted = to_restore.file_key_encrypted
    existing.encryption_iv = to_restore.encryption_iv
    existing.size_bytes = to_restore.size_bytes

    await db.commit()
    return {"restored_version": version_number}


@router.post("/{file_id}/share-group")
async def share_file_with_group(
    file_id: uuid.UUID,
    request: ShareWithGroupRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Condivide un file con tutti i membri di un gruppo."""
    permissions = await GroupShareService.share_file_with_group(
        db=db,
        owner=current_user,
        file_id=file_id,
        group_id=request.group_id,
        file_key_encrypted_for_group=request.file_key_encrypted_for_group,
        level=request.level,
        expires_at=request.expires_at,
    )
    return {"shared_with": len(permissions), "group_id": str(request.group_id)}


@router.post("/{file_id}/self-destruct")
async def set_self_destruct(
    file_id: uuid.UUID,
    request: SelfDestructRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Imposta auto-distruzione sul file."""
    return await DestructService.set_self_destruct(
        db=db,
        owner_id=current_user.id,
        file_id=file_id,
        after_downloads=request.after_downloads,
        destruct_at=request.destruct_at,
    )


@router.delete("/{file_id}/destroy")
async def manual_destroy(
    request: Request,
    file_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Distrugge manualmente un file (solo owner)."""
    file = await db.get(FileModel, file_id)
    if not file or file.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Non autorizzato")
    destroyed = await DestructService.destroy_file(
        db, file_id, reason="manual"
    )
    if destroyed:
        await AuditService.log_event(
            db,
            action=AuditAction.FILE_SELF_DESTRUCT,
            actor=current_user,
            resource_type="file",
            resource_id=str(file_id),
            details={"reason": "manual"},
            request=request,
        )
    return {"destroyed": destroyed, "file_id": str(file_id)}


@router.delete("/{file_id}/share-group/{group_id}")
async def revoke_group_access(
    file_id: uuid.UUID,
    group_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Revoca accesso gruppo a un file."""
    revoked = await GroupShareService.revoke_group_access(
        db, current_user, file_id, group_id
    )
    return {"revoked": revoked}
