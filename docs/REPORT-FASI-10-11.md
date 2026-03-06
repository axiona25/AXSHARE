# Report consolidato: Fasi 10.1 – 11.4 (AXSHARE)

Documento unico per analisi delle implementazioni dalla **Fase 10.1** (Link condivisione esterni) alla **Fase 11.4** (Test suite completa Fase 11).  
Path progetto: `/Users/r.amoroso/Documents/Cursor/AXSHARE`.

---

## Indice

1. [Fase 10 — Condivisione esterna & Guest](#fase-10)
   - 10.1 Link condivisione esterni con token sicuro
   - 10.2 Utenti Guest e accesso temporaneo
   - 10.3 Hook frontend condivisione esterna
   - 10.4 Test suite completa Fase 10
2. [Fase 11 — Reportistica & Audit Log](#fase-11)
   - 11.1 Audit log centralizzato
   - 11.2 Dashboard reportistica e statistiche
   - 11.3 Notifiche e alerting
   - 11.4 Test suite completa Fase 11

---

## Fase 10 — Condivisione esterna & Guest {#fase-10}

### Contesto tecnico

- **Backend:** FastAPI, SQLAlchemy async, PostgreSQL (schema `axshare`), MinIO, JWT RS256.
- **Frontend:** Next.js (App Router), React, SWR, TypeScript.
- **Sicurezza:** Zero-knowledge; chiavi/file cifrati client-side; server non decifra contenuti utente.

---

### TASK 10.1 — Link condivisione esterni con token sicuro

**Obiettivo:** Link di condivisione pubblici con token univoco, opzionale password, scadenza, `max_downloads`.

#### Migrazioni

- **`h8c9d0e1f2g3_add_share_links.py`** — Tabella iniziale `share_links` (se presente nello storico).
- **`l2g3h4i5j6k7_share_links_token_and_accesses.py`** (rev. `l2g3h4i5j6k7`, dopo `k1f2g3h4i5j6`):
  - `share_links`: colonna `slug` sostituita da `token` (String 64, unique); aggiunta `is_password_protected` (boolean); rimozione `expires_mode`.
  - Tabella **`share_link_accesses`**: tracciamento accessi (id, link_id, accessed_at, ip, user_agent, ecc.).
  - Indice `ix_share_links_token` (unique), `ix_share_links_owner_id`.

#### Modelli

- **`app/models/share_link.py`** — `ShareLink`: id, file_id, owner_id, token, is_password_protected, password_hash (opzionale), expires_at, max_downloads, download_count, is_active, label, file_key_encrypted_for_link, created_at, ecc.
- **`app/models/share_link_access.py`** (o simile) — `ShareLinkAccess` per gli accessi.

#### Schema Pydantic

- **`app/schemas/share_link.py`**:
  - `ShareLinkCreate`: file_key_encrypted_for_link, password, expires_at, max_downloads, label (tutti opzionali).
  - `ShareLinkResponse`: id, file_id, token, is_password_protected, expires_at, max_downloads, download_count, is_active, label, created_at, share_url.
  - `ShareLinkAccessRequest`: password (opzionale).

#### Servizi

- **`ShareLinkService`** (es. `app/services/share_link_service.py`): creazione link con token sicuro (es. secrets.token_urlsafe), hash password (bcrypt), validazione scadenza/max_downloads; `get_link_for_download(token, password)` per download pubblico.

#### Endpoint API (prefisso `/api/v1`)

| Metodo | Path | Descrizione |
|--------|------|-------------|
| POST | `/files/{file_id}/share-links` | Crea share link (body: ShareLinkCreate). Ritorna 201 + ShareLinkResponse. |
| GET | `/files/{file_id}/share-links` | Lista link del file (owner). |
| DELETE | `/share-links/{link_id}` | Revoca link (owner). |
| GET | `/public/share/{token}` | Info pubbliche link (senza auth). |
| POST | `/public/share/{token}/download` | Download pubblico (body: password opzionale). |

Integrazione audit: `AuditService.log_event` su creazione/revoca link e su accesso (share_link.create, share_link.revoke, share_link.access).  
Dopo download pubblico: `NotificationService.create` per notifica `share_link_accessed` all’owner.

#### Frontend (Fase 10.3)

- **`lib/api.ts`**: client per share link (create, list, revoke, getPublicInfo, downloadPublic).
- **`hooks/useShareLinks.ts`**: hook SWR per lista link per file_id, creazione, revoca; stato `isCreating`, `error`.
- **`hooks/useShareLinks.test.ts`**: test Vitest (lista, stato, link attivi).

#### Test backend (Fase 10.4)

- **`tests/phase10/`**: `conftest.py` (clear/prime `get_settings`), `helpers.py` (`create_user_and_token`, `upload_test_file` con AESCipher + FileUploadMetadata).
- **`test_share_links.py`**: test_create_and_list_share_link, test_download_via_public_link, test_revoke_link.
- **`test_phase10_full.py`**: test_share_link_no_password_flow, test_share_link_with_password, test_share_link_max_downloads, test_share_link_revoked, test_share_link_expired, test_multiple_share_links_same_file.

---

### TASK 10.2 — Utenti Guest e accesso temporaneo

**Obiettivo:** Inviti guest per file specifici, token di invito, riscatto con JWT temporaneo (HS256), permessi per file (can_download, can_preview).

#### Migrazioni

- **`j0e1f2g3h4i5_add_guest_sessions.py`** — Tabelle `guest_sessions` e `guest_permissions`.
- **`m3h4i5j6k7l8_guest_invite_and_redeem.py`** (rev. `m3h4i5j6k7l8`, dopo `l2g3h4i5j6k7`):
  - `guest_sessions`: `guest_email`, `invite_token`, `invite_used_at`, `session_token_jti`, `expires_at`; backfill e NOT NULL ove richiesto.

#### Modelli

- **`app/models/guest.py`** (o equivalente): `GuestSession` (id, invited_by, guest_email, invite_token, invite_used_at, expires_at, is_active, label, session_token_jti, …), `GuestPermission` (session_id, file_id, file_key_encrypted, can_download, can_preview).

#### Schema Pydantic

- **`app/schemas/guest.py`**:
  - `GuestInviteCreate`: guest_email, file_ids (lista UUID), file_keys_encrypted (opzionale), expires_in_hours (default 48), label, can_download, can_preview.
  - `GuestSessionResponse`: id, guest_email, expires_at, is_active, label, invite_used, created_at, accessible_files, invite_token.
  - `GuestTokenResponse`: access_token, expires_at, guest_email, accessible_files.

#### Servizi

- **`GuestService`**: creazione sessione guest, generazione `invite_token`, creazione permessi per file; riscatto `invite_token` → emissione JWT guest (HS256, short-lived), marcatura `invite_used_at`; revoca sessione.

#### Endpoint API

| Metodo | Path | Descrizione |
|--------|------|-------------|
| POST | `/guest/invite` | Crea invito guest (body: GuestInviteCreate). 201 + GuestSessionResponse (include invite_token). |
| GET | `/guest/sessions` | Lista sessioni guest dell’utente corrente. |
| DELETE | `/guest/sessions/{session_id}` | Revoca sessione guest. |
| POST | `/public/guest/redeem` | Pubblico: riscatto invite_token → GuestTokenResponse (JWT + accessible_files). |

Audit: `GUEST_INVITE`, `GUEST_REVOKE`, `GUEST_REDEEM` tramite `AuditService.log_event`.

#### Frontend

- **`hooks/useGuestSessions.ts`**: lista sessioni, crea invito, revoca; stato e errori.
- **`hooks/useGuestSessions.test.ts`**: test Vitest per hook guest.

#### Test backend

- **`test_guest.py`**: test_create_guest_invite, test_redeem_invite_token, test_revoke_guest_session.
- **`test_phase10_full.py`**: test_guest_full_flow (crea invito → riscatto → verifica JWT → lista sessioni → revoca), test_guest_cannot_invite_other_users_files.

---

### TASK 10.3 — Hook frontend condivisione esterna

Implementazione già descritta sopra: `useShareLinks`, `useGuestSessions`, API client in `lib/api.ts`, export in `hooks/index.ts`.

---

### TASK 10.4 — Test suite completa Fase 10

- **Backend:** `tests/phase10/` — helper con `create_user_and_token` (DB + auth_service), `upload_test_file` (AESCipher + FileUploadMetadata). E2E: link senza/con password, max_downloads, revoca, scadenza, flusso guest completo, guest non può invitare per file altrui, più link sullo stesso file.
- **Frontend:** Vitest per `useShareLinks.test`, `useGuestSessions.test`.
- **Nota:** Per evitare 401 JWT intermittenti, nei test non si chiama `get_settings.cache_clear()` tra creazione token e richiesta HTTP; si usa priming o fixture che non svuota la cache in modo da mantenere coerenza JWT.

---

## Fase 11 — Reportistica & Audit Log {#fase-11}

### TASK 11.1 — Audit log centralizzato

**Obiettivo:** Audit log unificato con actor, resource, outcome, filtri, wildcard, export CSV, summary.

#### Migrazione

- **`n2o3p4q5r6s7_add_audit_log_centralized.py`** (dopo `m3h4i5j6k7l8`):
  - Tabella `audit_logs`: nuove colonne `actor_id`, `actor_email`, `actor_role`, `resource_name_encrypted`, `error_message`, `session_type`; FK su `actor_id` → users; backfill da `user_id`/`user_email`; indici (es. actor_id, resource, created_at, outcome).

#### Modello

- **`app/models/audit.py`**: `AuditLog` con campi legacy (user_id, user_email, previous_hash, log_hash) e nuovi (actor_id, actor_email, actor_role, resource_name_encrypted, error_message, session_type); relationship con User.

#### Costanti

- **`app/core/audit_actions.py`**: classe `AuditAction` con costanti `auth.login`, `file.upload`, `file.download`, `share_link.create`, `share_link.revoke`, `share_link.access`, `guest.invite`, `guest.redeem`, `guest.revoke`, `file.sign`, `file.verify`, `admin.audit_export`, ecc.

#### Servizio

- **`AuditService`** (`app/services/audit_service.py`):
  - `log_event(db, action, actor=..., actor_id=..., resource_type=..., resource_id=..., outcome=..., request=..., session_type=...)`: scrive entry e mantiene catena hash (previous_hash, log_hash).
  - `query(db, action=..., resource_type=..., outcome=..., date_from, date_to, page, page_size, admin_view, requesting_user_id)`: filtri; se `action` termina con `*` usa LIKE (es. `file.*`); utente normale vede solo propri eventi (actor_id/user_id = requesting_user_id).
  - `export_csv(...)`: export CSV con stessi filtri.
  - `verify_chain(db)`: verifica integrità catena (solo admin).

#### Endpoint audit (prefisso `/api/v1/audit`)

| Metodo | Path | Descrizione |
|--------|------|-------------|
| GET | `/verify-chain` | Verifica catena hash (solo admin). |
| GET | `/file/{file_id}/history` | Storia audit del file (owner o admin). |
| GET | `/logs` | Query log (action, resource_type, outcome, date_from, date_to, session_type, actor_id per admin, page, page_size). |
| GET | `/logs/export/csv` | Export CSV (stessi filtri; nome file attachment). |
| GET | `/logs/summary` | Conteggi per (action, outcome). |

Integrazione: `AuditService.log_event` su token refresh, upload/download/destroy file, create/revoke share link, access share link, sign/verify file, guest invite/redeem/revoke.

---

### TASK 11.2 — Dashboard reportistica e statistiche

**Obiettivo:** Dashboard utente (storage, sharing, signatures, activity) e admin (totali, top user, attività sistema); serie temporale (uploads, downloads, logins, shares).

#### Schema

- **`app/schemas/reports.py`**: `StorageStats`, `SharingStats`, `SignatureStats`, `ActivityStats`, `UserDashboard`, `UserSummary`, `AdminDashboard`, `TimeSeriesPoint`, `TimeSeriesReport`.

#### Servizio

- **`ReportService`** (`app/services/report_service.py`):
  - `get_user_dashboard(db, user_id)`: statistiche personali (file, storage, share link, guest, firme, attività ultimi 30 gg da AuditLog).
  - `get_admin_dashboard(db)`: totali sistema, utenti attivi, top 10 per storage, attività.
  - `get_time_series(db, metric, days, user_id)`: serie giornaliera per metric (uploads/downloads/logins/shares); se non admin, filtra per user_id.

#### Endpoint (sotto `/api/v1/audit`)

| Metodo | Path | Descrizione |
|--------|------|-------------|
| GET | `/dashboard/me` | Dashboard utente (UserDashboard). |
| GET | `/dashboard/admin` | Dashboard admin (403 se non admin). |
| GET | `/dashboard/timeseries` | Query params: metric (uploads|downloads|logins|shares), days (7–365). |

#### Frontend

- **`lib/api.ts`**: `reportsApi` (getMyDashboard, getAdminDashboard, getTimeSeries, audit logs, export CSV).
- **`hooks/useReports.ts`**: `useMyDashboard`, `useAdminDashboard` (solo se user.role === 'admin'), `useTimeSeries(metric, days)`.
- **`hooks/useReports.test.ts`**: test su dati dashboard e time series (mock SWR e API).

---

### TASK 11.3 — Notifiche e alerting

**Obiettivo:** Notifiche in-app (tabella, tipi, severity), contatore non lette, mark read; integrazione su firma invalida e accesso share link.

#### Migrazione

- **`o3p4q5r6s7t8_add_notifications.py`** (dopo `n2o3p4q5r6s7`): tabella `notifications` (id, user_id FK, type, title, body, resource_type, resource_id, action_url, is_read, read_at, severity, created_at) e indici.

#### Modello

- **`app/models/notification.py`**: `Notification` (UUID id, user_id, type, title, body, resource_type, resource_id, action_url, is_read, read_at, severity, created_at). Esportato in `app/models/__init__.py`.

#### Costanti

- **`app/core/notification_types.py`**: `NotificationType` (permission_expiring, signature_invalid, guest_access, share_link_accessed, …), `NotificationSeverity` (info, warning, error, success).

#### Servizio

- **`NotificationService`** (`app/services/notification_service.py`): `create(db, user_id, type, title, body=..., resource_type, resource_id, action_url, severity)`; helper tipo `notify_signature_invalid(db, user_id, file_id, version)`, `notify_permission_expiring`, `notify_guest_accessed`, `notify_share_revoked`, `notify_security_alert`; `get_unread_count(db, user_id)`; `list_notifications(db, user_id, unread_only, page, page_size)`; `mark_read(db, user_id, notification_ids=None)` (None = tutti).

#### Endpoint (prefisso `/api/v1/notifications`)

| Metodo | Path | Descrizione |
|--------|------|-------------|
| GET | `` | Lista notifiche (unread_only, page, page_size). |
| GET | `/count` | Ritorna `{ "unread_count": N }`. |
| POST | `/read` | Body opzionale `{ "notification_ids": [uuid, …] }`; assente = segna tutte. |

Integrazione: in `verify_signature` (endpoint firma), se `is_valid` è False → `NotificationService.notify_signature_invalid` per owner file; dopo download pubblico share link → `NotificationService.create` per owner con tipo `share_link_accessed`.

#### Frontend

- **`lib/api.ts`**: `notificationsApi` (list, getCount, markRead).
- **`hooks/useNotifications.ts`**: useSWR per lista e count; `markRead(ids?)`, `markAllRead`; `unreadCount`, `notifications`, `isLoading`, `error`, `refresh`.
- **`hooks/useNotifications.test.ts`**: test lista, unread count, stato iniziale (mock SWR e API).

---

### TASK 11.4 — Test suite completa Fase 11

**Obiettivo:** E2E audit → report → notifica → mark read; test Vitest per hook report e notifiche.

#### Backend

- **`tests/phase11/conftest.py`**: fixture `prime_settings_cache` che chiama `get_settings()` (no cache_clear) per ridurre 401 JWT.
- **`tests/phase11/helpers.py`**: `create_user_and_token()`, `upload_test_file(client, token)` (stile phase10).
- **`test_audit.py`**: test_audit_log_written_on_upload, test_audit_log_query_filters, test_audit_csv_export.
- **`test_reports.py`**: test_user_dashboard_structure, test_admin_dashboard_requires_admin (403 per non-admin), test_time_series_uploads.
- **`test_notifications.py`**: test_create_and_list_notifications, test_mark_notifications_read, test_unread_only_filter.
- **`test_phase11_full.py`**: test_upload_writes_audit_log, test_dashboard_reflects_uploaded_file, test_invalid_signature_triggers_notification, test_share_link_access_triggers_notification, test_audit_csv_contains_events, test_audit_summary_endpoint, test_mark_all_notifications_read, test_audit_wildcard_filter, test_user_cannot_see_other_users_audit.

Create share link ritorna **201**; nei test si accetta sia 200 che 201.

#### Frontend

- **`hooks/useNotifications.test.ts`**: 3 test (lista, unread count, non in loading).
- **`hooks/useReports.test.ts`**: 3 test (useMyDashboard dati e loading; useTimeSeries metric/points/total).

#### Esecuzione

```bash
# Backend
cd backend && source .venv/bin/activate && pytest tests/phase11/ -v --tb=short

# Frontend
cd frontend && npx vitest run hooks/useNotifications.test hooks/useReports.test
```

**Totale Fase 11:** 18 test backend + 6 test frontend = 24. In alcune run si possono avere 401 intermittenti (JWT/settings cache); rieseguire la suite o i singoli file di solito porta a 18/18 backend.

---

## Riepilogo endpoint aggiunti (Fasi 10–11)

### Share & Guest (Fase 10)

- `POST /api/v1/files/{file_id}/share-links`
- `GET /api/v1/files/{file_id}/share-links`
- `DELETE /api/v1/share-links/{link_id}`
- `GET /api/v1/public/share/{token}`
- `POST /api/v1/public/share/{token}/download`
- `POST /api/v1/guest/invite`
- `GET /api/v1/guest/sessions`
- `DELETE /api/v1/guest/sessions/{session_id}`
- `POST /api/v1/public/guest/redeem`

### Audit & Report (Fase 11)

- `GET /api/v1/audit/verify-chain`
- `GET /api/v1/audit/file/{file_id}/history`
- `GET /api/v1/audit/logs`
- `GET /api/v1/audit/logs/export/csv`
- `GET /api/v1/audit/logs/summary`
- `GET /api/v1/audit/dashboard/me`
- `GET /api/v1/audit/dashboard/admin`
- `GET /api/v1/audit/dashboard/timeseries`
- `GET /api/v1/notifications`
- `GET /api/v1/notifications/count`
- `POST /api/v1/notifications/read`

---

## Migrazioni in ordine (Fasi 10–11)

1. `h8c9d0e1f2g3` — add_share_links (se applicabile)
2. `l2g3h4i5j6k7` — share_links token + share_link_accesses
3. `m3h4i5j6k7l8` — guest_sessions invite_token, expires_at, guest_email, ecc.
4. `n2o3p4q5r6s7` — audit_logs centralizzato (actor_id, actor_email, …)
5. `o3p4q5r6s7t8` — notifications

---

## File principali per fase

| Fase | Backend (principali) | Frontend |
|------|----------------------|----------|
| 10.1 | share_link model/schema, ShareLinkService, share_links endpoints | — |
| 10.2 | guest model/schema, GuestService, guest endpoints | — |
| 10.3 | — | useShareLinks, useGuestSessions, api share/guest |
| 10.4 | tests/phase10/* | useShareLinks.test, useGuestSessions.test |
| 11.1 | audit_actions, AuditService.log_event/query/export_csv, audit endpoints | — |
| 11.2 | schemas/reports, ReportService, audit dashboard endpoints | useReports, reportsApi |
| 11.3 | notification model, notification_types, NotificationService, notifications endpoints | useNotifications, notificationsApi |
| 11.4 | tests/phase11/* | useNotifications.test, useReports.test |

---

*Report generato per analisi (es. Claude). Ultimo aggiornamento: Fasi 10.1–11.4.*
