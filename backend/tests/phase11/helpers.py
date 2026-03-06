"""Helper per test E2E Fase 11: creazione utente, upload file."""

import base64
import uuid as uuid_mod

from httpx import AsyncClient

from app.api.v1.endpoints.files import FileUploadMetadata
from app.crypto.aes import AESCipher
from app.database import AsyncSessionLocal
from app.models.user import User, UserRole
from app.services.auth_service import auth_service


def _unique_email(prefix: str = "phase11") -> str:
    return f"{prefix}-{uuid_mod.uuid4().hex[:12]}@example.com"


async def create_user_and_token():
    """Crea utente in DB e restituisce (token, user_id)."""
    async with AsyncSessionLocal() as session:
        user = User(
            email=_unique_email("phase11"),
            display_name_encrypted="Phase11 E2E",
            role=UserRole.USER,
            is_active=True,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        token = auth_service.create_access_token(user.id, user.role.value)
        return token, str(user.id)


async def upload_test_file(client: AsyncClient, token: str) -> str:
    """Carica file di test, restituisce file_id."""
    dek = AESCipher.generate_key()
    original = b"test content for phase11 e2e"
    file_id_str = "phase11-e2e-id"
    encrypted = AESCipher.encrypt_file_chunked(original, dek, file_id_str)
    encryption_iv = encrypted[:12].hex()
    content_hash = __import__("hashlib").sha256(original).hexdigest()
    metadata = FileUploadMetadata(
        name_encrypted="phase11-e2e.bin.enc",
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
