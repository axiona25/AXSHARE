# TASK 2.5 — Key Derivation (Argon2id) + Test Suite Fase 2

> **Fase:** 2 — Crittografia & Key Management  
> **Prerequisiti:** Task 2.4 completato  
> **Path progetto:** `/Users/r.amoroso/Documents/Cursor/AXSHARE`  
> **Output atteso:** `backend/app/crypto/kdf.py` completo + test suite completa Fase 2  

---

## Obiettivo

Modulo KDF con Argon2id per derivazione della KEK dalla password (punto critico zero-knowledge). PBKDF2-SHA256 come fallback. Hash password per login (argon2-cffi PasswordHasher), verifica e rehash. Funzioni di supporto: derive_session_key, secure_compare. Test suite completa Fase 2 che verifica l'integrazione tra tutti i moduli crypto.

---

## Deliverable

- [x] **backend/app/crypto/kdf.py** — Argon2id (OWASP 2024), PBKDF2 fallback, `DerivedKey`, `generate_salt`, `derive_key_from_password`, `derive_key_deterministic`, `hash_password_for_storage`, `verify_password`, `needs_rehash`, `derive_session_key`, `secure_compare`.
- [x] **backend/requirements.txt** — aggiunto `argon2-cffi==23.1.0`.
- [x] **backend/app/crypto/__init__.py** — export KDF.
- [x] **backend/tests/phase2/test_kdf.py** — 13 test (salt, argon2id, deterministic, pbkdf2, invalid algorithm, hash/verify/rehash, secure_compare, KEK workflow).
- [x] **backend/tests/phase2/test_phase2_full.py** — 3 test integrazione (registrazione utente, upload/download E2E, group sharing E2E).

---

## Risultato

- **Data completamento:** 2026-03-04  
- **test_aes:** 15/15  
- **test_rsa:** 11/11  
- **test_ecdh:** 11/11  
- **test_vault_kek:** 9/9  
- **test_kdf:** 13/13  
- **test_phase2_full:** 3/3  
- **TOTALE:** 62/62  
- **Errori:** Nessuno  

---

## Prossimo task

Fase 2 completata. Prossimo: **Fase 3** (o task successivo in roadmap).
