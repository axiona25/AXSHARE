"""WebAuthn (Passkey) registration and authentication endpoints."""

import json
import uuid
import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User, UserRole
import structlog
from app.services.brute_force_service import BruteForceService
from app.services.redis_service import get_redis
from app.services.webauthn_service import webauthn_service

logger = structlog.get_logger()

router = APIRouter(prefix="/auth/webauthn", tags=["auth"])

REDIS_REG_PREFIX = "webauthn:reg:"
REDIS_AUTH_PREFIX = "webauthn:auth:"
REDIS_TTL = 300  # 5 min


class RegisterBeginBody(BaseModel):
    email: str
    display_name: str | None = None


class RegisterCompleteBody(BaseModel):
    email: str
    credential: dict


class AuthenticateBeginBody(BaseModel):
    email: str


class AuthenticateCompleteBody(BaseModel):
    email: str
    credential: dict


@router.post("/register/begin")
async def register_begin(body: RegisterBeginBody, db: AsyncSession = Depends(get_db)):
    """Avvia registrazione WebAuthn: restituisce options e salva challenge in Redis."""
    settings = get_settings()
    options_dict, challenge, user_handle = webauthn_service.get_registration_options_for_email(
        body.email
    )
    redis_client = aioredis.from_url(settings.redis_url)
    try:
        payload = json.dumps(
            {
                "challenge": challenge.hex(),
                "user_id": str(user_handle),
                "display_name": body.display_name or "",
            }
        )
        await redis_client.set(
            f"{REDIS_REG_PREFIX}{body.email}",
            payload,
            ex=REDIS_TTL,
        )
    finally:
        await redis_client.aclose()
    return options_dict


