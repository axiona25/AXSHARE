# Note per i test (fasi successive)

## Cache JWT / `get_settings()`

La cache di `get_settings()` (lru_cache) può creare **interferenze** quando si esegue l’intera suite (es. `pytest tests/phase3/ -v` o i test di fine fase): a seconda dell’ordine di esecuzione, l’app può usare path JWT diversi da quelli con cui è stato creato il token nel test → 401.

**Soluzione attuale:**

- **Conftest globale** (`backend/tests/conftest.py`): fixture autouse `_global_clear_settings_cache` che fa `get_settings.cache_clear()` prima di ogni test. Così ogni test parte con cache pulita e il primo `get_settings()` nel test (o nell’app durante la richiesta) riempie la cache in modo coerente. L’import di `app.config` è in un try/except per non rompere collect di test che non caricano l’app (es. phase1 solo infra).
- **Phase3** (`tests/phase3/conftest.py`): clear aggiuntivo autouse; i singoli test che creano token possono ancora chiamare `get_settings.cache_clear()` all’inizio se in una run completa si vedono ancora 401.

Quando arriverete ai **test di fine fase completi**, se si notassero ancora 401 o incoerenze JWT:

1. Verificare che la fixture `_global_clear_settings_cache` sia effettivamente autouse e che giri prima di ogni test (inclusi quelli in sottodirectory).
2. Valutare un clear a **scope="function"** (già implicito) e che non ci siano fixture con scope "session" o "module" che tengano in vita un vecchio `get_settings()`.
3. In alternativa, in ambiente test evitare la cache (es. variabile d’ambiente che fa usare sempre path assoluti e/o bypass della cache nei test).
