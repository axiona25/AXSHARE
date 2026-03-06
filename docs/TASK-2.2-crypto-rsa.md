# TASK 2.2 — Modulo Crypto RSA-4096

> **Fase:** 2 — Crittografia & Key Management  
> **Prerequisiti:** Task 2.1 completato  
> **Path progetto:** `/Users/r.amoroso/Documents/Cursor/AXSHARE`  
> **Output atteso:** `backend/app/crypto/rsa.py` — generazione keypair, cifratura/decifratura, storage cifrato chiave privata  

---

## Obiettivo

Modulo RSA-4096 per keypair utente (registrazione), cifratura della file_key con chiave pubblica del destinatario (condivisione E2E), storage della chiave privata cifrata con AES-GCM derivato da password (zero-knowledge). Firma RSA-PSS per hash (base per Fase 9 pyHanko).

---

## Deliverable

- [x] **backend/app/crypto/rsa.py** — `RSAKeyPair`, `generate_keypair`, `encrypt_with_public_key` / `decrypt_with_private_key` (OAEP SHA-256), `encrypt_private_key` / `decrypt_private_key` (AES-GCM), `load_public_key_from_pem` / `load_private_key_from_pem`, `sign_data` / `verify_signature` (PSS SHA-256).
- [x] **backend/app/crypto/__init__.py** — export RSA.
- [x] **backend/tests/phase2/test_rsa.py** — 11 test (keypair, roundtrip, file_key, wrong key, encrypt/decrypt private key, sign/verify, e2e file sharing).

---

## Risultato

- **Data completamento:** 2026-03-04  
- **Test passati:** 11/11  
- **Tempo generazione keypair:** ~1–2 s per keypair (normale per RSA-4096). Suite completa ~5 s.  
- **Errori:** Nessuno.  

---

## Prossimo task

**2.3** — ECDH / X25519 (o successivo in Fase 2).