@router.post("/register/complete")
async def register_complete(
    body: RegisterCompleteBody, db: AsyncSession = Depends(get_db)
):
    """Completa registrazione: verifica credential e crea/aggiorna utente con passkey."""
    settings = get_settings()
    redis_client = aioredis.from_url(settings.redis_url)
    try:
        raw = await redis_client.get(f"{REDIS_REG_PREFIX}{body.email}")
        await redis_client.delete(f"{REDIS_REG_PREFIX}{body.email}")
    finally:
        await redis_client.aclose()

    if not raw:
        raise HTTPException(status_code=400, detail="Challenge scaduta o già usata")

    data = json.loads(raw.decode() if isinstance(raw, bytes) else raw)
    challenge = bytes.fromhex(data["challenge"])
    user_id_str = data["user_id"]

    try:
        new_credential = webauthn_service.verify_registration(
            credential=body.credential,
            expected_challenge=challenge,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Verifica credential fallita: {e!s}")

    display_name = data.get("display_name") or ""
    new_credential["display_name"] = display_name
    from datetime import datetime, timezone
    new_credential["created_at"] = datetime.now(timezone.utc).isoformat()

    result = await db.execute(
        select(User).where(User.email == body.email)
    )
    user = result.scalar_one_or_none()

    if user:
        creds = list(user.webauthn_credentials or [])
        creds.append(new_credential)
        user.webauthn_credentials = creds
    else:
        user = User(
            id=uuid.UUID(user_id_str),
            email=body.email,
            display_name_encrypted=body.email,
            role=UserRole.USER,
            is_active=True,
            is_email_verified=False,
            webauthn_credentials=[new_credential],
        )
        db.add(user)

    await db.commit()
    await db.refresh(user)
    return {"status": "registered", "user_id": str(user.id)}


@router.post("/authenticate/begin")
async def authenticate_begin(
    body: AuthenticateBeginBody,
    request: Request,
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
):
    """Avvia autenticazione WebAuthn: restituisce options e salva challenge in Redis."""
    ip = request.client.host if request.client else "0.0.0.0"
    if await BruteForceService.is_locked(redis, ip, body.email):
        logger.warning(
            "brute_force_lockout",
            ip=ip,
            email_domain=body.email.split("@")[-1] if "@" in body.email else None,
        )
        raise HTTPException(
            status_code=429,
            detail="Troppi tentativi falliti. Riprova tra 15 minuti.",
            headers={"Retry-After": "900"},
        )
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Utente non trovato")

    options_dict = webauthn_service.get_authentication_options(user)
    challenge_b64 = options_dict.get("challenge")
    if not challenge_b64:
        raise HTTPException(status_code=500, detail="Challenge non generata")

    settings = get_settings()
    redis_client = aioredis.from_url(settings.redis_url)
    try:
        await redis_client.set(
            f"{REDIS_AUTH_PREFIX}{body.email}",
            challenge_b64,
            ex=REDIS_TTL,
        )
    finally:
        await redis_client.aclose()

    return options_dict


@router.post("/authenticate/complete")
async def authenticate_complete(
    body: AuthenticateCompleteBody,
    request: Request,
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
):
    """Completa autenticazione: verifica credential e restituisce JWT."""
    from datetime import datetime, timedelta
    from jose import jwt
    from webauthn.helpers import base64url_to_bytes

    ip = request.client.host if request.client else "0.0.0.0"
    if await BruteForceService.is_locked(redis, ip, body.email):
        logger.warning(
            "brute_force_lockout",
            ip=ip,
            email_domain=body.email.split("@")[-1] if "@" in body.email else None,
        )
        raise HTTPException(
            status_code=429,
            detail="Troppi tentativi falliti. Riprova tra 15 minuti.",
            headers={"Retry-After": "900"},
        )

    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()
    if not user:
        await BruteForceService.record_failure(redis, ip, body.email)
        raise HTTPException(status_code=404, detail="Utente non trovato")

    settings = get_settings()
    redis_client = aioredis.from_url(settings.redis_url)
    try:
        challenge_b64 = await redis_client.get(f"{REDIS_AUTH_PREFIX}{body.email}")
        await redis_client.delete(f"{REDIS_AUTH_PREFIX}{body.email}")
    finally:
        await redis_client.aclose()

    if not challenge_b64:
        raise HTTPException(status_code=400, detail="Challenge scaduta o già usata")

    challenge_b64 = challenge_b64.decode() if isinstance(challenge_b64, bytes) else challenge_b64
    try:
        challenge = base64url_to_bytes(challenge_b64)
    except Exception:
        challenge = bytes.fromhex(challenge_b64)

    ok = webauthn_service.verify_authentication(
        user=user,
        credential=body.credential,
        expected_challenge=challenge,
    )
    if not ok:
        await BruteForceService.record_failure(redis, ip, body.email)
        remaining = await BruteForceService.get_remaining_attempts(redis, ip, body.email)
        logger.warning(
            "auth_failure_webauthn",
            ip=ip,
            email_domain=body.email.split("@")[-1] if "@" in body.email else None,
            remaining_attempts=remaining,
        )
        raise HTTPException(
            status_code=401,
            detail=f"Verifica passkey fallita. Tentativi rimasti: {remaining}",
        )
    await BruteForceService.clear(redis, ip, body.email)

    user.last_login_at = datetime.utcnow()
    await db.commit()

    with open(settings.jwt_private_key_path, "r") as f:
        private_key = f.read()
    expires = datetime.utcnow() + timedelta(
        minutes=settings.jwt_access_token_expire_minutes
    )
    token = jwt.encode(
        {"sub": str(user.id), "exp": expires},
        private_key,
        algorithm=settings.jwt_algorithm,
    )

    return {"status": "authenticated", "access_token": token, "token_type": "bearer"}


@router.get("/credentials")
async def list_credentials(
    current_user: User = Depends(get_current_user),
):
    """Elenco passkey registrate per l'utente corrente."""
    creds = current_user.webauthn_credentials or []
    if isinstance(creds, dict):
        creds = list(creds.values()) if creds else []
    out = []
    for c in creds:
        if isinstance(c, dict):
            out.append({
                "id": c.get("id", ""),
                "display_name": c.get("display_name") or "Passkey",
                "created_at": c.get("created_at"),
                "last_used_at": c.get("last_used_at"),
                "aaguid": c.get("aaguid", ""),
            })
    return {"credentials": out}


@router.delete("/credentials/{credential_id}")
async def delete_credential(
    credential_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Rimuove una passkey dall'utente."""
    raw = current_user.webauthn_credentials
    if isinstance(raw, dict):
        creds = list(raw.values()) if raw else []
    else:
        creds = list(raw or [])
    original_len = len(creds)
    creds = [c for c in creds if isinstance(c, dict) and c.get("id") != credential_id]
    if len(creds) == original_len:
        raise HTTPException(status_code=404, detail="Credenziale non trovata")
    current_user.webauthn_credentials = creds
    await db.commit()
    return {"deleted": True}
