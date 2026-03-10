# AXSHARE — Riepilogo progetto

Documento di onboarding per AI (es. Claude): architettura, tecnologie, API, codice sviluppato e interventi recenti, per supporto coerente al progetto.

---

## 1. Panoramica

**AXSHARE** è una piattaforma di storage e condivisione file con cifratura end-to-end (zero-knowledge). Include:

- **Web app**: gestione file/cartelle, condivisione con utenti e gruppi, link pubblici con password/PIN e scadenza, cestino, attività, notifiche, audit, GDPR.
- **Client desktop**: app nativa (Tauri) con sync locale e WebDAV virtuale.
- **Backend API**: autenticazione JWT (RS256), WebAuthn/Passkey, TOTP; storage su MinIO; code async con Celery/Redis; notifiche real-time (SSE/Redis pub-sub).

L’architettura è **tre parti**:

- **Frontend** (Next.js) — `frontend/`
- **Backend** (FastAPI) — `backend/`
- **Desktop** (Tauri + Rust) — `desktop/` (UI condivisa con il frontend, shell e sync in Rust)

---

## 2. Struttura repository

```
AXSHARE/
├── backend/                 # API FastAPI
│   ├── app/
│   │   ├── api/v1/          # Router e endpoint
│   │   ├── core/             # Config, Redis pub/sub, audit, rate limit
│   │   ├── models/           # SQLAlchemy (User, File, Folder, Permission, ShareLink, …)
│   │   ├── schemas/          # Pydantic
│   │   ├── services/         # Logica business
│   │   ├── middleware/
│   │   ├── exceptions.py
│   │   ├── config.py
│   │   ├── database.py
│   │   └── main.py
│   ├── alembic/              # Migrations DB
│   ├── tests/
│   ├── .venv/
│   └── requirements.txt
├── frontend/                 # Next.js 14
│   ├── app/                  # App Router (page.tsx, layout.tsx)
│   │   ├── (app)/            # Area autenticata (dashboard, i-miei-file, condivisi, cestino, …)
│   │   ├── desktop/          # Pagine usate dal client Tauri
│   │   ├── share/[token]/    # Pagina pubblica share link
│   │   ├── login/, register/, setup-keys/, invite/, guest/
│   │   └── layout.tsx, globals.css
│   ├── components/
│   ├── context/              # AuthContext, NotificationsContext
│   ├── hooks/                # useCrypto, useFiles, useNotifications, usePinVerification, …
│   ├── lib/                  # api.ts (client HTTP), crypto, keyManager, auth, tauri, fileIcons
│   └── types/
├── desktop/                  # Client Tauri
│   ├── src-tauri/            # Rust (commands, virtual_disk, webdav_server, …)
│   └── package.json
├── .cursor/rules/            # Regole per UI e desktop
└── riepilogo.md              # Questo file
```

---

## 3. Stack tecnologico

### Backend (Python 3.9+)

- **Framework**: FastAPI, Uvicorn, Gunicorn
- **DB**: PostgreSQL (asyncpg), SQLAlchemy 2 (async)
- **Cache/Code**: Redis (sessioni, Celery broker, pub/sub notifiche)
- **Storage**: MinIO (S3-compatible) — bucket file e chiavi
- **Auth**: JWT RS256 (chiavi in `keys/`), Passlib (bcrypt/Argon2), WebAuthn, PyOTP (TOTP)
- **Firma**: PyHanko (firma digitale)
- **Email**: Resend / SMTP / log (template Jinja2 + Premailer)
- **Task async**: Celery + Redis
- **Log/Monitoring**: structlog, Sentry (opzionale), Prometheus (metrics)
- **Secrets**: HashiCorp Vault (opzionale)
- **Config**: pydantic-settings, `.env`

**Nota**: Il progetto deve restare compatibile con **Python 3.9**. Evitare sintassi solo 3.10+ (es. `str | None`); usare `Optional[str]` da `typing`.

### Frontend

