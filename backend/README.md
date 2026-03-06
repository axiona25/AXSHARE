# AXSHARE Backend

FastAPI + SQLAlchemy 2.0 async + Celery + Redis. Python 3.12.

## Setup locale (macOS)

- **Servizi Homebrew:** fermali prima di ogni sessione per evitare conflitti con Docker (5432, 6379):
  ```bash
  brew services stop postgresql@17
  brew services stop redis
  ```
- **Venv:** attiva sempre prima di run, test e migration:
  ```bash
  source .venv/bin/activate   # da backend/
  # oppure dalla root:
  source backend/.venv/bin/activate
  ```

## Comandi

- **Run:** `uvicorn app.main:app --reload`
- **Tests:** `pytest tests/ -v`
- **Migrations:** `alembic upgrade head` (dopo Fase 1.3)
