# TASK 2.3 — Modulo Crypto X25519 ECDH (Key Exchange Gruppi)

> **Fase:** 2 — Crittografia & Key Management  
> **Prerequisiti:** Task 2.2 completato  
> **Path progetto:** `/Users/r.amoroso/Documents/Cursor/AXSHARE`  
> **Output atteso:** `backend/app/crypto/ecdh.py` — scambio chiavi X25519 per gruppi e condivisione E2E  

---

## Obiettivo

Modulo X25519 ECDH per scambio chiavi nei gruppi: shared secret tra coppie di utenti (senza che il server lo conosca), derivazione chiave AES-256 per gruppo tramite HKDF, cifratura/decifratura della chiave privata X25519 con AES-GCM per storage sicuro. Più veloce di RSA-4096 per scambi frequenti; usato per forward secrecy e chiavi di gruppo.

---

## Deliverable

- [x] **backend/app/crypto/ecdh.py** — `X25519KeyPair`, `generate_x25519_keypair`, `compute_shared_secret`, `derive_group_key` (HKDF + salt), `encrypt_x25519_private_key` / `decrypt_x25519_private_key`, `load_public_key_from_bytes` / `load_public_key_from_b64`, `load_private_key_from_bytes`.
- [x] **backend/app/crypto/__init__.py** — export ECDH (keypair, shared secret, derive group key, encrypt/decrypt private key, load public from b64).
- [x] **backend/tests/phase2/test_ecdh.py** — 11 test (keypair, unicità, simmetria shared secret, bytes/objects, derive group key, deterministicità, gruppi diversi, encrypt/decrypt private key, load public b64, E2E gruppo 3 membri).

---

## Risultato

- **Data completamento:** 2026-03-04  
- **Test passati:** 11/11  
- **Errori:** Nessuno.  

---

## Prossimo task

**2.4** — KDF / HKDF (o successivo in Fase 2).