- **Framework**: Next.js 14 (App Router), React 18, TypeScript
- **Styling**: Tailwind CSS
- **HTTP**: Axios (client centralizzato in `lib/api.ts`), SWR per dati
- **Auth/Token**: jose (JWT), localStorage / in Tauri storage sicuro
- **Cifratura lato client**: `lib/crypto.ts`, `lib/keyManager.ts`, hook `useCrypto`
- **UI**: Radix UI (dialog, dropdown, toast), Lucide React (icone), next-intl (i18n)
- **WebAuthn**: @simplewebauthn/browser
- **Tauri**: @tauri-apps/api (per rilevare contesto desktop e storage sicuro)
- **Build**: `next build`, `next build:tauri` per bundle desktop

### Desktop (Tauri 2)

- **Shell**: Tauri 2 (Rust), finestra modale senza scroll (ResizeObserver + comando `set_main_window_size`)
- **Storage locale**: rusqlite, keyring per token
- **Sync/WebDAV**: `dav-server` (Rust), `warp` (HTTP), virtual disk e WebDAV server in `desktop/src-tauri/src/`
- **Crypto**: aes-gcm, sha2, rsa (Rust)
- **Altro**: reqwest, notify (file watcher), deep-link, single-instance

---

## 4. API REST (v1)

Base URL: **`/api/v1`** (es. `http://localhost:8000/api/v1`).

Tutti gli endpoint (tranne auth/login e share pubblici) richiedono **Authorization: Bearer &lt;access_token&gt;**.
Il client frontend gestisce refresh JWT (401 → refresh token → retry) in `lib/api.ts`.

### Router e endpoint principali

| Prefisso / Tag | Descrizione | Endpoint principali |
|----------------|-------------|--------------------|
| **health** | Health check | `GET /health`, `GET /health/db` |
| **test** | Solo dev/test | `POST /test/seed-user` |
| **activity** | Log attività | `GET /activity/file/{file_id}`, `GET /activity/folder/{folder_id}`, `GET /activity/recent` |
| **auth** | Login, register, TOTP, PIN | `GET /auth/email-available`, `POST /auth/register`, `POST /auth/login`, `POST /auth/totp/setup`, `POST /auth/totp/verify`, `POST /auth/token/refresh`, `POST /auth/verify-pin`, `POST /auth/set-pin` |
| **auth/webauthn** | WebAuthn/Passkey | `POST /auth/webauthn/register/begin|complete`, `POST /auth/webauthn/authenticate/begin|complete`, `GET /auth/webauthn/credentials`, `DELETE /auth/webauthn/credentials/{id}` |
| **users** | Profilo e chiavi | `GET /users/me`, `PUT /users/me`, `POST /users/me/public-key`, `PUT /users/me/private-key`, `GET /users/{id}/public-key`, `GET /users/search`, … |
| **folders** | Cartelle | `POST /folders/`, `GET /folders/`, `GET /folders/shared-with-me`, `GET /folders/{id}/children`, `GET /folders/{id}/files`, `PATCH /folders/{id}`, `DELETE /folders/{id}`, … |
| **files** | File e versioni | `POST /files/upload`, `GET /files/{id}`, `GET /files/{id}/download`, `GET /files/{id}/key`, `PATCH /files/{id}`, `POST /files/{id}/copy`, `POST /files/{id}/version`, `GET /files/{id}/versions`, `DELETE /files/{id}/destroy`, … |
| **metadata** (files) | Metadati e tag | `PUT /files/{id}/metadata`, `GET /files/{id}/metadata`, `GET /files/{id}/tags`, `PUT /files/{id}/thumbnail`, … |
| **search** | Ricerca | `GET /search/files` (parametri: q, shared_with_me, folder_id, …), `GET /search/tags/suggest` |
| **share-links** | Link pubblici | `POST /files/{file_id}/share-links`, `GET /files/{file_id}/share-links`, `DELETE /share-links/{link_id}`, `GET /public/share/{token}`, `POST /public/share/{token}/verify-pin`, `POST /public/share/{token}/download` |
| **sync** | Eventi sync desktop | sotto `share_links.sync_router` |
| **trash** | Cestino | `GET /trash`, `POST /trash/file/{id}`, `POST /trash/folder/{id}`, `POST /trash/restore/file|folder/{id}`, `DELETE /trash/file|folder/{id}`, `DELETE /trash/empty` |
| **signatures** (files) | Firma digitale | `POST /files/{id}/sign`, `GET /files/{id}/signatures`, `POST /files/{id}/verify-signature` |
| **guest** | Sessioni guest | `POST /guest/...`, `GET /guest/...`, `public_router` per inviti |
| **permissions** | ACL file/cartella | `POST /permissions/`, `DELETE /permissions/{id}`, `PATCH /permissions/{id}`, `GET /permissions/file|folder/{id}`, `GET /permissions/my-shared-resources`, `GET /permissions/expiring-soon`, … |
| **notifications** | Notifiche in-app | `GET /notifications`, `GET /notifications/count`, `POST /notifications/read`, `DELETE /notifications/{id}`, `GET /notifications/stream` (SSE) |
| **gdpr** | GDPR (consent, erasure, export) | `GET /gdpr/unsubscribe`, `POST /gdpr/erasure`, `GET /gdpr/erasure/status`, `GET /gdpr/export`, `POST /gdpr/consent`, … |
| **audit** | Audit e report | `GET /audit/verify-chain`, `GET /audit/file/{id}/history`, `GET /audit/logs`, `GET /audit/logs/export/csv`, `GET /audit/dashboard/me|admin`, … |
| **groups** | Gruppi utenti | `POST /groups/`, `GET /groups/`, `POST /groups/{id}/members`, `DELETE /groups/{id}/members/{user_id}` |

