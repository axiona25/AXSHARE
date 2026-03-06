# TASK 3.5 — Groups Module

**Progetto:** AXSHARE | **Fase:** 3 — Backend Core — Auth & Utenti  
**Dipendenze:** TASK 3.4 completato

## Obiettivo

Gestione gruppi con distribuzione chiavi condivise E2E (encrypted group key per membro).

## Implementazione

### Endpoint (`backend/app/api/v1/endpoints/groups.py`)

| Metodo | Path | Descrizione | Auth |
|--------|------|-------------|------|
| POST | `/groups/` | Crea gruppo; owner diventa membro con ruolo OWNER | JWT |
| GET | `/groups/` | Lista gruppi di cui l'utente è membro | JWT |
| POST | `/groups/{group_id}/members` | Aggiunge membro (solo OWNER/ADMIN); body: `user_id`, `encrypted_group_key` | JWT |
| DELETE | `/groups/{group_id}/members/{user_id}` | Rimuove membro (solo OWNER/ADMIN) | JWT |

- **Modelli:** `Group` (name_encrypted, description_encrypted, owner_id, group_key_version), `GroupMember` (group_id, user_id, role, encrypted_group_key). Ruoli: `GroupRole.OWNER`, `GroupRole.ADMIN`, `GroupRole.MEMBER`.
- **API:** `GroupCreate` accetta `name`, `description`, `group_public_key` (opzionale; non persistito nel modello attuale). L’owner viene creato con `encrypted_group_key=""` (placeholder; la chiave resta lato client).
- **Permessi:** Solo membri con `role in (OWNER, ADMIN)` possono aggiungere/rimuovere membri.

### Modello GroupRole

- In `backend/app/models/group.py` il campo `role` di `GroupMember` usa `Enum(GroupRole, values_callable=lambda obj: [e.value for e in obj])` per allineare i valori al DB (`'owner'`, `'admin'`, `'member'`).

### Router

- Router `groups` incluso in `backend/app/api/v1/router.py`.

### Test (`backend/tests/phase3/test_groups.py`)

- **Fixture:** autouse `_clear_settings_cache` (e phase3 `conftest`) per coerenza JWT.
- **Helper:** `_create_test_user`, `_unique_email`.

| Test | Descrizione |
|------|-------------|
| `test_create_group` | POST `/groups/` → 200, gruppo creato; GET `/groups/` → owner vede il gruppo |
| `test_add_member_with_key` | Crea gruppo, POST `/{id}/members` con `encrypted_group_key` → 200, `member_added` |
| `test_remove_member_invalidates_key` | Aggiunge membro, DELETE `/{id}/members/{user_id}` → 200; seconda DELETE → 404 |

## Risultati test

Eseguire da `backend`:

```bash
source .venv/bin/activate
pytest tests/phase3/test_groups.py -v
```

| Test | Stato | Note |
|------|--------|------|
| test_create_group | OK | Gruppo creato, owner in lista |
| test_add_member_with_key | OK | Membro aggiunto con encrypted_group_key |
| test_remove_member_invalidates_key | OK | Membro rimosso, seconda DELETE 404 |

Tutti e 3 i test passano eseguendo solo `test_groups.py`. Con l’intera suite `pytest tests/phase3/ -v` l’ordine di esecuzione può influire su alcuni test (cache JWT); è stato aggiunto `tests/phase3/conftest.py` con autouse per il clear della cache settings.
