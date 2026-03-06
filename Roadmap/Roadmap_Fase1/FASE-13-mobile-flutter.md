# FASE 13 — Mobile App iOS & Android (Flutter)
> **Progetto:** AXSHARE — Secure File Sharing Platform
> **Prerequisiti:** Fase 12 completata (backend, API, deploy stabili)
> **Path progetto:** `/Users/r.amoroso/Documents/Cursor/AXSHARE`
> **Note:** UI e Design forniti separatamente — questa fase copre logica, crypto, sync, integrazioni

---

## Stack Mobile

| Layer | Tecnologia | Note |
|---|---|---|
| **Framework** | Flutter 3.x (Dart) | iOS + Android da unico codebase |
| **Cifratura** | pointycastle + flutter_secure_storage | AES-256-GCM, RSA, X25519 in Dart |
| **Chiavi hardware** | Keychain (iOS) / Keystore (Android) | Chiavi mai in memoria in chiaro |
| **Biometria** | local_auth | Face ID / Touch ID / Fingerprint |
| **Sync file** | background_fetch + sync engine custom | Cifrato, bidirezionale |
| **File viewer** | flutter_pdfview + viewer cifrato custom | Apertura in-app, mai su disco in chiaro |
| **Push** | Firebase Cloud Messaging (FCM) | Approvazioni, alert, scadenze |
| **State management** | Riverpod 2.x | Reattivo, testabile |
| **API client** | Dio + Retrofit | Interceptor JWT, retry logic |
| **Storage locale** | Hive (cifrato) + flutter_secure_storage | Cache offline cifrata |
| **Routing** | go_router | Deep linking per condivisioni esterne |

---

## Task

| Task | Nome | File Prompt |
|---|---|---|
| **13.1** | Scaffold Flutter + struttura progetto + config iOS/Android | `TASK-13.1-flutter-scaffold.md` |
| **13.2** | Auth mobile — Biometria + WebAuthn + JWT + scambio chiavi E2E | `TASK-13.2-mobile-auth.md` |
| **13.3** | Crypto module Dart — AES-256-GCM, RSA, X25519, Argon2id | `TASK-13.3-crypto-dart.md` |
| **13.4** | File sync engine — bidirezionale cifrato + conflict resolution | `TASK-13.4-sync-engine.md` |
| **13.5** | Encrypted file viewer — PDF, immagini, docs in-app senza disco in chiaro | `TASK-13.5-file-viewer.md` |
| **13.6** | Push notifications — FCM per approvazioni, auto-distruzione, scadenze | `TASK-13.6-push-notifications.md` |
| **13.7** | Offline mode — cache cifrata Hive, sync al rientro online | `TASK-13.7-offline-mode.md` |
| **13.8** | Guest flow mobile — approval, revoca, condivisione esterna | `TASK-13.8-guest-flow.md` |

**Test automatico fine fase:** `test/phase13/`
- Unit test modulo crypto Dart (round-trip encrypt/decrypt)
- Integration test sync engine con backend
- Widget test viewer file cifrato
- Test biometria simulata
- Test push notification ricezione e routing

---

## Note Architetturali

- Il modulo crypto Dart in Task 13.3 deve essere **speculare** al modulo Python del backend — stessi algoritmi, stessi parametri, interoperabili
- Le chiavi private non toccano mai il disco in chiaro — sempre in Keychain/Keystore hardware
- Il file viewer decifra in memoria RAM e non scrive mai il contenuto in chiaro su storage
- Il sync engine riprende da dove si era fermato in caso di interruzione (resumable upload/download)
- UI e Design da integrare separatamente sui componenti stub generati da Cursor
