# AXSHARE

**Secure File Sharing Platform** — End-to-End Encrypted, GDPR & NIS2 Compliant.

| Layer        | Stack                          |
|-------------|---------------------------------|
| Backend     | FastAPI + PostgreSQL + Redis + Celery |
| Frontend    | Next.js 14 + TypeScript + Tailwind + shadcn/ui |
| Desktop     | Tauri 2 (scaffold — Fase 7)    |
| Storage     | MinIO (S3-compatible)           |
| Key Mgmt    | HashiCorp Vault                |

## Monorepo layout

```
AXSHARE/
├── backend/          # FastAPI, SQLAlchemy, Celery, Alembic, tests
├── frontend/         # Next.js 14 App Router, app/(auth), (dashboard)
├── desktop/          # Tauri 2 scaffold
├── infra/            # docker, terraform
├── scripts/          # setup.sh, wait-for-infra.sh, test_phase1.sh
├── docs/             # Task prompts & roadmap
├── .env.example
├── .env.test
├── docker-compose.yml
└── README.md
```

## Setup locale (macOS)

- **Servizi Homebrew vs Docker:** prima di ogni sessione di sviluppo ferma i servizi Homebrew che confliggono con lo stack Docker (porte 5432 e 6379):
  ```bash
  brew services stop postgresql@17
  brew services stop redis
  ```
- **Venv Python:** il virtualenv è in `backend/.venv`. Attivalo sempre prima di comandi backend:
  ```bash
  source backend/.venv/bin/activate
  ```

## Quick start (Fase 1)

1. `./scripts/setup.sh` — genera chiavi JWT, copia `.env.example` → `.env`, installa dipendenze.
2. Compila `.env` (almeno `DATABASE_URL`, `REDIS_URL` con password, `MINIO_*`, `VAULT_*`, `SECRET_KEY`). Per CORS usa `ALLOWED_ORIGINS=["http://localhost:3000"]` (JSON array).
3. `docker compose up -d` — avvia Postgres, Redis, MinIO (+ bucket init), Vault, Adminer. Opzionale: `./scripts/wait-for-infra.sh`.
4. **Vault (prima volta):** `docker exec axshare_vault sh /vault/config/init.sh` — abilita KV e Transit.
5. Backend: `cd backend && uvicorn app.main:app --reload`
6. Frontend: `cd frontend && npm run dev`

**Servizi:** PostgreSQL 5432 | Redis 6379 | MinIO API 9000, Console 9001 | Vault 8200 | Adminer 8080 | API backend 8000 | Web 3000

## Test Phase 1

Con stack Docker attivo e `.env` configurato (servizi Homebrew fermi, venv attivo):

```bash
brew services stop postgresql@17
brew services stop redis
source backend/.venv/bin/activate
./scripts/test_phase1.sh
# oppure
cd backend && pytest tests/phase1/ -v
```

## Roadmap

Vedi roadmap (PDF o MD). **Fase 1 — Foundation: completata** (1.1 scaffold → 1.2 Docker → 1.3 PostgreSQL + RLS + Alembic → 1.4 MinIO + Redis service → 1.5 Vault + test phase1).

## Note

- Mai hardcodare segreti: usare `.env` o Vault.
- Zero-knowledge: il server non riceve chiavi private né file in chiaro.
