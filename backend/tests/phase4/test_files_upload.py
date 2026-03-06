"""Test upload file cifrato (chunked E2E) — TASK 4.1."""

import base64
import hashlib
import uuid as uuid_mod
import pytest
from httpx import ASGITransport, AsyncClient

from app.crypto.aes import AESCipher
from app.database import AsyncSessionLocal
from app.main import app
from app.models.user import User, UserRole
from app.services.auth_service import auth_service
from app.services.storage import get_storage_service


def _unique_email(prefix: str = "upload") -> str:
    return f"{prefix}-{uuid_mod.uuid4().hex[:12]}@example.com"


async def _create_test_user(email: str, role: UserRole = UserRole.USER):
    """Crea utente di test e restituisce (user, access_token)."""
    async with AsyncSessionLocal() as session:
        user = User(
            email=email,
            display_name_encrypted="Upload Test",
            role=role,
            is_active=True,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        token = auth_service.create_access_token(user.id, user.role.value)
        return user, token


@pytest.mark.asyncio
async def test_upload_encrypted_file():
    """Cifra file lato client, POST /files/upload → 200; su MinIO il contenuto è cifrato (≠ original)."""
    from app.api.v1.endpoints.files import FileUploadMetadata

    user, token = await _create_test_user(_unique_email("file"))
    dek = AESCipher.generate_key()
    original = b"Contenuto segreto del documento"
    file_id_str = "test-id"
    encrypted = AESCipher.encrypt_file_chunked(original, dek, file_id_str)

    # IV = primi 12 bytes (nonce) in hex; content_hash = SHA-256 del file originale
    encryption_iv = encrypted[:12].hex()
    content_hash = hashlib.sha256(original).hexdigest()
    metadata = FileUploadMetadata(
        name_encrypted="x.bin.enc",
        mime_type_encrypted="application/octet-stream",
        file_key_encrypted=base64.b64encode(dek).decode("utf-8"),
        encryption_iv=encryption_iv,
        content_hash=content_hash,
        folder_id=None,
        size_original=len(original),
    )

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        resp = await client.post(
            "/api/v1/files/upload",
            headers={"Authorization": f"Bearer {token}"},
            data={"metadata": metadata.model_dump_json()},
            files={"file": ("x.bin", encrypted, "application/octet-stream")},
        )

    assert resp.status_code == 200
    data = resp.json()
    assert "file_id" in data
    assert "storage_path" in data
    storage_path = data["storage_path"]

    # Verifica su MinIO: il blob salvato è cifrato, diverso dall'originale
    storage = get_storage_service()
    downloaded = await storage.download_encrypted_file(storage_path)
    assert downloaded != original
    assert downloaded == encrypted


@pytest.mark.asyncio
async def test_upload_requires_auth():
    """POST /files/upload senza JWT → 403."""
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        resp = await client.post(
            "/api/v1/files/upload",
            data={"metadata": "{}"},
            files={"file": ("x.bin", b"dummy", "application/octet-stream")},
        )
    assert resp.status_code == 403


# --- Download (TASK 4.2) ---


async def _upload_one_file(client, token: str, encrypted: bytes, metadata):
    """Helper: POST /files/upload e restituisce file_id."""
    resp = await client.post(
        "/api/v1/files/upload",
        headers={"Authorization": f"Bearer {token}"},
        data={"metadata": metadata.model_dump_json()},
        files={"file": ("x.bin", encrypted, "application/octet-stream")},
    )
    assert resp.status_code == 200
    return resp.json()["file_id"]


@pytest.mark.asyncio
async def test_download_returns_encrypted_bytes():
    """GET /files/{id}/download → 200 e body = bytes cifrati (non leggibili in chiaro)."""
    from app.api.v1.endpoints.files import FileUploadMetadata
    from app.config import get_settings
    get_settings.cache_clear()

    user, token = await _create_test_user(_unique_email("dl"))
    dek = AESCipher.generate_key()
    original = b"Segreto da scaricare"
    encrypted = AESCipher.encrypt_file_chunked(original, dek, "dl-id")
    iv_hex = encrypted[:12].hex()
    metadata = FileUploadMetadata(
        name_encrypted="dl.bin.enc",
        mime_type_encrypted="application/octet-stream",
        file_key_encrypted=base64.b64encode(dek).decode("utf-8"),
        encryption_iv=iv_hex,
        content_hash=hashlib.sha256(original).hexdigest(),
        folder_id=None,
        size_original=len(original),
    )
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        file_id = await _upload_one_file(client, token, encrypted, metadata)
        resp = await client.get(
            f"/api/v1/files/{file_id}/download",
            headers={"Authorization": f"Bearer {token}"},
        )
    assert resp.status_code == 200
    body = resp.content
    assert body != original
    assert body == encrypted
    assert resp.headers.get("x-file-iv") == iv_hex


@pytest.mark.asyncio
async def test_download_counter_increments():
    """Download incrementa download_count; due GET download → count 2."""
    from app.api.v1.endpoints.files import FileUploadMetadata
    from app.config import get_settings
    get_settings.cache_clear()

    user, token = await _create_test_user(_unique_email("counter"))
    dek = AESCipher.generate_key()
    encrypted = AESCipher.encrypt_file_chunked(b"x", dek, "c")
    metadata = FileUploadMetadata(
        name_encrypted="c.bin",
        mime_type_encrypted="application/octet-stream",
        file_key_encrypted=base64.b64encode(dek).decode("utf-8"),
        encryption_iv=encrypted[:12].hex(),
        content_hash=hashlib.sha256(b"x").hexdigest(),
        folder_id=None,
        size_original=1,
    )
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        file_id = await _upload_one_file(client, token, encrypted, metadata)
        # Primo download
        r1 = await client.get(
            f"/api/v1/files/{file_id}/download",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r1.status_code == 200
        # Metadati: non esponiamo download_count nell'API metadata attuale, verifichiamo due download
        r2 = await client.get(
            f"/api/v1/files/{file_id}/download",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r2.status_code == 200
        # Verifica count via GET metadata (se esponiamo count) o via DB
        meta = await client.get(
            f"/api/v1/files/{file_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
    assert meta.status_code == 200
    # Se l'endpoint metadata non restituisce download_count, controlliamo che i 2 download siano andati a buon fine
    # e che il file sia ancora scaricabile (count incrementato)
    from app.database import AsyncSessionLocal
    from app.models.file import File as FileModel
    from sqlalchemy import select

    async with AsyncSessionLocal() as session:
        res = await session.execute(
            select(FileModel).where(FileModel.id == uuid_mod.UUID(file_id))
        )
        f = res.scalar_one()
    assert f.download_count >= 2


@pytest.mark.asyncio
async def test_download_without_permission_fails():
    """GET /files/{id}/download da utente non owner e senza permission → 403."""
    from app.api.v1.endpoints.files import FileUploadMetadata
    from app.config import get_settings
    get_settings.cache_clear()

    owner, owner_token = await _create_test_user(_unique_email("owner"))
    other, other_token = await _create_test_user(_unique_email("other"))
    dek = AESCipher.generate_key()
    encrypted = AESCipher.encrypt_file_chunked(b"private", dek, "priv")
    metadata = FileUploadMetadata(
        name_encrypted="priv.bin",
        mime_type_encrypted="application/octet-stream",
        file_key_encrypted=base64.b64encode(dek).decode("utf-8"),
        encryption_iv=encrypted[:12].hex(),
        content_hash=hashlib.sha256(b"private").hexdigest(),
        folder_id=None,
        size_original=6,
    )
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        file_id = await _upload_one_file(client, owner_token, encrypted, metadata)
        resp = await client.get(
            f"/api/v1/files/{file_id}/download",
            headers={"Authorization": f"Bearer {other_token}"},
        )
    assert resp.status_code == 403


# --- Versioning (TASK 4.4) ---


@pytest.mark.asyncio
async def test_upload_3_versions():
    """Upload file poi due nuove versioni → version=3, list_versions con 2 snapshot (v1, v2)."""
    from app.api.v1.endpoints.files import FileUploadMetadata
    from app.config import get_settings
    get_settings.cache_clear()

    user, token = await _create_test_user(_unique_email("ver"))
    auth = {"Authorization": f"Bearer {token}"}
    dek1 = AESCipher.generate_key()
    content1 = b"version one"
    enc1 = AESCipher.encrypt_file_chunked(content1, dek1, "ver-id")
    meta1 = FileUploadMetadata(
        name_encrypted="v.bin",
        mime_type_encrypted="application/octet-stream",
        file_key_encrypted=base64.b64encode(dek1).decode("utf-8"),
        encryption_iv=enc1[:12].hex(),
        content_hash=hashlib.sha256(content1).hexdigest(),
        folder_id=None,
        size_original=len(content1),
    )
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        file_id = await _upload_one_file(client, token, enc1, meta1)
        # v2
        dek2 = AESCipher.generate_key()
        content2 = b"version two"
        enc2 = AESCipher.encrypt_file_chunked(content2, dek2, "ver-id")
        meta2 = FileUploadMetadata(
            name_encrypted="v.bin",
            mime_type_encrypted="application/octet-stream",
            file_key_encrypted=base64.b64encode(dek2).decode("utf-8"),
            encryption_iv=enc2[:12].hex(),
            content_hash=hashlib.sha256(content2).hexdigest(),
            folder_id=None,
            size_original=len(content2),
        )
        r2 = await client.post(
            f"/api/v1/files/{file_id}/version",
            headers=auth,
            data={"metadata": meta2.model_dump_json()},
            files={"file": ("v2.bin", enc2, "application/octet-stream")},
        )
        assert r2.status_code == 200
        assert r2.json()["version"] == 2
        # v3
        content3 = b"version three"
        enc3 = AESCipher.encrypt_file_chunked(content3, dek2, "ver-id")
        meta3 = FileUploadMetadata(
            name_encrypted="v.bin",
            mime_type_encrypted="application/octet-stream",
            file_key_encrypted=base64.b64encode(dek2).decode("utf-8"),
            encryption_iv=enc3[:12].hex(),
            content_hash=hashlib.sha256(content3).hexdigest(),
            folder_id=None,
            size_original=len(content3),
        )
        r3 = await client.post(
            f"/api/v1/files/{file_id}/version",
            headers=auth,
            data={"metadata": meta3.model_dump_json()},
            files={"file": ("v3.bin", enc3, "application/octet-stream")},
        )
        assert r3.status_code == 200
        assert r3.json()["version"] == 3
        # Lista versioni: 2 record (v1 e v2 salvati in FileVersion)
        list_r = await client.get(f"/api/v1/files/{file_id}/versions", headers=auth)
        assert list_r.status_code == 200
        versions = list_r.json()
        assert len(versions) == 2
        assert [v["version"] for v in versions] == [1, 2]


@pytest.mark.asyncio
async def test_restore_version_1():
    """Dopo 3 versioni, restore a v1 → il download restituisce il contenuto della v1."""
    from app.api.v1.endpoints.files import FileUploadMetadata
    from app.config import get_settings
    get_settings.cache_clear()

    user, token = await _create_test_user(_unique_email("restore"))
    auth = {"Authorization": f"Bearer {token}"}
    dek1 = AESCipher.generate_key()
    content1 = b"restore me"
    enc1 = AESCipher.encrypt_file_chunked(content1, dek1, "res-id")
    meta1 = FileUploadMetadata(
        name_encrypted="r.bin",
        mime_type_encrypted="application/octet-stream",
        file_key_encrypted=base64.b64encode(dek1).decode("utf-8"),
        encryption_iv=enc1[:12].hex(),
        content_hash=hashlib.sha256(content1).hexdigest(),
        folder_id=None,
        size_original=len(content1),
    )
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        file_id = await _upload_one_file(client, token, enc1, meta1)
        # v2
        content2 = b"second"
        enc2 = AESCipher.encrypt_file_chunked(content2, dek1, "res-id")
        meta2 = FileUploadMetadata(
            name_encrypted="r.bin",
            mime_type_encrypted="application/octet-stream",
            file_key_encrypted=base64.b64encode(dek1).decode("utf-8"),
            encryption_iv=enc2[:12].hex(),
            content_hash=hashlib.sha256(content2).hexdigest(),
            folder_id=None,
            size_original=len(content2),
        )
        await client.post(
            f"/api/v1/files/{file_id}/version",
            headers=auth,
            data={"metadata": meta2.model_dump_json()},
            files={"file": ("v2.bin", enc2, "application/octet-stream")},
        )
        # v3
        content3 = b"third"
        enc3 = AESCipher.encrypt_file_chunked(content3, dek1, "res-id")
        meta3 = FileUploadMetadata(
            name_encrypted="r.bin",
            mime_type_encrypted="application/octet-stream",
            file_key_encrypted=base64.b64encode(dek1).decode("utf-8"),
            encryption_iv=enc3[:12].hex(),
            content_hash=hashlib.sha256(content3).hexdigest(),
            folder_id=None,
            size_original=len(content3),
        )
        await client.post(
            f"/api/v1/files/{file_id}/version",
            headers=auth,
            data={"metadata": meta3.model_dump_json()},
            files={"file": ("v3.bin", enc3, "application/octet-stream")},
        )
        # Restore v1
        restore_r = await client.post(
            f"/api/v1/files/{file_id}/versions/1/restore",
            headers=auth,
        )
        assert restore_r.status_code == 200
        assert restore_r.json()["restored_version"] == 1
    # Download in nuovo contesto client per evitare 401 da cache JWT
    get_settings.cache_clear()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        dl = await client.get(
            f"/api/v1/files/{file_id}/download",
            headers={"Authorization": f"Bearer {token}"},
        )
    assert dl.status_code == 200
    assert dl.content == enc1
