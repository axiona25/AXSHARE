"""Event bus per notifiche real-time (SSE) agli utenti."""

import asyncio
import uuid
from typing import Dict, Tuple

from asyncio import Queue


class EventBus:
    """Bus per eventi per-utente. Usato da SSE /files/events."""

    def __init__(self) -> None:
        self._subscribers: Dict[str, Tuple[str, Queue]] = {}

    def subscribe(self, user_id: str) -> Tuple[str, Queue]:
        sub_id = str(uuid.uuid4())
        queue: Queue = Queue()
        self._subscribers[sub_id] = (user_id, queue)
        return sub_id, queue

    def unsubscribe(self, sub_id: str) -> None:
        self._subscribers.pop(sub_id, None)

    async def publish(self, user_id: str, event: dict) -> None:
        """Invia evento a tutti i subscriber dell'utente."""
        for _sub_id, (uid, queue) in list(self._subscribers.items()):
            if uid == user_id:
                await queue.put(event)


event_bus = EventBus()
