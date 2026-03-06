/**
 * Sentry error tracking (opzionale).
 * Impostare NEXT_PUBLIC_SENTRY_DSN per abilitare.
 * Chiamare initSentry() da un client component (es. SentryInit).
 */
export function initSentry(): void {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN
  if (!dsn || typeof window === 'undefined') return
  import('@sentry/nextjs')
    .then((Sentry) => {
      Sentry.init({
        dsn,
        environment: process.env.NODE_ENV,
        tracesSampleRate: 0.1,
        beforeSend(event) {
          if (event.request?.url) {
            event.request.url = event.request.url.split('#')[0]
          }
          return event
        },
      })
    })
    .catch(() => {})
}
