"""Rate limiting middleware (Redis-backed). NIS2 / OWASP."""

import redis.asyncio as aioredis
from fastapi import Request, HTTPException
from starlette.middleware.base import BaseHTTPMiddleware

from app.config import get_settings
from app.core.rate_limits import get_limit_for_path


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Rate limiting basato su Redis per path sensibili."""

    async def dispatch(self, request: Request, call_next):
        settings = get_settings()
        if getattr(settings, "environment", "") == "test":
            return await call_next(request)

        client_ip = request.client.host if request.client else "unknown"
        path = request.url.path
        limit, window = get_limit_for_path(path)
        redis_client = aioredis.from_url(settings.redis_url)

        key = f"rate_limit:{client_ip}:{path}"

        try:
            count = await redis_client.incr(key)
            if count == 1:
                await redis_client.expire(key, window)
            if count > limit:
                await redis_client.aclose()
                raise HTTPException(
                    status_code=429,
                    detail="Troppe richieste. Riprova tra poco.",
                )
        finally:
            await redis_client.aclose()

        return await call_next(request)