---

## 5. Backend: modelli e servizi

### Modelli principali (`backend/app/models/`)

- **User**: email, password hash, chiavi pubbliche/private (cifrate), TOTP, WebAuthn, pin_hash, …
- **File, Folder**: nome cifrato, owner, parent (folder), storage MinIO, versioni, metadati, self-destruct, …
- **Permission**: ACL per file/cartella (read/write), TTL, block_delete, block_link, require_pin, inherited_from_folder_id
- **ShareLink**: token, password/PIN, scadenza, max_downloads, block_delete, require_pin, pin_hash
- **ActivityLog**: user_id, action, target_type (file/folder), target_id, detail, created_at
- **Notification**, **AuditLog**, **Group**, **GuestSession**, **SyncEvent**, **FileSignature**, **GdprConsent**, …

Schema DB: **`axshare`** (PostgreSQL). Migrations: **Alembic** in `backend/alembic/versions/`. Mantenere **una sola head**; in caso di due heads creare una migration di merge.

### Servizi (`backend/app/services/`)

- **auth_service**, **webauthn_service**: login, JWT, TOTP, WebAuthn
- **permission_service**: grant/revoke, ereditarietà cartella→file, block_delete/block_link/require_pin
- **share_link_service**: creazione/revoca link, verifica password/PIN, download pubblico
- **storage**: MinIO (upload/download, bucket file e chiavi)
- **activity_service**: scrittura log attività
- **search_service**: ricerca file (filtri, condivisioni)
- **notification_service**: creazione notifiche, integrazione Redis pub/sub
- **audit_service**, **report_service**, **gdpr_service**, **email_service**, **signature_service**, **guest_service**, **sync_event_service**, **destruct_service**, **brute_force_service**

### Middleware ed eccezioni

- **CORSMiddleware**: allow_origins da config (`allowed_origins`), credentials, metodi e header standard.
- **AuditLogMiddleware**: log richiesta (method, path, IP, status, duration).
- **RateLimitMiddleware**, **SecurityHeadersMiddleware**, **RequestValidationMiddleware**.
- **exceptions.py**:
  - Tutte le risposte di errore (4xx/5xx) includono **header CORS** (`_cors_headers`) per evitare “blocked by CORS” in caso di 500.
  - Handler per **ExceptionGroup** (PEP 654 / backport): log della prima sub-eccezione e risposta 500 con CORS.
  - Handler generico per **Exception**: log e 500 con CORS.

