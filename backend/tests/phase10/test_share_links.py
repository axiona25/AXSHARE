"""Test share link (creazione, lista, revoca, download pubblico) — TASK 10.1."""

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


def _unique_email(prefix: str = "share") -> str:
    return f"{prefix}-{uuid_mod.uuid4().hex[:12]}@example.com"


@pytest.fixture(autouse=True)
def clear_cache():
    from app.config import get_settings
    get_settings.cache_clear()


async def _create_user_and_token():
    async with AsyncSessionLocal() as session:
        user = User(
            email=_unique_email("share"),
            display_name_encrypted="Share Link Test",
            role=UserRole.USER,
            is_active=True,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        token = auth_service.create_access_token(user.id, user.role.value)
        return token, str(user.id)


async def _upload_test_file(client: AsyncClient, token: str) -> str:
    dek = AESCipher.generate_key()
    original = b"test content for share link"
    file_id_str = "share-test-id"
    encrypted = AESCipher.encrypt_file_chunked(original, dek, file_id_str)
    encryption_iv = encrypted[:12].hex()
    content_hash = __import__("hashlib").sha256(original).hexdigest()
    metadata = FileUploadMetadata(
        name_encrypted="share-test.bin.enc",
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
        files={"file": ("f.bin", encrypted, "application/octet-stream")},
    )
    assert resp.status_code == 200
    return resp.json()["file_id"]


@pytest.mark.asyncio
async def test_create_and_list_share_link():
    """Owner crea link e lo lista."""
    from app.config import get_settings
    get_settings.cache_clear()
    token, _ = await _create_user_and_token()
    get_settings.cache_clear()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        file_id = await _upload_test_file(client, token)
        headers = {"Authorization": f"Bearer {token}"}

        resp = await client.post(
            f"/api/v1/files/{file_id}/share-links",
            json={"label": "test-link", "max_downloads": 5},
            headers=headers,
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["is_password_protected"] is False
        assert data["max_downloads"] == 5
        assert "token" in data
        assert "share_url" in data

        resp2 = await client.get(
            f"/api/v1/files/{file_id}/share-links",
            headers=headers,
        )
        assert resp2.status_code == 200
        assert len(resp2.json()) >= 1


@pytest.mark.asyncio
async def test_download_via_public_link():
    """Download tramite token pubblico senza password."""
    from app.config import get_settings
    get_settings.cache_clear()
    token, _ = await _create_user_and_token()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        file_id = await _upload_test_file(client, token)

        resp = await client.post(
            f"/api/v1/files/{file_id}/share-links",
            json={"file_key_encrypted_for_link": "enc_key_for_link"},
            headers={"Authorization": f"Bearer {token}"},
        )
        share_token = resp.json()["token"]

        resp2 = await client.post(
            f"/api/v1/public/share/{share_token}/download",
            json={},
        )
        assert resp2.status_code == 200
        assert (
            resp2.json()["file_key_encrypted_for_link"]
            == "enc_key_for_link"
        )


@pytest.mark.asyncio
async def test_revoke_link():
    """Link revocato non è più accessibile."""
    from app.config import get_settings
    get_settings.cache_clear()
    token, _ = await _create_user_and_token()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        file_id = await _upload_test_file(client, token)
        headers = {"Authorization": f"Bearer {token}"}

        resp = await client.post(
            f"/api/v1/files/{file_id}/share-links",
            json={},
            headers=headers,
        )
        link_id = resp.json()["id"]
        share_token = resp.json()["token"]

        resp2 = await client.delete(
            f"/api/v1/share-links/{link_id}",
            headers=headers,
        )
        assert resp2.status_code == 204

        resp3 = await client.post(
            f"/api/v1/public/share/{share_token}/download",
            json={},
        )
        assert resp3.status_code == 410
