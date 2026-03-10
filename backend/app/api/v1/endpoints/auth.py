"""Auth endpoints — TOTP setup/verify, JWT refresh, dev-only register/login."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.audit_actions import AuditAction
from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.services.audit_service import AuditService
from app.services.auth_service import auth_service

router = APIRouter(prefix="/auth", tags=["auth"])


class DevRegisterBody(BaseModel):
    email: str
    password: str
    display_name: Optional[str] = None  # Nome e cognome (es. "Raffaele Amoroso")


class DevLoginBody(BaseModel):
    email: str
    password: str


class TOTPSetupResponse(BaseModel):
    secret: str
    qr_uri: str


class TOTPVerifyRequest(BaseModel):
    code: str


class RefreshTokenRequest(BaseModel):
    refresh_token: str


class VerifyPinRequest(BaseModel):
    pin: str


class SetPinRequest(BaseModel):
    pin: str


def _dev_only():
    settings = get_settings()
    if getattr(settings, "environment", "production") != "development":
        raise HTTPException(status_code=404, detail="Not Found")


@router.get("/email-available")
async def check_email_available(
    email: str = Query(..., min_length=1),
    db: AsyncSession = Depends(get_db),
):
    """
    Verifica se l'email è già registrata (solo development).
    Restituisce { "available": true } se libera, { "available": false } se già usata.
    """
    _dev_only()
    result = await db.execute(select(User).where(User.email == email.strip()))
    exists = result.scalar_one_or_none() is not None
    return {"available": not exists}


@router.post("/register")
async def dev_register(body: DevRegisterBody, db: AsyncSession = Depends(get_db)):
    """
    Registrazione utente (solo development). Crea utente con email e password.
    In produzione usare WebAuthn (/auth/webauthn/register/begin e complete).
    """
    _dev_only()
    from app.models.user import UserRole

    result = await db.execute(select(User).where(User.email == body.email))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email già registrata")
    display_name = (body.display_name or "").strip() or body.email.split("@")[0]
    user = User(
        email=body.email,
        display_name_encrypted=display_name,
        role=UserRole.USER,
        is_active=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    token = auth_service.create_access_token(user.id, user.role.value)
    return {"access_token": token, "token_type": "bearer", "user_id": str(user.id)}


@router.post("/login")
async def dev_login(body: DevLoginBody, db: AsyncSession = Depends(get_db)):
    """
    Login con email (solo development). Restituisce JWT per utente esistente.
    In produzione usare WebAuthn (/auth/webauthn/authenticate/begin e complete).
    """
    _dev_only()
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=401, detail="Email o password non validi")
    if not user.is_active:
        raise HTTPException(status_code=401, detail="Utente disattivato")
    access_token = auth_service.create_access_token(user.id, user.role.value)
    refresh_token = auth_service.create_refresh_token(user.id)
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "user_id": str(user.id),
    }


@router.post("/totp/setup", response_model=TOTPSetupResponse)
async def setup_totp(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Genera secret TOTP, cifra e salva sull'utente, restituisce secret e URI per QR."""
    secret = auth_service.generate_totp_secret()
    encrypted = auth_service.encrypt_totp_secret_for_storage(secret)
    current_user.totp_secret_encrypted = encrypted
    await db.commit()
    uri = auth_service.get_totp_uri(secret, current_user.email)
    return TOTPSetupResponse(secret=secret, qr_uri=uri)


@router.post("/totp/verify")
async def verify_totp(
    req: TOTPVerifyRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Verifica il codice TOTP e abilita TOTP per l'utente se non già abilitato."""
    if not current_user.totp_secret_encrypted:
        raise HTTPException(
            status_code=400,
            detail="TOTP non configurato. Eseguire prima /auth/totp/setup.",
        )
    stored_secret = auth_service.decrypt_totp_secret_from_storage(
        current_user.totp_secret_encrypted
    )
    valid = auth_service.verify_totp(stored_secret, req.code)
    if not valid:
        raise HTTPException(status_code=401, detail="Codice TOTP non valido")
    if not current_user.totp_enabled:
        current_user.totp_enabled = True
        await db.commit()
    return {"status": "verified"}


@router.post("/token/refresh")
async def refresh_token(
    body: RefreshTokenRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Rilascia un nuovo access token a partire dal refresh token."""
    try:
        new_token = auth_service.refresh_access_token(
            body.refresh_token,
            current_user.id,
            current_user.role.value,
        )
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))
    await AuditService.log_event(
        db,
        action=AuditAction.AUTH_TOKEN_REFRESH,
        actor=current_user,
        request=request,
    )
    return {"access_token": new_token, "token_type": "bearer"}


@router.post("/verify-pin")
async def verify_pin(
    body: VerifyPinRequest,
    current_user: User = Depends(get_current_user),
):
    """
    Verifica il PIN dell'utente (per file condivisi con require_pin).
    Restituisce sempre 200: { "valid": true } o { "valid": false } (no 401 per gestire tentativi lato frontend).
    """
    from app.crypto.kdf import verify_password

    if not current_user.pin_hash:
        return {"valid": False}
    return {"valid": verify_password(body.pin, current_user.pin_hash)}


@router.post("/set-pin")
async def set_pin(
    body: SetPinRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Salva l'hash del PIN dell'utente (chiamato quando l'utente imposta il PIN in registrazione/setup chiavi).
    Il PIN viene hashato con lo stesso meccanismo usato per le password (Argon2id).
    """
    from app.crypto.kdf import hash_password_for_storage

    if not body.pin or len(body.pin) < 4:
        raise HTTPException(status_code=400, detail="PIN non valido (minimo 4 caratteri)")
    current_user.pin_hash = hash_password_for_storage(body.pin)
    await db.commit()
    return {"status": "ok"}
