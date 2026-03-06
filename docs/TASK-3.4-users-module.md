# TASK 3.4 — Users Module

**Progetto:** AXSHARE | **Fase:** 3 — Backend Core — Auth & Utenti  
**Dipendenze:** TASK 3.3 completato

## Obiettivo

CRUD utenti con gestione ruoli, profilo e chiave pubblica RSA.

## Implementazione

### Endpoint (`backend/app/api/v1/endpoints/users.py`)

| Metodo | Path | Descrizione | Auth |
|--------|------|-------------|------|
| GET | `/users/me` | Profilo utente autenticato | JWT |
| PUT | `/users/me` | Aggiorna profilo (display_name) | JWT |
| POST | `/users/me/public-key` | Carica chiave pubblica RSA (PEM); salvataggio in DB + Vault | JWT |
| GET | `/users/{user_id}/public-key` | Ottieni chiave pubblica di un utente attivo | JWT |
| GET | `/users/` | Lista utenti attivi (solo admin) | JWT + admin |

- **Modello:** `User` usa `display_name_encrypted` e `public_key_rsa`; l’API espone `display_name` e `has_public_key`.
- **Vault:** dopo l’upload della chiave pubblica viene chiamato `get_vault_service().store_user_public_key()`; in assenza di Vault l’errore viene ignorato e la chiave resta salvata nel DB.
- **Validazione:** la chiave PEM viene validata con `cryptography.hazmat.primitives.serialization.load_pem_public_key`.

### Router

- Router `users` incluso in `backend/app/api/v1/router.py`.

### Modello User

- **Enum ruolo:** in `backend/app/models/user.py` il campo `role` usa `Enum(UserRole, values_callable=lambda obj: [e.value for e in obj])` in modo che PostgreSQL riceva i valori `'admin'`, `'user'`, `'guest'` (minuscolo) come da schema Alembic.

### Configurazione JWT

- In `backend/app/config.py` i path JWT (`jwt_private_key_path`, `jwt_public_key_path`) sono risolti in path assoluti tramite validator, per evitare problemi di cwd in test e sotto ASGI.
- In `backend/tests/conftest.py` sono impostati `JWT_PRIVATE_KEY_PATH` e `JWT_PUBLIC_KEY_PATH` assoluti se esiste la cartella `backend/keys`.

### Test (`backend/tests/phase3/test_users.py`)

- **Helper:** `_unique_email(prefix)` per email univoche; `_create_test_user(email, role)` crea utente in DB e restituisce `(user, access_token)`.
- **Fixture:** `_clear_settings_cache` (autouse) per avere cache settings pulita e path JWT corretti in ogni test.
- **RSA:** `generate_keypair()` eseguito in `run_in_executor` per non bloccare l’event loop.
- **Pytest:** `asyncio_default_fixture_loop_scope = "session"` e `asyncio_default_test_loop_scope = "session"` in `pyproject.toml` per evitare conflitti async/event loop.

| Test | Descrizione |
|------|-------------|
| `test_get_own_profile` | GET `/users/me` con token → 200, dati profilo corretti |
| `test_upload_public_key` | POST `/users/me/public-key` con PEM RSA valido → 200 |
| `test_upload_public_key_invalid` | POST con body non PEM → 400 |
| `test_get_other_user_public_key` | Upload chiave poi GET `/{id}/public-key` → 200, `public_key_pem` presente |
| `test_list_users_admin_only` | GET `/users/` con user → 403; con admin → 200, lista |

## Risultati test

Eseguire da `backend`:

```bash
source .venv/bin/activate
pytest tests/phase3/test_users.py -v
```

| Test | Stato | Note |
|------|--------|------|
| test_get_own_profile | OK | Profilo e token corretti |
| test_upload_public_key | OK | Chiave RSA valida, 200 |
| test_upload_public_key_invalid | OK | 400 su PEM non valido |
| test_get_other_user_public_key | OK | Upload + GET public-key |
| test_list_users_admin_only | OK | 403 user, 200 admin |

Tutti e 5 i test passano. Per la suite phase3 con filtro: `pytest tests/phase3/ -k "users" -v` (in presenza di altri moduli phase3 l’ordine di esecuzione può influire; i test sono stabili eseguendo solo `test_users.py`).
