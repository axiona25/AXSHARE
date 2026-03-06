"""Test audit log centralizzato: query, filtri, export CSV — TASK 11.1."""

import uuid as uuid_mod

import pytest
from httpx import ASGITransport, AsyncClient

from app.config import get_settings
from app.core.audit_actions import AuditAction
from app.database import AsyncSessionLocal
from app.main import app
from app.models.user import User, UserRole
from app.services.audit_service import AuditService


async def _create_user_and_token():
    async with AsyncSessionLocal() as session:
        user = User(
            email=f"audit11_{uuid_mod.uuid4().hex[:12]}@example.com",
            display_name_encrypted="Audit Test",
            role=UserRole.USER,
            is_active=True,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        from app.services.auth_service import auth_service
        token = auth_service.create_access_token(user.id, user.role.value)
        return token, str(user.id)


@pytest.mark.asyncio
async def test_audit_log_written_on_upload():
    """Upload file scrive entry nel log; GET /audit/logs lo restituisce."""
    get_settings()
    token, user_id = await _create_user_and_token()

    from app.api.v1.endpoints.files import FileUploadMetadata
    from app.crypto.aes import AESCipher
    import base64

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        dek = AESCipher.generate_key()
        original = b"audit test content"
        encrypted = AESCipher.encrypt_file_chunked(original, dek, "audit-test")
        iv = encrypted[:12].hex()
        content_hash = __import__("hashlib").sha256(original).hexdigest()
        meta = FileUploadMetadata(
            name_encrypted="audit-test.bin.enc",
            mime_type_encrypted="application/octet-stream",
            file_key_encrypted=base64.b64encode(dek).decode("utf-8"),
            encryption_iv=iv,
            content_hash=content_hash,
            folder_id=None,
            size_original=len(original),
        )
        r = await client.post(
            "/api/v1/files/upload",
            headers={"Authorization": f"Bearer {token}"},
            data={"metadata": meta.model_dump_json()},
            files={"file": ("f.bin", encrypted, "application/octet-stream")},
        )
        assert r.status_code == 200

        resp = await client.get(
            "/api/v1/audit/logs",
            params={"action": "file.upload"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] >= 1
        actions = [item["action"] for item in data["items"]]
        assert "file.upload" in actions


@pytest.mark.asyncio
async def test_audit_log_query_filters():
    """Query audit con filtri action e outcome."""
    get_settings()
    token, user_id = await _create_user_and_token()

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        async with AsyncSessionLocal() as db:
            await AuditService.log_event(
                db=db,
                action=AuditAction.FILE_UPLOAD,
                actor_id=uuid_mod.UUID(user_id),
                actor_email="audit_filter@example.com",
                resource_type="file",
                resource_id=user_id,
                outcome="success",
            )

        resp = await client.get(
            "/api/v1/audit/logs",
            params={"action": "file.upload", "outcome": "success"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        assert resp.json()["total"] >= 1


@pytest.mark.asyncio
async def test_audit_csv_export():
    """Export CSV restituisce file con header corretti."""
    get_settings()
    token, _ = await _create_user_and_token()

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        resp = await client.get(
            "/api/v1/audit/logs/export/csv",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        assert "text/csv" in resp.headers.get("content-type", "")
        content = resp.text
        assert "action" in content
        assert "actor_email" in content
