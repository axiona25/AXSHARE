# TASK 2.4 — KEK Wrapping/Unwrapping su Vault

> **Fase:** 2 — Crittografia & Key Management  
> **Prerequisiti:** Task 2.3 completato, Vault in esecuzione con Transit engine attivo  
> **Path progetto:** `/Users/r.amoroso/Documents/Cursor/AXSHARE`  
> **Output atteso:** `backend/app/crypto/vault.py` aggiornato con workflow completo KEK + test integrazione Vault  

---

## Obiettivo

Estendere il client Vault (già presente dalla Fase 1) con il workflow completo di Key Encryption Key (KEK): wrap/unwrap di file key e group key tramite Transit, storage in KV v2, rotazione (rewrap), cancellazione e supporto GDPR (right to erasure).

---

## Deliverable

- [x] **backend/app/crypto/vault.py** — Nuovi metodi: `store_file_key_wrapped`, `retrieve_file_key`, `delete_file_key`; `store_group_master_key`, `retrieve_group_master_key`, `delete_group_keys`; `rewrap_file_key`, `batch_rewrap_keys`; `erase_all_user_data` (GDPR).
- [x] **backend/tests/phase2/test_vault_kek.py** — 9 test: auth, wrap/unwrap, store/retrieve/delete file key, store/retrieve/delete group key, rewrap file key, GDPR erasure, roundtrip multiplo.

---

## Risultato

- **Data completamento:** 2026-03-04  
- **Test passati:** 9/9  
- **Vault Transit operativo:** Sì (wrap/unwrap/rewrap con `axshare-master-key`)  
- **Errori:** Nessuno  

---

## Prossimo task

**2.5** — Integrazione KDF/KEK (o successivo in Fase 2).
