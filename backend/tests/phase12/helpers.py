"""Helper per test E2E Fase 12 (GDPR)."""

import uuid as uuid_mod

from app.database import AsyncSessionLocal
from app.models.user import User, UserRole
from app.services.auth_service import auth_service


def _unique_email(prefix: str = "gdpr") -> str:
    return f"{prefix}-{uuid_mod.uuid4().hex[:12]}@example.com"


async def create_user_and_token():
    """Crea utente in DB e restituisce (token, user_id, email)."""
    # Prime settings cache so JWT encode/decode use same key (evita 401 flaky)
    get_settings = __import__("app.config", fromlist=["get_settings"]).get_settings
    get_settings()
    async with AsyncSessionLocal() as session:
        user = User(
            email=_unique_email("gdpr"),
            display_name_encrypted="GDPR Test",
            role=UserRole.USER,
            is_active=True,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        token = auth_service.create_access_token(user.id, user.role.value)
        return token, str(user.id), user.email
