"""
Test E2E Fase 9 — Firma Digitale con chiavi RSA-PSS reali.

Flusso:
1. Genera keypair RSA-PSS in Python (simula il client)
2. Registra chiave pubblica firma sul server
3. Upload file
4. Calcola hash del file cifrato + firma con chiave privata
5. Upload firma al server
6. Verifica server-side → is_valid: True
7. Verifica con payload manomesso → is_valid: False
"""

import base64
import hashlib
import uuid as uuid_mod

import pytest
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from httpx import ASGITransport, AsyncClient

from app.api.v1.endpoints.files import FileUploadMetadata
from app.crypto.aes import AESCipher
from app.database import AsyncSessionLocal
from app.main import app
from app.models.user import User, UserRole
from app.services.auth_service import auth_service
from app.services.signature_service import SignatureService


# ─── Helpers ──────────────────────────────────────────────────────────────────


def generate_rsa_pss_keypair():
    """Genera keypair RSA-PSS 2048-bit per i test."""
    private_key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=2048,
        backend=default_backend(),
    )
    public_key = private_key.public_key()
    pub_pem = public_key.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()
    return private_key, pub_pem


def sign_payload_rsa_pss(private_key, payload_bytes: bytes) -> str:
    """Firma payload con RSA-PSS SHA-256, restituisce base64."""
    signature = private_key.sign(
        payload_bytes,
        padding.PSS(
            mgf=padding.MGF1(hashes.SHA256()),
            salt_length=32,
        ),
        hashes.SHA256(),
    )
    return base64.b64encode(signature).decode()


