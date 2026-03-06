"""Test WebAuthn (Passkey) registration and authentication — TASK 3.2."""

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.mark.asyncio
async def test_webauthn_register_begin_returns_options():
    """register/begin restituisce options con challenge e rp."""
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        resp = await client.post(
            "/api/v1/auth/webauthn/register/begin",
            json={"email": "webauthn-test@example.com"},
        )
    assert resp.status_code == 200
    data = resp.json()
    assert "challenge" in data
    assert "rp" in data
    assert data["rp"].get("name") == "AXSHARE"
    assert "user" in data
    assert data["user"].get("name") == "webauthn-test@example.com"


@pytest.mark.asyncio
async def test_webauthn_register_complete_without_challenge_fails():
    """register/complete senza challenge in Redis restituisce 400."""
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        resp = await client.post(
            "/api/v1/auth/webauthn/register/complete",
            json={
                "email": "no-challenge@example.com",
                "credential": {"id": "fake", "response": {}},
            },
        )
    assert resp.status_code == 400
    assert "scaduta" in resp.json().get("detail", "").lower() or "Challenge" in resp.json().get("detail", "")


@pytest.mark.asyncio
async def test_webauthn_authenticate_begin_user_not_found():
    """authenticate/begin con email inesistente restituisce 404 o errore client."""
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        resp = await client.post(
            "/api/v1/auth/webauthn/authenticate/begin",
            json={"email": "nonexistent-webauthn@example.com"},
        )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_webauthn_service_get_registration_options_for_email():
    """Il servizio genera options con challenge e user_id per una email."""
    from app.services.webauthn_service import webauthn_service

    options_dict, challenge, user_handle = webauthn_service.get_registration_options_for_email(
        "test@example.com"
    )
    assert len(challenge) >= 32
    assert options_dict.get("user", {}).get("name") == "test@example.com"
    assert user_handle is not None
