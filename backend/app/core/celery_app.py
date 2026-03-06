"""Celery app per task asincroni (TASK 13.1)."""

from celery import Celery
from celery.schedules import crontab

from app.config import get_settings


def create_celery_app() -> Celery:
    settings = get_settings()
    broker = settings.celery_broker_url or settings.redis_url

    app = Celery(
        "axshare",
        broker=broker,
        backend=broker,
        include=[
            "app.tasks.file_tasks",
            "app.tasks.notification_tasks",
            "app.tasks.gdpr_tasks",
            "app.tasks.email_tasks",
        ],
    )

    app.conf.update(
        task_serializer="json",
        accept_content=["json"],
        result_serializer="json",
        timezone="UTC",
        enable_utc=True,
        task_track_started=True,
        task_acks_late=True,
        worker_prefetch_multiplier=1,
        task_soft_time_limit=300,
        task_time_limit=600,
        beat_schedule={
            "check-self-destruct": {
                "task": "app.tasks.file_tasks.process_self_destruct_files",
                "schedule": crontab(minute="*/5"),
            },
            "check-expiring-permissions": {
                "task": "app.tasks.notification_tasks.notify_expiring_permissions",
                "schedule": crontab(minute=0),
            },
            "gdpr-retention-cleanup": {
                "task": "app.tasks.gdpr_tasks.run_retention_cleanup",
                "schedule": crontab(hour=2, minute=0),
            },
            "process-pending-erasures": {
                "task": "app.tasks.gdpr_tasks.process_pending_erasures",
                "schedule": crontab(hour=3, minute=0),
            },
        },
    )
    return app


celery_app = create_celery_app()
