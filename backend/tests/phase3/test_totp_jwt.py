"""Test TOTP e JWT RS256 — TASK 3.3."""

import os
import uuid

import pyotp
import pytest

from app.config import get_settings
from app.services.auth_service import auth_service


def _jwt_keys_exist() -> bool:
    settings = get_settings()
    return (
        os.path.isfile(settings.jwt_private_key_path)
        and os.path.isfile(settings.jwt_public_key_path)
    )


def test_totp_valid_code():
    secret = auth_service.generate_totp_secret()
    code = pyotp.TOTP(secret).now()
    assert auth_service.verify_totp(secret, code) is True


def test_totp_invalid_code():
    secret = auth_service.generate_totp_secret()
    assert auth_service.verify_totp(secret, "000000") is False


@pytest.mark.skipif(not _jwt_keys_exist(), reason="JWT keys not found (run scripts/setup.sh from repo root)")
def test_jwt_roundtrip():
    user_id = uuid.uuid4()
    token = auth_service.create_access_token(user_id, "user")
    payload = auth_service.decode_token(token)
    assert payload["sub"] == str(user_id)
    assert payload["role"] == "user"
    assert payload.get("type") == "access"


def test_totp_encrypt_decrypt_roundtrip():
    secret = auth_service.generate_totp_secret()
    encrypted = auth_service.encrypt_totp_secret_for_storage(secret)
    decrypted = auth_service.decrypt_totp_secret_from_storage(encrypted)
    assert decrypted == secret


@pytest.mark.skipif(not _jwt_keys_exist(), reason="JWT keys not found (run scripts/setup.sh from repo root)")
def test_refresh_token_roundtrip():
    user_id = uuid.uuid4()
    refresh = auth_service.create_refresh_token(user_id)
    payload = auth_service.decode_token(refresh)
    assert payload["sub"] == str(user_id)
    assert payload.get("type") == "refresh"
    new_access = auth_service.refresh_access_token(refresh, user_id, "user")
    decoded = auth_service.decode_token(new_access)
    assert decoded["sub"] == str(user_id)
    assert decoded.get("type") == "access"


@pytest.mark.skipif(not _jwt_keys_exist(), reason="JWT keys not found (run scripts/setup.sh from repo root)")
def test_refresh_token_wrong_type_raises():
    user_id = uuid.uuid4()
    access = auth_service.create_access_token(user_id, "user")
    with pytest.raises(ValueError, match="refresh token"):
        auth_service.refresh_access_token(access, user_id, "user")
