"""Phase 4 conftest — eventuali fixture specifiche per file/storage E2E."""

import pytest


@pytest.fixture(autouse=True)
def _phase4_clear_settings_cache():
    """Assicura cache settings pulita per test upload (JWT/storage)."""
    try:
        from app.config import get_settings
        get_settings.cache_clear()
    except Exception:
        pass
    yield