async def _create_user_and_token():
    """Crea utente in DB e restituisce (token, user_id)."""
    async with AsyncSessionLocal() as session:
        user = User(
            email=f"phase9-{uuid_mod.uuid4().hex[:12]}@example.com",
            display_name_encrypted="Phase9 E2E",
            role=UserRole.USER,
            is_active=True,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        token = auth_service.create_access_token(user.id, user.role.value)
        return token, str(user.id)


async def _upload_test_file_returning_encrypted(client: AsyncClient, token: str):
    """Carica file di test, restituisce (file_id, encrypted_bytes)."""
    dek = AESCipher.generate_key()
    original = b"test content for phase9 e2e signature"
    file_id_str = "phase9-e2e-id"
    encrypted = AESCipher.encrypt_file_chunked(original, dek, file_id_str)
    encryption_iv = encrypted[:12].hex()
    content_hash = hashlib.sha256(original).hexdigest()
    metadata = FileUploadMetadata(
        name_encrypted="phase9-e2e.bin.enc",
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
    return resp.json()["file_id"], encrypted


# ─── Test ─────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_full_sign_and_verify_flow():
    """
    Flusso completo E2E:
    genera keypair → registra → firma → upload firma → verifica server → True
    """
    from app.config import get_settings
    get_settings.cache_clear()
    token, user_id = await _create_user_and_token()
    get_settings.cache_clear()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        headers = {"Authorization": f"Bearer {token}"}

        private_key, pub_pem = generate_rsa_pss_keypair()

        resp = await client.post(
            "/api/v1/users/me/signing-key",
            json={"signing_public_key_pem": pub_pem},
            headers=headers,
        )
        assert resp.status_code == 200

        file_id, encrypted_bytes = await _upload_test_file_returning_encrypted(
            client, token
        )

        file_hash = hashlib.sha256(encrypted_bytes).hexdigest()
        version = 1
        payload = f"{file_hash}:{file_id}:{version}".encode("utf-8")
        signature_b64 = sign_payload_rsa_pss(private_key, payload)

        resp = await client.post(
            f"/api/v1/files/{file_id}/sign",
            json={
                "version": version,
                "signature_b64": signature_b64,
                "file_hash_sha256": file_hash,
                "public_key_pem_snapshot": pub_pem,
                "algorithm": "RSA-PSS-SHA256",
            },
            headers=headers,
        )
        assert resp.status_code == 201, f"Sign failed: {resp.text}"
        sig_data = resp.json()
        assert sig_data["is_valid"] is None

        resp = await client.post(
            f"/api/v1/files/{file_id}/verify/{version}",
            headers=headers,
        )
        assert resp.status_code == 200
        verify_data = resp.json()
        assert verify_data["is_valid"] is True, (
            f"Verifica fallita: {verify_data.get('message', '')}"
        )

        resp = await client.get(
            f"/api/v1/files/{file_id}/signatures",
            headers=headers,
        )
        assert resp.status_code == 200
        sigs = resp.json()
        assert len(sigs) == 1
        assert sigs[0]["is_valid"] is True
        assert sigs[0]["verified_at"] is not None


@pytest.mark.asyncio
async def test_tampered_signature_fails_verification():
    """Firma manomessa deve fallire la verifica."""
    from app.config import get_settings
    get_settings.cache_clear()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        token, _ = await _create_user_and_token()
        headers = {"Authorization": f"Bearer {token}"}

        private_key, pub_pem = generate_rsa_pss_keypair()
        file_id, encrypted_bytes = await _upload_test_file_returning_encrypted(
            client, token
        )
        file_hash = hashlib.sha256(encrypted_bytes).hexdigest()
        version = 1
        payload = f"{file_hash}:{file_id}:{version}".encode("utf-8")
        sig_b64 = sign_payload_rsa_pss(private_key, payload)

        wrong_hash = "f" * 64
        await client.post(
            f"/api/v1/files/{file_id}/sign",
            json={
                "version": version,
                "signature_b64": sig_b64,
                "file_hash_sha256": wrong_hash,
                "public_key_pem_snapshot": pub_pem,
            },
            headers=headers,
        )

        resp = await client.post(
            f"/api/v1/files/{file_id}/verify/{version}",
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["is_valid"] is False


def test_signature_service_unit():
    """Test unitario SignatureService.verify_rsa_pss."""
    private_key, pub_pem = generate_rsa_pss_keypair()
    file_id = "test-file-id"
    version = 1
    file_hash = "a" * 64
    payload = f"{file_hash}:{file_id}:{version}".encode("utf-8")
    sig_b64 = sign_payload_rsa_pss(private_key, payload)

    result = SignatureService.verify_rsa_pss(
        signature_b64=sig_b64,
        file_hash_sha256=file_hash,
        file_id=file_id,
        version=version,
        public_key_pem=pub_pem,
    )
    assert result is True

    result_wrong = SignatureService.verify_rsa_pss(
        signature_b64=sig_b64,
        file_hash_sha256="b" * 64,
        file_id=file_id,
        version=version,
        public_key_pem=pub_pem,
    )
    assert result_wrong is False


@pytest.mark.asyncio
async def test_verify_nonexistent_signature():
    """Verifica di firma inesistente restituisce 404."""
    from app.config import get_settings
    get_settings.cache_clear()
    token, _ = await _create_user_and_token()
    get_settings.cache_clear()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        file_id, _ = await _upload_test_file_returning_encrypted(client, token)

        resp = await client.post(
            f"/api/v1/files/{file_id}/verify/99",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 404


@pytest.mark.asyncio
async def test_file_is_signed_flag():
    """Flag is_signed sul file viene impostato dopo la firma; ricerca per is_signed."""
    from app.config import get_settings
    get_settings.cache_clear()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        token, _ = await _create_user_and_token()
        headers = {"Authorization": f"Bearer {token}"}
        private_key, pub_pem = generate_rsa_pss_keypair()
        file_id, encrypted_bytes = await _upload_test_file_returning_encrypted(
            client, token
        )

        file_hash = hashlib.sha256(encrypted_bytes).hexdigest()
        payload = f"{file_hash}:{file_id}:1".encode("utf-8")
        sig_b64 = sign_payload_rsa_pss(private_key, payload)

        await client.post(
            f"/api/v1/files/{file_id}/sign",
            json={
                "version": 1,
                "signature_b64": sig_b64,
                "file_hash_sha256": file_hash,
                "public_key_pem_snapshot": pub_pem,
            },
            headers=headers,
        )

        resp = await client.get(
            "/api/v1/search/files",
            params={"is_signed": "true"},
            headers=headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] >= 1
        ids = [item["id"] for item in data["items"]]
        assert file_id in ids
