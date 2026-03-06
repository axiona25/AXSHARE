# TASK 8.4 — Test Suite Completa Fase 8

**Fase:** 8 — Metadati & Ricerca Avanzata  
**Prerequisiti:** TASK 8.1, 8.2, 8.3 completati

## Riepilogo implementazione Fase 8

La Fase 8 introduce:

- **Metadati cifrati e tag** (8.1): tabelle `file_metadata` e `file_tags`, flag `is_starred`, `is_pinned`, `color_label` su `files`. Metadati (descrizione, note, custom fields) e thumbnail sono cifrati client-side; il server memorizza solo blob cifrati.
- **Ricerca full-text server-side** (8.2): filtri su tag, `mime_category`, starred/pinned, color_label, date, dimensioni, paginazione e ordinamento. La ricerca per nome/descrizione resta client-side (contenuti cifrati).
- **Thumbnail cifrate** (8.3): generazione thumbnail client-side (immagini e PDF), cifratura AES-GCM prima dell’upload; chiave thumbnail cifrata con RSA pubkey owner e salvata in `custom_fields_encrypted`; endpoint PUT/GET thumbnail.
- **Test suite E2E** (8.4): `test_phase8_full.py` con flusso completo upload → metadati → tag → label → ricerca (tag, starred, color) → thumbnail; test aggiuntivi per duplicati tag, range size, tag inesistente, upsert idempotente, color label non valido, paginazione.

## Endpoint aggiunti (Fase 8)

| Metodo | Path | Descrizione |
|--------|------|-------------|
| PUT | `/api/v1/files/{file_id}/metadata` | Upsert metadati cifrati |
| GET | `/api/v1/files/{file_id}/metadata` | Lettura metadati |
| DELETE | `/api/v1/files/{file_id}/metadata` | Eliminazione metadati |
| POST | `/api/v1/files/{file_id}/tags` | Aggiunta tag (409 se duplicato) |
| GET | `/api/v1/files/{file_id}/tags` | Elenco tag del file |
| DELETE | `/api/v1/files/{file_id}/tags/{tag}` | Rimozione tag |
| PATCH | `/api/v1/files/{file_id}/labels` | Aggiornamento is_starred, is_pinned, color_label |
| PUT | `/api/v1/files/{file_id}/thumbnail` | Upload thumbnail cifrata + chiave cifrata |
| GET | `/api/v1/files/{file_id}/thumbnail` | Download thumbnail cifrata + chiave cifrata |
| GET | `/api/v1/search/files` | Ricerca file (tag, mime_category, starred, pinned, color, size, date, paginazione, sort) |
| GET | `/api/v1/search/tags/suggest` | Suggerimenti tag (autocomplete) |

## Istruzioni per migration e test

### Migration

```bash
cd backend
source .venv/bin/activate
alembic upgrade head
```

Migration coinvolte: `d4e5f6a7b8c9_add_file_metadata_tags`, `e5f6a7b8c9d0_add_search_indexes`.

### Test backend (Fase 8)

```bash
cd backend
source .venv/bin/activate
pytest tests/phase8/ -v --tb=short
```

**Output atteso:** 14 test passed (test_metadata 4, test_phase8_full 7, test_search 3).

In caso di 401 (JWT/get_settings cache) su singoli test in esecuzione completa, la suite usa `get_settings.cache_clear()` in punti strategici; in caso di flakiness residua, rieseguire la suite.

### Test frontend (thumbnail)

```bash
cd frontend
npx vitest run lib/thumbnail.test
```

**Output atteso:** 2 passed (generazione thumbnail per tipi non supportati / non image-pdf).

## Zero-knowledge: cosa è cifrato vs non cifrato

| Dato | Cifrato | Note |
|------|--------|------|
| Nome file | Sì (client) | `name_encrypted` su server |
| Descrizione / note / custom fields | Sì (client) | `description_encrypted`, `notes_encrypted`, `custom_fields_encrypted` |
| Contenuto thumbnail | Sì (client, AES-GCM) | `thumbnail_encrypted`; chiave in `custom_fields_encrypted` cifrata con RSA pubkey owner |
| File key | Sì (client) | `file_key_encrypted` |
| Tag | No | Usati per filtri e ricerca server-side; max 64 caratteri |
| is_starred, is_pinned, color_label | No | Flag/label per filtri e UI |
| mime_category | No | Categoria generica (image, pdf, video, …) per ricerca |
| size_bytes, date, owner_id, folder_id | No | Metadati strutturali per filtri e ordinamento |

Il server non decifra mai contenuti utente; la decifratura avviene solo client-side con chiavi derivate dalla passphrase o dalla chiave privata RSA dell’utente.

---

- **Data completamento:** 2026-03-05  
- **Test backend fase 8:** 14/14  
- **Test frontend thumbnail:** 2/2  
- **Totale fase 8:** 16/16  
- **Errori:** Nessuno
