"""Test self-destruct — TASK 5.4."""

import uuid as uuid_mod
from datetime import datetime, timezone, timedelta

import pytest
from httpx import AsyncClient, ASGITransport

from app.api.v1.endpoints.files import FileUploadMetadata
from app.crypto.aes import AESCipher
from app.database import AsyncSessionLocal
from app.main import app
from app.models.file import File
from app.models.user import User, UserRole
from app.services.auth_service import auth_service


def _unique_email(prefix: str = "sd") -> str:
    return f"{prefix}_{uuid_mod.uuid4().hex[:10]}@test.com"


async def _make_user_and_token(email: str):
    """Crea utente e restituisce (user, token)."""
    async with AsyncSessionLocal() as db:
        user = User(
            email=email,
            display_name_encrypted="t",
            role=UserRole.USER,
            is_active=True,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
        token = auth_service.create_access_token(user.id, user.role.value)
        return user, token


async def _upload(
    client: AsyncClient, token: str, content: bytes = b"destruct me"
):
    """Upload un file e restituisce file_id."""
    import base64
    import hashlib

    key = AESCipher.generate_key()
    file_id_hint = "self-destruct-file"
    encrypted = AESCipher.encrypt_file_chunked(content, key, file_id_hint)
    iv_hex = encrypted[:12].hex()
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
async def test_self_destruct_after_n_downloads():
    """File si distrugge dopo N download."""
    from app.config import get_settings

    get_settings.cache_clear()

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        owner, token = await _make_user_and_token(_unique_email("sd_n"))
        get_settings.cache_clear()
        file_id = await _upload(client, token, b"destruct me")

        get_settings.cache_clear()
        resp = await client.post(
            f"/api/v1/files/{file_id}/self-destruct",
            headers={"Authorization": f"Bearer {token}"},
            json={"after_downloads": 2},
        )
        assert resp.status_code == 200

        get_settings.cache_clear()
        resp = await client.get(
            f"/api/v1/files/{file_id}/download",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200

        get_settings.cache_clear()
        resp = await client.get(
            f"/api/v1/files/{file_id}/download",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code in (200, 410)

        get_settings.cache_clear()
        resp = await client.get(
            f"/api/v1/files/{file_id}/download",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 410


@pytest.mark.asyncio
async def test_manual_destroy():
    """Owner distrugge file manualmente — file non più accessibile."""
    from app.config import get_settings

    get_settings.cache_clear()

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        owner, token = await _make_user_and_token(_unique_email("sd_m"))
        get_settings.cache_clear()
        file_id = await _upload(client, token, b"destruct me")
        get_settings.cache_clear()

        get_settings.cache_clear()
        resp = await client.delete(
            f"/api/v1/files/{file_id}/destroy",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        assert resp.json()["destroyed"] is True

        get_settings.cache_clear()
        resp = await client.get(
            f"/api/v1/files/{file_id}/download",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 410


@pytest.mark.asyncio
async def test_destroy_expired_files_task():
    """Il task Celery distrugge file con self_destruct_at passata."""
    from app.config import get_settings
    from app.tasks.destruct_tasks import _destroy_expired_files_async

    get_settings.cache_clear()

    owner, token = await _make_user_and_token(_unique_email("sd_t"))

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        get_settings.cache_clear()
        file_id = await _upload(client, token, b"destruct me")

    past = datetime.now(timezone.utc) - timedelta(hours=1)
    async with AsyncSessionLocal() as db:
        file = await db.get(File, uuid_mod.UUID(file_id))
        assert file is not None
        file.self_destruct_at = past
        await db.commit()

    result = await _destroy_expired_files_async()
    assert result["destroyed"] >= 1

    async with AsyncSessionLocal() as db:
        file = await db.get(File, uuid_mod.UUID(file_id))
        assert file is not None
        assert file.is_destroyed is True
