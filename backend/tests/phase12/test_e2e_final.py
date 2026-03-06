"""
TEST E2E FINALE — Flusso utente completo AXSHARE

Simula il ciclo di vita:
1. Utente (helper) + upload file cifrato
2. Metadati e tag
3. Chiave firma + firma digitale (RSA-PSS) + verifica
4. Share link pubblico + download via link
5. Share link con password + verifica wrong/correct
6. Invito guest + riscatto
7. Revoca link → 410
8. Dashboard + audit log
9. Export GDPR + consenso + richiesta erasure
10. Health check
"""

import hashlib
import base64
import os
import uuid as uuid_mod
import pytest
from httpx import ASGITransport, AsyncClient
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.backends import default_backend

from app.main import app
from app.services.auth_service import auth_service

from tests.phase12.helpers import create_user_and_token


def _get_settings():
    get_settings = __import__("app.config", fromlist=["get_settings"]).get_settings
    get_settings()


def _gen_rsa_pss_keypair():
    priv = rsa.generate_private_key(65537, 2048, default_backend())
    pub = priv.public_key().public_bytes(
        serialization.Encoding.PEM,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()
    return priv, pub


def _sign_rsa_pss(priv_key, payload: bytes) -> str:
    sig = priv_key.sign(
        payload,
        padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=32),
        hashes.SHA256(),
    )
    return base64.b64encode(sig).decode()


