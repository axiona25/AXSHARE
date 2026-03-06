"""Fixture condivise per test Fase 9 (firma digitale)."""

import pytest


@pytest.fixture(autouse=True)
def clear_settings_cache():
    try:
        from app.config import get_settings
        get_settings.cache_clear()
    except Exception:
        pass
