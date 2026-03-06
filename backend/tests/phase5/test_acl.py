"""Test ACL permessi — TASK 5.1."""

import uuid as uuid_mod
import pytest
from httpx import AsyncClient, ASGITransport

from app.api.v1.endpoints.files import FileUploadMetadata
from app.crypto.aes import AESCipher
from app.database import AsyncSessionLocal
from app.main import app
from app.models.user import User, UserRole
from app.services.auth_service import auth_service


def _unique_email(prefix: str = "acl") -> str:
    return f"{prefix}_{uuid_mod.uuid4().hex[:10]}@test.com"


async def _make_user_and_token(email: str):
    """Crea utente e restituisce (user, token)."""
    async with AsyncSessionLocal() as db:
        user = User(
            email=email,
            display_name_encrypted="test",
            role=UserRole.USER,
            is_active=True,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
        token = auth_service.create_access_token(user.id, user.role.value)
        return user, token


async def _upload_file(client: AsyncClient, token: str, content: bytes = b"test content"):
    """Upload un file e restituisce file_id."""
    key = AESCipher.generate_key()
    file_id_hint = "acl-file"
    encrypted = AESCipher.encrypt_file_chunked(content, key, file_id_hint)
    iv_hex = encrypted[:12].hex()
    import hashlib
    import base64
    metadata = FileUploadMetadata(
        name_encrypted="dGVzdA==",
        mime_type_encrypted="dGVzdA==",
        file_key_encrypted=base64.b64encode(key).decode("utf-8"),
        encryption_iv=iv_hex,
        content_hash=hashlib.sha256(content).hexdigest(),
        folder_id=None,
        size_original=len(content),
    )
    resp = await client.post(
        "/api/v1/files/upload",
        headers={"Authorization": f"Bearer {token}"},
        data={"metadata": metadata.model_dump_json()},
        files={"file": ("blob", encrypted, "application/octet-stream")},
    )
    assert resp.status_code == 200
    return resp.json()["file_id"]


@pytest.mark.asyncio
async def test_grant_and_list_permission():
    """Owner concede permesso read a un altro utente."""
    from app.config import get_settings
    get_settings.cache_clear()

    owner, owner_token = await _make_user_and_token(_unique_email("owner"))
    other, _ = await _make_user_and_token(_unique_email("other"))

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        get_settings.cache_clear()
        file_id = await _upload_file(client, owner_token)

        resp = await client.post(
            "/api/v1/permissions/",
            headers={"Authorization": f"Bearer {owner_token}"},
            json={
                "subject_user_id": str(other.id),
                "resource_file_id": file_id,
                "level": "read",
                "resource_key_encrypted": "encrypted_key_placeholder",
            },
        )
        assert resp.status_code == 201
        perm = resp.json()
        assert perm["level"] == "read"
        assert perm["is_active"] is True

        resp = await client.get(
            f"/api/v1/permissions/file/{file_id}",
            headers={"Authorization": f"Bearer {owner_token}"},
        )
        assert resp.status_code == 200
        perms = resp.json()
        assert any(p["subject_user_id"] == str(other.id) for p in perms)


@pytest.mark.asyncio
async def test_revoke_permission():
    """Owner revoca permesso — utente non può più accedere."""
    from app.config import get_settings
    get_settings.cache_clear()

    owner, owner_token = await _make_user_and_token(_unique_email("owner_rev"))
    other, other_token = await _make_user_and_token(_unique_email("other_rev"))

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        get_settings.cache_clear()
        file_id = await _upload_file(client, owner_token, b"content")

        resp = await client.post(
            "/api/v1/permissions/",
            headers={"Authorization": f"Bearer {owner_token}"},
            json={
                "subject_user_id": str(other.id),
                "resource_file_id": file_id,
                "level": "read",
            },
        )
        assert resp.status_code == 201
        perm_id = resp.json()["id"]

        resp = await client.delete(
            f"/api/v1/permissions/{perm_id}",
            headers={"Authorization": f"Bearer {owner_token}"},
        )
        assert resp.status_code == 204

        resp = await client.get(
            f"/api/v1/files/{file_id}/download",
            headers={"Authorization": f"Bearer {other_token}"},
        )
        assert resp.status_code == 403


@pytest.mark.asyncio
async def test_grant_requires_ownership():
    """Utente senza ownership non può concedere permessi."""
    from app.config import get_settings
    get_settings.cache_clear()

    owner, owner_token = await _make_user_and_token(_unique_email("own"))
    stranger, stranger_token = await _make_user_and_token(_unique_email("str"))
    victim, _ = await _make_user_and_token(_unique_email("vic"))

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        get_settings.cache_clear()
        file_id = await _upload_file(client, owner_token, b"content")
        get_settings.cache_clear()
        resp = await client.post(
            "/api/v1/permissions/",
            headers={"Authorization": f"Bearer {stranger_token}"},
            json={
                "subject_user_id": str(victim.id),
                "resource_file_id": file_id,
                "level": "read",
            },
        )
        assert resp.status_code == 403
