"""
Client HashiCorp Vault per lettura segreti in produzione.
In development usa le variabili .env come fallback.
"""

import logging
from typing import Optional

import hvac

from app.config import get_settings

logger = logging.getLogger(__name__)


class VaultClient:
    """Lettura segreti da Vault KV v2 (path axshare/)."""

    _client: Optional[hvac.Client] = None

    @classmethod
    def _get_client(cls) -> hvac.Client:
        if cls._client and cls._client.is_authenticated():
            return cls._client
        settings = get_settings()
        client = hvac.Client(url=settings.vault_addr)

        if settings.vault_token:
            client.token = settings.vault_token
        elif settings.vault_role_id and settings.vault_secret_id:
            result = client.auth.approle.login(
                role_id=settings.vault_role_id,
                secret_id=settings.vault_secret_id,
            )
            client.token = result["auth"]["client_token"]
        else:
            raise RuntimeError("Vault: nessuna credenziale configurata")

        if not client.is_authenticated():
            raise RuntimeError("Vault: autenticazione fallita")

        cls._client = client
        return client

    @classmethod
    def get_secret(cls, path: str, key: str) -> Optional[str]:
        """Legge un segreto da Vault. Ritorna None se non disponibile."""
        try:
            client = cls._get_client()
            response = client.secrets.kv.v2.read_secret_version(
                path=path,
                mount_point=get_settings().vault_mount_path,
            )
            return response["data"]["data"].get(key)
        except Exception as e:
            logger.warning("Vault read failed (%s/%s): %s", path, key, e)
            return None

    @classmethod
    def get_app_secrets(cls) -> dict:
        """Carica tutti i segreti applicazione (axshare/app) in un colpo solo."""
        try:
            client = cls._get_client()
            response = client.secrets.kv.v2.read_secret_version(
                path="app",
                mount_point=get_settings().vault_mount_path,
            )
            return response["data"]["data"]
        except Exception as e:
            logger.warning("Vault: impossibile caricare segreti app: %s", e)
            return {}
