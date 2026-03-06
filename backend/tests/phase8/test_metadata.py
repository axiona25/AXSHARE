"""Test metadati cifrati e tag (TASK 8.1)."""

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


def _unique_email(prefix: str = "meta") -> str:
    return f"{prefix}-{uuid_mod.uuid4().hex[:12]}@example.com"


@pytest.fixture(autouse=True)
def clear_cache():
    from app.config import get_settings
    get_settings.cache_clear()


async def _create_user_and_token():
    """Crea utente di test e restituisce (token, user_id)."""
    async with AsyncSessionLocal() as session:
        user = User(
            email=_unique_email("meta"),
            display_name_encrypted="Meta Test",
            role=UserRole.USER,
            is_active=True,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        token = auth_service.create_access_token(user.id, user.role.value)
        return token, str(user.id)


async def _upload_test_file(client: AsyncClient, token: str) -> str:
    """Carica un file di test e restituisce file_id."""
    dek = AESCipher.generate_key()
    original = b"test content for metadata"
    file_id_str = "meta-test-id"
    encrypted = AESCipher.encrypt_file_chunked(original, dek, file_id_str)
    encryption_iv = encrypted[:12].hex()
    content_hash = __import__("hashlib").sha256(original).hexdigest()
    metadata = FileUploadMetadata(
        name_encrypted="meta-test.bin.enc",
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
async def test_upsert_and_get_metadata():
    """Owner aggiunge metadati cifrati al file e li recupera."""
    from app.config import get_settings
    get_settings.cache_clear()
    token, _user_id = await _create_user_and_token()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        file_id = await _upload_test_file(client, token)

        from app.config import get_settings
        get_settings.cache_clear()
        resp = await client.put(
            f"/api/v1/files/{file_id}/metadata",
            json={
                "description_encrypted": "enc_descrizione",
                "notes_encrypted": "enc_note",
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["description_encrypted"] == "enc_descrizione"

        resp2 = await client.get(
            f"/api/v1/files/{file_id}/metadata",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp2.status_code == 200
        assert resp2.json()["notes_encrypted"] == "enc_note"


@pytest.mark.asyncio
async def test_add_list_remove_tags():
    """Owner aggiunge tag, li lista, li rimuove."""
    from app.config import get_settings
    get_settings.cache_clear()
    token, _user_id = await _create_user_and_token()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        file_id = await _upload_test_file(client, token)

        for tag in ["importante", "progetto-alpha"]:
            resp = await client.post(
                f"/api/v1/files/{file_id}/tags",
                json={"tag": tag},
                headers={"Authorization": f"Bearer {token}"},
            )
            assert resp.status_code == 201

        resp = await client.get(
            f"/api/v1/files/{file_id}/tags",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        tags = [t["tag"] for t in resp.json()]
        assert "importante" in tags
        assert "progetto-alpha" in tags

        resp = await client.delete(
            f"/api/v1/files/{file_id}/tags/importante",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 204


@pytest.mark.asyncio
async def test_starred_and_color_label():
    """Owner imposta starred e color_label sul file."""
    from app.config import get_settings
    get_settings.cache_clear()
    token, _user_id = await _create_user_and_token()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        file_id = await _upload_test_file(client, token)

        from app.config import get_settings
        get_settings.cache_clear()
        resp = await client.patch(
            f"/api/v1/files/{file_id}/labels",
            json={"is_starred": True, "color_label": "red"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["is_starred"] is True
        assert data["color_label"] == "red"


@pytest.mark.asyncio
async def test_upload_and_get_thumbnail():
    """Owner carica thumbnail cifrata e la recupera (TASK 8.3)."""
    from app.config import get_settings
    get_settings.cache_clear()
    token, _ = await _create_user_and_token()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        file_id = await _upload_test_file(client, token)

        resp = await client.put(
            f"/api/v1/files/{file_id}/thumbnail",
            json={
                "thumbnail_encrypted": "base64_encrypted_thumb",
                "thumbnail_key_encrypted": "rsa_encrypted_key",
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        assert resp.json()["thumbnail"] == "uploaded"

        resp2 = await client.get(
            f"/api/v1/files/{file_id}/thumbnail",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp2.status_code == 200
        data = resp2.json()
        assert data["thumbnail_encrypted"] == "base64_encrypted_thumb"
        assert data["thumbnail_key_encrypted"] == "rsa_encrypted_key"
