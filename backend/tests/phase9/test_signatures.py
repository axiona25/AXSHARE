"""Test firma digitale file (RSA-PSS) — TASK 9.1."""

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


def _unique_email(prefix: str = "sig") -> str:
    return f"{prefix}-{uuid_mod.uuid4().hex[:12]}@example.com"


@pytest.fixture(autouse=True)
def clear_cache():
    from app.config import get_settings
    get_settings.cache_clear()


async def _create_user_and_token():
    async with AsyncSessionLocal() as session:
        user = User(
            email=_unique_email("sig"),
            display_name_encrypted="Sig Test",
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
    original = b"test content for signature"
    file_id_str = "sig-test-id"
    encrypted = AESCipher.encrypt_file_chunked(original, dek, file_id_str)
    encryption_iv = encrypted[:12].hex()
    content_hash = __import__("hashlib").sha256(original).hexdigest()
    metadata = FileUploadMetadata(
        name_encrypted="sig-test.bin.enc",
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
async def test_sign_file():
    """Owner firma un file e la firma viene salvata."""
    from app.config import get_settings
    get_settings.cache_clear()
    token, _ = await _create_user_and_token()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        file_id = await _upload_test_file(client, token)
        resp = await client.post(
            f"/api/v1/files/{file_id}/sign",
            json={
                "version": 1,
                "signature_b64": "dGVzdF9zaWduYXR1cmVfYmFzZTY0",
                "file_hash_sha256": "a" * 64,
                "public_key_pem_snapshot": "-----BEGIN PUBLIC KEY-----\ntest\n-----END PUBLIC KEY-----",
                "algorithm": "RSA-PSS-SHA256",
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["file_id"] == file_id
        assert data["version"] == 1
        assert data["is_valid"] is None


@pytest.mark.asyncio
async def test_list_signatures():
    """Lista firme di un file."""
    from app.config import get_settings
    get_settings.cache_clear()
    token, _ = await _create_user_and_token()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        file_id = await _upload_test_file(client, token)
        await client.post(
            f"/api/v1/files/{file_id}/sign",
            json={
                "version": 1,
                "signature_b64": "c2lnX3Rlc3Q=",
                "file_hash_sha256": "b" * 64,
                "public_key_pem_snapshot": "-----BEGIN PUBLIC KEY-----\ntest\n-----END PUBLIC KEY-----",
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        resp = await client.get(
            f"/api/v1/files/{file_id}/signatures",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        assert len(resp.json()) == 1


@pytest.mark.asyncio
async def test_duplicate_signature_rejected():
    """Doppia firma sulla stessa versione restituisce 409."""
    from app.config import get_settings
    get_settings.cache_clear()
    token, _ = await _create_user_and_token()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        file_id = await _upload_test_file(client, token)
        payload = {
            "version": 1,
            "signature_b64": "c2lnX3Rlc3Q=",
            "file_hash_sha256": "c" * 64,
            "public_key_pem_snapshot": "-----BEGIN PUBLIC KEY-----\ntest\n-----END PUBLIC KEY-----",
        }
        await client.post(
            f"/api/v1/files/{file_id}/sign",
            json=payload,
            headers={"Authorization": f"Bearer {token}"},
        )
        resp = await client.post(
            f"/api/v1/files/{file_id}/sign",
            json=payload,
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 409
