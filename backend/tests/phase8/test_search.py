"""Test ricerca file (TASK 8.2)."""

import base64
import uuid as uuid_mod

import pytest
from httpx import ASGITransport, AsyncClient

from app.api.v1.endpoints.files import FileUploadMetadata
from app.crypto.aes import AESCipher
from app.database import AsyncSessionLocal
from app.main import app
from app.models.user import User, UserRole
from app.services.auth_service import auth_service


def _unique_email(prefix: str = "search") -> str:
    return f"{prefix}-{uuid_mod.uuid4().hex[:12]}@example.com"


@pytest.fixture(autouse=True)
def clear_cache():
    from app.config import get_settings
    get_settings.cache_clear()


async def _create_user_and_token():
    """Crea utente di test e restituisce (token, user_id)."""
    async with AsyncSessionLocal() as session:
        user = User(
            email=_unique_email("search"),
            display_name_encrypted="Search Test",
            role=UserRole.USER,
            is_active=True,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        token = auth_service.create_access_token(user.id, user.role.value)
        return token, str(user.id)


async def _upload_test_file(client: AsyncClient, token: str) -> str:
    """Carica un file di test e restituisce file_id."""
    dek = AESCipher.generate_key()
    original = b"test content for search"
    file_id_str = "search-test-id"
    encrypted = AESCipher.encrypt_file_chunked(original, dek, file_id_str)
    encryption_iv = encrypted[:12].hex()
    content_hash = __import__("hashlib").sha256(original).hexdigest()
    metadata = FileUploadMetadata(
        name_encrypted="search-test.bin.enc",
        mime_type_encrypted="application/octet-stream",
        file_key_encrypted=base64.b64encode(dek).decode("utf-8"),
        encryption_iv=encryption_iv,
        content_hash=content_hash,
        folder_id=None,
        size_original=len(original),
    )
    resp = await client.post(
        "/api/v1/files/upload",
        headers={"Authorization": f"Bearer {token}"},
        data={"metadata": metadata.model_dump_json()},
        files={"file": ("x.bin", encrypted, "application/octet-stream")},
    )
    assert resp.status_code == 200
    return resp.json()["file_id"]


@pytest.mark.asyncio
async def test_search_by_tag():
    """Ricerca file per tag."""
    token, _ = await _create_user_and_token()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        file_id = await _upload_test_file(client, token)

        await client.post(
            f"/api/v1/files/{file_id}/tags",
            json={"tag": "test-search"},
            headers={"Authorization": f"Bearer {token}"},
        )

        resp = await client.get(
            "/api/v1/search/files",
            params={"tags": "test-search"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] >= 1
        ids = [item["id"] for item in data["items"]]
        assert file_id in ids


@pytest.mark.asyncio
async def test_search_starred():
    """Ricerca file starred."""
    from app.config import get_settings
    get_settings.cache_clear()
    token, _ = await _create_user_and_token()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        file_id = await _upload_test_file(client, token)

        await client.patch(
            f"/api/v1/files/{file_id}/labels",
            json={"is_starred": True},
            headers={"Authorization": f"Bearer {token}"},
        )

        resp = await client.get(
            "/api/v1/search/files",
            params={"is_starred": "true"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        assert resp.json()["total"] >= 1


@pytest.mark.asyncio
async def test_search_pagination():
    """Paginazione risultati."""
    token, _ = await _create_user_and_token()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        for _ in range(3):
            await _upload_test_file(client, token)
        from app.config import get_settings
        get_settings.cache_clear()
        resp = await client.get(
            "/api/v1/search/files",
            params={"page": 1, "page_size": 2},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["items"]) <= 2
        assert data["page"] == 1
