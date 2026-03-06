# TASK 11.4 — Test Suite Completa Fase 11

**Fase:** 11 — Reportistica & Audit Log  
**Prerequisiti:** TASK 11.1, 11.2, 11.3 completati

## Riepilogo implementazione Fase 11

La Fase 11 introduce:

- **Audit log centralizzato** (11.1): colonne `actor_id`, `actor_email`, `actor_role`, `resource_name_encrypted`, `error_message`, `session_type`; `AuditService.log_event`, query con filtri e wildcard (`file.*`), export CSV, summary.
- **Dashboard reportistica** (11.2): `ReportService` per dashboard utente e admin, statistiche aggregate (storage, sharing, signatures, activity), serie temporale (uploads, downloads, logins, shares); endpoint `/audit/dashboard/me`, `/audit/dashboard/admin`, `/audit/dashboard/timeseries`.
- **Notifiche in-app** (11.3): tabella `notifications`, `NotificationService`, tipi (es. `signature_invalid`, `share_link_accessed`); integrazione in verify firma e download share link; endpoint `/notifications`, `/notifications/count`, `/notifications/read`.
- **Test suite E2E** (11.4): flusso completo azione → audit → dashboard → notifica → mark read; test frontend Vitest per `useNotifications` e `useReports`.

## Struttura test backend (phase11)

| File | Contenuto |
|------|-----------|
| `conftest.py` | Fixture `prime_settings_cache`: priming di `get_settings()` per evitare 401 JWT tra creazione token e validazione. |
| `helpers.py` | `create_user_and_token()`, `upload_test_file(client, token)` (stile phase10, AESCipher + FileUploadMetadata). |
| `test_audit.py` | Query audit, filtri, export CSV. |
| `test_reports.py` | Dashboard utente/admin, time series. |
| `test_notifications.py` | Crea/lista notifiche, mark read, filtro unread_only. |
| `test_phase11_full.py` | E2E: upload→audit, dashboard→storage, firma invalida→notifica, share link→notifica owner, CSV export, summary, mark all read, wildcard filter, isolamento log tra utenti. |

## Flusso E2E coperto (test_phase11_full.py)

1. **Upload → audit**: upload file → GET `/audit/logs?action=file.upload` → `total >= 1`.
2. **Dashboard**: prima/dopo upload → GET `/audit/dashboard/me` → `total_files` e `total_size_bytes` aggiornati.
3. **Firma invalida → notifica**: firma con chiave diversa da quella salvata → verify → GET `/notifications?unread_only=true` → tipo `signature_invalid`.
4. **Share link → notifica**: crea share link → POST pubblico `/public/share/{token}/download` → GET `/notifications` come owner → tipo `share_link_accessed`.
5. **Export CSV**: upload → GET `/audit/logs/export/csv` → `text/csv`, almeno header + una riga.
6. **Summary**: GET `/audit/logs/summary` → lista di `{ action, outcome, count }`.
7. **Mark all read**: crea 3 notifiche → GET count ≥ 3 → POST `/notifications/read` (body `{}`) → GET count === 0.
8. **Wildcard**: GET `/audit/logs?action=file.*` → tutte le `action` iniziano con `file.`.
9. **Isolamento**: log scritto per user2 → GET `/audit/logs` come user1 → `actor_id` di user2 non presente.

## Test frontend (Vitest)

| File | Test |
|------|------|
| `hooks/useNotifications.test.ts` | Lista notifiche, unread count, stato iniziale non in loading. |
| `hooks/useReports.test.ts` | `useMyDashboard`: dati dashboard (storage, sharing); `useTimeSeries`: metric, points, total. |

## Esecuzione

### Backend

```bash
cd backend
source .venv/bin/activate
pytest tests/phase11/ -v --tb=short
```

**Output atteso:** 18 test passed. In caso di 401 intermittenti (JWT/settings cache), rieseguire la suite o i singoli file; la conftest effettua il priming di `get_settings()` prima di ogni test.

### Frontend

```bash
cd frontend
npx vitest run hooks/useNotifications.test hooks/useReports.test
```

**Output atteso:** 6 test passed (3 useNotifications + 3 useReports).

## Totale Fase 11

| Tipo | Conteggio |
|------|-----------|
| Backend (phase11) | 18 |
| Frontend (hooks phase 11) | 6 |
| **Totale** | **24** |