**Resilienza endpoint** (per evitare 500 a cascata):

- **GET /activity/file/{file_id}** e **GET /files/{file_id}/share-links**: in caso di eccezione (DB, serializzazione, …) si logga e si restituisce `[]` invece di 500.

---

## 6. Frontend: pagine e codice

### Pagine principali (`frontend/app/`)

- **(app)/dashboard/page.tsx**: home autenticata, evidenze, attività recente
- **(app)/i-miei-file/page.tsx**: albero cartelle e file
- **(app)/condivisi/page.tsx**: file/cartelle condivisi con me (ricerca, activity e share-links per item in **batch** per evitare troppe richieste parallele)
- **(app)/cestino/page.tsx**: trash, restore, svuota
- **(app)/preferiti/page.tsx**: file/cartelle in evidenza
- **(app)/media/page.tsx**: galleria media
- **(app)/settings/page.tsx**, **settings/security**, **settings/sharing**, **settings/gdpr**
- **(app)/admin/page.tsx**, **admin/users**, **admin/audit**
- **(app)/desktop/sync/page.tsx**, **desktop/onboarding**
- **share/[token]/page.tsx**: pagina pubblica share link (password/PIN, download)
- **login**, **register**, **setup-keys**, **invite/[token]**, **guest/dashboard**

### Client API e dati

- **lib/api.ts**: unico client Axios (`apiClient`), base URL da `NEXT_PUBLIC_API_URL` (default `http://localhost:8000/api/v1`). Interceptor: JWT da localStorage (o da Tauri storage se in desktop). Retry su 401 con refresh token. Export: `authApi`, `usersApi`, `foldersApi`, `filesApi`, `activityApi`, `searchApi`, `shareLinksApi`, `permissionsApi`, `trashApi`, `notificationsApi`, …
- **hooks**: `useFiles`, `useCrypto`, `useNotifications`, `usePinVerification`, …
- **context**: `AuthContext`, `NotificationsContext`
- **lib/crypto.ts**, **lib/keyManager.ts**: cifratura lato client (chiavi utente, file key, nome file cifrato)

### Convenzioni UI

- **.cursor/rules/axshare-ui-conventions.mdc**: tabelle file/cartelle (icone 52×52 file, 44×44 cartella, padding, classi `file-table-row-file` / `file-table-row-folder`), card “In Evidenza” (icone 68×58 cartella, 56×48 file), uso di `getFolderColorIcon` da `@/lib/fileIcons`.
- **.cursor/rules/axshare-desktop-client.mdc**: finestra desktop adattiva in altezza, nessuno scroll verticale nella modale; `ResizeObserver` + comando Tauri `set_main_window_size`.

---

## 7. Desktop (Tauri)

