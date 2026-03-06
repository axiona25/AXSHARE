"""Phase3 conftest: clear settings cache before each test so JWT path resolution is consistent."""

import pytest


@pytest.fixture(autouse=True)
def _phase3_clear_settings_cache():
    from app.config import get_settings
    get_settings.cache_clear()
    yield
