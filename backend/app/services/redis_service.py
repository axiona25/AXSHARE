"""
Redis service — cache, sessioni, permessi a tempo, rate limiting.
"""

import json
from typing import Any, Optional

import redis.asyncio as redis
import structlog

from app.config import get_settings

logger = structlog.get_logger()
settings = get_settings()

_redis_client: Optional[redis.Redis] = None


async def get_redis() -> redis.Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = redis.from_url(
            settings.redis_url,
            encoding="utf-8",
            decode_responses=True,
        )
    return _redis_client


async def close_redis() -> None:
    """Chiude il client Redis (per graceful shutdown). Non solleva se Redis è già irraggiungibile."""
    global _redis_client
    if _redis_client is not None:
        try:
            await _redis_client.aclose()
            logger.info("Redis client closed")
        except Exception as e:
            logger.warning("Chiusura Redis client fallita: %s", e)
        _redis_client = None


async def cache_set(key: str, value: Any, ttl_seconds: int = 3600) -> None:
    client = await get_redis()
    serialized = json.dumps(value) if not isinstance(value, str) else value
    await client.setex(key, ttl_seconds, serialized)


async def cache_get(key: str) -> Optional[Any]:
    client = await get_redis()
    value = await client.get(key)
    if value is None:
        return None
    try:
        return json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return value


async def cache_delete(key: str) -> None:
    client = await get_redis()
    await client.delete(key)


async def cache_exists(key: str) -> bool:
    client = await get_redis()
    return bool(await client.exists(key))


# Chiavi per permessi a tempo
def permission_key(user_id: str, resource_id: str) -> str:
    return f"perm:{user_id}:{resource_id}"


# Chiavi per sessioni
def session_key(session_id: str) -> str:
    return f"session:{session_id}"


# Chiavi per rate limiting
def rate_limit_key(user_id: str, action: str) -> str:
    return f"ratelimit:{action}:{user_id}"
