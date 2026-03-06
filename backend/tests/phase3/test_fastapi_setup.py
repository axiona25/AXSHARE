"""Test FastAPI app setup — TASK 3.1 (health, security headers)."""

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.mark.asyncio
async def test_health_endpoint():
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        resp = await client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert "version" in data


@pytest.mark.asyncio
async def test_security_headers():
    """Verifica che i security headers siano presenti nelle risposte."""
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        resp = await client.get("/health")
    assert resp.status_code == 200
    # Headers sono case-insensitive
    assert resp.headers.get("x-content-type-options") is not None
    assert resp.headers.get("x-frame-options") is not None
