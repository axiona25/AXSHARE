# TASK 3.3 — Auth TOTP + JWT RS256

> **Progetto:** AXSHARE | **Fase:** 3 — Backend Core — Auth & Utenti  
> **Dipendenze:** TASK 3.2 completato  

---

## Obiettivo

TOTP (pyotp) per secondo fattore e JWT RS256 (python-jose) per access/refresh token. Secret TOTP cifrato in DB con chiave derivata da `secret_key`; endpoint per setup, verifica TOTP e refresh del token.

---

## Deliverable

- [x] **backend/app/services/auth_service.py** — `AuthService`: `generate_totp_secret`, `get_totp_uri`, `verify_totp` (valid_window=1), `encrypt_totp_secret_for_storage`, `decrypt_totp_secret_from_storage`, `create_access_token`, `create_refresh_token`, `decode_token`, `refresh_access_token`. Config via `get_settings()`; TOTP storage key da SHA256(secret_key).
- [x] **backend/app/api/v1/endpoints/auth.py** — POST `/auth/totp/setup` (salva secret cifrato, ritorna secret + qr_uri), POST `/auth/totp/verify` (verifica codice e abilita TOTP), POST `/auth/token/refresh` (body `refresh_token`, ritorna nuovo `access_token`). Dipendenze `get_current_user`, `get_db` dove serve.
- [x] **backend/app/api/v1/router.py** — inclusione router `auth`.
- [x] **backend/tests/phase3/test_totp_jwt.py** — test TOTP (codice valido/invalido), roundtrip cifratura secret, JWT roundtrip, refresh roundtrip, refresh con token sbagliato (ValueError). JWT test con `skipif` se chiavi assenti.

---

## Risultati Test

| Test | Stato | Note |
|------|--------|------|
| test_totp_valid_code | PASSED | pyotp.TOTP(secret).now() verificato |
| test_totp_invalid_code | PASSED | "000000" rifiutato |
| test_jwt_roundtrip | PASSED | create_access_token / decode_token |
| test_totp_encrypt_decrypt_roundtrip | PASSED | encrypt/decrypt per storage |
| test_refresh_token_roundtrip | PASSED | refresh → nuovo access |
| test_refresh_token_wrong_type_raises | PASSED | access token come refresh → ValueError |

**Comando:** `cd backend && pytest tests/phase3/ -k "totp or jwt" -v`

---

## Note

- Chiavi JWT: `./keys/jwt_private.pem` e `./keys/jwt_public.pem` (creabili con `scripts/setup.sh` dalla root del repo). Se mancano, i test JWT vengono saltati.
- TOTP: secret salvato in `User.totp_secret_encrypted` cifrato con AES (chiave da `secret_key`). `totp_enabled` viene messo a `True` alla prima verifica corretta.
- Refresh: il client invia `refresh_token` nel body; il backend verifica che sia di tipo `refresh` e che `sub` coincida con `current_user.id`, poi rilascia un nuovo access token.
