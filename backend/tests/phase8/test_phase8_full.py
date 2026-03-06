"""
Test E2E Fase 8 — flusso completo (TASK 8.4):
upload → metadati → tag → label → ricerca (tag, starred, color) → thumbnail
"""

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app

from tests.phase8.helpers import create_user_and_token, upload_test_file


@pytest.mark.asyncio
async def test_full_metadata_search_flow():
    """
    Flusso completo:
    1. Upload file
    2. Aggiungi metadati cifrati
    3. Aggiungi tag 'report-q1'
    4. Imposta starred + color_label 'blue'
    5. Ricerca per tag → file trovato
    6. Ricerca per starred → file trovato
    7. Ricerca per color_label → file trovato
    8. Upload thumbnail cifrata
    9. Get thumbnail → dati corretti
    """
    from app.config import get_settings
    get_settings.cache_clear()
    token, user_id = await create_user_and_token()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        file_id = await upload_test_file(client, token)
        headers = {"Authorization": f"Bearer {token}"}

        # Step 2: Metadati cifrati
        resp = await client.put(
            f"/api/v1/files/{file_id}/metadata",
            json={
                "description_encrypted": "enc_desc_q1",
                "notes_encrypted": "enc_notes",
            },
            headers=headers,
        )
        assert resp.status_code == 200, f"Metadati: {resp.text}"

        # Step 3: Tag (clear cache prima della richiesta per evitare 401 in sequenza)
        from app.config import get_settings
        get_settings.cache_clear()
        resp = await client.post(
            f"/api/v1/files/{file_id}/tags",
            json={"tag": "report-q1"},
            headers=headers,
        )
        assert resp.status_code == 201, f"Tag: {resp.text}"

        # Step 4: Label
        resp = await client.patch(
            f"/api/v1/files/{file_id}/labels",
            json={"is_starred": True, "color_label": "blue"},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["is_starred"] is True

        # Step 5: Ricerca per tag
        resp = await client.get(
            "/api/v1/search/files",
            params={"tags": "report-q1"},
            headers=headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] >= 1
        found_ids = [item["id"] for item in data["items"]]
        assert file_id in found_ids

        # Step 6: Ricerca starred
        resp = await client.get(
            "/api/v1/search/files",
            params={"is_starred": "true"},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["total"] >= 1

        # Step 7: Ricerca color_label
        resp = await client.get(
            "/api/v1/search/files",
            params={"color_label": "blue"},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["total"] >= 1

        # Step 8: Thumbnail
        resp = await client.put(
            f"/api/v1/files/{file_id}/thumbnail",
            json={
                "thumbnail_encrypted": "enc_thumb_data",
                "thumbnail_key_encrypted": "enc_thumb_key",
            },
            headers=headers,
        )
        assert resp.status_code == 200

        # Step 9: Get thumbnail
        resp = await client.get(
            f"/api/v1/files/{file_id}/thumbnail",
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["thumbnail_encrypted"] == "enc_thumb_data"


@pytest.mark.asyncio
async def test_tag_duplicate_rejected():
    """Tag duplicato deve restituire 409."""
    from app.config import get_settings
    get_settings.cache_clear()
    token, _ = await create_user_and_token()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        file_id = await upload_test_file(client, token)
        headers = {"Authorization": f"Bearer {token}"}

        await client.post(
            f"/api/v1/files/{file_id}/tags",
            json={"tag": "duplicato"},
            headers=headers,
        )
        resp = await client.post(
            f"/api/v1/files/{file_id}/tags",
            json={"tag": "duplicato"},
            headers=headers,
        )
        assert resp.status_code == 409


@pytest.mark.asyncio
async def test_search_by_size_range():
    """Ricerca per range dimensione."""
    from app.config import get_settings
    get_settings.cache_clear()
    token, _ = await create_user_and_token()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        await upload_test_file(client, token)
        headers = {"Authorization": f"Bearer {token}"}

        resp = await client.get(
            "/api/v1/search/files",
            params={"min_size": 0, "max_size": 999_999_999},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["total"] >= 1


@pytest.mark.asyncio
async def test_search_no_results_wrong_tag():
    """Ricerca con tag inesistente restituisce 0 risultati."""
    from app.config import get_settings
    get_settings.cache_clear()
    token, _ = await create_user_and_token()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        headers = {"Authorization": f"Bearer {token}"}

        resp = await client.get(
            "/api/v1/search/files",
            params={"tags": "tag-che-non-esiste-xyz-123"},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["total"] == 0


@pytest.mark.asyncio
async def test_metadata_upsert_idempotent():
    """Upsert metadati è idempotente — seconda chiamata aggiorna."""
    from app.config import get_settings
    get_settings.cache_clear()
    token, _ = await create_user_and_token()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        file_id = await upload_test_file(client, token)
        headers = {"Authorization": f"Bearer {token}"}

        await client.put(
            f"/api/v1/files/{file_id}/metadata",
            json={"description_encrypted": "v1"},
            headers=headers,
        )
        resp = await client.put(
            f"/api/v1/files/{file_id}/metadata",
            json={"description_encrypted": "v2"},
            headers=headers,
        )
        assert resp.status_code == 200

        get = await client.get(
            f"/api/v1/files/{file_id}/metadata",
            headers=headers,
        )
        assert get.json()["description_encrypted"] == "v2"


@pytest.mark.asyncio
async def test_color_label_invalid_rejected():
    """Color label non valido restituisce 422."""
    from app.config import get_settings
    get_settings.cache_clear()
    token, _ = await create_user_and_token()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        file_id = await upload_test_file(client, token)
        headers = {"Authorization": f"Bearer {token}"}

        resp = await client.patch(
            f"/api/v1/files/{file_id}/labels",
            json={"color_label": "invalid-color-xyz"},
            headers=headers,
        )
        assert resp.status_code == 422


@pytest.mark.asyncio
async def test_search_pagination_pages():
    """Verifica che pages sia calcolato correttamente."""
    from app.config import get_settings
    get_settings.cache_clear()
    token, _ = await create_user_and_token()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        for _ in range(5):
            await upload_test_file(client, token)
        from app.config import get_settings
        get_settings.cache_clear()
        headers = {"Authorization": f"Bearer {token}"}

        resp = await client.get(
            "/api/v1/search/files",
            params={"page_size": 2, "page": 1},
            headers=headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["pages"] >= 3  # 5 file / 2 per page
        assert len(data["items"]) <= 2
