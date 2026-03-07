import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _resolve_path(v: str) -> str:
    """Rende il path assoluto per evitare problemi con cwd nei test/ASGI."""
    p = Path(v)
    if not p.is_absolute():
        p = Path.cwd().resolve() / p
    return str(p.resolve())


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # App
    app_name: str = "AXSHARE"
    app_version: str = "0.1.2"
    debug: bool = False
    environment: str = "development"

    # Database
    database_url: str
    database_pool_size: int = 10
    database_max_overflow: int = 20

    # Redis
    redis_url: str
    celery_broker_url: str = ""  # se vuoto usa redis_url

    # MinIO
    minio_endpoint: str
    minio_port: int = 9000
    minio_access_key: str
    minio_secret_key: str
    minio_bucket_files: str = "axshare-files"
    minio_bucket_keys: str = "axshare-keys"
    minio_secure: bool = False

    # Vault
    vault_addr: str = "http://localhost:8200"
    vault_token: Optional[str] = None  # solo dev
    vault_role_id: Optional[str] = None  # produzione (AppRole)
    vault_secret_id: Optional[str] = None  # produzione (AppRole)
    use_vault: bool = False  # attiva integrazione
    vault_mount_path: str = "axshare"

    # JWT RS256 (validati come path assoluti)
    jwt_algorithm: str = "RS256"
    jwt_private_key_path: str = "./keys/jwt_private.pem"
    jwt_public_key_path: str = "./keys/jwt_public.pem"

    @field_validator("jwt_private_key_path", "jwt_public_key_path", mode="after")
    @classmethod
    def resolve_jwt_paths(cls, v: str) -> str:
        return _resolve_path(v)
    jwt_access_token_expire_minutes: int = 60
    jwt_refresh_token_expire_days: int = 30

    # Security
    secret_key: str
    allowed_origins: list[str] = [
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:3002",
        "https://app.axshare.io",
    ]

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def parse_allowed_origins(cls, v: Any) -> list[str]:
        """Parse ALLOWED_ORIGINS from .env as JSON array, e.g. ["http://localhost:3000"]."""
        if isinstance(v, list):
            return v
        if isinstance(v, str):
            try:
                parsed = json.loads(v)
                return list(parsed) if isinstance(parsed, list) else [parsed]
            except (json.JSONDecodeError, TypeError):
                return [origin.strip() for origin in v.split(",") if origin.strip()]
        return ["http://localhost:3000"]

    # Frontend (per share URL)
    frontend_url: str = "http://localhost:3000"

    # Email
    email_provider: str = "log"  # 'resend' | 'smtp' | 'log'
    resend_api_key: Optional[str] = None
    smtp_host: str = "localhost"
    smtp_port: int = 587
    smtp_user: Optional[str] = None
    smtp_password: Optional[str] = None
    smtp_tls: bool = True
    email_from_address: str = "noreply@axshare.io"
    email_from_name: str = "AXSHARE"
    email_unsubscribe_secret: str = "change-me-unsubscribe-secret"

    # Monitoring
    sentry_dsn: Optional[str] = None

    # WebAuthn
    webauthn_rp_id: str = "localhost"
    webauthn_rp_name: str = "AXSHARE"
    webauthn_origin: str = "http://localhost:3000"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
