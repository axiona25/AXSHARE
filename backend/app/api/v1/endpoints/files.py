"""
Upload/download file cifrati E2E — DEK e storage MinIO.
Il server gestisce solo blob cifrati; metadati (nome, MIME) sono già cifrati lato client.
"""

import asyncio
import io
import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.event_bus import event_bus
from app.database import get_db
from app.dependencies import get_current_user, get_current_user_sse
from app.models.file import File as FileModel, FileVersion, Folder
from app.models.permission import Permission, PermissionLevel
from app.models.share_link import ShareLink
from app.models.user import User
from app.core.audit_actions import AuditAction
from app.core.metrics import file_uploads_total
from app.services.activity_service import log_activity
from app.services.audit_service import AuditService
from app.services.notification_service import NotificationService
from app.services.destruct_service import DestructService
from app.services.group_share_service import GroupShareService
from app.services.storage import get_storage_service
from app.services.permission_service import PermissionService as PermSvc

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


class MoveFileRequest(BaseModel):
    """Body per spostare un file in un'altra cartella."""

    folder_id: Optional[str] = None  # null = root


class RenameFileRequest(BaseModel):
    """Body per rinominare un file (nome già cifrato lato client)."""

    name_encrypted: str


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
    version_comment: Optional[str] = None  # Nota opzionale per nuova versione (solo upload versione)


