"""CRUD utenti — profilo, chiave pubblica RSA, chiave firma, lista (admin)."""

import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user, require_admin
from app.models.user import User, UserRole

router = APIRouter(prefix="/users", tags=["users"])


class RegisterSigningKeyRequest(BaseModel):
    signing_public_key_pem: str


class UserProfileUpdate(BaseModel):
    display_name: Optional[str] = None
    profile_metadata: Optional[dict] = None


class PublicKeyUpload(BaseModel):
    public_key_pem: str  # Chiave pubblica RSA in formato PEM


class PrivateKeyUpload(BaseModel):
    encrypted_private_key: str  # Chiave privata cifrata con KEK (base64)


@router.get("/me")
async def get_my_profile(current_user: User = Depends(get_current_user)):
    """Profilo dell'utente autenticato."""
    return {
        "id": str(current_user.id),
        "email": current_user.email,
        "display_name": current_user.display_name_encrypted,
        "role": current_user.role.value,
        "totp_enabled": current_user.totp_enabled,
        "has_public_key": current_user.public_key_rsa is not None,
    }


@router.put("/me")
async def update_my_profile(
    update: UserProfileUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Aggiorna profilo (display_name; profile_metadata non persistito nel modello attuale)."""
    if update.display_name is not None:
        current_user.display_name_encrypted = update.display_name
    # profile_metadata non presente sul modello User — ignorato
    await db.commit()
    return {"status": "updated"}


@router.post("/me/public-key")
async def upload_public_key(
    payload: PublicKeyUpload,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Carica chiave pubblica RSA; la salva sul profilo e in Vault."""
    from cryptography.hazmat.primitives.serialization import load_pem_public_key

    try:
        load_pem_public_key(payload.public_key_pem.encode())
    except Exception:
        raise HTTPException(status_code=400, detail="Chiave pubblica non valida")

    current_user.public_key_rsa = payload.public_key_pem
    await db.commit()

    try:
        from app.crypto.vault import get_vault_service
        get_vault_service().store_user_public_key(
            str(current_user.id), payload.public_key_pem
        )
    except Exception:
        pass  # Vault non disponibile (es. test): chiave comunque salvata nel DB

    return {"status": "public_key_saved"}


@router.put("/me/private-key")
async def save_private_key(
    payload: PrivateKeyUpload,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Salva la chiave privata cifrata (KEK) sul server. Usata per sync browser/desktop."""
    current_user.private_key_encrypted = payload.encrypted_private_key
    await db.commit()
    return {"status": "private_key_saved"}


@router.delete("/me/keys")
async def reset_user_keys(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Elimina le chiavi RSA dal profilo (per rigenerare con RSA-4096)."""
    current_user.public_key_rsa = None
    current_user.private_key_encrypted = None
    await db.commit()
    return {"message": "Chiavi resettate"}


@router.get("/me/private-key")
async def get_my_private_key(current_user: User = Depends(get_current_user)):
    """Restituisce la chiave privata cifrata e la chiave pubblica (per popolare IndexedDB su altro client)."""
    return {
        "encrypted_private_key": current_user.private_key_encrypted,
        "public_key_pem": current_user.public_key_rsa,
    }


@router.post("/me/signing-key", response_model=dict)
async def register_signing_key(
    body: RegisterSigningKeyRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Registra la chiave pubblica RSA-PSS per la firma digitale."""
    if not body.signing_public_key_pem.strip().startswith(
        "-----BEGIN PUBLIC KEY-----"
    ):
        raise HTTPException(
            status_code=422, detail="Chiave pubblica non valida"
        )

    current_user.signing_public_key_pem = body.signing_public_key_pem
    current_user.signing_key_registered_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(current_user)
    return {
        "message": "Chiave firma registrata",
        "registered_at": current_user.signing_key_registered_at.isoformat(),
    }


@router.get("/me/signing-key", response_model=dict)
async def get_signing_key_status(
    current_user: User = Depends(get_current_user),
):
    """Verifica se l'utente ha una chiave firma registrata."""
    return {
        "has_signing_key": current_user.signing_public_key_pem is not None,
        "registered_at": (
            current_user.signing_key_registered_at.isoformat()
            if current_user.signing_key_registered_at
            else None
        ),
    }


@router.get("/{user_id}/signing-key", response_model=dict)
async def get_user_signing_key(
    user_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Ottieni la chiave pubblica firma di un utente (per verifica)."""
    result = await db.execute(
        select(User).where(
            User.id == user_id, User.is_active.is_(True)
        )
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Utente non trovato")
    return {
        "user_id": str(user_id),
        "signing_public_key_pem": user.signing_public_key_pem,
        "registered_at": (
            user.signing_key_registered_at.isoformat()
            if user.signing_key_registered_at
            else None
        ),
    }


@router.get("/")
async def list_users(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Lista utenti attivi (solo admin)."""
    result = await db.execute(select(User).where(User.is_active == True))
    users = result.scalars().all()
    return [
        {"id": str(u.id), "email": u.email, "role": u.role.value}
        for u in users
    ]


@router.get("/{user_id}/public-key")
async def get_user_public_key(
    user_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Ottieni la chiave pubblica RSA di un utente attivo."""
    result = await db.execute(
        select(User).where(User.id == user_id, User.is_active == True)
    )
    user = result.scalar_one_or_none()
    if not user or not user.public_key_rsa:
        raise HTTPException(status_code=404, detail="Chiave pubblica non trovata")
    return {"user_id": str(user_id), "public_key_pem": user.public_key_rsa}