- **desktop/src-tauri/**: crate Rust `axshare_desktop_lib`, Tauri 2, plugin (shell, fs, http, dialog, deep-link, single-instance, …).
- **Comandi**: esposti al frontend per finestra (es. `set_main_window_size`), storage sicuro token, sync e WebDAV.
- **Virtual disk / WebDAV**: `virtual_disk/`, `webdav_server.rs` — disco virtuale e server WebDAV locale per sync.
- La UI è la stessa del frontend (Next) con build `next build:tauri`; il contesto “desktop” si rileva con `isRunningInTauri()` e si usano chiavi/token da storage sicuro invece che da localStorage.

---

## 8. Interventi recenti (sessione corrente)

Interventi effettuati per stabilizzare navigazione e ridurre errori 500/CORS:

1. **CORS su risposte di errore**  
   In `backend/app/exceptions.py`: tutte le risposte degli handler (HTTP, validazione, eccezione generica, ExceptionGroup) includono gli header CORS (`_cors_headers(origin)`), così il browser non segnala “blocked by CORS” quando il backend restituisce 5xx.

2. **Handler per ExceptionGroup**  
   In `backend/app/exceptions.py`: registrato handler per `ExceptionGroup` (PEP 654; backport su Python 3.9). In caso di errore in task group (es. anyio/Starlette), si logga la prima sub-eccezione e si risponde con 500 e CORS.

3. **Compatibilità Python 3.9**  
   Sostituito `X | None` con `Optional[X]` e import da `typing` in:  
   `app/exceptions.py`, `app/api/v1/endpoints/auth.py`, `app/api/v1/endpoints/notifications.py`, `app/core/redis_pubsub.py`.

4. **Merge migration Alembic**  
   Creata `backend/alembic/versions/merge_51d6_b2c3.py` per unire le due heads (`51d61139ce5a`, `b2c3d4e5f6a1`) in un’unica head `merge_51d6_b2c3`, così `alembic upgrade head` applica tutte le migration.

5. **Resilienza endpoint activity e share-links**  
   - **GET /activity/file/{file_id}**: try/except (incluso `ExceptionGroup`); in caso di errore log + ritorno `[]`.  
   - **GET /files/{file_id}/share-links**: try/except; in caso di errore log + ritorno `[]`.  
   Così errori DB o serializzazione non producono 500 e la navigazione resta utilizzabile.

6. **Batching richieste in pagina Condivisi**  
   In `frontend/app/(app)/condivisi/page.tsx`: introdotta helper `runInBatches(items, fn, batchSize=6)`. I due `useEffect` che caricavano activity e share-links **per ogni file** con `Promise.all` ora eseguono le richieste in batch da 6, per evitare sovraccarico e `ERR_INSUFFICIENT_RESOURCES` nel browser.

---

## 9. Come eseguire il progetto

- **Backend** (dalla root del repo):
  - `cd backend`
  - `source .venv/bin/activate` (o `.venv\Scripts\activate` su Windows)
  - `alembic upgrade head` (se non già fatto)
  - `uvicorn app.main:app --reload --host 0.0.0.0 --port 8000`  
  Se la porta 8000 è occupata: `kill $(lsof -t -i :8000)` (macOS/Linux) e rilanciare uvicorn.

- **Frontend** (da `frontend/`):
  - `npm install` (se necessario)
  - `npm run dev` → tipicamente `http://localhost:3000`

- **Desktop** (da `desktop/`):
  - `npm run dev` (avvia Tauri e build frontend in modalità desktop)

- **Variabili d’ambiente**: backend usa `.env` in `backend/` (o `../.env`); es. `DATABASE_URL`, `REDIS_URL`, `MINIO_*`, `SECRET_KEY`, `ALLOWED_ORIGINS` (JSON array o stringa separata da virgole), `JWT_*_PATH`, ecc.

---

## 10. Convenzioni per il supporto AI futuro

- **Backend**
  - Python 3.9: usare `Optional[X]`, `List[X]` da `typing`, non `X | None` o `list[X]`.
  - Nuove route in `app/api/v1/endpoints/`, router registrati in `app/api/v1/router.py`.
  - Nuove tabelle/colonne: creare migration Alembic; in caso di più heads, aggiungere una migration di merge.
  - Risposte di errore: gli handler in `exceptions.py` aggiungono già CORS; mantenerli coerenti per nuovi tipi di eccezione se necessario.

- **Frontend**
  - Chiamate API: usare sempre `lib/api.ts` (e gli export `*Api`) o gli hook che li usano; non creare client Axios alternativi.
  - Pagine con liste di file/cartelle: rispettare `.cursor/rules/axshare-ui-conventions.mdc` (icone, padding, classi tabella/card).
  - Evitare `Promise.all` su grandi liste di richieste per item; preferire batch (es. `runInBatches`) o endpoint batch lato backend.

- **Desktop**
  - Modifiche alla UI desktop: rispettare `.cursor/rules/axshare-desktop-client.mdc` (altezza finestra adattiva, nessuno scroll nella modale).

- **Documentazione**
  - Aggiornare questo `riepilogo.md` quando si aggiungono router, modelli, servizi o convenzioni rilevanti per il contesto AI.

---

*Ultimo aggiornamento: in base agli interventi descritti nella sezione 8 (CORS, ExceptionGroup, Python 3.9, merge migration, resilienza activity/share-links, batching Condivisi).*
