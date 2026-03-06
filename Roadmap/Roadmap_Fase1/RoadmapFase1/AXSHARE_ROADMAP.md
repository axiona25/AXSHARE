# AXSHARE — Master Roadmap di Sviluppo
> Secure File Sharing Platform — End-to-End Encrypted, GDPR & NIS2 Compliant
> **Path progetto:** `/Users/r.amoroso/Documents/Cursor/AXSHARE`
> **Stack:** FastAPI + PostgreSQL + Next.js
> **Data:** 2026-03-04 | **Versione:** 2.0

---

## Stack Tecnologico Definitivo

| Layer | Tecnologia | Note |
|---|---|---|
| **Backend API** | FastAPI + Uvicorn + Gunicorn | Python 3.12 |
| **ORM** | SQLAlchemy 2.0 async + Alembic | Migrations versionate |
| **Task Queue** | Celery + Redis | Auto-distruzione, notifiche, report |
| **Database** | PostgreSQL 16 | RLS + JSONB + Full-Text Search |
| **Cache / TTL** | Redis 7 | Permessi a tempo, sessioni |
| **Storage File** | MinIO (S3-compatible) | Zero-knowledge |
| **Cifratura** | PyNaCl (libsodium) + AES-256-GCM + X25519 | Client-side E2E |
| **Key Management** | HashiCorp Vault + hvac | HSM-ready, GDPR/NIS2 |
| **Firma Digitale** | pyHanko (PAdES/CAdES) | Standard eIDAS |
| **Auth** | py_webauthn + pyotp + python-jose RS256 | MFA obbligatorio |
| **Frontend Web** | Next.js 14 + React + TypeScript | App Router |
| **UI** | shadcn/ui + Tailwind CSS | Componenti accessibili |
| **Client Desktop** | Tauri 2 (Rust + WebView2) | Mac + Windows |
| **Disco Virtuale** | macFUSE / WinFsp via Tauri | File cifrati localmente |
| **Test Backend** | pytest + pytest-asyncio + httpx | Coverage obbligatorio |
| **Test Frontend** | Vitest + Playwright | Unit + E2E |
| **Infra Dev** | Docker Compose v2 | Stack locale completo |
| **Infra Cloud** | Terraform + GitHub Actions | IaC + CI/CD |

---

## Mappa Completa Fasi

| Fase | Nome | Task | Stato |
|---|---|---|---|
| **FASE 1** | Foundation & Infrastruttura | 1.1 → 1.5 | **Completata** |
| **FASE 2** | Crittografia & Key Management | 2.1 → 2.5 | Da fare |
| **FASE 3** | Backend Core — Auth & Utenti | 3.1 → 3.5 | Da fare |
| **FASE 4** | File System & Storage E2E | 4.1 → 4.5 | Da fare |
| **FASE 5** | Permessi a Tempo & Gruppi | 5.1 → 5.4 | Da fare |
| **FASE 6** | Auto-Distruzione File & Cartelle | 6.1 → 6.3 | Da fare |
| **FASE 7** | Client Desktop Mac/Windows | 7.1 → 7.5 | Da fare |
| **FASE 8** | Metadati & Ricerca Avanzata | 8.1 → 8.3 | Da fare |
| **FASE 9** | Firma Digitale | 9.1 → 9.4 | Da fare |
| **FASE 10** | Condivisione Esterna & Guest | 10.1 → 10.4 | Da fare |
| **FASE 11** | Reportistica & Audit Log | 11.1 → 11.3 | Da fare |
| **FASE 12** | Compliance GDPR/NIS2 & Deploy | 12.1 → 12.4 | Da fare |

---

## FASE 1 — Foundation & Infrastruttura

> Obiettivo: struttura del progetto, tutti i servizi Docker attivi, DB pronto, storage configurato, Vault inizializzato.

| Task | Nome | File Prompt | Stato |
|---|---|---|---|
| **1.1** | Scaffold monorepo | `TASK-1.1-scaffold-monorepo.md` | Completato |
| **1.2** | Docker Compose stack completo | `TASK-1.2-docker-compose.md` | Completato |
| **1.3** | PostgreSQL schema + RLS + Alembic | `TASK-1.3-postgresql-schema.md` | Completato |
| **1.4** | MinIO bucket policy + config | `TASK-1.4-minio-setup.md` | Completato |
| **1.5** | HashiCorp Vault secrets engine | `TASK-1.5-vault-setup.md` | Completato |

**Test automatico fine fase:** `tests/phase1/test_infra.py` — 12 test (PostgreSQL 3, Redis 2, MinIO 3, Vault 3, API health 1). Eseguire con `pytest tests/phase1/ -v`. **FASE 1 COMPLETATA.**

---

## Note Operative

1. Eseguire i task nell'ordine indicato — ci sono dipendenze tra fasi
2. Ogni task genera/aggiorna il proprio file `.md` con risultati e output test
3. I test di fine fase eseguono `pytest tests/phaseN/ -v` e riportano nel file MD
4. Mai hardcodare segreti — sempre da `.env` o Vault
5. Il server non riceve mai chiavi private o file in chiaro (principio zero-knowledge)
