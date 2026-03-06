"""Dipendenze FastAPI globali — get_db, get_current_user, require_admin."""

import uuid
from typing import Optional

from fastapi import Depends, Header, HTTPException, Query, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.models.user import User, UserRole

security = HTTPBearer()


async def _get_user_from_token(token: str, db: AsyncSession) -> User:
    """Decodifica JWT e restituisce l'utente. Solleva HTTPException se invalido."""
    settings = get_settings()
    try:
        with open(settings.jwt_public_key_path, "r") as f:
            public_key = f.read()
        payload = jwt.decode(
            token, public_key, algorithms=[settings.jwt_algorithm]
        )
        user_id: str = payload.get("sub")
        if user_id is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token non valido",
            )
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token non valido",
        )
    result = await db.execute(select(User).where(User.id == uuid.UUID(user_id)))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Utente non trovato",
        )
    return user


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> User:
    return await _get_user_from_token(credentials.credentials, db)


async def get_current_user_sse(
    token: Optional[str] = Query(None, alias="token"),
    authorization: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Come get_current_user ma accetta token da query param (per EventSource SSE)."""
    actual_token: Optional[str] = token
    if not actual_token and authorization and authorization.startswith("Bearer "):
        actual_token = authorization[7:].strip()
    if not actual_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token mancante",
        )
    return await _get_user_from_token(actual_token, db)


async def require_admin(
    current_user: User = Depends(get_current_user),
) -> User:
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Accesso negato",
        )
    return current_user
