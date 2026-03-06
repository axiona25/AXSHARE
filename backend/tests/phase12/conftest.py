"""Fixture per test Fase 12 (GDPR)."""

import pytest


@pytest.fixture(autouse=True)
def prime_settings_cache():
    try:
        from app.config import get_settings
        get_settings()
    except Exception:
        pass
