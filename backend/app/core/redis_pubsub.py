"""Redis pub/sub helper per notifiche real-time.
Nessun listener/subscriber parte allo startup; get_redis() è lazy (connessione al primo uso).
"""
import json
from typing import Optional

import redis.asyncio as aioredis
import structlog

from app.config import get_settings

logger = structlog.get_logger()
_redis: Optional[aioredis.Redis] = None


async def get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        settings = get_settings()
        _redis = aioredis.from_url(
            settings.redis_url,
            encoding="utf-8",
            decode_responses=True,
        )
    return _redis


def notification_channel(user_id: str) -> str:
    return f"notif:{user_id}"


async def publish_notification(user_id: str, payload: dict) -> None:
    """Pubblica una notifica sul canale Redis dell'utente. Se Redis non è disponibile, logga e non solleva."""
    try:
        r = await get_redis()
        await r.publish(notification_channel(user_id), json.dumps(payload))
    except Exception as e:
        logger.warning("Redis pub/sub non disponibile, notifica non inviata", user_id=user_id, error=str(e))
