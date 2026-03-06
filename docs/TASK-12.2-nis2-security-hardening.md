# TASK 12.2 — NIS2: Sicurezza, Hardening & Penetration Test

## Completamento

- **Data:** 2026-03-05
- **Test sicurezza:** 6/6 passed
- **Note:** Rate limiting gestito con middleware Redis esistente + `rate_limits.py` (slowapi non aggiunto per evitare duplicazione).

---

## Implementato

### 1. Rate limiting
- **`backend/app/core/rate_limits.py`**: costanti per limiti (formato slowapi) e `get_limit_for_path()` per il middleware.
- **`backend/app/middleware/rate_limit.py`**: usa `get_limit_for_path()` per limiti per path (auth, upload, GDPR, share, guest, ecc.).

### 2. Brute-force protection (login WebAuthn)
- **`backend/app/services/brute_force_service.py`**: lockout dopo 5 tentativi falliti (finestra 5 min), blocco 15 min; chiavi Redis per IP e email.
- Integrazione in **`auth_webauthn.py`**: `authenticate/begin` e `authenticate/complete` controllano `is_locked`; su fallimento (utente non trovato o verifica passkey fallita) si chiama `record_failure`; su successo `clear`.
- Log structlog: `brute_force_lockout`, `auth_failure_webauthn`.

### 3. Security headers
- **`backend/app/middleware/security.py`**: HSTS (con preload), X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy, Permissions-Policy, CSP; rimozione header `Server` e `X-Powered-By` (con `del` su `MutableHeaders`).

### 4. Request validation
- **`backend/app/middleware/request_validation.py`**: blocco User-Agent (sqlmap, nikto, nmap, masscan) → 403; limite dimensione body (Content-Length > 100 MB) → 413.
- Registrato in **`main.py`**.

### 5. CORS
- **`backend/app/main.py`**: `allow_methods` e `allow_headers` espliciti; `max_age=600`.
- **`backend/app/config.py`**: `allowed_origins` di default include `https://app.axshare.io`.

### 6. Frontend (Next.js)
- **`frontend/next.config.ts`**: `async headers()` con security headers (HSTS, X-Frame-Options, CSP, Permissions-Policy, ecc.).

### 7. Test automatici
- **`backend/tests/phase12/test_security.py`**:
  - `test_security_headers_present`: header di sicurezza su `/health`, assenza X-Powered-By.
  - `test_brute_force_lockout`: 5 fallimenti `authenticate/complete` → sesto richiesta → 429.
  - `test_sql_injection_rejected`: body con `admin'--` → non 500, status in (404, 422, 429).
  - `test_oversized_request_rejected`: Content-Length > 100 MB → 413.
  - `test_blocked_user_agent_rejected`: User-Agent sqlmap → 403.
  - `test_unauthenticated_access_denied`: endpoint protetti senza token → 401 o 403.

---

## File principali

| File | Descrizione |
|------|-------------|
| `app/core/rate_limits.py` | Limiti e `get_limit_for_path()` |
| `app/middleware/rate_limit.py` | Rate limit Redis per path |
| `app/services/brute_force_service.py` | Lockout login |
| `app/middleware/security.py` | Security headers |
| `app/middleware/request_validation.py` | UA block + max body size |
| `app/api/v1/endpoints/auth_webauthn.py` | Integrazione brute-force + log |
| `app/main.py` | RequestValidation + CORS |
| `frontend/next.config.ts` | Security headers Next.js |
| `tests/phase12/test_security.py` | 6 test sicurezza |
