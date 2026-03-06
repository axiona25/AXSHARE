"""Test integrazione Fase 5 completa."""

import uuid as uuid_mod
from datetime import datetime, timezone, timedelta

import pytest
from httpx import AsyncClient, ASGITransport

from app.api.v1.endpoints.files import FileUploadMetadata
from app.crypto.aes import AESCipher
from app.database import AsyncSessionLocal
from app.main import app
from app.models.user import User, UserRole
from app.services.audit_service import AuditService
from app.services.auth_service import auth_service


def _unique_email(prefix: str = "f5") -> str:
    return f"{prefix}_{uuid_mod.uuid4().hex[:10]}@test.com"


async def _user_and_token(email: str):
    """Crea utente e restituisce (user, token)."""
    async with AsyncSessionLocal() as db:
        u = User(
            email=email,
            display_name_encrypted="t",
            role=UserRole.USER,
            is_active=True,
        )
        db.add(u)
        await db.commit()
        await db.refresh(u)
        token = auth_service.create_access_token(u.id, u.role.value)
        return u, token


async def _upload_file(client: AsyncClient, token: str, content: bytes):
    """Upload un file e restituisce file_id."""
    import base64
    import hashlib

    key = AESCipher.generate_key()
    file_id_hint = "phase5-full"
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
async def test_full_share_revoke_audit_flow():
    """
    Flusso completo Fase 5:
    1. Owner carica file
    2. Concede permesso con TTL
    3. Destinatario scarica
    4. Owner revoca
    5. Destinatario non può più scaricare
    6. Audit log registra tutto (catena integra)
    """
    from app.config import get_settings

    get_settings.cache_clear()

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        owner, owner_token = await _user_and_token(_unique_email("f5_own"))
        other, other_token = await _user_and_token(_unique_email("f5_oth"))

        get_settings.cache_clear()
        file_id = await _upload_file(client, owner_token, b"phase5 content")

        future = (
            datetime.now(timezone.utc) + timedelta(hours=1)
        ).isoformat()
        get_settings.cache_clear()
        resp = await client.post(
            "/api/v1/permissions/",
            headers={"Authorization": f"Bearer {owner_token}"},
            json={
                "subject_user_id": str(other.id),
                "resource_file_id": file_id,
                "level": "read",
                "resource_key_encrypted": "enc_key",
                "expires_at": future,
            },
        )
        assert resp.status_code == 201
        perm_id = resp.json()["id"]

        get_settings.cache_clear()
        resp = await client.get(
            f"/api/v1/files/{file_id}/download",
            headers={"Authorization": f"Bearer {other_token}"},
        )
        assert resp.status_code == 200

        get_settings.cache_clear()
        resp = await client.delete(
            f"/api/v1/permissions/{perm_id}",
            headers={"Authorization": f"Bearer {owner_token}"},
        )
        assert resp.status_code == 204

        get_settings.cache_clear()
        resp = await client.get(
            f"/api/v1/files/{file_id}/download",
            headers={"Authorization": f"Bearer {other_token}"},
        )
        assert resp.status_code == 403

        async with AsyncSessionLocal() as db:
            chain = await AuditService.verify_chain(db)
            assert chain["valid"] is True
