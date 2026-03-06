"""Fixture condivise per la test suite Fase 8."""

import pytest


@pytest.fixture(autouse=True)
def clear_settings_cache():
    """Assicura cache get_settings pulita prima di ogni test (evita 401 JWT)."""
    try:
        from app.config import get_settings
        get_settings.cache_clear()
    except Exception:
        pass
