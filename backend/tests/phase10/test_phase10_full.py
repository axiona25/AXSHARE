"""
Test E2E Fase 10 — Condivisione Esterna & Guest.

Flussi testati:
1. Link senza password → download pubblico OK
2. Link con password → download con password corretta OK, sbagliata 401
3. Link con max_downloads → download oltre limite 410
4. Link con scadenza → download dopo scadenza 410
5. Link revocato → download 410
6. Invito guest → riscatta → lista sessioni → revoca
7. Guest non può invitare per file di altri
8. Più link attivi sullo stesso file
"""

from datetime import datetime, timezone, timedelta

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from tests.phase10.helpers import create_user_and_token, upload_test_file


def _clear_cache():
    from app.config import get_settings
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_share_link_no_password_flow():
    """Link pubblico senza password: info + download."""
    _clear_cache()
    token, _ = await create_user_and_token()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        file_id = await upload_test_file(client, token)
        headers = {"Authorization": f"Bearer {token}"}

        resp = await client.post(
            f"/api/v1/files/{file_id}/share-links",
            json={
                "label": "public-link",
                "file_key_encrypted_for_link": "enc_key_abc",
            },
            headers=headers,
        )
        assert resp.status_code == 201
        share_token = resp.json()["token"]

        info = await client.get(f"/api/v1/public/share/{share_token}")
        assert info.status_code == 200
        assert info.json()["is_password_protected"] is False

        dl = await client.post(
            f"/api/v1/public/share/{share_token}/download",
            json={},
        )
        assert dl.status_code == 200
        data = dl.json()
        assert data["file_key_encrypted_for_link"] == "enc_key_abc"
        assert data["download_count"] == 1


@pytest.mark.asyncio
async def test_share_link_with_password():
    """Link protetto da password: password giusta OK, sbagliata 401."""
    _clear_cache()
    token, _ = await create_user_and_token()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        file_id = await upload_test_file(client, token)
        headers = {"Authorization": f"Bearer {token}"}

        resp = await client.post(
            f"/api/v1/files/{file_id}/share-links",
            json={"password": "SecretPass123"},
            headers=headers,
        )
        assert resp.status_code == 201
        assert resp.json()["is_password_protected"] is True
        share_token = resp.json()["token"]

        wrong = await client.post(
            f"/api/v1/public/share/{share_token}/download",
            json={"password": "wrong"},
        )
        assert wrong.status_code == 401

        correct = await client.post(
            f"/api/v1/public/share/{share_token}/download",
            json={"password": "SecretPass123"},
        )
        assert correct.status_code == 200


@pytest.mark.asyncio
async def test_share_link_max_downloads():
    """Link con max_downloads=2: al 3° download restituisce 410."""
    _clear_cache()
    token, _ = await create_user_and_token()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        file_id = await upload_test_file(client, token)
        headers = {"Authorization": f"Bearer {token}"}

        resp = await client.post(
            f"/api/v1/files/{file_id}/share-links",
            json={"max_downloads": 2},
            headers=headers,
        )
        assert resp.status_code == 201
        share_token = resp.json()["token"]

        for _ in range(2):
            dl = await client.post(
                f"/api/v1/public/share/{share_token}/download",
                json={},
            )
            assert dl.status_code == 200

        dl3 = await client.post(
            f"/api/v1/public/share/{share_token}/download",
            json={},
        )
        assert dl3.status_code == 410


@pytest.mark.asyncio
async def test_share_link_revoked():
    """Link revocato restituisce 410."""
    _clear_cache()
    token, _ = await create_user_and_token()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        file_id = await upload_test_file(client, token)
        headers = {"Authorization": f"Bearer {token}"}

        resp = await client.post(
            f"/api/v1/files/{file_id}/share-links",
            json={},
            headers=headers,
        )
        assert resp.status_code == 201
        link_id = resp.json()["id"]
        share_token = resp.json()["token"]

        await client.delete(
            f"/api/v1/share-links/{link_id}",
            headers=headers,
        )

        dl = await client.post(
            f"/api/v1/public/share/{share_token}/download",
            json={},
        )
        assert dl.status_code == 410


