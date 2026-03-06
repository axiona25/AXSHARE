"""
Test E2E Fase 11 — flusso completo:
1. Upload file → audit log scritto (file.upload)
2. Dashboard me → storage aggiornato
3. Firma file → audit log (file.sign)
4. Verifica firma invalida → notifica signature_invalid generata
5. Crea share link → audit log (share_link.create)
6. Accesso share link → notifica share_link_accessed all'owner
7. Export CSV audit → file scaricabile
8. Time series uploads → struttura corretta
9. Mark all read → unread_count == 0
"""

import base64
import uuid as uuid_mod

import pytest
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from httpx import ASGITransport, AsyncClient

from app.config import get_settings
from app.core.audit_actions import AuditAction
from app.database import AsyncSessionLocal
from app.main import app
from app.services.audit_service import AuditService
from app.services.notification_service import NotificationService

from tests.phase11.helpers import create_user_and_token, upload_test_file


def _gen_rsa_pss_keypair():
    priv = rsa.generate_private_key(65537, 2048, default_backend())
    pub_pem = (
        priv.public_key()
        .public_bytes(
            serialization.Encoding.PEM,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        .decode()
    )
    return priv, pub_pem


def _sign(priv_key, payload: bytes) -> str:
    sig = priv_key.sign(
        payload,
        padding.PSS(
            mgf=padding.MGF1(hashes.SHA256()),
            salt_length=32,
        ),
        hashes.SHA256(),
    )
    return base64.b64encode(sig).decode()


@pytest.mark.asyncio
async def test_upload_writes_audit_log():
    """Upload scrive entry audit file.upload."""
    get_settings()
    token, user_id = await create_user_and_token()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        file_id = await upload_test_file(client, token)
        headers = {"Authorization": f"Bearer {token}"}

        resp = await client.get(
            "/api/v1/audit/logs",
            params={"action": "file.upload"},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["total"] >= 1


@pytest.mark.asyncio
async def test_dashboard_reflects_uploaded_file():
    """Dopo upload, dashboard mostra file e storage aggiornati."""
    get_settings()
    token, _ = await create_user_and_token()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        headers = {"Authorization": f"Bearer {token}"}

        before = await client.get(
            "/api/v1/audit/dashboard/me",
            headers=headers,
        )
        files_before = before.json()["storage"]["total_files"]

        await upload_test_file(client, token)

        after = await client.get(
            "/api/v1/audit/dashboard/me",
            headers=headers,
        )
        assert after.json()["storage"]["total_files"] == files_before + 1
        assert after.json()["storage"]["total_size_bytes"] > 0


@pytest.mark.asyncio
async def test_invalid_signature_triggers_notification():
    """Verifica firma invalida genera notifica signature_invalid."""
    get_settings()
    token, user_id = await create_user_and_token()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        headers = {"Authorization": f"Bearer {token}"}

        priv_b, pub_b_pem = _gen_rsa_pss_keypair()
        _, pub_a_pem = _gen_rsa_pss_keypair()

        file_id = await upload_test_file(client, token)
        file_hash = "a" * 64
        payload_str = f"{file_hash}:{file_id}:1"
        sig_b64 = _sign(priv_b, payload_str.encode())

        await client.post(
            f"/api/v1/files/{file_id}/sign",
            json={
                "version": 1,
                "signature_b64": sig_b64,
                "file_hash_sha256": file_hash,
                "public_key_pem_snapshot": pub_a_pem,
            },
            headers=headers,
        )

        await client.post(
            f"/api/v1/files/{file_id}/verify/1",
            headers=headers,
        )

        notifs = await client.get(
            "/api/v1/notifications",
            params={"unread_only": "true"},
            headers=headers,
        )
        types = [n["type"] for n in notifs.json()["items"]]
        assert "signature_invalid" in types


@pytest.mark.asyncio
async def test_share_link_access_triggers_notification():
    """Accesso a share link notifica l'owner."""
    get_settings()
    token, user_id = await create_user_and_token()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        headers = {"Authorization": f"Bearer {token}"}

        file_id = await upload_test_file(client, token)

        link_resp = await client.post(
            f"/api/v1/files/{file_id}/share-links",
            json={"label": "notif-test"},
            headers=headers,
        )
        assert link_resp.status_code in (200, 201), link_resp.text
        share_token = link_resp.json()["token"]

        await client.post(
            f"/api/v1/public/share/{share_token}/download",
            json={},
        )

        notifs = await client.get(
            "/api/v1/notifications",
            headers=headers,
        )
        types = [n["type"] for n in notifs.json()["items"]]
        assert "share_link_accessed" in types


@pytest.mark.asyncio
async def test_audit_csv_contains_events():
    """Export CSV contiene gli eventi dell'utente."""
    get_settings()
    token, _ = await create_user_and_token()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        headers = {"Authorization": f"Bearer {token}"}

        await upload_test_file(client, token)

        resp = await client.get(
            "/api/v1/audit/logs/export/csv",
            headers=headers,
        )
        assert resp.status_code == 200
        assert "text/csv" in resp.headers.get("content-type", "")
        lines = resp.text.strip().split("\n")
        assert len(lines) >= 2


@pytest.mark.asyncio
async def test_audit_summary_endpoint():
    """Endpoint summary restituisce conteggi per azione."""
    get_settings()
    token, _ = await create_user_and_token()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        headers = {"Authorization": f"Bearer {token}"}

        resp = await client.get(
            "/api/v1/audit/logs/summary",
            headers=headers,
        )
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)


@pytest.mark.asyncio
async def test_mark_all_notifications_read():
    """Mark all read azzera unread_count."""
    get_settings()
    token, user_id = await create_user_and_token()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        headers = {"Authorization": f"Bearer {token}"}

        async with AsyncSessionLocal() as db:
            for i in range(3):
                await NotificationService.create(
                    db=db,
                    user_id=uuid_mod.UUID(user_id),
                    type="test",
                    title=f"Notifica {i}",
                    severity="info",
                )

        count = await client.get(
            "/api/v1/notifications/count",
            headers=headers,
        )
        assert count.status_code == 200, count.text
        data = count.json()
        assert "unread_count" in data, data
        assert data["unread_count"] >= 3

        await client.post(
            "/api/v1/notifications/read",
            json={},
            headers=headers,
        )

        count2 = await client.get(
            "/api/v1/notifications/count",
            headers=headers,
        )
        assert count2.status_code == 200, count2.text
        assert count2.json()["unread_count"] == 0


@pytest.mark.asyncio
async def test_audit_wildcard_filter():
    """Filtro action con wildcard 'file.*' restituisce tutti gli eventi file."""
    get_settings()
    token, _ = await create_user_and_token()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        headers = {"Authorization": f"Bearer {token}"}

        await upload_test_file(client, token)

        resp = await client.get(
            "/api/v1/audit/logs",
            params={"action": "file.*"},
            headers=headers,
        )
        assert resp.status_code == 200
        items = resp.json()["items"]
        assert all(item["action"].startswith("file.") for item in items)


@pytest.mark.asyncio
async def test_user_cannot_see_other_users_audit():
    """Utente normale non vede i log di altri utenti."""
    get_settings()
    token1, user1_id = await create_user_and_token()
    token2, user2_id = await create_user_and_token()

    async with AsyncSessionLocal() as db:
        await AuditService.log_event(
            db=db,
            action=AuditAction.FILE_UPLOAD,
            actor_id=uuid_mod.UUID(user2_id),
            resource_type="file",
            resource_id="some-file-id",
        )

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        resp = await client.get(
            "/api/v1/audit/logs",
            headers={"Authorization": f"Bearer {token1}"},
        )
        assert resp.status_code == 200
        actor_ids = [
            item["actor_id"] for item in resp.json()["items"] if item.get("actor_id")
        ]
        assert user2_id not in actor_ids
