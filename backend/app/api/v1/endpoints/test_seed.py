"""Endpoint solo per E2E/test: crea utente e restituisce token. Attivo solo con ENVIRONMENT=test."""

from fastapi import APIRouter
from pydantic import BaseModel

from app.config import get_settings
from app.database import AsyncSessionLocal
from app.models.user import User, UserRole
from app.services.auth_service import auth_service

router = APIRouter(prefix="/test", tags=["test"])


class SeedUserResponse(BaseModel):
    access_token: str
    user_id: str
    email: str


@router.post("/seed-user", response_model=SeedUserResponse)
async def seed_user():
    """
    Crea un utente di test e restituisce access_token.
    Disponibile solo quando ENVIRONMENT=test (per E2E Playwright).
    """
    settings = get_settings()
    if getattr(settings, "environment", "development") != "test":
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Not available")

    import uuid as uuid_mod
    email = f"e2e_{uuid_mod.uuid4().hex[:8]}@test.com"
    async with AsyncSessionLocal() as session:
        user = User(
            email=email,
            display_name_encrypted="E2E Test",
            role=UserRole.USER,
            is_active=True,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        token = auth_service.create_access_token(user.id, user.role.value)
        return SeedUserResponse(
            access_token=token,
            user_id=str(user.id),
            email=user.email,
        )
