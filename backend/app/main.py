"""AXSHARE FastAPI application — entry point."""

import inspect
import logging
import os
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.database import engine, init_db
from app.exceptions import register_exception_handlers
from app.middleware.audit import AuditLogMiddleware
from app.middleware.rate_limit import RateLimitMiddleware
from app.middleware.request_validation import RequestValidationMiddleware
from app.middleware.security import SecurityHeadersMiddleware

logging.basicConfig(level=logging.INFO)
structlog.configure(
    processors=[
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.stdlib.add_log_level,
        structlog.processors.JSONRenderer(),
    ]
)

logger = structlog.get_logger()
settings = get_settings()

# Sentry (init prima della creazione app)
if getattr(settings, "sentry_dsn", None):
    import sentry_sdk
    from sentry_sdk.integrations.fastapi import FastApiIntegration
    from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration

    def _sanitize_sentry_event(event, hint):
        if "request" in event:
            headers = event["request"].get("headers") or {}
            if isinstance(headers, dict):
                headers = dict(headers)
                headers.pop("Authorization", None)
                headers.pop("authorization", None)
                event["request"]["headers"] = headers
            event["request"].pop("data", None)
        return event

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        integrations=[
            FastApiIntegration(transaction_style="endpoint"),
            SqlalchemyIntegration(),
        ],
        traces_sample_rate=0.1,
        profiles_sample_rate=0.1,
        environment=getattr(settings, "environment", "development"),
        release=os.environ.get("APP_VERSION", getattr(settings, "app_version", "dev")),
        before_send=_sanitize_sentry_event,
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting AXSHARE API", version=settings.app_version)
    if getattr(settings, "use_vault", False):
        try:
            from app.core.vault import VaultClient
            logger.info("Caricamento segreti da Vault...")
            secrets = VaultClient.get_app_secrets()
            if secrets.get("secret_key"):
                settings.secret_key = secrets["secret_key"]
            if secrets.get("postgres_password") and getattr(settings, "database_url", None):
                import re
                url = settings.database_url
                settings.database_url = re.sub(
                    r"://([^:]+):[^@]+@",
                    lambda m: f"://{m.group(1)}:{secrets['postgres_password']}@",
                    url,
                    count=1,
                )
            if secrets.get("redis_password") and getattr(settings, "redis_url", None):
                import re
                url = settings.redis_url
                settings.redis_url = re.sub(
                    r"://:[^@]+@",
                    f"://:{secrets['redis_password']}@",
                    url,
                    count=1,
                )
            if secrets.get("minio_root_password"):
                settings.minio_secret_key = secrets["minio_root_password"]
            logger.info("Vault: %s segreti caricati", len(secrets))
        except Exception as e:
            logger.warning("Vault caricamento segreti fallito: %s", e)

    try:
        await init_db()
    except Exception as e:
        logger.warning("Database init non disponibile (PostgreSQL irraggiungibile o errore): %s", e)

    try:
        from app.services.storage import get_storage_service
        storage = get_storage_service()
        await storage.ensure_buckets()
    except Exception as e:
        logger.warning("MinIO/storage non disponibile (bucket check fallito): %s", e)

    logger.info("AXSHARE backend ready")
    yield
    logger.info("Shutting down AXSHARE API")
    try:
        from app.services.redis_service import close_redis
        await close_redis()
    except Exception as e:
        logger.warning("Chiusura Redis fallita: %s", e)
    try:
        # SQLAlchemy AsyncEngine: dispose() può essere sync (2.0) o async (alcune versioni).
        # Usiamo il risultato della chiamata: se è awaitable lo attendiamo (più affidabile di iscoroutinefunction).
        dispose_result = engine.dispose()
        if inspect.isawaitable(dispose_result):
            await dispose_result
    except Exception as e:
        logger.warning("Dispose engine DB fallito: %s", e)
    logger.info("Shutdown complete")


def create_application() -> FastAPI:
    app = FastAPI(
        title="AXSHARE API",
        version=settings.app_version,
        description="""
## AXSHARE — Secure File Sharing API

API per la piattaforma di condivisione file con cifratura **end-to-end**.

### Autenticazione
- **JWT Bearer**: header `Authorization: Bearer <token>`
- **WebAuthn/Passkey**: flusso in due step (begin → complete)

### Crittografia
Tutti i file vengono cifrati **lato client** con AES-256-GCM prima
dell'upload. Il server non vede mai il contenuto in chiaro.

### Conformità
- **GDPR Art. 17/20**: endpoint `/gdpr/erasure` e `/gdpr/export`
- **NIS2**: rate limiting, brute-force protection, audit log
        """,
        contact={
            "name": "AXSHARE Support",
            "email": "support@axshare.io",
        },
        license_info={
            "name": "Proprietario",
        },
        docs_url="/api/docs" if settings.debug else None,
        redoc_url="/api/redoc" if settings.debug else None,
        openapi_url="/api/openapi.json" if settings.debug else None,
        lifespan=lifespan,
        openapi_tags=[
            {"name": "auth", "description": "Autenticazione: JWT, WebAuthn/Passkey, TOTP"},
            {"name": "files", "description": "Gestione file: upload cifrato, download, versioni, self-destruct"},
            {"name": "folders", "description": "Cartelle e navigazione file system"},
            {"name": "permissions", "description": "Controllo accessi: grant, revoke, TTL, condivisione gruppi"},
            {"name": "share-links", "description": "Link di condivisione pubblica con password e scadenza"},
            {"name": "guest", "description": "Sessioni guest: invito, accesso temporaneo"},
            {"name": "signatures", "description": "Firma digitale RSA-PSS e verifica autenticità"},
            {"name": "groups", "description": "Gruppi utenti per condivisione multipla"},
            {"name": "search", "description": "Ricerca file cifrata con filtri"},
            {"name": "notifications", "description": "Notifiche in-app"},
            {"name": "audit", "description": "Audit log con catena di hash — solo admin"},
            {"name": "gdpr", "description": "Compliance GDPR: erasure (Art.17), export (Art.20), consensi"},
            {"name": "health", "description": "Health check e metriche Prometheus"},
            {"name": "metadata", "description": "Metadati e tag file"},
            {"name": "users", "description": "Profilo utente e preferenze"},
        ],
    )

    app.add_middleware(AuditLogMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(RateLimitMiddleware)
    app.add_middleware(RequestValidationMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
        max_age=600,
    )

    from app.api.v1.router import api_router

    app.include_router(api_router, prefix="/api/v1")

    register_exception_handlers(app)

    @app.get("/health")
    async def health():
        return {
            "status": "ok",
            "version": settings.app_version,
            "env": settings.environment,
        }

    # Prometheus metrics
    try:
        from prometheus_fastapi_instrumentator import Instrumentator

        Instrumentator(
            should_group_status_codes=True,
            should_ignore_untemplated=True,
            should_respect_env_var=True,
            should_instrument_requests_inprogress=True,
            excluded_handlers=["/metrics", "/health", "/api/v1/health"],
            inprogress_name="http_requests_inprogress",
            inprogress_labels=True,
        ).instrument(app).expose(app, endpoint="/metrics", include_in_schema=False)
    except ImportError:
        pass

    return app


app = create_application()
