"""Test condivisione gruppo — TASK 5.3."""

import uuid as uuid_mod

import pytest
from httpx import AsyncClient, ASGITransport

from app.api.v1.endpoints.files import FileUploadMetadata
from app.crypto.aes import AESCipher
from app.database import AsyncSessionLocal
from app.main import app
from app.models.user import User, UserRole
from app.services.auth_service import auth_service


def _unique_email(prefix: str = "gs") -> str:
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


async def _upload_file(client: AsyncClient, token: str, content: bytes = b"group content"):
    """Upload un file e restituisce file_id."""
    import base64
    import hashlib

    key = AESCipher.generate_key()
    file_id_hint = "group-share-file"
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
async def test_share_file_with_group():
    """Owner condivide file con gruppo — tutti i membri ricevono permesso."""
    from app.config import get_settings

    get_settings.cache_clear()

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        owner, owner_token = await _make_user_and_token(_unique_email("gs_own"))
        member1, member1_token = await _make_user_and_token(_unique_email("gs_m1"))
        member2, member2_token = await _make_user_and_token(_unique_email("gs_m2"))

        get_settings.cache_clear()
        resp = await client.post(
            "/api/v1/groups/",
            headers={"Authorization": f"Bearer {owner_token}"},
            json={"name": "Test Group Share", "description": "test"},
        )
        assert resp.status_code == 200
        group_id = resp.json()["id"]

        for member in [member1, member2]:
            resp = await client.post(
                f"/api/v1/groups/{group_id}/members",
                headers={"Authorization": f"Bearer {owner_token}"},
                json={
                    "user_id": str(member.id),
                    "encrypted_group_key": "enc_key_placeholder",
                },
            )
            assert resp.status_code == 200

        get_settings.cache_clear()
        file_id = await _upload_file(client, owner_token, b"group content")

        get_settings.cache_clear()
        resp = await client.post(
            f"/api/v1/files/{file_id}/share-group",
            headers={"Authorization": f"Bearer {owner_token}"},
            json={
                "group_id": group_id,
                "file_key_encrypted_for_group": "group_encrypted_file_key",
                "level": "read",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["shared_with"] == 2

        for token in [member1_token, member2_token]:
            get_settings.cache_clear()
            resp = await client.get(
                f"/api/v1/files/{file_id}/download",
                headers={"Authorization": f"Bearer {token}"},
            )
            assert resp.status_code == 200


@pytest.mark.asyncio
async def test_revoke_group_access():
    """Owner revoca accesso gruppo — i membri non possono più scaricare."""
    from app.config import get_settings

    get_settings.cache_clear()

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        owner, owner_token = await _make_user_and_token(_unique_email("gr_own"))
        member, member_token = await _make_user_and_token(_unique_email("gr_mem"))

        get_settings.cache_clear()
        resp = await client.post(
            "/api/v1/groups/",
            headers={"Authorization": f"Bearer {owner_token}"},
            json={"name": "Revoke Group", "description": "test"},
        )
        assert resp.status_code == 200
        group_id = resp.json()["id"]

        await client.post(
            f"/api/v1/groups/{group_id}/members",
            headers={"Authorization": f"Bearer {owner_token}"},
            json={"user_id": str(member.id), "encrypted_group_key": "key"},
        )

        get_settings.cache_clear()
        file_id = await _upload_file(client, owner_token, b"content")

        get_settings.cache_clear()
        await client.post(
            f"/api/v1/files/{file_id}/share-group",
            headers={"Authorization": f"Bearer {owner_token}"},
            json={
                "group_id": group_id,
                "file_key_encrypted_for_group": "key",
                "level": "read",
            },
        )

        get_settings.cache_clear()
        resp = await client.get(
            f"/api/v1/files/{file_id}/download",
            headers={"Authorization": f"Bearer {member_token}"},
        )
        assert resp.status_code == 200

        get_settings.cache_clear()
        resp = await client.delete(
            f"/api/v1/files/{file_id}/share-group/{group_id}",
            headers={"Authorization": f"Bearer {owner_token}"},
        )
        assert resp.status_code == 200
        assert resp.json()["revoked"] == 1

        get_settings.cache_clear()
        resp = await client.get(
            f"/api/v1/files/{file_id}/download",
            headers={"Authorization": f"Bearer {member_token}"},
        )
        assert resp.status_code == 403
