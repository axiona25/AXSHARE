# TASK 1.1 — Scaffold Monorepo AXSHARE

> **Fase:** 1 — Foundation & Infrastruttura  
> **Prerequisiti:** nessuno — primo task del progetto  
> **Path progetto:** `/Users/r.amoroso/Documents/Cursor/AXSHARE`  
> **Output atteso:** struttura directory completa, file config base, frontend inizializzato  

---

## Obiettivo

Strutturare il monorepo con backend (FastAPI), frontend (Next.js 14 App Router), desktop (Tauri 2 scaffold), infra, script e config root. Stack: FastAPI + SQLAlchemy 2.0 async + Alembic, Next.js 14 + TypeScript + shadcn/ui + Tailwind, PostgreSQL 16 | Redis 7 | MinIO | HashiCorp Vault.

---

## Struttura creata

```
AXSHARE/
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py
│   │   ├── config.py
│   │   ├── database.py
│   │   ├── api/
│   │   │   ├── __init__.py
│   │   │   └── v1/
│   │   │       └── __init__.py
│   │   ├── core/
│   │   │   ├── __init__.py
│   │   │   ├── security.py
│   │   │   └── exceptions.py
│   │   ├── crypto/
│   │   │   ├── __init__.py
│   │   │   ├── aes.py
│   │   │   ├── rsa.py
│   │   │   ├── ecdh.py
│   │   │   ├── vault.py
│   │   │   └── kdf.py
│   │   ├── models/
│   │   │   └── __init__.py
│   │   ├── schemas/
│   │   │   └── __init__.py
│   │   ├── services/
│   │   │   └── __init__.py
│   │   └── tasks/
│   │       └── __init__.py
│   ├── alembic/
│   │   ├── env.py
│   │   ├── script.py.mako
│   │   └── versions/
│   ├── tests/
│   │   ├── __init__.py
│   │   ├── conftest.py
│   │   └── phase1/
│   │       ├── __init__.py
│   │       └── test_infra.py
│   ├── alembic.ini
│   ├── pyproject.toml
│   ├── requirements.txt
│   └── requirements-dev.txt
├── frontend/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   ├── globals.css
│   │   ├── (auth)/
│   │   │   ├── login/
│   │   │   │   └── page.tsx
│   │   │   └── register/
│   │   │       └── page.tsx
│   │   └── (dashboard)/
│   │       └── dashboard/
│   │           └── page.tsx
│   ├── components/
│   │   ├── ui/
│   │   └── shared/
│   ├── lib/
│   │   ├── api.ts
│   │   ├── crypto.ts
│   │   └── auth.ts
│   ├── types/
│   │   └── index.ts
│   ├── public/
│   ├── next.config.ts
│   ├── tailwind.config.ts
│   ├── tsconfig.json
│   ├── postcss.config.js
│   └── package.json
├── desktop/
│   ├── src/
│   │   ├── main.tsx
│   │   └── App.tsx
│   └── src-tauri/
│       ├── src/
│       │   └── main.rs
│       ├── Cargo.toml
│       └── tauri.conf.json
├── infra/
│   ├── docker/
│   └── terraform/
├── scripts/
│   ├── setup.sh
│   └── test_phase1.sh
├── docs/
│   └── TASK-1.1-scaffold-monorepo.md
├── .env.example
├── .env.test
├── .gitignore
├── docker-compose.yml
└── README.md
```

---

## Deliverable

- [x] Struttura directory come da spec
- [x] `backend/pyproject.toml`, `requirements.txt`, `requirements-dev.txt`
- [x] `backend/app/config.py`, `main.py`, `database.py` (lifespan, structlog, init_db, get_db)
- [x] `backend/app/api/v1/`, `core/`, `crypto/`, `models/`, `schemas/`, `services/`, `tasks/`
- [x] `backend/alembic/` (env.py, script.py.mako, versions/)
- [x] `backend/tests/` con `conftest.py` e `phase1/test_infra.py`
- [x] `frontend/app/` con (auth)/login, register e (dashboard)/dashboard
- [x] `frontend/lib/api.ts`, `crypto.ts`, `auth.ts` — `frontend/types/index.ts`
- [x] `frontend/next.config.ts`, `tailwind.config.ts`, `package.json` (axios, swr, jose, radix)
- [x] `desktop/` Tauri 2 scaffold
- [x] `infra/docker/`, `infra/terraform/`, `scripts/setup.sh`, `test_phase1.sh`
- [x] `.env.example`, `.env.test`, `docker-compose.yml`

---

## Verifica struttura

```bash
find /Users/r.amoroso/Documents/Cursor/AXSHARE -type f \
  \( -name "*.py" -o -name "*.ts" -o -name "*.tsx" \) \
  | grep -v node_modules | grep -v __pycache__ | grep -v .next | sort
```

Deve includere almeno: `backend/app/main.py`, `backend/app/config.py`, `backend/app/database.py`, `backend/requirements.txt`, `frontend/lib/api.ts`, `frontend/types/index.ts`.

---

## Prossimo step (STEP 12)

Setup Next.js + shadcn (da eseguire a mano se si vuole UI completa):

```bash
cd frontend
npx create-next-app@14 . --typescript --tailwind --eslint --app --src-dir no --import-alias "@/*" --use-npm
npm install axios swr jose lucide-react clsx tailwind-merge class-variance-authority
npm install @radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-toast
npx shadcn@latest init
# Seleziona: Style=Default, Color=Slate, CSS variables=yes
```

Nota: la struttura `app/` è già presente; eventualmente adattare i comandi per non sovrascrivere i file esistenti.

---

## Prossimo task

**1.2** — Docker Compose stack completo (`docs/TASK-1.2-docker-compose.md`).

---

## Risultato

- **Data completamento:** 2026-03-04  
- **Struttura creata:** come da spec (backend, frontend, desktop, infra, scripts, root config).  
- **File generati:** tutti i file elencati sopra; `backend/app/db/` rimosso (sostituito da `database.py`).  
- **Errori riscontrati:** nessuno.  
- **Note:** Config backend carica `.env` da `backend/` o da root (`../.env`). Per avviare l’API serve un `.env` con le variabili obbligatorie (es. copia da `.env.example`). Test Phase 1: `cd backend && pytest tests/phase1/ -v` (con stack Docker e `.env` configurato).
