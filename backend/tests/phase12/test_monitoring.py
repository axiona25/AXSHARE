"""Test monitoring: health, health/detailed, metrics, no auth required."""

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


def _get_settings():
    from app.config import get_settings
    get_settings()


@pytest.fixture(autouse=True)
def prime_settings_cache():
    try:
        _get_settings()
    except Exception:
        pass


@pytest.mark.asyncio
async def test_health_endpoint_ok():
    """Endpoint /api/v1/health restituisce 200 e status ok."""
    _get_settings()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        resp = await client.get("/api/v1/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert "timestamp" in data
    assert "version" in data


@pytest.mark.asyncio
async def test_detailed_health_has_checks():
    """Health dettagliato include check database e redis."""
    _get_settings()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        resp = await client.get("/api/v1/health/detailed")
    assert resp.status_code == 200
    data = resp.json()
    assert "checks" in data
    assert "database" in data["checks"]
    assert data["checks"]["database"]["status"] in ("ok", "error")
    assert data["status"] in ("healthy", "degraded")


@pytest.mark.asyncio
async def test_metrics_endpoint_accessible():
    """Endpoint /metrics Prometheus è accessibile (200 se instrumentator attivo)."""
    _get_settings()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        resp = await client.get("/metrics")
    assert resp.status_code in (200, 404)
    if resp.status_code == 200:
        assert "http_requests" in resp.text or "python_info" in resp.text


@pytest.mark.asyncio
async def test_health_no_auth_required():
    """Health check non richiede autenticazione."""
    _get_settings()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        resp = await client.get("/api/v1/health")
    assert resp.status_code == 200
    assert resp.status_code != 401
