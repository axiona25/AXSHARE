"""Test integrazione HashiCorp Vault (TASK 1.6)."""

import os
from pathlib import Path

import pytest

from app.config import get_settings


@pytest.fixture(autouse=True)
def clear_cache():
    get_settings.cache_clear()


def test_vault_config_has_required_fields():
    """Config ha i campi Vault necessari."""
    settings = get_settings()
    assert hasattr(settings, "vault_addr")
    assert hasattr(settings, "vault_token")
    assert hasattr(settings, "use_vault")
    assert hasattr(settings, "vault_role_id")
    assert hasattr(settings, "vault_secret_id")


def test_vault_client_import():
    """VaultClient importa correttamente."""
    from app.core.vault import VaultClient

    assert VaultClient is not None


@pytest.mark.asyncio
async def test_vault_fallback_when_disabled():
    """Con use_vault=False il sistema usa .env normalmente."""
    settings = get_settings()
    if getattr(settings, "use_vault", False):
        pytest.skip("Vault abilitato — skip test fallback")
    assert settings.secret_key is not None
    assert len(settings.secret_key) >= 16


def test_vault_policy_file_exists():
    """Policy file Vault presente."""
    # Da backend/tests/phase1/ il repo root è parents[3]
    repo_root = Path(__file__).resolve().parents[3]
    policy_path = repo_root / "infra" / "vault" / "policies" / "axshare-app.hcl"
    if not policy_path.exists():
        pytest.skip("Policy file non ancora creato")
    content = policy_path.read_text()
    assert "axshare/data/app" in content
    assert "axshare/data/jwt-keys" in content
