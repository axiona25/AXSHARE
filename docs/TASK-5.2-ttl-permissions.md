# TASK 5.2 — TTL Permessi & Auto-scadenza

**Fase:** 5 — Permessi a tempo & gruppi  
**Prerequisiti:** TASK 5.1 completato

## Implementazione

### Modello
- Il campo `expires_at` è già presente nel modello `Permission`; i permessi con `expires_at <= now` vengono considerati scaduti.

### Task Celery — `backend/app/tasks/permission_tasks.py`
- **expire_permissions:** task periodico (Celery Beat ogni 5 min) che seleziona i permessi con `is_active=True`, `expires_at` non nullo e `expires_at <= now`, imposta `is_active=False` e `resource_key_encrypted=None`, fa commit, e pubblica su Redis il messaggio `"{count} permissions expired at {now.isoformat()}"` sul channel `permissions:expired`.
- **notify_expiring_soon:** task orario che seleziona i permessi in scadenza nelle prossime 24h e pubblica l’ID di ciascuno sul channel Redis `permissions:expiring_soon` (per future notifiche push).

Le funzioni async `_expire_permissions_async` e `_notify_expiring_soon_async` sono eseguite dai task tramite `asyncio.run()` per compatibilità con SQLAlchemy async e Redis async.

### Celery App — `backend/app/celery_app.py`
- Broker e backend: `settings.redis_url`.
- Beat schedule: `expire-permissions-every-5-min` (crontab `*/5`), `notify-expiring-soon-every-hour` (minute=0).
- Serializzazione JSON.

### Endpoint — `backend/app/api/v1/endpoints/permissions.py`
- **GET /permissions/expiring-soon?hours=24:** elenco permessi **concessi da** `current_user` che scadono nelle prossime N ore (default 24). Filtri: `granted_by_id == current_user.id`, `is_active`, `expires_at` in (now, now+hours].
- **POST /permissions/file/{file_id}/extend:** body `ExtendPermissionRequest` (subject_user_id, new_expires_at). Verifica che il permesso esista (`_get_permission`), che `current_user` sia owner del file; aggiorna `expires_at` e restituisce il permesso aggiornato.

### Test — `backend/tests/phase5/test_ttl_permissions.py`
- **test_permission_expires_automatically:** permesso con `expires_at` nel passato; il download con l’utente soggetto restituisce 403 perché `check_permission` invalida il permesso scaduto.
- **test_permission_valid_before_expiry:** permesso con `expires_at` nel futuro; il download restituisce 200.
- **test_expire_permissions_task:** crea un permesso scaduto nel DB, esegue `_expire_permissions_async()`, verifica `result["expired"] >= 1` e che il permesso sia stato impostato a `is_active=False`.

## Risultati test

Esecuzione: `cd backend && source .venv/bin/activate && pytest tests/phase5/test_ttl_permissions.py -v --tb=short`

| Test | Stato |
|------|--------|
| test_permission_expires_automatically | OK |
| test_permission_valid_before_expiry | OK |
| test_expire_permissions_task | OK |

**Risultato:** 3/3 passed.

## Avvio worker e beat

```bash
# Worker
celery -A app.celery_app worker -l info

# Beat (scheduler)
celery -A app.celery_app beat -l info
```

---

- **Data completamento:** 2026-03-05  
- **Test passati:** 3/3  
- **Errori:** Nessuno
