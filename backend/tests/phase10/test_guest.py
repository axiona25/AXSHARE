"""Test sessioni guest: invito, riscatto token, revoca — TASK 10.2."""

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


def _unique_email(prefix: str = "guest") -> str:
    return f"{prefix}-{uuid_mod.uuid4().hex[:12]}@example.com"


@pytest.fixture(autouse=True)
def clear_cache():
    from app.config import get_settings
    get_settings.cache_clear()


async def _create_user_and_token():
    async with AsyncSessionLocal() as session:
        user = User(
            email=_unique_email("owner"),
            display_name_encrypted="Guest Test Owner",
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
    original = b"test content for guest invite"
    file_id_str = "guest-test-id"
    encrypted = AESCipher.encrypt_file_chunked(original, dek, file_id_str)
    encryption_iv = encrypted[:12].hex()
    content_hash = __import__("hashlib").sha256(original).hexdigest()
    metadata = FileUploadMetadata(
        name_encrypted="guest-test.bin.enc",
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
async def test_create_guest_invite():
    """Owner crea invito guest per un file."""
    from app.config import get_settings
    get_settings.cache_clear()
    token, _ = await _create_user_and_token()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        file_id = await _upload_test_file(client, token)

        resp = await client.post(
            "/api/v1/guest/invite",
            json={
                "guest_email": "guest@external.com",
                "file_ids": [str(file_id)],
                "expires_in_hours": 24,
                "label": "test guest",
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["guest_email"] == "guest@external.com"
        assert str(file_id) in data["accessible_files"]
        assert data["invite_used"] is False
        assert "invite_token" in data and data["invite_token"]


@pytest.mark.asyncio
async def test_redeem_invite_token():
    """Guest riscatta token invito e riceve JWT."""
    from app.config import get_settings
    get_settings.cache_clear()
    token, _ = await _create_user_and_token()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        file_id = await _upload_test_file(client, token)

        resp = await client.post(
            "/api/v1/guest/invite",
            json={
                "guest_email": "guest2@external.com",
                "file_ids": [str(file_id)],
                "expires_in_hours": 24,
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        invite_token = resp.json()["invite_token"]

        resp2 = await client.post(
            f"/api/v1/public/guest/redeem?invite_token={invite_token}",
        )
        assert resp2.status_code == 200
        data = resp2.json()
        assert "access_token" in data
        assert data["guest_email"] == "guest2@external.com"
        assert str(file_id) in data["accessible_files"]


@pytest.mark.asyncio
async def test_revoke_guest_session():
    """Owner revoca sessione guest."""
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
            "/api/v1/guest/invite",
            json={
                "guest_email": "guest3@external.com",
                "file_ids": [str(file_id)],
                "expires_in_hours": 24,
            },
            headers=headers,
        )
        session_id = resp.json()["id"]

        resp2 = await client.delete(
            f"/api/v1/guest/sessions/{session_id}",
            headers=headers,
        )
        assert resp2.status_code == 204

        resp3 = await client.get("/api/v1/guest/sessions", headers=headers)
        sessions = resp3.json()
        revoked = next(
            (s for s in sessions if s["id"] == session_id),
            None,
        )
        assert revoked is not None
        assert revoked["is_active"] is False
