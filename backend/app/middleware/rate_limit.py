"""Rate limiting middleware (Redis-backed). NIS2 / OWASP.
Quando il limite è superato restituisce direttamente una JSONResponse 429 con CORS,
senza sollevare HTTPException, per evitare traceback ASGI / ExceptionGroup.
"""

import redis.asyncio as aioredis
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from app.config import get_settings
from app.core.rate_limits import get_limit_for_path
from app.exceptions import get_cors_headers


def _is_localhost(client_ip: str) -> bool:
    return client_ip in ("127.0.0.1", "::1")


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Rate limiting basato su Redis per path sensibili."""

    async def dispatch(self, request: Request, call_next):
        settings = get_settings()
        if getattr(settings, "environment", "") == "test":
            return await call_next(request)
        if not getattr(settings, "rate_limit_enabled", True):
            return await call_next(request)

        client_ip = request.client.host if request.client else "unknown"
        if getattr(settings, "rate_limit_skip_localhost", True) and _is_localhost(client_ip):
            return await call_next(request)

        path = request.url.path
        limit, window = get_limit_for_path(path)
        redis_client = aioredis.from_url(settings.redis_url)

        key = f"rate_limit:{client_ip}:{path}"

        try:
            count = await redis_client.incr(key)
            if count == 1:
                await redis_client.expire(key, window)
            if count > limit:
                # Sempre JSONResponse 429 con CORS (get_cors_headers include Vary: Origin). Non usare raise HTTPException.
                origin = request.headers.get("origin")
                headers = get_cors_headers(origin)
                return JSONResponse(
                    status_code=429,
                    content={"detail": "Troppe richieste. Riprova tra poco."},
                    headers=headers,
                )
        finally:
            await redis_client.aclose()

        return await call_next(request)
