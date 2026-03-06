"""Test folder tree cifrato — TASK 4.3."""

import uuid as uuid_mod
import pytest
from httpx import ASGITransport, AsyncClient

from app.database import AsyncSessionLocal
from app.main import app
from app.models.user import User, UserRole
from app.services.auth_service import auth_service


def _unique_email(prefix: str = "folder") -> str:
    return f"{prefix}-{uuid_mod.uuid4().hex[:12]}@example.com"


async def _create_test_user(email: str, role: UserRole = UserRole.USER):
    async with AsyncSessionLocal() as session:
        user = User(
            email=email,
            display_name_encrypted="Folder Test",
            role=role,
            is_active=True,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        token = auth_service.create_access_token(user.id, user.role.value)
        return user, token


@pytest.mark.asyncio
async def test_create_nested_folders():
    """Crea root → sub1 → sub2, naviga albero correttamente."""
    from app.config import get_settings
    get_settings.cache_clear()

    user, token = await _create_test_user(_unique_email("nested"))
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        auth = {"Authorization": f"Bearer {token}"}
        # Root
        r_root = await client.post(
            "/api/v1/folders/",
            headers=auth,
            json={
                "name_encrypted": "root-encrypted-name",
                "parent_id": None,
                "folder_key_encrypted": "fake-key-encrypted-base64",
            },
        )
        assert r_root.status_code == 200
        root_id = r_root.json()["folder_id"]

        # Sub1
        r_sub1 = await client.post(
            "/api/v1/folders/",
            headers=auth,
            json={
                "name_encrypted": "sub1-encrypted",
                "parent_id": root_id,
                "folder_key_encrypted": "fake-key-sub1",
            },
        )
        assert r_sub1.status_code == 200
        sub1_id = r_sub1.json()["folder_id"]

        # Sub2 under sub1
        r_sub2 = await client.post(
            "/api/v1/folders/",
            headers=auth,
            json={
                "name_encrypted": "sub2-encrypted",
                "parent_id": sub1_id,
                "folder_key_encrypted": "fake-key-sub2",
            },
        )
        assert r_sub2.status_code == 200
        sub2_id = r_sub2.json()["folder_id"]

        # List root: deve contenere la root
        list_root = await client.get("/api/v1/folders/", headers=auth)
        assert list_root.status_code == 200
        root_list = list_root.json()
        assert len(root_list) >= 1
        ids = [x["id"] for x in root_list]
        assert root_id in ids

        # Children of root: sub1
        list_children = await client.get(
            f"/api/v1/folders/{root_id}/children",
            headers=auth,
        )
        assert list_children.status_code == 200
        children = list_children.json()
        assert len(children) >= 1
        assert any(c["id"] == sub1_id for c in children)

        # Children of sub1: sub2
        list_sub1_children = await client.get(
            f"/api/v1/folders/{sub1_id}/children",
            headers=auth,
        )
        assert list_sub1_children.status_code == 200
        sub1_children = list_sub1_children.json()
        assert any(c["id"] == sub2_id for c in sub1_children)


@pytest.mark.asyncio
async def test_folder_name_opaque_on_server():
    """Il name_encrypted non è leggibile senza chiave: il server restituisce l'opaco."""
    from app.config import get_settings
    get_settings.cache_clear()

    user, token = await _create_test_user(_unique_email("opaque"))
    opaque_name = "aGVsbG8td29ybGQtY2lw aGVyZWQ="  # nome cifrato (base64-like), opaco al server
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        r = await client.post(
            "/api/v1/folders/",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "name_encrypted": opaque_name,
                "parent_id": None,
                "folder_key_encrypted": "opaque-key",
            },
        )
        assert r.status_code == 200
        folder_id = r.json()["folder_id"]

        list_root = await client.get(
            "/api/v1/folders/",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert list_root.status_code == 200
        folders = list_root.json()
        created = next((f for f in folders if f["id"] == folder_id), None)
        assert created is not None
        # Il server restituisce il nome così com'è memorizzato (cifrato/opaco)
        assert created["name_encrypted"] == opaque_name
