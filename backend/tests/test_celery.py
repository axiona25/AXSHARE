"""Test integrazione Celery (TASK 13.1)."""

import pytest


def test_celery_app_created():
    """Celery app si crea correttamente."""
    from app.core.celery_app import celery_app

    assert celery_app is not None
    assert celery_app.main == "axshare"


def test_celery_beat_schedule_has_required_tasks():
    """Beat schedule contiene tutti i task periodici richiesti."""
    from app.core.celery_app import celery_app

    schedule = celery_app.conf.beat_schedule
    required = [
        "check-self-destruct",
        "check-expiring-permissions",
        "gdpr-retention-cleanup",
        "process-pending-erasures",
    ]
    for task_name in required:
        assert task_name in schedule, f"Task periodico mancante: {task_name}"


def test_file_task_importable():
    """Task file importano senza errori."""
    from app.tasks.file_tasks import process_self_destruct_files

    assert process_self_destruct_files is not None


def test_notification_task_importable():
    """Task notifiche importano senza errori."""
    from app.tasks.notification_tasks import (
        notify_expiring_permissions,
        send_guest_invite_email,
    )

    assert notify_expiring_permissions is not None
    assert send_guest_invite_email is not None


def test_gdpr_task_importable():
    """Task GDPR importano senza errori."""
    from app.tasks.gdpr_tasks import (
        run_retention_cleanup,
        process_pending_erasures,
    )

    assert run_retention_cleanup is not None
    assert process_pending_erasures is not None
