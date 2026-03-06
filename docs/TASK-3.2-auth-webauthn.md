# TASK 3.2 — Auth WebAuthn (Passkey)

> **Progetto:** AXSHARE | **Fase:** 3 — Backend Core — Auth & Utenti  
> **Dipendenze:** TASK 3.1 completato  

---

## Obiettivo

Registrazione e autenticazione con WebAuthn (Passkey) tramite `webauthn` (py_webauthn). Flusso register begin/complete e authenticate begin/complete con challenge in Redis e JWT in uscita.

---

## Deliverable

- [x] **backend/app/services/webauthn_service.py** — `WebAuthnService`: `get_registration_options`, `get_registration_options_for_email`, `verify_registration`, `get_authentication_options`, `verify_authentication`. Config da `get_settings()` (webauthn_rp_id, webauthn_rp_name, webauthn_origin).
- [x] **backend/app/api/v1/endpoints/auth_webauthn.py** — POST `/auth/webauthn/register/begin`, `/register/complete`, `/authenticate/begin`, `/authenticate/complete` con body Pydantic; Redis per challenge (TTL 5 min); creazione utente su register/complete se non esiste; JWT su authenticate/complete.
- [x] **backend/app/api/v1/router.py** — inclusione router WebAuthn.
- [x] **backend/tests/phase3/test_webauthn.py** — 4 test: register begin options, register complete senza challenge 400, authenticate begin user not found 404, service get_registration_options_for_email.
- Fix relazione **Folder** (parent/children): `remote_side` solo su `parent` per evitare `ArgumentError` in fase di configurazione mapper.

---

## Risultati Test

| Test | Stato | Note |
|------|--------|------|
| test_webauthn_register_begin_returns_options | PASSED | Options con challenge, rp, user |
| test_webauthn_register_complete_without_challenge_fails | PASSED | 400 challenge scaduta |
| test_webauthn_authenticate_begin_user_not_found | PASSED | 404 |
| test_webauthn_service_get_registration_options_for_email | PASSED | Challenge e user_id generati |

**Comando:** `cd backend && pytest tests/phase3/ -k webauthn -v`

---

## Note

- Registrazione con sola email: `get_registration_options_for_email` genera `user_handle` (UUID) e challenge; su complete si crea `User` con quell’id se non esiste.
- Credential salvate in `User.webauthn_credentials` (JSONB) come lista di `{id, public_key, sign_count, transports}` (id e public_key in hex).
- Autenticazione: challenge in Redis sotto `webauthn:auth:{email}`; verifica passkey aggiorna `sign_count`; risposta con `access_token` JWT (RS256).