async def _upload_encrypted_file(client, token, size=256):
    content = os.urandom(size)
    content_hash = hashlib.sha256(content).hexdigest()
    iv_hex = "a" * 24
    metadata = (
        f'{{"name_encrypted":"enc_filename","mime_type_encrypted":"enc_mime",'
        f'"file_key_encrypted":"enc_key_b64","encryption_iv":"{iv_hex}",'
        f'"content_hash":"{content_hash}","folder_id":null}}'
    )
    resp = await client.post(
        "/api/v1/files/upload",
        data={"metadata": metadata},
        files={"file": ("test.enc", content, "application/octet-stream")},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code in (200, 201), f"Upload failed: {resp.text}"
    data = resp.json()
    fid = data["file_id"]
    return fid, content, content_hash


def _refresh_headers(user_id: str, headers: dict) -> None:
    """Aggiorna headers con un nuovo JWT (mitiga 401 da cache settings)."""
    import uuid as _uuid
    token = auth_service.create_access_token(_uuid.UUID(user_id), "user")
    headers["Authorization"] = f"Bearer {token}"


@pytest.mark.asyncio
async def test_full_user_lifecycle():
    """E2E completo: dall'utente creato a erasure e health."""
    _get_settings()
    token, user_id, email = await create_user_and_token()
    headers = {"Authorization": f"Bearer {token}"}

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        # ── 1. Upload file ─────────────────────────────────────────────────
        _get_settings()
        file_id, content, content_hash = await _upload_encrypted_file(client, token)
        assert file_id

        # ── 2. Metadati e tag ─────────────────────────────────────────────
        _get_settings()
        meta_resp = await client.put(
            f"/api/v1/files/{file_id}/metadata",
            json={
                "description_encrypted": "desc_cifrata",
                "notes_encrypted": "note_cifrate",
            },
            headers=headers,
        )
        assert meta_resp.status_code in (200, 201)

        tag_resp = await client.post(
            f"/api/v1/files/{file_id}/tags",
            json={"tag": "importante"},
            headers=headers,
        )
        assert tag_resp.status_code in (200, 201)

        # ── 3. Chiave firma + firma digitale ─────────────────────────────
        _get_settings()
        _refresh_headers(user_id, headers)
        priv_key, pub_pem = _gen_rsa_pss_keypair()
        sk_resp = await client.post(
            "/api/v1/users/me/signing-key",
            json={"signing_public_key_pem": pub_pem},
            headers=headers,
        )
        assert sk_resp.status_code in (200, 201), f"Signing key failed: {sk_resp.text}"

        file_hash = hashlib.sha256(content).hexdigest()
        version = 1
        payload = f"{file_hash}:{file_id}:{version}".encode()
        sig_b64 = _sign_rsa_pss(priv_key, payload)

        _get_settings()
        sign_resp = await client.post(
            f"/api/v1/files/{file_id}/sign",
            json={
                "version": version,
                "signature_b64": sig_b64,
                "file_hash_sha256": file_hash,
                "public_key_pem_snapshot": pub_pem,
                "algorithm": "RSA-PSS-SHA256",
            },
            headers=headers,
        )
        if sign_resp.status_code == 401:
            _get_settings()
            sign_resp = await client.post(
                f"/api/v1/files/{file_id}/sign",
                json={
                    "version": version,
                    "signature_b64": sig_b64,
                    "file_hash_sha256": file_hash,
                    "public_key_pem_snapshot": pub_pem,
                    "algorithm": "RSA-PSS-SHA256",
                },
                headers=headers,
            )
        assert sign_resp.status_code in (200, 201), (
            f"Sign failed: {sign_resp.status_code} {sign_resp.text}"
        )

        # ── 4. Verifica firma → True ─────────────────────────────────────
        _get_settings()
        verify_resp = await client.post(
            f"/api/v1/files/{file_id}/verify/{version}",
            headers=headers,
        )
        if verify_resp.status_code == 401:
            _get_settings()
            verify_resp = await client.post(
                f"/api/v1/files/{file_id}/verify/{version}",
                headers=headers,
            )
        assert verify_resp.status_code == 200, (
            f"Verify failed: {verify_resp.status_code} {verify_resp.text}"
        )
        assert verify_resp.json()["is_valid"] is True

        # ── 5. Share link pubblico + download ────────────────────────────
        _get_settings()
        _refresh_headers(user_id, headers)
        link_resp = await client.post(
            f"/api/v1/files/{file_id}/share-links",
            json={"label": "e2e-link", "file_key_encrypted_for_link": "enc_key"},
            headers=headers,
        )
        assert link_resp.status_code in (200, 201)
        share_token = link_resp.json()["token"]

        dl_resp = await client.post(
            f"/api/v1/public/share/{share_token}/download",
            json={},
        )
        assert dl_resp.status_code == 200
        assert dl_resp.json().get("file_key_encrypted_for_link") == "enc_key"

        # ── 6. Share link con password ────────────────────────────────────
        _refresh_headers(user_id, headers)
        pwd_link = await client.post(
            f"/api/v1/files/{file_id}/share-links",
            json={
                "password": "SecretPass123",
                "label": "pwd-link",
                "file_key_encrypted_for_link": "enc_key2",
            },
            headers=headers,
        )
        assert pwd_link.status_code in (200, 201)
        pwd_token = pwd_link.json()["token"]

        wrong = await client.post(
            f"/api/v1/public/share/{pwd_token}/download",
            json={"password": "wrong"},
        )
        assert wrong.status_code in (401, 403)

        correct = await client.post(
            f"/api/v1/public/share/{pwd_token}/download",
            json={"password": "SecretPass123"},
        )
        assert correct.status_code == 200

        # ── 7. Invito guest + riscatto ────────────────────────────────────
        _get_settings()
        _refresh_headers(user_id, headers)
        guest_resp = await client.post(
            "/api/v1/guest/invite",
            json={
                "guest_email": "guest@external.com",
                "file_ids": [file_id],
                "expires_in_hours": 24,
            },
            headers=headers,
        )
        if guest_resp.status_code == 401:
            _get_settings()
            guest_resp = await client.post(
                "/api/v1/guest/invite",
                json={
                    "guest_email": "guest@external.com",
                    "file_ids": [file_id],
                    "expires_in_hours": 24,
                },
                headers=headers,
            )
        assert guest_resp.status_code in (200, 201), (
            f"Guest invite failed: {guest_resp.status_code} {guest_resp.text}"
        )
        invite_token = guest_resp.json().get("invite_token")
        if invite_token:
            redeem = await client.post(
                f"/api/v1/public/guest/redeem?invite_token={invite_token}",
            )
            assert redeem.status_code == 200
            assert "access_token" in redeem.json() or "token" in str(redeem.json()).lower()

        # ── 8. Revoca link → 410 ─────────────────────────────────────────
        _refresh_headers(user_id, headers)
        link_id = link_resp.json()["id"]
        rev_resp = await client.delete(
            f"/api/v1/share-links/{link_id}",
            headers=headers,
        )
        assert rev_resp.status_code == 204

        dead_dl = await client.post(
            f"/api/v1/public/share/{share_token}/download",
            json={},
        )
        assert dead_dl.status_code in (404, 410)

        # ── 9. Dashboard + audit ─────────────────────────────────────────
        _get_settings()
        _refresh_headers(user_id, headers)
        dash = await client.get("/api/v1/audit/dashboard/me", headers=headers)
        assert dash.status_code == 200
        data = dash.json()
        assert data.get("storage", {}).get("total_files", 0) >= 1
        assert data.get("signatures", {}).get("signed_files", 0) >= 1

        audit = await client.get(
            "/api/v1/audit/logs",
            params={"page_size": 10},
            headers=headers,
        )
        assert audit.status_code == 200
        # Almeno un evento (upload, sign, share, guest, ecc.)
        assert audit.json().get("total", 0) >= 1, "Audit log deve contenere almeno un evento"

        # ── 10. Export GDPR + consenso ───────────────────────────────────
        _get_settings()
        _refresh_headers(user_id, headers)
        export = await client.get("/api/v1/gdpr/export", headers=headers)
        assert export.status_code == 200
        exp_data = export.json()
        assert exp_data.get("user", {}).get("email") == email
        assert len(exp_data.get("files", [])) >= 1

        _refresh_headers(user_id, headers)
        consent = await client.post(
            "/api/v1/gdpr/consent",
            json={
                "consent_type": "terms_of_service",
                "granted": True,
                "version": "1.0",
            },
            headers=headers,
        )
        assert consent.status_code == 200

        # ── 11. Richiesta erasure (ultimo step utente) ────────────────────
        _refresh_headers(user_id, headers)
        erasure = await client.post("/api/v1/gdpr/erasure", headers=headers)
        assert erasure.status_code == 202

        # ── 12. Health check ──────────────────────────────────────────────
        health = await client.get("/api/v1/health")
        assert health.status_code == 200
        assert health.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_zero_knowledge_invariants():
    """Invarianti zero-knowledge: nomi cifrati, nessuna chiave privata esposta."""
    _get_settings()
    token, _, _ = await create_user_and_token()
    headers = {"Authorization": f"Bearer {token}"}

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        _, _, _ = await _upload_encrypted_file(client, token)

        # Lista tramite search: name_encrypted non deve essere in chiaro
        search = await client.get(
            "/api/v1/search/files",
            headers=headers,
        )
        assert search.status_code == 200
        items = search.json().get("items", [])
        for item in items:
            name = item.get("name_encrypted", "")
            assert name != "test.enc", "Nome file non deve essere in chiaro sul server"

        key_resp = await client.get("/api/v1/users/me/signing-key", headers=headers)
        assert key_resp.status_code == 200
        resp_str = str(key_resp.json())
        assert "private_key" not in resp_str.lower() or "has_signing_key" in resp_str
        assert "PRIVATE KEY" not in resp_str


@pytest.mark.asyncio
async def test_isolation_between_users():
    """User A non può accedere ai file di User B."""
    _get_settings()
    token_a, _, _ = await create_user_and_token()
    token_b, _, _ = await create_user_and_token()
    headers_a = {"Authorization": f"Bearer {token_a}"}
    headers_b = {"Authorization": f"Bearer {token_b}"}

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        file_b, _, _ = await _upload_encrypted_file(client, token_b)

        dl = await client.get(
            f"/api/v1/files/{file_b}/download",
            headers=headers_a,
        )
        assert dl.status_code in (403, 404)

        sign = await client.post(
            f"/api/v1/files/{file_b}/sign",
            json={
                "version": 1,
                "signature_b64": "fake",
                "file_hash_sha256": "a" * 64,
                "public_key_pem_snapshot": "-----BEGIN PUBLIC KEY-----\nMIIBIjAN\n-----END PUBLIC KEY-----",
                "algorithm": "RSA-PSS-SHA256",
            },
            headers=headers_a,
        )
        assert sign.status_code in (403, 404)
