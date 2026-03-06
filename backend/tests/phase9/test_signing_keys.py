"""Test keypair firma separato e registrazione chiave firma — TASK 9.2."""

import uuid as uuid_mod

import pytest
from httpx import AsyncClient

from app.database import AsyncSessionLocal
from app.main import app
from app.models.user import User, UserRole
from app.services.auth_service import auth_service


@pytest.fixture(autouse=True)
def clear_cache():
    from app.config import get_settings
    get_settings.cache_clear()


async def _create_user_and_token():
    """Crea utente in DB e restituisce (token, user_id)."""
    async with AsyncSessionLocal() as session:
        user = User(
            email=f"sigkey-{uuid_mod.uuid4().hex[:12]}@example.com",
            display_name_encrypted="Signing Key Test",
            role=UserRole.USER,
            is_active=True,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        token = auth_service.create_access_token(user.id, user.role.value)
        return token, str(user.id)


@pytest.mark.asyncio
async def test_register_and_get_signing_key():
    """Registra chiave firma e verifica status."""
    async with AsyncClient(app=app, base_url="http://test") as client:
        token, _ = await _create_user_and_token()
        headers = {"Authorization": f"Bearer {token}"}

        resp = await client.get(
            "/api/v1/users/me/signing-key", headers=headers
        )
        assert resp.status_code == 200
        assert resp.json()["has_signing_key"] is False

        resp = await client.post(
            "/api/v1/users/me/signing-key",
            json={
                "signing_public_key_pem": "-----BEGIN PUBLIC KEY-----\ntest\n-----END PUBLIC KEY-----"
            },
            headers=headers,
        )
        assert resp.status_code == 200
        assert "registered_at" in resp.json()

        resp = await client.get(
            "/api/v1/users/me/signing-key", headers=headers
        )
        assert resp.json()["has_signing_key"] is True


@pytest.mark.asyncio
async def test_get_other_user_signing_key():
    """Recupera chiave pubblica firma di altro utente."""
    from app.config import get_settings
    get_settings.cache_clear()
    token1, _ = await _create_user_and_token()
    token2, user2_id = await _create_user_and_token()
    get_settings.cache_clear()
    async with AsyncClient(app=app, base_url="http://test") as client:

        await client.post(
            "/api/v1/users/me/signing-key",
            json={
                "signing_public_key_pem": "-----BEGIN PUBLIC KEY-----\nkey2\n-----END PUBLIC KEY-----"
            },
            headers={"Authorization": f"Bearer {token2}"},
        )

        resp = await client.get(
            f"/api/v1/users/{user2_id}/signing-key",
            headers={"Authorization": f"Bearer {token1}"},
        )
        assert resp.status_code == 200
        assert resp.json().get("signing_public_key_pem") is not None


@pytest.mark.asyncio
async def test_invalid_pem_rejected():
    """PEM non valida viene rifiutata."""
    from app.config import get_settings
    get_settings.cache_clear()
    async with AsyncClient(app=app, base_url="http://test") as client:
        token, _ = await _create_user_and_token()
        resp = await client.post(
            "/api/v1/users/me/signing-key",
            json={"signing_public_key_pem": "not-a-valid-pem"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 422
