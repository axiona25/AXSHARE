"""Health check endpoints: light (LB) e detailed (dipendenze)."""

import os
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db

router = APIRouter(tags=["health"])


@router.get(
    "/health",
    summary="Health check leggero",
    description="Verifica che il servizio sia attivo. Non richiede autenticazione.",
    include_in_schema=True,
)
async def health_check():
    """Health check leggero per load balancer (sempre 200 se il processo è up)."""
    settings = get_settings()
    return {
        "status": "ok",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "version": getattr(settings, "app_version", "dev"),
    }


@router.get(
    "/health/detailed",
    summary="Health check dettagliato",
    description="Verifica DB, Redis, MinIO/S3 e spazio disco. Non richiede autenticazione.",
)
async def detailed_health_check(db: AsyncSession = Depends(get_db)):
    """
    Health check dettagliato con verifica dipendenze.
    Usato per monitoring interno — NON esposto pubblicamente.
    """
    settings = get_settings()
    checks = {}
    overall = "healthy"

    # Database
    try:
        start = datetime.now(timezone.utc)
        await db.execute(text("SELECT 1"))
        latency_ms = (datetime.now(timezone.utc) - start).total_seconds() * 1000
        checks["database"] = {"status": "ok", "latency_ms": round(latency_ms, 2)}
    except Exception as e:
        checks["database"] = {"status": "error", "error": str(e)}
        overall = "degraded"

    # Redis
    try:
        from app.services.redis_service import get_redis

        start = datetime.now(timezone.utc)
        redis = await get_redis()
        await redis.ping()
        latency_ms = (datetime.now(timezone.utc) - start).total_seconds() * 1000
        checks["redis"] = {"status": "ok", "latency_ms": round(latency_ms, 2)}
    except Exception as e:
        checks["redis"] = {"status": "error", "error": str(e)}
        overall = "degraded"

    # MinIO / Storage
    try:
        from app.services.storage import get_storage_service

        storage = get_storage_service()
        await storage.health_check()
        checks["storage"] = {"status": "ok"}
    except Exception as e:
        checks["storage"] = {"status": "error", "error": str(e)}
        overall = "degraded"

    # Disco
    try:
        stat = os.statvfs("/")
        free_gb = (stat.f_bavail * stat.f_frsize) / 1_073_741_824
        total_gb = (stat.f_blocks * stat.f_frsize) / 1_073_741_824
        used_pct = round((1 - stat.f_bavail / stat.f_blocks) * 100, 1)
        checks["disk"] = {
            "status": "warning" if used_pct > 85 else "ok",
            "free_gb": round(free_gb, 2),
            "total_gb": round(total_gb, 2),
            "used_pct": used_pct,
        }
        if used_pct > 95:
            overall = "degraded"
    except Exception as e:
        checks["disk"] = {"status": "error", "error": str(e)}

    return {
        "status": overall,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "version": getattr(settings, "app_version", "dev"),
        "checks": checks,
    }
