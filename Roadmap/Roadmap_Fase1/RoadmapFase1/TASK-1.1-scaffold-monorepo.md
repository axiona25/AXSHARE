# TASK 1.1 — Scaffold Monorepo AXSHARE
> **Fase:** 1 — Foundation & Infrastruttura
> **Prerequisiti:** nessuno — primo task del progetto
> **Path progetto:** `/Users/r.amoroso/Documents/Cursor/AXSHARE`
> **Output atteso:** struttura directory completa, file config base, frontend inizializzato

---

## Prompt Cursor

```
Sei un senior software engineer. Devi creare lo scaffold completo del progetto AXSHARE
in /Users/r.amoroso/Documents/Cursor/AXSHARE.

AXSHARE e' una piattaforma enterprise di filesharing end-to-end encrypted, GDPR e NIS2 compliant.

Stack:
- Backend: FastAPI + Python 3.12 + SQLAlchemy 2.0 async + Alembic
- Frontend: Next.js 14 App Router + React + TypeScript + shadcn/ui + Tailwind
- Desktop: Tauri 2 (solo scaffold per ora, sviluppo in Fase 7)
- DB: PostgreSQL 16 | Cache: Redis 7 | Storage: MinIO | KMS: HashiCorp Vault

════════════════════════════════════════════════
STEP 1 — Crea la struttura directory
════════════════════════════════════════════════

Crea esattamente questa struttura:

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
│   └── package.json
├── desktop/
│   ├── src/
│   │   └── main.tsx
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
├── .env.example
├── .env.test
├── .gitignore
├── docker-compose.yml
└── README.md

════════════════════════════════════════════════
STEP 2 — Crea backend/pyproject.toml
════════════════════════════════════════════════

[build-system]
requires = ["setuptools>=68", "wheel"]
build-backend = "setuptools.backends.legacy:build"

[project]
name = "axshare-backend"
version = "0.1.0"
requires-python = ">=3.12"

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]

[tool.ruff]
line-length = 88
target-version = "py312"

[tool.mypy]
python_version = "3.12"
strict = true

════════════════════════════════════════════════
STEP 3 — Crea backend/requirements.txt
════════════════════════════════════════════════

fastapi==0.115.0
uvicorn[standard]==0.30.0
gunicorn==22.0.0
sqlalchemy[asyncio]==2.0.36
alembic==1.13.3
asyncpg==0.29.0
redis[hiredis]==5.1.1
minio==7.2.9
hvac==2.3.0
pynacl==1.5.0
cryptography==43.0.3
python-jose[cryptography]==3.3.0
passlib[bcrypt]==1.7.4
pyotp==2.9.0
py-webauthn==2.2.0
pyhanko==0.25.1
celery[redis]==5.4.0
pydantic==2.9.2
pydantic-settings==2.6.0
python-multipart==0.0.12
httpx==0.27.2
python-dotenv==1.0.1
structlog==24.4.0

════════════════════════════════════════════════
STEP 4 — Crea backend/requirements-dev.txt
════════════════════════════════════════════════

pytest==8.3.3
pytest-asyncio==0.24.0
pytest-cov==5.0.0
httpx==0.27.2
faker==30.8.1
ruff==0.7.0
mypy==1.13.0
black==24.10.0

════════════════════════════════════════════════
STEP 5 — Crea backend/app/config.py
════════════════════════════════════════════════

from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # App
    app_name: str = "AXSHARE"
    app_version: str = "0.1.0"
    debug: bool = False
    environment: str = "development"

    # Database
    database_url: str
    database_pool_size: int = 10
    database_max_overflow: int = 20

    # Redis
    redis_url: str

    # MinIO
    minio_endpoint: str
    minio_port: int = 9000
    minio_access_key: str
    minio_secret_key: str
    minio_bucket_files: str = "axshare-files"
    minio_bucket_keys: str = "axshare-keys"
    minio_secure: bool = False

    # Vault
    vault_addr: str
    vault_token: str
    vault_mount_path: str = "axshare"

    # JWT RS256
    jwt_algorithm: str = "RS256"
    jwt_private_key_path: str = "./keys/jwt_private.pem"
    jwt_public_key_path: str = "./keys/jwt_public.pem"
    jwt_access_token_expire_minutes: int = 60
    jwt_refresh_token_expire_days: int = 30

    # Security
    secret_key: str
    allowed_origins: list[str] = ["http://localhost:3000"]

    # WebAuthn
    webauthn_rp_id: str = "localhost"
    webauthn_rp_name: str = "AXSHARE"
    webauthn_origin: str = "http://localhost:3000"


@lru_cache()
def get_settings() -> Settings:
    return Settings()

════════════════════════════════════════════════
STEP 6 — Crea backend/app/main.py
════════════════════════════════════════════════

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import structlog

from app.config import get_settings
from app.database import init_db

logger = structlog.get_logger()
settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting AXSHARE API", version=settings.app_version)
    await init_db()
    yield
    logger.info("Shutting down AXSHARE API")


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    docs_url="/api/docs" if settings.debug else None,
    redoc_url="/api/redoc" if settings.debug else None,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "app": settings.app_name,
        "version": settings.app_version,
        "environment": settings.environment,
    }

════════════════════════════════════════════════
STEP 7 — Crea backend/app/database.py
════════════════════════════════════════════════

from sqlalchemy.ext.asyncio import (
    create_async_engine,
    AsyncSession,
    async_sessionmaker,
)
from sqlalchemy.orm import DeclarativeBase
from app.config import get_settings
import structlog

logger = structlog.get_logger()
settings = get_settings()

engine = create_async_engine(
    settings.database_url,
    pool_size=settings.database_pool_size,
    max_overflow=settings.database_max_overflow,
    echo=settings.debug,
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


async def init_db():
    logger.info("Initializing database connection")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()

════════════════════════════════════════════════
STEP 8 — Crea .env.example
════════════════════════════════════════════════

# =============================================
# AXSHARE — Environment Variables
# Copia in .env e compila tutti i valori
# MAI committare .env su git
# =============================================

APP_NAME=AXSHARE
APP_VERSION=0.1.0
DEBUG=false
ENVIRONMENT=development

DATABASE_URL=postgresql+asyncpg://axshare:axshare_password@localhost:5432/axshare_db
DATABASE_POOL_SIZE=10
DATABASE_MAX_OVERFLOW=20

REDIS_URL=redis://localhost:6379/0

MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=axshare_minio
MINIO_SECRET_KEY=axshare_minio_secret
MINIO_BUCKET_FILES=axshare-files
MINIO_BUCKET_KEYS=axshare-keys
MINIO_SECURE=false

VAULT_ADDR=http://localhost:8200
VAULT_TOKEN=dev-root-token
VAULT_MOUNT_PATH=axshare

JWT_ALGORITHM=RS256
JWT_PRIVATE_KEY_PATH=./keys/jwt_private.pem
JWT_PUBLIC_KEY_PATH=./keys/jwt_public.pem
JWT_ACCESS_TOKEN_EXPIRE_MINUTES=60
JWT_REFRESH_TOKEN_EXPIRE_DAYS=30

SECRET_KEY=change-this-to-a-random-64-char-string-in-production
ALLOWED_ORIGINS=["http://localhost:3000"]

WEBAUTHN_RP_ID=localhost
WEBAUTHN_RP_NAME=AXSHARE
WEBAUTHN_ORIGIN=http://localhost:3000

════════════════════════════════════════════════
STEP 9 — Crea frontend/types/index.ts
════════════════════════════════════════════════

export interface User {
  id: string
  email: string
  display_name: string
  role: 'admin' | 'user' | 'guest'
  is_active: boolean
  created_at: string
}

export interface FileItem {
  id: string
  name_encrypted: string
  size: number
  owner_id: string
  folder_id: string | null
  is_destroyed: boolean
  created_at: string
  updated_at: string
}

export interface Folder {
  id: string
  name_encrypted: string
  owner_id: string
  parent_id: string | null
  created_at: string
}

export interface Permission {
  id: string
  subject_id: string
  subject_type: 'user' | 'group'
  resource_id: string
  resource_type: 'file' | 'folder'
  level: 'read' | 'write' | 'share' | 'admin'
  expires_at: string | null
}

export interface ApiError {
  detail: string
  code?: string
}

════════════════════════════════════════════════
STEP 10 — Crea frontend/lib/api.ts
════════════════════════════════════════════════

import axios from 'axios'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export const apiClient = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
})

apiClient.interceptors.request.use((config) => {
  const token =
    typeof window !== 'undefined'
      ? localStorage.getItem('axshare_token')
      : null
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

apiClient.interceptors.response.use(
  (r) => r,
  async (error) => {
    if (error.response?.status === 401 && typeof window !== 'undefined') {
      localStorage.removeItem('axshare_token')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await apiClient.get('/health')
    return res.data.status === 'ok'
  } catch {
    return false
  }
}

════════════════════════════════════════════════
STEP 11 — Crea scripts/setup.sh
════════════════════════════════════════════════

#!/bin/bash
set -e
echo "=== AXSHARE Setup ==="

mkdir -p keys

if [ ! -f keys/jwt_private.pem ]; then
  echo "Generazione chiavi JWT RS256..."
  openssl genrsa -out keys/jwt_private.pem 4096
  openssl rsa -in keys/jwt_private.pem -pubout -out keys/jwt_public.pem
  chmod 600 keys/jwt_private.pem
  echo "Chiavi JWT generate in keys/"
fi

if [ ! -f .env ]; then
  cp .env.example .env
  echo ".env creato — compila i valori mancanti"
fi

cd backend
python -m pip install --upgrade pip
pip install -r requirements.txt
pip install -r requirements-dev.txt

cd ../frontend
npm install

echo "=== Setup completato ==="
echo "Prossimo step: esegui 'docker-compose up -d'"

════════════════════════════════════════════════
STEP 12 — Setup Next.js
════════════════════════════════════════════════

Esegui da terminale:

cd /Users/r.amoroso/Documents/Cursor/AXSHARE/frontend
npx create-next-app@14 . --typescript --tailwind --eslint --app --src-dir no --import-alias "@/*" --use-npm
npm install axios swr jose lucide-react clsx tailwind-merge class-variance-authority
npm install @radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-toast
npx shadcn@latest init
# Seleziona: Style=Default, Color=Slate, CSS variables=yes

════════════════════════════════════════════════
STEP 13 — Verifica struttura
════════════════════════════════════════════════

find /Users/r.amoroso/Documents/Cursor/AXSHARE -type f \
  \( -name "*.py" -o -name "*.ts" -o -name "*.tsx" \) \
  | grep -v node_modules | grep -v __pycache__ | grep -v .next | sort

Deve includere almeno:
- backend/app/main.py
- backend/app/config.py
- backend/app/database.py
- backend/requirements.txt
- frontend/lib/api.ts
- frontend/types/index.ts

Al termine aggiorna la sezione "Risultato" in TASK-1.1-scaffold-monorepo.md
```

---

## Risultato
> *Compilare al completamento del task*

- Data completamento: ___
- Struttura creata: ___
- File generati: ___
- Errori riscontrati: ___
