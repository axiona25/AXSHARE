# Diagnosi: notifica condivisione che “ricompare” al refresh

## FASE 1 — Diagnosi

### File rilevanti

| File | Ruolo |
|------|--------|
| `backend/app/api/v1/endpoints/permissions.py` | Crea notifica (FILE_SHARED_WITH_ME / FOLDER_SHARED_WITH_ME) **solo** in `grant_permission` |
| `backend/app/services/notification_service.py` | `create` / `create_notification` — nessuna creazione in lettura |
| `backend/app/api/v1/endpoints/notifications.py` | Solo list, count, mark read, delete, stream — **nessuna creazione** |
| `frontend/app/(app)/layout.tsx` | Effect al mount che fa getCount + list e **mostra il toast** se `newCount > prevUnreadCountRef` |

### Dove si crea la notifica di condivisione (backend)

- **Una sola volta:** in `permissions.py` in `grant_permission` (POST `/permissions/`), righe ~126 (file) e ~154 (cartella): `NotificationService.create(...)` + `publish_notification` per SSE.
- **Mai** in: GET notifications, GET count, GET shared-with-me, GET search shared_with_me, SSE stream. Nessun endpoint di lettura crea notifiche.

### La notifica viene salvata una sola volta

Sì. La notifica è creata solo al grant; non viene ricreata a ogni accesso/refresh lato backend.

### Frontend: logica che ripresenta notifiche vecchie come nuove

In `layout.tsx`, l’effect con dipendenza `[user]`:

1. Alla prima esecuzione (mount dopo login) `prevUnreadCountRef.current` è **0**.
2. Viene chiamato `getCount()` → es. `newCount = 1`.
3. Si valuta `if (newCount > prevUnreadCountRef.current)` → `1 > 0` → **true**.
4. Si fetcha la lista unread (ultima notifica), si mostra il toast “Condivisione ricevuta” e si aggiornano i ref.
5. **Ad ogni refresh** il componente viene smontato e rimontato, quindi `prevUnreadCountRef` torna a 0. Il flusso si ripete e il toast viene mostrato di nuovo per la **stessa** notifica già presente in DB.

Quindi non è il backend a “ricreare” la notifica: è il frontend che, al mount, interpreta “ho delle unread” come “è arrivata una nuova notifica” e mostra di nuovo il toast.

### Punto più probabile del bug

**`frontend/app/(app)/layout.tsx`**: l’effect che al mount esegue `checkNotifications` e mostra il toast quando `newCount > prevUnreadCountRef.current`. Al refresh `prevUnreadCountRef` è 0, quindi la condizione è sempre vera e il toast viene ripetuto per le unread già esistenti.

---

## FASE 2 — Patch (vedi commit)

- **Fix:** Al mount **solo sincronizzare** `prevUnreadCountRef` con il count attuale (getCount + `prevUnreadCountRef.current = newCount`) e **non** mostrare il toast per le unread già presenti. Il toast per una condivisione “nuova” deve arrivare **solo** da SSE (`axshare-notification-toast`), non dalla prima lettura dopo il refresh.