@router.get("/events")
async def file_events(
    current_user: User = Depends(get_current_user_sse),
):
    """Stream SSE di eventi file (creato/eliminato/modificato) per l'utente corrente."""
    sub_id, queue = event_bus.subscribe(str(current_user.id))

    async def generate():
        try:
            yield "data: " + json.dumps({"type": "connected"}) + "\n\n"
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=30.0)
                    yield "data: " + json.dumps(event) + "\n\n"
                except asyncio.TimeoutError:
                    yield "data: " + json.dumps({"type": "ping"}) + "\n\n"
        finally:
            event_bus.unsubscribe(sub_id)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


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

    encrypted_data = await file.read()
    file_size = len(encrypted_data)

    # Deduplicazione robusta: stesso owner, stesso content_hash
    existing = await db.execute(
        select(FileModel).where(
            FileModel.owner_id == current_user.id,
            FileModel.content_hash == meta.content_hash,
            FileModel.is_destroyed.is_(False),
            FileModel.is_trashed.is_(False),
        )
    )
    duplicate = existing.scalar_one_or_none()
    if duplicate:
        return {"file_id": str(duplicate.id), "storage_path": duplicate.storage_path, "deduplicated": True}

    file_id = uuid.uuid4()
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
    if folder_uuid:
        await PermSvc.apply_folder_permissions_to_file(db, file_record.id, folder_uuid)
    await event_bus.publish(
        str(current_user.id),
        {
            "type": "file_created",
            "file_id": str(file_record.id),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
    )
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
    await log_activity(db, current_user.id, "upload", "file", file_record.id, target_name=meta.name_encrypted)
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
    perm = await PermSvc.get_permission_for_file(db, current_user.id, file_id)
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
    perm = await PermSvc.get_permission_for_file(db, current_user.id, file_id)
    if perm is None or not _has_write_permission(file, current_user, perm):
        raise HTTPException(status_code=403, detail="Permesso di scrittura negato")
    return file


@router.patch("/{file_id}/name")
async def rename_file(
    file_id: uuid.UUID,
    body: RenameFileRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Aggiorna il nome del file (name_encrypted già cifrato lato client)."""
    file = await _get_file_with_write_permission(file_id, current_user, db)
    if file.is_destroyed:
        raise HTTPException(status_code=410, detail="File eliminato")
    if not body.name_encrypted or not body.name_encrypted.strip():
        raise HTTPException(status_code=400, detail="Nome obbligatorio")
    file.name_encrypted = body.name_encrypted.strip()
    await db.commit()
    await event_bus.publish(
        str(current_user.id),
        {
            "type": "file_updated",
            "file_id": str(file_id),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
    )
    return {"renamed": True, "file_id": str(file_id)}


@router.patch("/{file_id}")
async def move_file(
    file_id: uuid.UUID,
    body: MoveFileRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Sposta un file in un'altra cartella (folder_id null = root)."""
    file = await _get_file_with_write_permission(file_id, current_user, db)
    if file.is_destroyed:
        raise HTTPException(status_code=410, detail="File eliminato")
    folder_uuid = None
    if body.folder_id is not None and body.folder_id.strip() != "":
        try:
            folder_uuid = uuid.UUID(body.folder_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="folder_id non valido")
        folder_result = await db.execute(
            select(Folder).where(
                Folder.id == folder_uuid,
                Folder.owner_id == current_user.id,
                Folder.is_destroyed.is_(False),
            )
        )
        if folder_result.scalar_one_or_none() is None:
            raise HTTPException(status_code=404, detail="Cartella di destinazione non trovata")
    file.folder_id = folder_uuid
    await db.commit()
    if folder_uuid:
        await PermSvc.apply_folder_permissions_to_file(db, file_id, folder_uuid)
    await event_bus.publish(
        str(current_user.id),
        {
            "type": "file_updated",
            "file_id": str(file_id),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
    )
    await log_activity(db, current_user.id, "move", "file", file_id, target_name=str(file.id))
    return {"moved": True, "folder_id": str(folder_uuid) if folder_uuid else None}


@router.post("/{file_id}/copy")
async def copy_file(
    file_id: uuid.UUID,
    body: MoveFileRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Copia un file in un'altra cartella (folder_id null = root)."""
    file = await _get_file_with_permission_check(file_id, current_user, db)
    if file.is_destroyed:
        raise HTTPException(status_code=410, detail="File eliminato")
    folder_uuid = None
    if body.folder_id is not None and body.folder_id.strip() != "":
        try:
            folder_uuid = uuid.UUID(body.folder_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="folder_id non valido")
        folder_result = await db.execute(
            select(Folder).where(
                Folder.id == folder_uuid,
                Folder.owner_id == current_user.id,
                Folder.is_destroyed.is_(False),
            )
        )
        if folder_result.scalar_one_or_none() is None:
            raise HTTPException(status_code=404, detail="Cartella di destinazione non trovata")
    storage = get_storage_service()
    encrypted_data = await storage.download_encrypted_file(file.storage_path)
    new_file_id = uuid.uuid4()
    new_storage_path = await storage.upload_encrypted_file(
        file.owner_id,
        new_file_id,
        encrypted_data,
    )
    new_file = FileModel(
        id=new_file_id,
        owner_id=file.owner_id,
        folder_id=folder_uuid,
        name_encrypted=file.name_encrypted,
        mime_type_encrypted=file.mime_type_encrypted,
        file_key_encrypted=file.file_key_encrypted,
        storage_path=new_storage_path,
        size_bytes=file.size_bytes,
        content_hash=file.content_hash,
        encryption_iv=file.encryption_iv,
        is_destroyed=False,
        mime_category=file.mime_category,
    )
    new_file.content_hash = str(uuid.uuid4())
    db.add(new_file)
    await db.commit()
    if folder_uuid:
        await PermSvc.apply_folder_permissions_to_file(db, new_file.id, folder_uuid)
    await log_activity(db, current_user.id, "copy", "file", new_file.id, target_name=str(new_file.id))
    return {"copied": True, "new_file_id": str(new_file.id), "folder_id": str(folder_uuid) if folder_uuid else None}


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
    await log_activity(db, current_user.id, "download", "file", file_id, target_name=file.name_encrypted)
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
    perm = None
    if file.owner_id != current_user.id:
        perm = await PermSvc.get_permission_for_file(db, current_user.id, file_id)
        if perm and perm.resource_key_encrypted:
            file_key_encrypted = perm.resource_key_encrypted
    requires_pin = bool(
        file.owner_id != current_user.id and perm and getattr(perm, "require_pin", False)
    )
    return {
        "file_key_encrypted": file_key_encrypted,
        "encryption_iv": file.encryption_iv,
        "mime_type_encrypted": file.mime_type_encrypted or "",
        "owner_id": str(file.owner_id),
        "requires_pin": requires_pin,
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

    # Salva vecchia versione come FileVersion (versioning illimitato)
    old_version = FileVersion(
        file_id=file_id,
        version_number=existing.version,
        storage_path=existing.storage_path,
        file_key_encrypted=existing.file_key_encrypted,
        encryption_iv=existing.encryption_iv,
        size_bytes=existing.size_bytes,
        content_hash=existing.content_hash,
        comment=meta.version_comment,
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
    await event_bus.publish(
        str(current_user.id),
        {
            "type": "file_updated",
            "file_id": str(file_id),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
    )
    return {"version": existing.version}


@router.get("/{file_id}/versions")
async def list_versions(
    file_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Elenco di tutte le versioni (corrente da File + cronologia da FileVersion)."""
    from sqlalchemy.orm import selectinload

    file = await _get_file_with_permission_check(file_id, current_user, db)
    # Carica owner per email versione corrente
    await db.refresh(file, ["owner"])
    result = await db.execute(
        select(FileVersion)
        .where(FileVersion.file_id == file_id)
        .options(selectinload(FileVersion.creator))
        .order_by(FileVersion.version_number.desc())
    )
    history = result.scalars().all()

    # Versione corrente (dati dal record File)
    out = [
        {
            "version_number": file.version,
            "size": file.size_bytes,
            "created_at": file.updated_at.isoformat(),
            "created_by_email": file.owner.email if file.owner else None,
            "comment": None,
            "is_current": True,
        }
    ]
    # Versioni storiche (da FileVersion)
    for v in history:
        out.append(
            {
                "version_number": v.version_number,
                "size": v.size_bytes,
                "created_at": v.created_at.isoformat(),
                "created_by_email": v.creator.email if v.creator else None,
                "comment": v.comment,
                "is_current": False,
            }
        )
    out.sort(key=lambda x: x["version_number"], reverse=True)
    return out


@router.post("/{file_id}/versions/{version_number}/restore")
async def restore_version(
    request: Request,
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
        content_hash=existing.content_hash,
        created_by=current_user.id,
    )
    db.add(old_current)
    await db.flush()

    # Ripristina i dati della versione richiesta nel record file corrente
    existing.storage_path = to_restore.storage_path
    existing.file_key_encrypted = to_restore.file_key_encrypted
    existing.encryption_iv = to_restore.encryption_iv
    existing.size_bytes = to_restore.size_bytes
    if to_restore.content_hash is not None:
        existing.content_hash = to_restore.content_hash

    await db.commit()
    await AuditService.log_event(
        db,
        action=AuditAction.FILE_RESTORE,
        actor=current_user,
        resource_type="file",
        resource_id=str(file_id),
        details={"version_number": version_number},
        request=request,
    )
    await event_bus.publish(
        str(current_user.id),
        {
            "type": "file_updated",
            "file_id": str(file_id),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
    )
    return {"restored_version": version_number}


@router.get("/{file_id}/versions/{version_number}/key")
async def get_version_key(
    file_id: uuid.UUID,
    version_number: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Ritorna la DEK cifrata e IV per una versione specifica (per decifratura client)."""
    file = await _get_file_with_permission_check(file_id, current_user, db)
    if file.is_destroyed:
        raise HTTPException(status_code=410, detail="File eliminato")
    if version_number == file.version:
        return {
            "file_key_encrypted": file.file_key_encrypted,
            "encryption_iv": file.encryption_iv,
            "mime_type_encrypted": file.mime_type_encrypted or "",
        "owner_id": str(file.owner_id),
        }
    result = await db.execute(
        select(FileVersion).where(
            FileVersion.file_id == file_id,
            FileVersion.version_number == version_number,
        )
    )
    ver = result.scalar_one_or_none()
    if ver is None:
        raise HTTPException(status_code=404, detail="Versione non trovata")
    return {
        "file_key_encrypted": ver.file_key_encrypted,
        "encryption_iv": ver.encryption_iv,
        "mime_type_encrypted": "",  # versioni storiche non hanno mime cifrato in tabella
    }


@router.get("/{file_id}/versions/{version_number}/download")
async def download_version(
    request: Request,
    file_id: uuid.UUID,
    version_number: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Scarica una versione specifica del file (cifrata)."""
    file = await _get_file_with_permission_check(file_id, current_user, db)
    if file.is_destroyed:
        raise HTTPException(status_code=410, detail="File eliminato")

    if version_number == file.version:
        storage_path = file.storage_path
        encryption_iv = file.encryption_iv
    else:
        result = await db.execute(
            select(FileVersion).where(
                FileVersion.file_id == file_id,
                FileVersion.version_number == version_number,
            )
        )
        ver = result.scalar_one_or_none()
        if ver is None:
            raise HTTPException(status_code=404, detail="Versione non trovata")
        storage_path = ver.storage_path
        encryption_iv = ver.encryption_iv

    storage = get_storage_service()
    encrypted_data = await storage.download_encrypted_file(storage_path)
    return StreamingResponse(
        io.BytesIO(encrypted_data),
        media_type="application/octet-stream",
        headers={"X-File-IV": encryption_iv},
    )


@router.delete("/{file_id}/versions/{version_number}")
async def delete_version(
    request: Request,
    file_id: uuid.UUID,
    version_number: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Elimina una versione specifica (non la corrente)."""
    file = await _get_file_with_write_permission(file_id, current_user, db)
    if version_number == file.version:
        raise HTTPException(
            status_code=400,
            detail="Non è possibile eliminare la versione corrente",
        )
    result = await db.execute(
        select(FileVersion).where(
            FileVersion.file_id == file_id,
            FileVersion.version_number == version_number,
        )
    )
    ver = result.scalar_one_or_none()
    if ver is None:
        raise HTTPException(status_code=404, detail="Versione non trovata")

    storage = get_storage_service()
    await storage.delete_file_secure(ver.storage_path)
    await db.delete(ver)
    await db.commit()
    await AuditService.log_event(
        db,
        action=AuditAction.FILE_VERSION_DELETE,
        actor=current_user,
        resource_type="file",
        resource_id=str(file_id),
        details={"version_number": version_number},
        request=request,
    )
    return {"deleted": version_number}


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
    await log_activity(
        db, current_user.id, "share", "file", file_id,
        detail="Condiviso con gruppo",
    )
    await NotificationService.create_notification(
        db=db,
        user_id=current_user.id,
        type="file_shared",
        title="File condiviso",
        body="File condiviso con un gruppo",
        resource_type="file",
        resource_id=str(file_id),
        severity="info",
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


@router.delete("/cleanup-system-files")
async def cleanup_system_files(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Elimina file di sistema/junk caricati per errore (piccoli file anomali: .DS_Store, file_, ~$, ecc.)."""
    result = await db.execute(
        select(FileModel).where(
            FileModel.owner_id == current_user.id,
            FileModel.is_destroyed.is_(False),
            FileModel.size_bytes <= 100,
        )
    )
    files = result.scalars().all()
    deleted = 0
    for f in files:
        try:
            destroyed = await DestructService.destroy_file(
                db, f.id, reason="cleanup_system_files"
            )
            if destroyed:
                deleted += 1
        except Exception:
            pass
    return {"deleted": deleted}


@router.delete("/{file_id}/destroy")
async def manual_destroy(
    request: Request,
    file_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Distrugge manualmente un file (solo owner; se condiviso con block_delete → 403)."""
    file = await db.get(FileModel, file_id)
    if not file:
        raise HTTPException(status_code=404, detail="File non trovato")
    if file.owner_id != current_user.id:
        perm = await PermSvc.get_permission_for_file(db, current_user.id, file_id)
        if perm and getattr(perm, "block_delete", False):
            raise HTTPException(status_code=403, detail="Non puoi eliminare questo file")
        raise HTTPException(status_code=403, detail="Non autorizzato")
    # Proprietario: blocca se esiste un link pubblico attivo con block_delete
    if file.owner_id == current_user.id:
        link_check = await db.execute(
            select(ShareLink).where(
                ShareLink.file_id == file_id,
                ShareLink.is_active.is_(True),
            )
        )
        for link in link_check.scalars().all():
            if getattr(link, "block_delete", False):
                raise HTTPException(
                    status_code=403,
                    detail="Non puoi eliminare un file con link pubblico attivo (opzione 'Non può eliminare' attiva).",
                )
    destroyed = await DestructService.destroy_file(
        db, file_id, reason="manual"
    )
    if destroyed:
        await event_bus.publish(
            str(current_user.id),
            {
                "type": "file_deleted",
                "file_id": str(file_id),
                "timestamp": datetime.now(timezone.utc).isoformat(),
            },
        )
        await AuditService.log_event(
            db,
            action=AuditAction.FILE_SELF_DESTRUCT,
            actor=current_user,
            resource_type="file",
            resource_id=str(file_id),
            details={"reason": "manual"},
            request=request,
        )
        await log_activity(db, current_user.id, "delete", "file", file_id)
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
    if revoked:
        await log_activity(
            db, current_user.id, "share_revoke", "file", file_id,
            detail="Accesso gruppo rimosso",
        )
    return {"revoked": revoked}
