"""Test TTL permessi — TASK 5.2."""

import uuid as uuid_mod
from datetime import datetime, timezone, timedelta

import pytest
from httpx import AsyncClient, ASGITransport

from app.api.v1.endpoints.files import FileUploadMetadata
from app.crypto.aes import AESCipher
from app.database import AsyncSessionLocal
from app.main import app
from app.models.permission import Permission, PermissionLevel
from app.models.user import User, UserRole
from app.services.auth_service import auth_service


def _unique_email(prefix: str = "ttl") -> str:
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
    import base64
    import hashlib

    key = AESCipher.generate_key()
    file_id_hint = "ttl-file"
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
async def test_permission_expires_automatically():
    """Permesso con TTL passato viene invalidato dal check (check_permission)."""
    from app.config import get_settings

    get_settings.cache_clear()

    owner, owner_token = await _make_user_and_token(_unique_email("owner_ttl"))
    other, other_token = await _make_user_and_token(_unique_email("other_ttl"))

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        get_settings.cache_clear()
        file_id = await _upload_file(client, owner_token, b"content")

        # Permesso già scaduto (1 secondo fa)
        expired_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        async with AsyncSessionLocal() as db:
            perm = Permission(
                subject_user_id=other.id,
                resource_file_id=uuid_mod.UUID(file_id),
                level=PermissionLevel.READ,
                granted_by_id=owner.id,
                expires_at=expired_at,
                is_active=True,
            )
            db.add(perm)
            await db.commit()

        get_settings.cache_clear()
        resp = await client.get(
            f"/api/v1/files/{file_id}/download",
            headers={"Authorization": f"Bearer {other_token}"},
        )
        assert resp.status_code == 403


@pytest.mark.asyncio
async def test_permission_valid_before_expiry():
    """Permesso con TTL futuro è ancora valido."""
    from app.config import get_settings

    get_settings.cache_clear()

    owner, owner_token = await _make_user_and_token(_unique_email("own_ttl2"))
    other, other_token = await _make_user_and_token(_unique_email("oth_ttl2"))

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        get_settings.cache_clear()
        file_id = await _upload_file(client, owner_token, b"valid content")

        future_at = datetime.now(timezone.utc) + timedelta(hours=1)
        async with AsyncSessionLocal() as db:
            perm = Permission(
                subject_user_id=other.id,
                resource_file_id=uuid_mod.UUID(file_id),
                level=PermissionLevel.READ,
                granted_by_id=owner.id,
                expires_at=future_at,
                is_active=True,
            )
            db.add(perm)
            await db.commit()

        get_settings.cache_clear()
        resp = await client.get(
            f"/api/v1/files/{file_id}/download",
            headers={"Authorization": f"Bearer {other_token}"},
        )
        assert resp.status_code == 200


@pytest.mark.asyncio
async def test_expire_permissions_task():
    """Il task Celery (async) invalida i permessi scaduti nel DB."""
    from app.config import get_settings
    from app.tasks.permission_tasks import _expire_permissions_async

    get_settings.cache_clear()

    owner, _ = await _make_user_and_token(_unique_email("own_task"))
    other, _ = await _make_user_and_token(_unique_email("oth_task"))

    # Permesso scaduto nel DB (senza resource file per test isolato)
    async with AsyncSessionLocal() as db:
        perm = Permission(
            subject_user_id=other.id,
            resource_file_id=None,
            resource_folder_id=None,
            level=PermissionLevel.READ,
            granted_by_id=owner.id,
            expires_at=datetime.now(timezone.utc) - timedelta(hours=1),
            is_active=True,
        )
        db.add(perm)
        await db.commit()
        perm_id = perm.id

    result = await _expire_permissions_async()
    assert result["expired"] >= 1

    async with AsyncSessionLocal() as db:
        p = await db.get(Permission, perm_id)
        assert p is not None
        assert p.is_active is False
