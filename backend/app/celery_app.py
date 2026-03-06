"""Celery app per task periodici (TTL permessi, notifiche)."""

from celery import Celery
from celery.schedules import crontab

from app.config import get_settings

settings = get_settings()

celery_app = Celery(
    "axshare",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=["app.tasks.permission_tasks", "app.tasks.destruct_tasks"],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    beat_schedule={
        "expire-permissions-every-5-min": {
            "task": "tasks.expire_permissions",
            "schedule": crontab(minute="*/5"),
        },
        "notify-expiring-soon-every-hour": {
            "task": "tasks.notify_expiring_soon",
            "schedule": crontab(minute=0),
        },
        "destroy-expired-files-every-minute": {
            "task": "tasks.destroy_expired_files",
            "schedule": crontab(minute="*"),
        },
    },
)
