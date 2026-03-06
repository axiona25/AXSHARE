import os
import pytest
import asyncio
from dotenv import load_dotenv

# Carica .env.test PRIMA di tutto, override=True sovrascrive variabili di sistema
_here = os.path.dirname(os.path.abspath(__file__))
_backend = os.path.dirname(_here)
_env_test = os.path.join(_backend, ".env.test")
load_dotenv(_env_test, override=True)
# Disabilita rate limiting nei test (middleware controlla environment == "test")
os.environ.setdefault("ENVIRONMENT", "test")

# Percorsi assoluti per JWT così che app e test usino le stesse chiavi
_keys_dir = os.path.join(_backend, "keys")
if os.path.isdir(_keys_dir):
    os.environ.setdefault(
        "JWT_PRIVATE_KEY_PATH",
        os.path.join(_keys_dir, "jwt_private.pem"),
    )
    os.environ.setdefault(
        "JWT_PUBLIC_KEY_PATH",
        os.path.join(_keys_dir, "jwt_public.pem"),
    )


# Cache JWT/get_settings: evita interferenze quando si esegue l'intera suite (es. phase3
# o test di fine fase). Senza clear, l'ordine dei test può far usare all'app path JWT
# diversi da quelli usati per creare il token → 401. Autouse globale = ogni test parte
# con cache pulita; il primo get_settings() nel test riempie la cache in modo coerente.
@pytest.fixture(autouse=True)
def _global_clear_settings_cache():
    try:
        from app.config import get_settings
        get_settings.cache_clear()
    except Exception:
        pass  # app.config non importabile in alcuni collect (es. phase1 solo infra)
    yield


@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()
