# Checklist Compliance GDPR/NIS2 — AXSHARE

## GDPR (Reg. EU 2016/679)

### Art. 5 — Principi
- [x] **Minimizzazione dati**: solo i dati necessari raccolti
- [x] **Accuratezza**: i dati possono essere aggiornati dall'utente
- [x] **Limitazione conservazione**: retention automatica configurabile (default 365gg)
- [x] **Integrità e riservatezza**: crittografia E2E, zero-knowledge server

### Art. 13/14 — Informativa
- [x] Privacy policy implementata
- [x] Registro consensi (`gdpr_consent_log`) con tipo, versione, IP, timestamp
- [x] Endpoint `POST /gdpr/consent` per registrare accettazione ToS/Privacy

### Art. 17 — Diritto alla cancellazione
- [x] Endpoint `POST /gdpr/erasure` per richiedere cancellazione
- [x] Procedura `process_erasure`: cancella file, revoca link, anonimizza profilo
- [x] Audit log anonimizzato (`actor_email → [deleted]`)
- [x] Stato richiesta consultabile (`GET /gdpr/erasure/status`)

### Art. 20 — Portabilità dati
- [x] Endpoint `GET /gdpr/export` con export JSON di tutti i dati utente
- [x] Include: profilo, file (metadati), share link, sessioni guest, audit log
- [x] Formato machine-readable (JSON)

### Art. 25 — Privacy by Design
- [x] Crittografia E2E: il server non conosce contenuti file
- [x] Chiavi private generate e conservate client-side (IndexedDB cifrato)
- [x] Zero-knowledge: name_encrypted, mime_type_encrypted nei metadati

### Art. 32 — Misure di sicurezza
- [x] Crittografia in transito: TLS 1.2/1.3 obbligatorio (nginx config)
- [x] Crittografia a riposo: file cifrati AES-GCM client-side
- [x] Autenticazione: JWT RS256, refresh token rotation
- [x] Autorizzazione: RBAC (admin, user, guest)
- [x] Audit log immutabile per tutte le operazioni sensibili
- [x] Backup automatico PostgreSQL

## NIS2 (Dir. EU 2022/2555)

### Art. 21 — Misure di gestione del rischio

#### Politiche sicurezza
- [x] Rate limiting su endpoint sensibili (middleware Redis)
- [x] Brute-force protection login (Redis, 5 tentativi, lockout 15min)
- [x] Security headers HTTP (HSTS, CSP, X-Frame-Options, ecc.)
- [x] CORS configurato con lista esplicita origini consentite

#### Gestione incidenti
- [x] Audit log centralizzato con filtri e export CSV
- [x] Notifiche in-app per eventi critici (firma invalida, accesso anomalo)
- [x] Sentry per error tracking (con sanitizzazione dati sensibili)
- [x] Alert sicurezza per admin (`notify_security_alert`)

#### Continuità operativa
- [x] Health check endpoint `/health` e `/health/detailed`
- [x] Graceful shutdown backend (uvicorn + lifespan hooks)
- [x] Graceful shutdown desktop (Tauri window event)
- [x] Docker healthcheck su tutti i servizi critici
- [x] Backup automatico PostgreSQL (pg_backup service)

#### Sicurezza catena fornitura
- [x] Dockerfile multi-stage (minimizza attack surface)
- [x] Utente non-root nei container
- [x] Trivy security scan in CI/CD
- [x] Dipendenze Python/Node con versioni pinned

#### Crittografia
- [x] AES-256-GCM per cifratura file (client-side)
- [x] RSA-OAEP 2048-bit per chiave file
- [x] RSA-PSS 2048-bit SHA-256 per firma digitale
- [x] PBKDF2 per derivazione KEK da passphrase
- [x] TLS 1.2/1.3 con cipher suite moderne (nginx)

### Art. 23 — Notifica incidenti
- [x] Audit log traccia tutti gli eventi di sicurezza
- [x] Export CSV per reporting alle autorità
- [x] Timeline ricostruibile da `audit_logs` con created_at
