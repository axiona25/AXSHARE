"""
Test automatici FASE 1 — Infrastructure
Verifica: PostgreSQL, Redis, MinIO, Vault
Eseguire con: pytest tests/phase1/ -v
"""
import os
from pathlib import Path

import pytest

# Carica .env.test (backend/ o repo root)
_backend_dir = Path(__file__).resolve().parent.parent.parent
_root_dir = _backend_dir.parent
for _path in (_backend_dir / ".env.test", _root_dir / ".env.test"):
    if _path.is_file():
        from dotenv import load_dotenv
        load_dotenv(_path)
        break


# ─── PostgreSQL ──────────────────────────────────────────────

@pytest.mark.asyncio
async def test_postgresql_connection():
    """Verifica connessione a PostgreSQL."""
    import asyncpg
    url = os.getenv("DATABASE_URL")
    if not url:
        pytest.skip("DATABASE_URL not set")
    conn = await asyncpg.connect(
        url.replace("postgresql+asyncpg://", "postgresql://")
    )
    result = await conn.fetchval("SELECT 1")
    await conn.close()
    assert result == 1, "PostgreSQL non risponde"


@pytest.mark.asyncio
async def test_postgresql_extensions():
    """Verifica estensioni PostgreSQL richieste."""
    import asyncpg
    url = os.getenv("DATABASE_URL")
    if not url:
        pytest.skip("DATABASE_URL not set")
    conn = await asyncpg.connect(
        url.replace("postgresql+asyncpg://", "postgresql://")
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
    import asyncpg
    url = os.getenv("DATABASE_URL")
    if not url:
        pytest.skip("DATABASE_URL not set")
    conn = await asyncpg.connect(
        url.replace("postgresql+asyncpg://", "postgresql://")
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

    required = {
        "users", "groups", "group_members", "files", "folders",
        "permissions", "audit_logs", "file_signatures",
    }
    missing = required - table_names
    assert not missing, f"Tabelle mancanti: {missing}"


# ─── Redis ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_redis_connection():
    """Verifica connessione a Redis (sintassi Redis 7 con password nell'URL)."""
    import redis.asyncio as aioredis
    url = os.getenv("REDIS_URL", "redis://:axshare_redis_password@localhost:6379/1")
    client = aioredis.from_url(url, decode_responses=True)
    result = await client.ping()
    await client.aclose()
    assert result is True, "Redis non risponde al PING"


@pytest.mark.asyncio
async def test_redis_set_get():
    """Verifica operazioni base Redis con TTL."""
    import redis.asyncio as aioredis
    url = os.getenv("REDIS_URL", "redis://:axshare_redis_password@localhost:6379/1")
    client = aioredis.from_url(url, decode_responses=True)
    await client.setex("axshare:test:key", 10, "test_value")
    value = await client.get("axshare:test:key")
    await client.delete("axshare:test:key")
    await client.aclose()
    assert value == "test_value", "Redis set/get fallito"


# ─── MinIO ───────────────────────────────────────────────────

def test_minio_connection():
    """Verifica connessione a MinIO."""
    from minio import Minio
    endpoint = os.getenv("MINIO_ENDPOINT", "localhost")
    port = os.getenv("MINIO_PORT", "9000")
    client = Minio(
        f"{endpoint}:{port}",
        access_key=os.getenv("MINIO_ACCESS_KEY", "minioadmin"),
        secret_key=os.getenv("MINIO_SECRET_KEY", "minioadmin"),
        secure=os.getenv("MINIO_SECURE", "false").lower() == "true",
    )
    buckets = client.list_buckets()
    assert buckets is not None, "MinIO non risponde"


def test_minio_buckets_exist():
    """Verifica che i bucket necessari esistano."""
    from minio import Minio
    endpoint = os.getenv("MINIO_ENDPOINT", "localhost")
    port = os.getenv("MINIO_PORT", "9000")
    client = Minio(
        f"{endpoint}:{port}",
        access_key=os.getenv("MINIO_ACCESS_KEY", "minioadmin"),
        secret_key=os.getenv("MINIO_SECRET_KEY", "minioadmin"),
        secure=False,
    )
    bucket_files = os.getenv("MINIO_BUCKET_FILES", "axshare-files")
    bucket_keys = os.getenv("MINIO_BUCKET_KEYS", "axshare-keys")

    assert client.bucket_exists(bucket_files), f"Bucket {bucket_files} non esiste"
    assert client.bucket_exists(bucket_keys), f"Bucket {bucket_keys} non esiste"


def test_minio_upload_download():
    """Verifica upload e download di un file di test."""
    from io import BytesIO
    from minio import Minio
    endpoint = os.getenv("MINIO_ENDPOINT", "localhost")
    port = os.getenv("MINIO_PORT", "9000")
    client = Minio(
        f"{endpoint}:{port}",
        access_key=os.getenv("MINIO_ACCESS_KEY", "minioadmin"),
        secret_key=os.getenv("MINIO_SECRET_KEY", "minioadmin"),
        secure=False,
    )
    bucket = os.getenv("MINIO_BUCKET_FILES", "axshare-files")
    test_data = b"axshare-test-encrypted-content"
    test_path = "test/phase1_test_file"

    client.put_object(bucket, test_path, BytesIO(test_data), len(test_data))
    response = client.get_object(bucket, test_path)
    downloaded = response.read()
    response.close()
    response.release_conn()
    client.remove_object(bucket, test_path)

    assert downloaded == test_data, "Upload/download MinIO fallito"


# ─── HashiCorp Vault ─────────────────────────────────────────

def test_vault_health():
    """Verifica che Vault sia attivo e unsealed."""
    import hvac
    client = hvac.Client(
        url=os.getenv("VAULT_ADDR"),
        token=os.getenv("VAULT_TOKEN"),
    )
    assert client.is_authenticated(), "Vault non autenticato"
    import requests
    resp = requests.get(f"{os.getenv('VAULT_ADDR')}/v1/sys/health")
    assert resp.status_code in [200, 429], f"Vault non healthy: {resp.status_code}"


def test_vault_kv_engine():
    """Verifica KV v2 engine per AXSHARE."""
    import hvac
    url = os.getenv("VAULT_ADDR")
    token = os.getenv("VAULT_TOKEN")
    mount = os.getenv("VAULT_MOUNT_PATH", "axshare")
    if not url or not token:
        pytest.skip("VAULT_ADDR o VAULT_TOKEN non impostati")
    client = hvac.Client(url=url, token=token)

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
    import base64
    import hvac
    url = os.getenv("VAULT_ADDR")
    token = os.getenv("VAULT_TOKEN")
    if not url or not token:
        pytest.skip("VAULT_ADDR o VAULT_TOKEN non impostati")
    client = hvac.Client(url=url, token=token)
    test_key = os.urandom(32)  # 256-bit key
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
    base_url = os.getenv("API_BASE_URL", "http://localhost:8000")
    try:
        async with httpx.AsyncClient(base_url=base_url, timeout=5.0) as client:
            response = await client.get("/health")
    except (httpx.ConnectError, httpx.ConnectTimeout):
        pytest.skip("API non raggiungibile — avviare con: uvicorn app.main:app --port 8000")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["app"] == "AXSHARE"
