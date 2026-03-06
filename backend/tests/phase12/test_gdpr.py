"""Test GDPR: richiesta cancellazione, export dati, consensi."""

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app

from tests.phase12.helpers import create_user_and_token


@pytest.mark.asyncio
async def test_request_erasure():
    """Utente richiede cancellazione dati (Art. 17)."""
    get_settings = __import__("app.config", fromlist=["get_settings"]).get_settings
    get_settings()
    token, _, _ = await create_user_and_token()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        resp = await client.post(
            "/api/v1/gdpr/erasure",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 202
        data = resp.json()
        assert "request_id" in data
        assert "requested_at" in data


@pytest.mark.asyncio
async def test_duplicate_erasure_rejected():
    """Seconda richiesta erasure → 409."""
    get_settings = __import__("app.config", fromlist=["get_settings"]).get_settings
    get_settings()
    token, _, _ = await create_user_and_token()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        headers = {"Authorization": f"Bearer {token}"}
        await client.post("/api/v1/gdpr/erasure", headers=headers)
        resp = await client.post("/api/v1/gdpr/erasure", headers=headers)
        assert resp.status_code == 409


@pytest.mark.asyncio
async def test_export_my_data():
    """Export dati personali include struttura corretta (Art. 20)."""
    get_settings = __import__("app.config", fromlist=["get_settings"]).get_settings
    get_settings()
    token, _, email = await create_user_and_token()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        resp = await client.get(
            "/api/v1/gdpr/export",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "user" in data
        assert data["user"]["email"] == email
        assert "files" in data
        assert "audit_log" in data
        assert "gdpr_article" in data
        assert "share_links" in data


@pytest.mark.asyncio
async def test_consent_record_and_history():
    """Registra consenso e verifica history (Art. 13/14)."""
    get_settings = __import__("app.config", fromlist=["get_settings"]).get_settings
    get_settings()
    token, _, _ = await create_user_and_token()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        headers = {"Authorization": f"Bearer {token}"}
        resp = await client.post(
            "/api/v1/gdpr/consent",
            json={
                "consent_type": "privacy_policy",
                "granted": True,
                "version": "1.0",
            },
            headers=headers,
        )
        assert resp.status_code == 200

        hist = await client.get("/api/v1/gdpr/consent/history", headers=headers)
        assert hist.status_code == 200
        types = [c["consent_type"] for c in hist.json()]
        assert "privacy_policy" in types
