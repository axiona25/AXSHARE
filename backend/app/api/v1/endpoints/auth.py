"""Auth endpoints — TOTP setup/verify, JWT refresh."""

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit_actions import AuditAction
from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.services.audit_service import AuditService
from app.services.auth_service import auth_service

router = APIRouter(prefix="/auth", tags=["auth"])


class TOTPSetupResponse(BaseModel):
    secret: str
    qr_uri: str


class TOTPVerifyRequest(BaseModel):
    code: str


class RefreshTokenRequest(BaseModel):
    refresh_token: str


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
