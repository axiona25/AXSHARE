# FASE 1 — Diagnosi flusso notifiche frontend

## File rilevanti

| File | Ruolo |
|------|--------|
| `frontend/context/NotificationsContext.tsx` | Provider SSE, `mutate` globale su evento `notification` |
| `frontend/hooks/useNotifications.ts` | SWR per lista e count, `revalidateOnFocus` + `refreshInterval` |
| `frontend/app/(app)/layout.tsx` | Polling manuale `setInterval(..., 15000)` per count + list (toast) |
| `frontend/components/AppHeader.tsx` | Consuma `useNotifications(false)` → lista + count |
| `frontend/lib/api.ts` | `notificationsApi.list`, `notificationsApi.getCount` |

Nessun altro componente usa SSE `/notifications/stream` direttamente; lo stream è solo in `NotificationsContext`.

---

## 1. Count notifiche

- **Hook:** `useNotifications` → `useSWR('/notifications/count', () => notificationsApi.getCount().then(r => r.data), { refreshInterval: 60000 })`. Nessun `revalidateOnFocus` esplicito (default SWR è true).
- **Layout:** `useEffect(..., [user])` con `checkNotifications()` che chiama `notificationsApi.getCount()` subito e poi **ogni 15 secondi** con `setInterval(checkNotifications, 15000)`.

Quindi il count viene richiesto da:
1. SWR (mount + ogni 60s + su focus se default)
2. Layout (subito + ogni 15s)

→ Duplicazione e richieste molto frequenti (15s).

---

## 2. Lista notifiche

- **Hook:** `useSWR('/notifications?unread_only=false', ..., { revalidateOnFocus: true, refreshInterval: 60000 })` → `notificationsApi.list({ unread_only: false })`.
- **Layout:** `checkNotifications` dopo il count chiama `notificationsApi.list({ unread_only: true, page_size: 1 })` per il toast “ultima notifica” (solo se `newCount > prevUnreadCountRef`).

Quindi la lista viene richiesta da:
1. SWR lista completa (mount, focus, ogni 60s)
2. Layout lista 1 item (quando il count è aumentato, ogni 15s)

---

## 3. Stream / SSE

- **Solo in:** `NotificationsContext.tsx`.
- **Flusso:** `connectSSE()` apre `EventSource` su `/notifications/stream?token=...`. Su evento `notification`:
  - dispatch di `axshare-notification-toast` (se tipo condivisione/permessi)
  - **`mutate(..., { revalidate: true })`** per ogni chiave SWR che inizia con `/notifications` → quindi **sia** `/notifications?unread_only=false` **sia** `/notifications/count` vengono revalidate → 2 richieste per ogni evento SSE.
- **Reconnect:** `es.onerror` → `setTimeout(connectSSE(), delay)` con backoff (2s, 4s, … max 30s). Nessun AbortController; cleanup in `useEffect` chiude `EventSource` e cancella `retryRef`.

Problema: ogni messaggio SSE (e ogni riconnessione che può riportare eventi) scatena 2 richieste HTTP (list + count). Se lo stream è instabile o invia molti eventi, si ottengono molte richieste e possibili “cancelled” se le richieste precedenti non sono ancora completate.

---

## 4. Polling / interval / retry

| Dove | Cosa | Intervallo |
|------|------|------------|
| **layout.tsx** | `setInterval(checkNotifications, 15000)` | 15 s |
| **useNotifications** | SWR `refreshInterval: 60000` (list e count) | 60 s |
| **useNotifications** | SWR `revalidateOnFocus: true` (solo list; count usa default SWR) | Ogni focus tab |
| **NotificationsContext** | Retry SSE con backoff | 2s → 30s |

Nessun `setTimeout` per polling oltre a retry SSE. Il polling “aggressivo” è il **layout a 15s** in parallelo allo SWR a 60s e al focus.

---

## 5. Evidenze nel codice

### `useEffect`
- **NotificationsContext:** `useEffect(() => { connectSSE(); return () => { ... } }, [connectSSE])`. In Strict Mode: doppio mount → connectSSE due volte; il cleanup chiude l’ES e cancella il retry, ma la seconda run riapre lo stream. Rischio di doppia connessione/race.
- **layout.tsx:** `useEffect(() => { checkNotifications(); const interval = setInterval(checkNotifications, 15000); return () => clearInterval(interval) }, [user])`. Se `user` è stabile, un solo interval; in Strict Mode l’effect può girare due volte → due interval brevi fino al cleanup del primo.

### `setInterval` / `setTimeout`
- Layout: `setInterval(checkNotifications, 15000)` (vedi sopra).
- NotificationsContext: `setTimeout(connectSSE(), delay)` in `onerror`; cleanup con `clearTimeout(retryRef.current)`.

### `AbortController`
- Non usato né in `notificationsApi` né nel contesto/hook. Le fetch sono quelle standard di SWR/axios; le “cancelled” arrivano quando SWR/React annullano la richiesta (unmount, nuova revalidation che sostituisce la precedente).

### Cleanup effect
- NotificationsContext: chiusura ES e clear del retry.
- Layout: `clearInterval(interval)`; nessun flag “cancelled” in `checkNotifications`, quindi se l’effect viene riaperto (es. Strict Mode) le richieste avviate prima del cleanup possono ancora completare e chiamare `setNotificationToast`/`prevUnreadCountRef.current = ...` dopo unmount (race).

### Reconnect logic
- Solo SSE: backoff 2s → 30s in `onerror`; `retryRef` cancellato al cleanup.

### Dipendenze instabili
- `connectSSE` è `useCallback(() => { ... }, [])` → stabile.
- `[user]` nel layout è stabile dopo login. Quindi il moltiplicarsi delle richieste non viene da dipendenze che cambiano in loop, ma da:
  - più sorgenti che richiedono le stesse cose (layout + SWR)
  - revalidate su focus
  - revalidate globale su ogni evento SSE

---

## 6. Punto più probabile del problema

1. **Polling doppio (principale):** il layout esegue **getCount** (e a volte **list**) ogni **15 secondi** indipendentemente da SWR. Lo SWR fa già count + list (mount, ogni 60s, su focus). Quindi count (e a volte list) sono richiesti sia dal layout sia dall’hook → molte richieste duplicate e rischio di “cancelled” quando si naviga o si rivalidano le chiavi SWR.
2. **SSE → mutate globale:** ogni evento `notification` invalida tutte le chiavi `/notifications*` con `revalidate: true`, quindi 2 richieste (list + count) per evento. Con molti eventi o riconnessioni si hanno picchi di richieste e possibili cancellazioni.
3. **revalidateOnFocus:** ogni ritorno sul tab rivalida la lista (e il count se il default SWR è true), aggiungendo altre richieste in aggiunta al polling a 15s.
4. **Strict Mode:** doppio mount può far partire due interval (layout) e due connectSSE (context) in sequenza, con cleanup che annulla il primo; le richieste già in volo possono essere “cancelled” quando il componente “si smonta” la prima volta.

Riepilogo: la causa principale è il **polling a 15s nel layout** in parallelo a SWR e a revalidate su focus/SSE; in più, ogni evento SSE forza 2 richieste. Le “cancelled” sono tipicamente richieste SWR o fetch avviate dal layout che vengono annullate da unmount o da una nuova revalidation.
