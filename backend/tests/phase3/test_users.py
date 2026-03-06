"""Test Users module — TASK 3.4."""

import asyncio
import uuid as uuid_mod
import pytest
from httpx import ASGITransport, AsyncClient

from app.database import AsyncSessionLocal
from app.main import app
from app.models.user import User, UserRole
from app.services.auth_service import auth_service


def _unique_email(prefix: str = "user") -> str:
    """Email univoca per evitare UniqueViolation tra run."""
    return f"{prefix}-{uuid_mod.uuid4().hex[:12]}@example.com"


@pytest.fixture(autouse=True)
def _clear_settings_cache():
    """Ogni test parte con cache settings vuota così JWT usa path risolti."""
    from app.config import get_settings
    get_settings.cache_clear()
    yield


async def _create_test_user(email: str, role: UserRole = UserRole.USER):
    """Crea un utente di test e restituisce (user, access_token)."""
    async with AsyncSessionLocal() as session:
        user = User(
            email=email,
            display_name_encrypted="Test User",
            role=role,
            is_active=True,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        token = auth_service.create_access_token(user.id, user.role.value)
        return user, token


@pytest.mark.asyncio
async def test_get_own_profile():
    """GET /users/me con token restituisce il profilo corretto."""
    user, token = await _create_test_user(_unique_email("me"))
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        resp = await client.get(
            "/api/v1/users/me",
            headers={"Authorization": f"Bearer {token}"},
        )
    assert resp.status_code == 200
    data = resp.json()
    assert data["email"] == user.email
    assert data["id"] == str(user.id)
    assert data["role"] == "user"
    assert "display_name" in data
    assert "totp_enabled" in data
    assert "has_public_key" in data


@pytest.mark.asyncio
async def test_upload_public_key():
    """POST /users/me/public-key con chiave RSA valida → 200."""
    from app.config import get_settings
    from app.crypto.rsa import generate_keypair

    get_settings.cache_clear()
    user, token = await _create_test_user(_unique_email("upload-pk"))
    loop = asyncio.get_event_loop()
    pub_pem = await loop.run_in_executor(
        None, lambda: generate_keypair().public_key_pem()
    )

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        resp = await client.post(
            "/api/v1/users/me/public-key",
            headers={"Authorization": f"Bearer {token}"},
            json={"public_key_pem": pub_pem},
        )
    assert resp.status_code == 200
    assert resp.json()["status"] == "public_key_saved"


@pytest.mark.asyncio
async def test_upload_public_key_invalid():
    """POST /users/me/public-key con dati non PEM → 400."""
    user, token = await _create_test_user(_unique_email("invalid-pk"))
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        resp = await client.post(
            "/api/v1/users/me/public-key",
            headers={"Authorization": f"Bearer {token}"},
            json={"public_key_pem": "not-a-valid-pem"},
        )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_get_other_user_public_key():
    """GET /users/{id}/public-key dopo upload restituisce la chiave."""
    from app.config import get_settings
    from app.crypto.rsa import generate_keypair

    get_settings.cache_clear()
    user, token = await _create_test_user(_unique_email("other-pk"))
    loop = asyncio.get_event_loop()
    pub_pem = await loop.run_in_executor(
        None, lambda: generate_keypair().public_key_pem()
    )

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        await client.post(
            "/api/v1/users/me/public-key",
            headers={"Authorization": f"Bearer {token}"},
            json={"public_key_pem": pub_pem},
        )
        resp = await client.get(
            f"/api/v1/users/{user.id}/public-key",
            headers={"Authorization": f"Bearer {token}"},
        )
    assert resp.status_code == 200
    data = resp.json()
    assert data["user_id"] == str(user.id)
    assert "public_key_pem" in data
    assert data["public_key_pem"] == pub_pem


@pytest.mark.asyncio
async def test_list_users_admin_only():
    """GET /users/ senza admin → 403; con admin → 200."""
    user, user_token = await _create_test_user(_unique_email("nonadmin"), UserRole.USER)
    admin, admin_token = await _create_test_user(_unique_email("admin"), UserRole.ADMIN)

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        resp_user = await client.get(
            "/api/v1/users/",
            headers={"Authorization": f"Bearer {user_token}"},
        )
        resp_admin = await client.get(
            "/api/v1/users/",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
    assert resp_user.status_code == 403
    assert resp_admin.status_code == 200
    assert isinstance(resp_admin.json(), list)
