"""Test notifiche in-app: crea, lista, count, segna lette — TASK 11.3."""

import uuid as uuid_mod

import pytest
from httpx import ASGITransport, AsyncClient

from app.config import get_settings
from app.core.notification_types import NotificationSeverity
from app.database import AsyncSessionLocal
from app.main import app
from app.models.user import User, UserRole
from app.services.notification_service import NotificationService


async def _create_user_and_token():
    async with AsyncSessionLocal() as session:
        user = User(
            email=f"notif_{uuid_mod.uuid4().hex[:12]}@example.com",
            display_name_encrypted="Notif Test",
            role=UserRole.USER,
            is_active=True,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        from app.services.auth_service import auth_service
        token = auth_service.create_access_token(user.id, user.role.value)
        return token, str(user.id)


@pytest.mark.asyncio
async def test_create_and_list_notifications():
    """Crea notifica e la lista."""
    get_settings()
    token, user_id = await _create_user_and_token()

    async with AsyncSessionLocal() as db:
        await NotificationService.create(
            db=db,
            user_id=uuid_mod.UUID(user_id),
            type="test_type",
            title="Test notifica",
            body="Corpo della notifica",
            severity=NotificationSeverity.INFO,
        )

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        resp = await client.get(
            "/api/v1/notifications",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["unread_count"] >= 1
        assert len(data["items"]) >= 1
        assert data["items"][0]["title"] == "Test notifica"


@pytest.mark.asyncio
async def test_mark_notifications_read():
    """Segna notifiche come lette."""
    get_settings()
    token, user_id = await _create_user_and_token()

    async with AsyncSessionLocal() as db:
        await NotificationService.create(
            db=db,
            user_id=uuid_mod.UUID(user_id),
            type="test",
            title="Da leggere",
            severity=NotificationSeverity.INFO,
        )

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        headers = {"Authorization": f"Bearer {token}"}
        count_resp = await client.get(
            "/api/v1/notifications/count",
            headers=headers,
        )
        assert count_resp.status_code == 200
        assert count_resp.json()["unread_count"] >= 1

        resp = await client.post(
            "/api/v1/notifications/read",
            headers=headers,
        )
        assert resp.status_code == 200

        count_resp2 = await client.get(
            "/api/v1/notifications/count",
            headers=headers,
        )
        assert count_resp2.json()["unread_count"] == 0


@pytest.mark.asyncio
async def test_unread_only_filter():
    """Filtro unread_only restituisce solo non lette."""
    get_settings()
    token, user_id = await _create_user_and_token()

    async with AsyncSessionLocal() as db:
        await NotificationService.create(
            db=db,
            user_id=uuid_mod.UUID(user_id),
            type="test",
            title="Non letta",
            severity=NotificationSeverity.WARNING,
        )

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        resp = await client.get(
            "/api/v1/notifications",
            params={"unread_only": True},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        items = resp.json()["items"]
        assert all(not item["is_read"] for item in items)
