"""Test sicurezza NIS2: security headers, rate/brute-force, input, size, auth."""

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
async def test_security_headers_present():
    """Tutte le risposte hanno i security headers richiesti."""
    _get_settings()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        resp = await client.get("/health")
    assert resp.status_code == 200
    assert "x-frame-options" in [h.lower() for h in resp.headers.keys()]
    assert "x-content-type-options" in [h.lower() for h in resp.headers.keys()]
    assert resp.headers.get("x-powered-by") is None


@pytest.mark.asyncio
async def test_brute_force_lockout():
    """Dopo 5 tentativi falliti di auth WebAuthn → 429 lockout."""
    _get_settings()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        # 5 failed authenticate/complete (user not found o credential invalida)
        for _ in range(5):
            await client.post(
                "/api/v1/auth/webauthn/authenticate/complete",
                json={
                    "email": "nonexistent-lockout@test.local",
                    "credential": {"id": "x", "response": {}},
                },
            )
        # 6th request (begin o complete) deve dare 429
        resp = await client.post(
            "/api/v1/auth/webauthn/authenticate/begin",
            json={"email": "nonexistent-lockout@test.local"},
        )
    assert resp.status_code == 429
    assert "Retry-After" in resp.headers or "15" in (resp.json().get("detail") or "")


@pytest.mark.asyncio
async def test_sql_injection_rejected():
    """Input con SQL injection non causa errori 500."""
    _get_settings()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        resp = await client.post(
            "/api/v1/auth/webauthn/authenticate/begin",
            json={
                "email": "admin'--",
            },
        )
    assert resp.status_code != 500
    assert resp.status_code in (404, 422, 429)


@pytest.mark.asyncio
async def test_oversized_request_rejected():
    """Payload troppo grande (Content-Length > 100 MB) → 413."""
    _get_settings()
    oversized = 101 * 1024 * 1024
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        # Header Content-Length > 100 MB: middleware rifiuta prima di leggere il body
        resp = await client.request(
            "POST",
            "/api/v1/auth/webauthn/register/begin",
            content=b'{"email":"a@b.co"}',
            headers={
                "Content-Type": "application/json",
                "Content-Length": str(oversized),
            },
        )
    assert resp.status_code == 413


@pytest.mark.asyncio
async def test_blocked_user_agent_rejected():
    """User-Agent da tool di scanning (es. sqlmap) → 403."""
    _get_settings()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        resp = await client.get(
            "/health",
            headers={"User-Agent": "sqlmap/1.0"},
        )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_unauthenticated_access_denied():
    """Endpoint protetti richiedono autenticazione → 401."""
    _get_settings()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        for method, path in [
            ("GET", "/api/v1/folders/"),
            ("GET", "/api/v1/audit/logs"),
            ("GET", "/api/v1/notifications"),
            ("GET", "/api/v1/gdpr/export"),
        ]:
            if method == "GET":
                resp = await client.get(path)
            else:
                resp = await client.post(path)
            assert resp.status_code in (401, 403), (
                f"{method} {path} dovrebbe richiedere auth (401/403)"
            )
