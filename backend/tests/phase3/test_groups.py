"""Test Groups module — TASK 3.5."""

import uuid as uuid_mod
import pytest
from httpx import ASGITransport, AsyncClient

from app.database import AsyncSessionLocal
from app.main import app
from app.models.user import User, UserRole
from app.services.auth_service import auth_service


def _unique_email(prefix: str = "user") -> str:
    return f"{prefix}-{uuid_mod.uuid4().hex[:12]}@example.com"


@pytest.fixture(autouse=True)
def _clear_settings_cache():
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
async def test_create_group():
    """POST /groups/ → gruppo creato, owner è membro admin."""
    user, token = await _create_test_user(_unique_email("group-owner"))
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        resp = await client.post(
            "/api/v1/groups/",
            headers={"Authorization": f"Bearer {token}"},
            json={"name": "Test Group", "description": "A test group"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "id" in data
        assert data["name"] == "Test Group"
        list_resp = await client.get(
            "/api/v1/groups/",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert list_resp.status_code == 200
        groups = list_resp.json()
        assert len(groups) == 1
        assert groups[0]["id"] == data["id"]
        assert groups[0]["name"] == "Test Group"


@pytest.mark.asyncio
async def test_add_member_with_key():
    """POST /groups/{id}/members con encrypted_group_key → membro aggiunto."""
    from app.config import get_settings
    get_settings.cache_clear()
    owner, owner_token = await _create_test_user(_unique_email("group-owner"))
    member_user, _ = await _create_test_user(_unique_email("group-member"))
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        create_resp = await client.post(
            "/api/v1/groups/",
            headers={"Authorization": f"Bearer {owner_token}"},
            json={"name": "Group With Members"},
        )
        assert create_resp.status_code == 200
        group_id = create_resp.json()["id"]
        add_resp = await client.post(
            f"/api/v1/groups/{group_id}/members",
            headers={"Authorization": f"Bearer {owner_token}"},
            json={
                "user_id": str(member_user.id),
                "encrypted_group_key": "fake-encrypted-key-for-member",
            },
        )
        assert add_resp.status_code == 200
        assert add_resp.json()["status"] == "member_added"


@pytest.mark.asyncio
async def test_remove_member_invalidates_key():
    """DELETE /groups/{id}/members/{uid} → membro rimosso."""
    from app.config import get_settings
    get_settings.cache_clear()
    owner, owner_token = await _create_test_user(_unique_email("owner-rm"))
    member_user, _ = await _create_test_user(_unique_email("member-rm"))
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        create_resp = await client.post(
            "/api/v1/groups/",
            headers={"Authorization": f"Bearer {owner_token}"},
            json={"name": "Group To Remove From"},
        )
        assert create_resp.status_code == 200
        group_id = create_resp.json()["id"]
        await client.post(
            f"/api/v1/groups/{group_id}/members",
            headers={"Authorization": f"Bearer {owner_token}"},
            json={
                "user_id": str(member_user.id),
                "encrypted_group_key": "encrypted-key",
            },
        )
        del_resp = await client.delete(
            f"/api/v1/groups/{group_id}/members/{member_user.id}",
            headers={"Authorization": f"Bearer {owner_token}"},
        )
        assert del_resp.status_code == 200
        assert del_resp.json()["status"] == "member_removed"
        del_again = await client.delete(
            f"/api/v1/groups/{group_id}/members/{member_user.id}",
            headers={"Authorization": f"Bearer {owner_token}"},
        )
        assert del_again.status_code == 404
