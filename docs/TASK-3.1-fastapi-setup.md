# TASK 3.1 — FastAPI App Setup

> **Progetto:** AXSHARE | **Fase:** 3 — Backend Core  
> **Dipendenze:** TASK 1.1, 1.3 completati  

---

## Obiettivo

Configurare l'applicazione FastAPI con struttura modulare: middleware (security headers, rate limit, audit), dipendenze globali (get_db, get_current_user, require_admin), handler eccezioni custom, logging strutturato (structlog).

---

## Deliverable

- [x] **backend/app/middleware/** — `SecurityHeadersMiddleware` (HSTS, CSP, X-Frame-Options, ecc.), `RateLimitMiddleware` (Redis, limiti per path), `AuditLogMiddleware` (log richieste).
- [x] **backend/app/dependencies.py** — `get_db`, `get_current_user` (JWT RS256), `require_admin`.
- [x] **backend/app/exceptions.py** — handler per `HTTPException` e `RequestValidationError`, `register_exception_handlers(app)`.
- [x] **backend/app/main.py** — `create_application()`, CORS, middleware, router `/api/v1`, endpoint `/health`, lifespan (init_db, MinIO buckets).
- [x] **backend/app/api/v1/router.py** — `api_router` (placeholder per auth/files).
- [x] **backend/tests/phase3/test_fastapi_setup.py** — test health endpoint e security headers.

---

## Comandi

```bash
cd backend && uvicorn app.main:app --reload --port 8000
```

---

## Test

```bash
cd backend && source .venv/bin/activate && pytest tests/phase3/test_fastapi_setup.py -v
```

- **test_health_endpoint:** GET /health → 200, `status == "ok"`.
- **test_security_headers:** presenza header `x-content-type-options`, `x-frame-options`.

---

## Risultato

- **Test passati:** 2/2  
- **Errori:** Nessuno  
