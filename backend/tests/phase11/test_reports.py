"""Test reportistica: dashboard utente, admin, timeseries — TASK 11.2."""

import uuid as uuid_mod

import pytest
from httpx import ASGITransport, AsyncClient

from app.config import get_settings
from app.database import AsyncSessionLocal
from app.main import app
from app.models.user import User, UserRole


async def _create_user_and_token(role: UserRole = UserRole.USER):
    async with AsyncSessionLocal() as session:
        user = User(
            email=f"reports_{uuid_mod.uuid4().hex[:12]}@example.com",
            display_name_encrypted="Reports Test",
            role=role,
            is_active=True,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        from app.services.auth_service import auth_service
        token = auth_service.create_access_token(user.id, user.role.value)
        return token, str(user.id)


@pytest.mark.asyncio
async def test_user_dashboard_structure():
    """Dashboard utente ha tutti i campi attesi."""
    get_settings()
    token, _ = await _create_user_and_token()

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        resp = await client.get(
            "/api/v1/audit/dashboard/me",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "storage" in data
        assert "sharing" in data
        assert "signatures" in data
        assert "activity" in data
        assert "generated_at" in data
        assert data["storage"]["total_files"] >= 0
        assert data["storage"]["total_size_mb"] >= 0


@pytest.mark.asyncio
async def test_admin_dashboard_requires_admin():
    """Dashboard admin nega accesso a utenti normali."""
    get_settings()
    token, _ = await _create_user_and_token(role=UserRole.USER)

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        resp = await client.get(
            "/api/v1/audit/dashboard/admin",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 403


@pytest.mark.asyncio
async def test_time_series_uploads():
    """Serie temporale upload restituisce struttura corretta."""
    get_settings()
    token, _ = await _create_user_and_token()

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        resp = await client.get(
            "/api/v1/audit/dashboard/timeseries",
            params={"metric": "uploads", "days": 7},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["metric"] == "uploads"
        assert "points" in data
        assert "total" in data
