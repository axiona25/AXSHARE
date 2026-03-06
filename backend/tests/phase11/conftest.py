"""Fixture per test Fase 11 (audit log centralizzato)."""

import pytest


@pytest.fixture(autouse=True)
def prime_settings_cache():
    """Prima la cache di get_settings per evitare 401 tra creazione token e validazione."""
    try:
        from app.config import get_settings
        get_settings()
    except Exception:
        pass