@pytest.mark.asyncio
async def test_share_link_expired():
    """Link con scadenza già passata restituisce 410."""
    _clear_cache()
    token, _ = await create_user_and_token()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        file_id = await upload_test_file(client, token)
        headers = {"Authorization": f"Bearer {token}"}

        past = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        resp = await client.post(
            f"/api/v1/files/{file_id}/share-links",
            json={"expires_at": past},
            headers=headers,
        )
        assert resp.status_code == 201
        share_token = resp.json()["token"]

        dl = await client.post(
            f"/api/v1/public/share/{share_token}/download",
            json={},
        )
        assert dl.status_code == 410


@pytest.mark.asyncio
async def test_guest_full_flow():
    """
    Flusso completo guest:
    crea invito → riscatta token → verifica JWT → lista sessioni → revoca.
    """
    _clear_cache()
    token, _ = await create_user_and_token()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        file_id = await upload_test_file(client, token)
        headers = {"Authorization": f"Bearer {token}"}

        resp = await client.post(
            "/api/v1/guest/invite",
            json={
                "guest_email": "fullflow@guest.com",
                "file_ids": [str(file_id)],
                "expires_in_hours": 24,
                "label": "full-flow-test",
                "can_download": True,
                "can_preview": True,
            },
            headers=headers,
        )
        assert resp.status_code == 201
        session_id = resp.json()["id"]
        assert resp.json()["invite_used"] is False
        invite_token = resp.json()["invite_token"]
        assert invite_token

        redeem = await client.post(
            f"/api/v1/public/guest/redeem?invite_token={invite_token}",
        )
        assert redeem.status_code == 200
        guest_jwt = redeem.json()["access_token"]
        assert guest_jwt
        assert redeem.json()["guest_email"] == "fullflow@guest.com"
        assert str(file_id) in redeem.json()["accessible_files"]

        redeem2 = await client.post(
            f"/api/v1/public/guest/redeem?invite_token={invite_token}",
        )
        assert redeem2.status_code == 404

        list_resp = await client.get(
            "/api/v1/guest/sessions",
            headers=headers,
        )
        assert list_resp.status_code == 200
        sessions = list_resp.json()
        found = next(
            (s for s in sessions if s["id"] == session_id),
            None,
        )
        assert found is not None
        assert found["invite_used"] is True

        rev = await client.delete(
            f"/api/v1/guest/sessions/{session_id}",
            headers=headers,
        )
        assert rev.status_code == 204

        list_resp2 = await client.get(
            "/api/v1/guest/sessions",
            headers=headers,
        )
        revoked = next(
            (s for s in list_resp2.json() if s["id"] == session_id),
            None,
        )
        assert revoked is not None
        assert revoked["is_active"] is False


@pytest.mark.asyncio
async def test_guest_cannot_invite_other_users_files():
    """Guest non può invitare accesso a file di altri utenti."""
    _clear_cache()
    token1, _ = await create_user_and_token()
    token2, _ = await create_user_and_token()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        file_id = await upload_test_file(client, token2)

        resp = await client.post(
            "/api/v1/guest/invite",
            json={
                "guest_email": "attacker@guest.com",
                "file_ids": [str(file_id)],
                "expires_in_hours": 24,
            },
            headers={"Authorization": f"Bearer {token1}"},
        )
        assert resp.status_code == 404


@pytest.mark.asyncio
async def test_multiple_share_links_same_file():
    """Un file può avere più link attivi contemporaneamente."""
    _clear_cache()
    token, _ = await create_user_and_token()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        file_id = await upload_test_file(client, token)
        headers = {"Authorization": f"Bearer {token}"}

        for label in ["link-a", "link-b", "link-c"]:
            resp = await client.post(
                f"/api/v1/files/{file_id}/share-links",
                json={"label": label},
                headers=headers,
            )
            assert resp.status_code == 201

        list_resp = await client.get(
            f"/api/v1/files/{file_id}/share-links",
            headers=headers,
        )
        assert list_resp.status_code == 200
        assert len(list_resp.json()) == 3
