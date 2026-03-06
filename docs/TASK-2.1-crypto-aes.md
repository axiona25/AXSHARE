# TASK 2.1 — Modulo Crypto AES-256-GCM

> **Fase:** 2 — Crittografia & Key Management  
> **Prerequisiti:** Fase 1 completata  
> **Path progetto:** `/Users/r.amoroso/Documents/Cursor/AXSHARE`  
> **Output atteso:** `backend/app/crypto/aes.py` completo e testato  

---

## Obiettivo

Modulo AES-256-GCM per cifratura simmetrica di file e chiavi: chiave per file, IV random 12 byte, tag GCM per integrità/autenticità. Cifratura sempre lato client; server gestisce solo blob cifrati.

---

## Deliverable

- [x] **backend/app/crypto/aes.py** — `EncryptedData`, `generate_file_key`, `generate_nonce`, `encrypt`/`decrypt`, `decrypt_raw`, `encrypt_string`/`decrypt_string`, `encrypt_key`/`decrypt_key`, `derive_key_from_bytes` (HKDF-SHA256).
- [x] **backend/app/crypto/__init__.py** — export simboli AES.
- [x] **backend/tests/phase2/test_aes.py** — 14 test (roundtrip, AAD, wrong key/AAD/tamper, storage format, string, key wrap, HKDF, invalid key size, large file, decrypt_raw).
- [x] **backend/tests/phase2/__init__.py** — package phase2.

---

## Risultato

- **Data completamento:** 2026-03-04  
- **Test passati:** 15/15 (14 + test_decrypt_raw)  
- **Errori:** Nessuno. Compatibilità Python 3.9: uso di `Optional[bytes]` al posto di `bytes | None`.  

---

## Prossimo task

**2.2** — KDF e key derivation (o successivo in Fase 2).
