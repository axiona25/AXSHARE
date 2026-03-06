# TASK 1.5 — HashiCorp Vault: Secrets Engine + Policy + Client Python
> **Fase:** 1 — Foundation & Infrastruttura
> **Prerequisiti:** Task 1.2 completato (Vault in esecuzione su localhost:8200)
> **Path progetto:** `/Users/r.amoroso/Documents/Cursor/AXSHARE`
> **Output atteso:** Vault configurato con KV e Transit engine, client Python hvac funzionante, test di fine fase VERDE

---

## Prompt Cursor

```
Sei un senior security engineer. Il progetto AXSHARE si trova in
/Users/r.amoroso/Documents/Cursor/AXSHARE.
HashiCorp Vault e' in esecuzione su localhost:8200 (token: dev-root-token).

Devi creare il client Python per Vault (hvac) e configurare:
- KV v2 secrets engine per i segreti applicativi
- Transit engine per il key wrapping (cifratura delle chiavi crittografiche)
- Policy di accesso per l'applicazione

════════════════════════════════════════════════
STEP 1 — Crea backend/app/crypto/vault.py
════════════════════════════════════════════════

import base64
from typing import Optional, Any
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

    def store_user_public_key(self, user_id: str, public_key_pem: str, key_type: str = "rsa") -> None:
        """Salva la chiave pubblica dell'utente in Vault (KV)."""
        self.write_secret(
            f"users/{user_id}/public_keys",
            {f"public_key_{key_type}": public_key_pem},
        )

    def get_user_public_key(self, user_id: str, key_type: str = "rsa") -> Optional[str]:
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


# Singleton
_vault_service: Optional[VaultService] = None


def get_vault_service() -> VaultService:
    global _vault_service
    if _vault_service is None:
        _vault_service = VaultService()
    return _vault_service

════════════════════════════════════════════════
STEP 2 — Inizializza Vault da terminale
════════════════════════════════════════════════

Esegui questi comandi per configurare Vault:

# Entra nel container Vault
docker exec -it axshare_vault sh

# All'interno del container:
export VAULT_ADDR="http://127.0.0.1:8200"
export VAULT_TOKEN="dev-root-token"

# Abilita KV v2 per AXSHARE
vault secrets enable -path=axshare kv-v2

# Abilita Transit engine
vault secrets enable transit

# Crea chiave master per key wrapping
vault write -f transit/keys/axshare-master-key \
  type=aes256-gcm96 \
  exportable=false \
  allow_plaintext_backup=false

# Crea policy applicazione
vault policy write axshare-app - <<EOF
path "axshare/*" {
  capabilities = ["create", "read", "update", "delete", "list"]
}
path "transit/encrypt/axshare-master-key" {
  capabilities = ["update"]
}
path "transit/decrypt/axshare-master-key" {
  capabilities = ["update"]
}
path "transit/rewrap/axshare-master-key" {
  capabilities = ["update"]
}
path "transit/keys/axshare-master-key/rotate" {
  capabilities = ["update"]
}
EOF

# Verifica configurazione
vault secrets list
vault policy read axshare-app
vault read transit/keys/axshare-master-key

# Esci dal container
exit

════════════════════════════════════════════════
STEP 3 — Crea test di fine FASE 1
════════════════════════════════════════════════

Crea backend/tests/phase1/test_infra.py:

"""
Test automatici FASE 1 — Infrastructure
Verifica: PostgreSQL, Redis, MinIO, Vault
Eseguire con: pytest tests/phase1/ -v
"""
import pytest
import asyncio
import asyncpg
import redis.asyncio as aioredis
from minio import Minio
import hvac
import os

# Carica .env.test
from dotenv import load_dotenv
load_dotenv(".env.test")


# ─── PostgreSQL ──────────────────────────────────────────────

@pytest.mark.asyncio
async def test_postgresql_connection():
    """Verifica connessione a PostgreSQL."""
    conn = await asyncpg.connect(
        os.getenv("DATABASE_URL").replace("postgresql+asyncpg://", "postgresql://")
    )
    result = await conn.fetchval("SELECT 1")
    await conn.close()
    assert result == 1, "PostgreSQL non risponde"


@pytest.mark.asyncio
async def test_postgresql_extensions():
    """Verifica estensioni PostgreSQL richieste."""
    conn = await asyncpg.connect(
        os.getenv("DATABASE_URL").replace("postgresql+asyncpg://", "postgresql://")
    )
    extensions = await conn.fetch(
        "SELECT extname FROM pg_extension WHERE extname IN ('uuid-ossp', 'pgcrypto', 'pg_trgm')"
    )
    ext_names = {row["extname"] for row in extensions}
    await conn.close()
    assert "uuid-ossp" in ext_names, "uuid-ossp non installato"
    assert "pgcrypto" in ext_names, "pgcrypto non installato"
    assert "pg_trgm" in ext_names, "pg_trgm non installato"


@pytest.mark.asyncio
async def test_postgresql_schema():
    """Verifica schema axshare e tabelle principali."""
    conn = await asyncpg.connect(
        os.getenv("DATABASE_URL").replace("postgresql+asyncpg://", "postgresql://")
    )
    tables = await conn.fetch(
        """
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'axshare'
        ORDER BY tablename
        """
    )
    table_names = {row["tablename"] for row in tables}
    await conn.close()

    required = {"users", "groups", "group_members", "files", "folders", "permissions", "audit_logs", "file_signatures"}
    missing = required - table_names
    assert not missing, f"Tabelle mancanti: {missing}"


# ─── Redis ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_redis_connection():
    """Verifica connessione a Redis."""
    client = aioredis.from_url(os.getenv("REDIS_URL"), decode_responses=True)
    result = await client.ping()
    await client.aclose()
    assert result is True, "Redis non risponde al PING"


@pytest.mark.asyncio
async def test_redis_set_get():
    """Verifica operazioni base Redis con TTL."""
    client = aioredis.from_url(os.getenv("REDIS_URL"), decode_responses=True)
    await client.setex("axshare:test:key", 10, "test_value")
    value = await client.get("axshare:test:key")
    await client.delete("axshare:test:key")
    await client.aclose()
    assert value == "test_value", "Redis set/get fallito"


# ─── MinIO ───────────────────────────────────────────────────

def test_minio_connection():
    """Verifica connessione a MinIO."""
    client = Minio(
        f"{os.getenv('MINIO_ENDPOINT')}:{os.getenv('MINIO_PORT', '9000')}",
        access_key=os.getenv("MINIO_ACCESS_KEY"),
        secret_key=os.getenv("MINIO_SECRET_KEY"),
        secure=os.getenv("MINIO_SECURE", "false").lower() == "true",
    )
    # Se non lancia eccezione, la connessione e' OK
    buckets = client.list_buckets()
    assert buckets is not None, "MinIO non risponde"


def test_minio_buckets_exist():
    """Verifica che i bucket necessari esistano."""
    client = Minio(
        f"{os.getenv('MINIO_ENDPOINT')}:{os.getenv('MINIO_PORT', '9000')}",
        access_key=os.getenv("MINIO_ACCESS_KEY"),
        secret_key=os.getenv("MINIO_SECRET_KEY"),
        secure=False,
    )
    bucket_files = os.getenv("MINIO_BUCKET_FILES", "axshare-files")
    bucket_keys = os.getenv("MINIO_BUCKET_KEYS", "axshare-keys")

    assert client.bucket_exists(bucket_files), f"Bucket {bucket_files} non esiste"
    assert client.bucket_exists(bucket_keys), f"Bucket {bucket_keys} non esiste"


def test_minio_upload_download():
    """Verifica upload e download di un file di test."""
    from io import BytesIO
    client = Minio(
        f"{os.getenv('MINIO_ENDPOINT')}:{os.getenv('MINIO_PORT', '9000')}",
        access_key=os.getenv("MINIO_ACCESS_KEY"),
        secret_key=os.getenv("MINIO_SECRET_KEY"),
        secure=False,
    )
    bucket = os.getenv("MINIO_BUCKET_FILES", "axshare-files")
    test_data = b"axshare-test-encrypted-content"
    test_path = "test/phase1_test_file"

    client.put_object(bucket, test_path, BytesIO(test_data), len(test_data))
    response = client.get_object(bucket, test_path)
    downloaded = response.read()
    response.close()
    client.remove_object(bucket, test_path)

    assert downloaded == test_data, "Upload/download MinIO fallito"


# ─── HashiCorp Vault ─────────────────────────────────────────

def test_vault_health():
    """Verifica che Vault sia attivo e unsealed."""
    client = hvac.Client(
        url=os.getenv("VAULT_ADDR"),
        token=os.getenv("VAULT_TOKEN"),
    )
    assert client.is_authenticated(), "Vault non autenticato"
    health = client.sys.read_health_status(method="GET")
    assert health.status_code in [200, 429], f"Vault non healthy: {health.status_code}"


def test_vault_kv_engine():
    """Verifica KV v2 engine per AXSHARE."""
    client = hvac.Client(
        url=os.getenv("VAULT_ADDR"),
        token=os.getenv("VAULT_TOKEN"),
    )
    mount = os.getenv("VAULT_MOUNT_PATH", "axshare")

    # Scrivi e leggi un segreto di test
    client.secrets.kv.v2.create_or_update_secret(
        path="test/phase1",
        secret={"test_key": "test_value"},
        mount_point=mount,
    )
    response = client.secrets.kv.v2.read_secret_version(
        path="test/phase1",
        mount_point=mount,
    )
    value = response["data"]["data"]["test_key"]

    # Cleanup
    client.secrets.kv.v2.delete_metadata_and_all_versions(
        path="test/phase1",
        mount_point=mount,
    )

    assert value == "test_value", "Vault KV v2 read/write fallito"


def test_vault_transit_wrap_unwrap():
    """Verifica key wrapping con Transit engine."""
    import os as _os
    client = hvac.Client(
        url=os.getenv("VAULT_ADDR"),
        token=os.getenv("VAULT_TOKEN"),
    )
    import base64
    test_key = _os.urandom(32)  # 256-bit key
    test_key_b64 = base64.b64encode(test_key).decode("utf-8")

    # Wrap
    enc_response = client.secrets.transit.encrypt_data(
        name="axshare-master-key",
        plaintext=test_key_b64,
    )
    ciphertext = enc_response["data"]["ciphertext"]
    assert ciphertext.startswith("vault:v"), "Formato ciphertext Vault non valido"

    # Unwrap
    dec_response = client.secrets.transit.decrypt_data(
        name="axshare-master-key",
        ciphertext=ciphertext,
    )
    recovered_b64 = dec_response["data"]["plaintext"]
    recovered_key = base64.b64decode(recovered_b64)

    assert recovered_key == test_key, "Vault Transit wrap/unwrap fallito"


# ─── FastAPI health ──────────────────────────────────────────

@pytest.mark.asyncio
async def test_api_health():
    """Verifica l'endpoint /health dell'API FastAPI."""
    import httpx
    async with httpx.AsyncClient(base_url="http://localhost:8000") as client:
        response = await client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["app"] == "AXSHARE"

════════════════════════════════════════════════
STEP 4 — Crea backend/tests/conftest.py
════════════════════════════════════════════════

import pytest
import asyncio
from dotenv import load_dotenv

load_dotenv(".env.test")


@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()

════════════════════════════════════════════════
STEP 5 — Esegui i test di fine Fase 1
════════════════════════════════════════════════

Prima avvia il backend:

cd /Users/r.amoroso/Documents/Cursor/AXSHARE/backend
uvicorn app.main:app --reload --port 8000 &

Poi esegui i test:

cd /Users/r.amoroso/Documents/Cursor/AXSHARE/backend
pytest tests/phase1/ -v --tb=short

Output atteso (tutti VERDE):
  PASSED tests/phase1/test_infra.py::test_postgresql_connection
  PASSED tests/phase1/test_infra.py::test_postgresql_extensions
  PASSED tests/phase1/test_infra.py::test_postgresql_schema
  PASSED tests/phase1/test_infra.py::test_redis_connection
  PASSED tests/phase1/test_infra.py::test_redis_set_get
  PASSED tests/phase1/test_infra.py::test_minio_connection
  PASSED tests/phase1/test_infra.py::test_minio_buckets_exist
  PASSED tests/phase1/test_infra.py::test_minio_upload_download
  PASSED tests/phase1/test_infra.py::test_vault_health
  PASSED tests/phase1/test_infra.py::test_vault_kv_engine
  PASSED tests/phase1/test_infra.py::test_vault_transit_wrap_unwrap
  PASSED tests/phase1/test_infra.py::test_api_health

  12 passed in X.XXs

Al termine aggiorna la sezione Risultato di questo file e quello di AXSHARE_ROADMAP.md
con lo stato "FASE 1 COMPLETATA".
```

---

## Risultato
> *Compilare al completamento del task*

- Data completamento: ___
- Vault KV engine: ___
- Vault Transit engine: ___
- Key wrap/unwrap test: ___
- Test suite fase 1: ___  (N/12 passed)
- Errori: ___
