# TASK 14.1 — Playwright: Test E2E Browser — Report completamento

## Riepilogo

Implementati test E2E browser con Playwright per i flussi critici (auth, file, share link). Il backend espone un endpoint di seed solo in ambiente test per creare utenti E2E senza WebAuthn.

## Step completati

### STEP 1 — Playwright

- `frontend`: già presente `@playwright/test` in `package.json`.
- Esecuzione: `npx playwright install chromium firefox` (opzionale firefox) per installare i browser.

### STEP 2 — Configurazione

- **`frontend/playwright.config.ts`**: creato con `testDir: './e2e'`, `fullyParallel: false`, `workers: 1`, `timeout: 30000`, reporter html+list, `baseURL` da `E2E_BASE_URL`, screenshot/video/trace on failure, `ignoreHTTPSErrors: true`, progetti chromium e firefox, `webServer` per avviare `npm run dev` in locale (disattivato in CI).

### STEP 3 — Helper e fixtures

- **`frontend/e2e/fixtures.ts`**: `createTestUser(page)` chiama `POST /api/v1/test/seed-user` (richiede backend con `ENVIRONMENT=test`). `loginViaUI` per login da form. Fixture `loggedInPage` crea utente via seed e porta la pagina su `/dashboard`.

### STEP 4 — Test auth

- **`frontend/e2e/auth.spec.ts`**: tre test — registrazione e redirect a dashboard/setup-keys; login con credenziali errate mostra messaggio errore; logout e verifica che la visita a dashboard richieda re-login.

### STEP 5 — Test file

- **`frontend/e2e/files.spec.ts`**: upload file tramite `data-testid="file-input"`, gestione eventuale passphrase modal, verifica presenza in `file-list`; invariante zero-knowledge (nessun `BEGIN PRIVATE KEY` nel DOM).

### STEP 6 — Test share link

- **`frontend/e2e/share.spec.ts`**: pagina share pubblica accessibile senza login (creazione utente + upload + share link via API, poi navigazione a `/share/:token`); share link con password mostra form password.

### STEP 7 — GitHub Actions

- **`.github/workflows/ci.yml`**: aggiunto job `test-e2e` con `needs: [test-backend, test-frontend]`, servizi postgres, redis, minio, step per install frontend, Playwright chromium, backend (migrazioni + uvicorn), frontend (`npm run dev`), attesa 25s, esecuzione `npx playwright test --project=chromium`, upload artefatto `playwright-report` in caso di fallimento.

### Backend — Endpoint seed E2E

- **`backend/app/api/v1/endpoints/test_seed.py`**: `POST /api/v1/test/seed-user` crea un utente e restituisce `access_token`, `user_id`, `email`. Attivo solo se `ENVIRONMENT=test` (altrimenti 404).
- **`backend/app/api/v1/router.py`**: incluso `test_seed.router`.

### Frontend — data-testid e pagine

- **Login**: form con `email-input`, `password-input`, `login-button`, `error-message` (mostrato al submit).
- **Register**: form con `email-input`, `password-input`, `confirm-password-input`, `register-button`; submit reindirizza a `/dashboard`.
- **Dashboard**: `dashboard-page`, `file-input`, `file-list`, `user-menu`, `logout-button` (logout reindirizza a `/login`).
- **Share**: `PublicShareView` con `share-page`, `download-button`, `password-form`, `password-input`.

## Esecuzione test

- **Solo frontend (2 test auth passano)**: da `frontend/` con `npm run dev` già avviato o webServer Playwright:  
  `npx playwright test --project=chromium`
- **Completa (tutti i 7 test)**: backend su porta 8000 con `ENVIRONMENT=test`, frontend su 3000, poi:  
  `E2E_BASE_URL=http://localhost:3000 E2E_API_URL=http://localhost:8000/api/v1 npx playwright test --project=chromium`

## Risultato

- **Test totali**: 7 (auth 3, files 2, share 2).
- **Browser**: chromium (e firefox in config, eseguibile in locale).
- **CI**: job `test-e2e` esegue i test con backend e frontend avviati nel workflow; per i test che usano `createTestUser` è necessario che il backend risponda con `ENVIRONMENT=test`.

Data completamento: 2025-03-04
