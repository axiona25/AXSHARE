# E2E Playwright Tests (Task 14.1)

Test E2E browser per flussi critici: auth, upload/download, share link pubblico.

## Prerequisiti

- **Backend** in esecuzione su `http://localhost:8000` con `ENVIRONMENT=test` (per abilitare `/api/v1/test/seed-user`).
- **Frontend**: avviato con `npm run dev` oppure lasciato a Playwright (webServer in `playwright.config.ts` avvia automaticamente `npm run dev` in locale).

## Esecuzione

```bash
# Dalla root frontend
cd frontend
npm run test:e2e
# oppure
npx playwright test --project=chromium --reporter=list
```

Con backend e frontend già avviati:

```bash
E2E_BASE_URL=http://localhost:3000 E2E_API_URL=http://localhost:8000/api/v1 npx playwright test --project=chromium
```

## Test inclusi

- **Auth**: registrazione → redirect dashboard, login credenziali errate → messaggio errore, logout → sessione pulita.
- **File**: upload file e presenza in lista, invariante zero-knowledge (nessuna chiave privata in DOM).
- **Share**: pagina share link pubblica senza login, share link con password → form password.

## Browser

Configurati `chromium` e `firefox`. In CI viene usato solo `chromium`.
