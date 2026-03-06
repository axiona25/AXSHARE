"""Metriche Prometheus custom per AXSHARE."""

from prometheus_client import Counter, Gauge, Histogram

file_uploads_total = Counter(
    "axshare_file_uploads_total",
    "Totale upload file",
    ["outcome"],
)
file_downloads_total = Counter(
    "axshare_file_downloads_total",
    "Totale download file",
    ["type"],
)
auth_attempts_total = Counter(
    "axshare_auth_attempts_total",
    "Tentativi di autenticazione",
    ["outcome"],
)
active_share_links = Gauge(
    "axshare_active_share_links",
    "Share link attivi",
)
active_guest_sessions = Gauge(
    "axshare_active_guest_sessions",
    "Sessioni guest attive",
)
crypto_operations = Histogram(
    "axshare_crypto_operation_seconds",
    "Durata operazioni crittografiche",
    ["operation"],
    buckets=[0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5],
)
