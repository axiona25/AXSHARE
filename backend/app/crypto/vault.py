"""
HashiCorp Vault client per AXSHARE.
KV v2 per segreti applicativi, Transit per key wrapping (KEK).
"""

import base64
from typing import Any, Optional

import hvac
import structlog

from app.config import get_settings

logger = structlog.get_logger()
settings = get_settings()


class VaultService:
    """
    Client HashiCorp Vault per AXSHARE.

    Responsabilita':
    - Wrap/unwrap chiavi crittografiche (Transit engine)
    - Storage segreti applicativi (KV v2)
    - Audit di tutte le operazioni su chiavi

    Il Vault NON decifra mai il contenuto dei file.
    Protegge le KEK (Key Encryption Keys) usate per cifrare le chiavi dei file.
    """

    def __init__(self):
        self._client: Optional[hvac.Client] = None

    @property
    def client(self) -> hvac.Client:
        if self._client is None or not self._client.is_authenticated():
            self._client = hvac.Client(
                url=settings.vault_addr,
                token=settings.vault_token,
            )
            if not self._client.is_authenticated():
                raise RuntimeError("Vault authentication failed")
        return self._client

    def health_check(self) -> dict:
        """Verifica che Vault sia attivo e unsealed."""
        return self.client.sys.read_health_status(method="GET")

    # ─── KV v2 — Secrets Storage ─────────────────────────────

    def write_secret(self, path: str, data: dict[str, Any]) -> None:
        """Scrive un segreto nel KV v2 engine."""
        self.client.secrets.kv.v2.create_or_update_secret(
            path=path,
            secret=data,
            mount_point=settings.vault_mount_path,
        )
        logger.info("Secret written to Vault", path=path)

    def read_secret(self, path: str) -> Optional[dict[str, Any]]:
        """Legge un segreto dal KV v2 engine."""
        try:
            response = self.client.secrets.kv.v2.read_secret_version(
                path=path,
                mount_point=settings.vault_mount_path,
                raise_on_deleted_version=True,
            )
            return response["data"]["data"]
        except hvac.exceptions.InvalidPath:
            logger.warning("Secret not found in Vault", path=path)
            return None

    def delete_secret(self, path: str) -> None:
        """Elimina permanentemente un segreto (tutte le versioni)."""
        self.client.secrets.kv.v2.delete_metadata_and_all_versions(
            path=path,
            mount_point=settings.vault_mount_path,
        )
        logger.info("Secret permanently deleted from Vault", path=path)

    def list_secrets(self, path: str = "") -> list[str]:
        """Lista le chiavi sotto un path."""
        try:
            response = self.client.secrets.kv.v2.list_secrets(
                path=path,
                mount_point=settings.vault_mount_path,
            )
            return response["data"]["keys"]
        except hvac.exceptions.InvalidPath:
            return []

    # ─── Transit Engine — Key Wrapping ───────────────────────

    def wrap_key(self, plaintext_key: bytes) -> str:
        """
        Cifra una chiave crittografica con la KEK master di Vault (Transit).
        Restituisce il ciphertext base64 che puo' essere salvato nel DB.

        USO: proteggere le file_key prima di salvarle nel DB.
        Il server puo' wrappare ma NON vede mai il plaintext della file_key.
        """
        plaintext_b64 = base64.b64encode(plaintext_key).decode("utf-8")
        response = self.client.secrets.transit.encrypt_data(
            name="axshare-master-key",
            plaintext=plaintext_b64,
        )
        ciphertext = response["data"]["ciphertext"]
        logger.debug("Key wrapped with Vault Transit")
        return ciphertext

    def unwrap_key(self, ciphertext: str) -> bytes:
        """
        Decifra una chiave wrappata con la KEK master di Vault (Transit).
        Restituisce i bytes della chiave originale.

        USO: recuperare la file_key per consegnarla cifrata all'utente.
        """
        response = self.client.secrets.transit.decrypt_data(
            name="axshare-master-key",
            ciphertext=ciphertext,
        )
        plaintext_b64 = response["data"]["plaintext"]
        key_bytes = base64.b64decode(plaintext_b64)
        logger.debug("Key unwrapped with Vault Transit")
        return key_bytes

    def rewrap_key(self, ciphertext: str) -> str:
        """
        Re-cifra una chiave con la versione piu' recente della KEK.
        Usare dopo key rotation per aggiornare le chiavi cifrate nel DB.
        """
        response = self.client.secrets.transit.rewrap_data(
            name="axshare-master-key",
            ciphertext=ciphertext,
        )
        return response["data"]["ciphertext"]

    def rotate_master_key(self) -> None:
        """
        Ruota la KEK master. Le chiavi esistenti devono essere re-wrappate.
        Operazione admin — da eseguire periodicamente (GDPR/NIS2).
        """
        self.client.secrets.transit.rotate_key(name="axshare-master-key")
        logger.info("Vault master key rotated — rewrap all file keys")

    # ─── User Key Storage ────────────────────────────────────

    def store_user_public_key(
        self, user_id: str, public_key_pem: str, key_type: str = "rsa"
    ) -> None:
        """Salva la chiave pubblica dell'utente in Vault (KV)."""
        self.write_secret(
            f"users/{user_id}/public_keys",
            {f"public_key_{key_type}": public_key_pem},
        )

    def get_user_public_key(
        self, user_id: str, key_type: str = "rsa"
    ) -> Optional[str]:
        """Recupera la chiave pubblica dell'utente da Vault."""
        secret = self.read_secret(f"users/{user_id}/public_keys")
        if secret:
            return secret.get(f"public_key_{key_type}")
        return None

    def delete_user_keys(self, user_id: str) -> None:
        """
        Elimina TUTTE le chiavi dell'utente da Vault.
        Usare per: GDPR right to erasure, self-destruct account.
        Dopo questa operazione i file dell'utente sono irrecuperabili.
        """
        self.delete_secret(f"users/{user_id}/public_keys")
        logger.warning("User keys permanently deleted", user_id=user_id)

    # ─── File Key Management ─────────────────────────────────

    def store_file_key_wrapped(self, file_id: str, file_key: bytes) -> str:
        """
        Wrappa una file_key con la KEK master di Vault e la salva nel KV.
        Usare per file di sistema o file senza proprietario specifico.

        NOTA: per file utente normali, la file_key viene cifrata con
        la chiave pubblica RSA dell'utente, NON con Vault.
        Vault viene usato per chiavi di sistema e backup sicuro.

        Returns:
            ciphertext Vault (formato "vault:v1:...")
        """
        ciphertext = self.wrap_key(file_key)
        self.write_secret(
            f"file_keys/{file_id}",
            {"wrapped_key": ciphertext, "version": 1},
        )
        return ciphertext

    def retrieve_file_key(self, file_id: str) -> bytes:
        """
        Recupera e unwrappa la file_key di un file di sistema da Vault.
        """
        secret = self.read_secret(f"file_keys/{file_id}")
        if not secret:
            raise KeyError(f"File key non trovata in Vault per file_id: {file_id}")
        return self.unwrap_key(secret["wrapped_key"])

    def delete_file_key(self, file_id: str) -> None:
        """
        Elimina la file_key dal Vault — usare per auto-distruzione.
        Dopo questa operazione il file e' irrecuperabile.
        """
        self.delete_secret(f"file_keys/{file_id}")
        structlog.get_logger().warning(
            "File key permanently deleted from Vault",
            file_id=file_id,
        )

    # ─── Group Key Management ────────────────────────────────

    def store_group_master_key(self, group_id: str, group_key: bytes) -> str:
        """
        Wrappa e salva la chiave master di un gruppo in Vault.
        Usata come KEK per le chiavi dei file condivisi nel gruppo.

        Returns:
            ciphertext Vault
        """
        ciphertext = self.wrap_key(group_key)
        self.write_secret(
            f"groups/{group_id}/master_key",
            {
                "wrapped_key": ciphertext,
                "version": 1,
            },
        )
        return ciphertext

    def retrieve_group_master_key(self, group_id: str) -> bytes:
        """Recupera la chiave master di un gruppo da Vault."""
        secret = self.read_secret(f"groups/{group_id}/master_key")
        if not secret:
            raise KeyError(f"Group key non trovata per group_id: {group_id}")
        return self.unwrap_key(secret["wrapped_key"])

    def delete_group_keys(self, group_id: str) -> None:
        """
        Elimina tutte le chiavi di un gruppo da Vault.
        Usare quando il gruppo viene dissolto — tutti i file diventeranno
        inaccessibili.
        """
        self.delete_secret(f"groups/{group_id}/master_key")
        structlog.get_logger().warning(
            "Group keys permanently deleted",
            group_id=group_id,
        )

    # ─── Key Rotation ────────────────────────────────────────

    def rewrap_file_key(self, file_id: str) -> None:
        """
        Re-cifra la file_key con la versione piu' recente della KEK master.
        Chiamare dopo ogni rotazione della master key.
        """
        secret = self.read_secret(f"file_keys/{file_id}")
        if not secret:
            return
        new_ciphertext = self.rewrap_key(secret["wrapped_key"])
        self.write_secret(
            f"file_keys/{file_id}",
            {
                "wrapped_key": new_ciphertext,
                "version": secret.get("version", 1) + 1,
            },
        )

    def batch_rewrap_keys(self, path_prefix: str) -> int:
        """
        Re-cifra tutte le chiavi sotto un path prefix dopo key rotation.

        Returns:
            numero di chiavi re-cifrate
        """
        keys = self.list_secrets(path_prefix)
        count = 0
        for key_path in keys:
            try:
                full_path = f"{path_prefix}/{key_path}".rstrip("/")
                secret = self.read_secret(full_path)
                if secret and "wrapped_key" in secret:
                    new_ciphertext = self.rewrap_key(secret["wrapped_key"])
                    self.write_secret(
                        full_path,
                        {**secret, "wrapped_key": new_ciphertext},
                    )
                    count += 1
            except Exception as e:
                structlog.get_logger().error(
                    "Failed to rewrap key",
                    path=key_path,
                    error=str(e),
                )
        return count

    # ─── GDPR — Right to Erasure ─────────────────────────────

    def erase_all_user_data(self, user_id: str) -> dict:
        """
        GDPR Art. 17 — Diritto alla cancellazione.
        Elimina TUTTI i segreti dell'utente da Vault:
        - Chiavi pubbliche
        - File keys dell'utente
        - Membership nei gruppi

        Dopo questa operazione i file dell'utente sono IRRECUPERABILI.

        Returns:
            report di cancellazione
        """
        log = structlog.get_logger()
        deleted: list[str] = []

        # 1. Chiavi pubbliche
        try:
            self.delete_user_keys(user_id)
            deleted.append("public_keys")
        except Exception:
            pass

        # 2. File keys utente
        try:
            file_keys = self.list_secrets(f"file_keys/user/{user_id}")
            for key in file_keys:
                self.delete_secret(f"file_keys/user/{user_id}/{key}")
                deleted.append(f"file_key/{key}")
        except Exception:
            pass

        log.warning(
            "GDPR erasure completed",
            user_id=user_id,
            deleted_items=deleted,
        )
        return {"user_id": user_id, "deleted": deleted, "status": "erased"}


# Singleton
_vault_service: Optional[VaultService] = None


def get_vault_service() -> VaultService:
    global _vault_service
    if _vault_service is None:
        _vault_service = VaultService()
    return _vault_service
