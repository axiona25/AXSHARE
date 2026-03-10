"""
Limiti di rate per endpoint (NIS2 / OWASP).
- Formato slowapi: "N/periodo" per @limiter.limit()
- get_limit_for_path() per RateLimitMiddleware: (numero_richieste, finestra_secondi).
"""
from typing import Tuple


class RateLimit:
    """Limiti in formato slowapi (es. 5/minute)."""
    LOGIN = "10/minute"
    REGISTER = "5/hour"
    TOKEN_REFRESH = "10/minute"
    UPLOAD = "20/minute"
    DOWNLOAD = "60/minute"
    DOWNLOAD_PUBLIC = "30/minute"
    SHARE_CREATE = "10/minute"
    GUEST_INVITE = "5/minute"
    GUEST_REDEEM = "10/minute"
    GDPR_EXPORT = "2/hour"
    GDPR_ERASURE = "1/day"
    DEFAULT = "100/minute"
    SEARCH = "30/minute"


# Finestre in secondi per middleware Redis
LOGIN_WINDOW = 60
LOGIN_LIMIT = 10
REGISTER_WINDOW = 3600
REGISTER_LIMIT = 5
TOKEN_REFRESH_WINDOW = 60
TOKEN_REFRESH_LIMIT = 10
UPLOAD_WINDOW = 3600
UPLOAD_LIMIT = 50
DOWNLOAD_WINDOW = 60
DOWNLOAD_LIMIT = 60
DOWNLOAD_PUBLIC_WINDOW = 60
DOWNLOAD_PUBLIC_LIMIT = 30
SHARE_CREATE_WINDOW = 60
SHARE_CREATE_LIMIT = 10
GUEST_INVITE_WINDOW = 60
GUEST_INVITE_LIMIT = 5
GUEST_REDEEM_WINDOW = 60
GUEST_REDEEM_LIMIT = 10
GDPR_EXPORT_WINDOW = 3600
GDPR_EXPORT_LIMIT = 2
GDPR_ERASURE_WINDOW = 86400
GDPR_ERASURE_LIMIT = 1
DEFAULT_WINDOW = 60
DEFAULT_LIMIT = 200
SEARCH_WINDOW = 60
SEARCH_LIMIT = 30


def get_limit_for_path(path: str) -> Tuple[int, int]:
    """Restituisce (limit, window_seconds) per il path."""
    path = path.rstrip("/")
    if "/api/v1/auth/token/refresh" in path:
        return (TOKEN_REFRESH_LIMIT, TOKEN_REFRESH_WINDOW)
    if "/api/v1/auth/webauthn/register/begin" in path or "/api/v1/auth/webauthn/register/complete" in path:
        return (REGISTER_LIMIT, REGISTER_WINDOW)
    if "/api/v1/auth/webauthn/authenticate" in path:
        return (LOGIN_LIMIT, LOGIN_WINDOW)
    if "/api/v1/files/upload" in path:
        return (UPLOAD_LIMIT, UPLOAD_WINDOW)
    if "/api/v1/public/share/" in path and "/download" in path:
        return (DOWNLOAD_PUBLIC_LIMIT, DOWNLOAD_PUBLIC_WINDOW)
    if "/api/v1/public/guest/redeem" in path:
        return (GUEST_REDEEM_LIMIT, GUEST_REDEEM_WINDOW)
    if "/share-links" in path and "files" in path:
        return (SHARE_CREATE_LIMIT, SHARE_CREATE_WINDOW)
    if "/guest/invite" in path:
        return (GUEST_INVITE_LIMIT, GUEST_INVITE_WINDOW)
    if "/api/v1/gdpr/export" in path:
        return (GDPR_EXPORT_LIMIT, GDPR_EXPORT_WINDOW)
    if "/api/v1/gdpr/erasure" in path and "admin" not in path:
        return (GDPR_ERASURE_LIMIT, GDPR_ERASURE_WINDOW)
    if "/api/v1/search/" in path:
        return (SEARCH_LIMIT, SEARCH_WINDOW)
    return (DEFAULT_LIMIT, DEFAULT_WINDOW)
