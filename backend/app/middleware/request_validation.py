"""Request validation: size limits, block scanning user-agents. NIS2."""

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

MAX_REQUEST_SIZE = 100 * 1024 * 1024  # 100 MB (upload endpoints may override)
BLOCKED_USER_AGENTS = ("sqlmap", "nikto", "nmap", "masscan")


class RequestValidationMiddleware(BaseHTTPMiddleware):
    """Blocca user-agent da tool di scanning e limita dimensione body."""

    async def dispatch(self, request: Request, call_next):
        ua = (request.headers.get("user-agent") or "").lower()
        for blocked in BLOCKED_USER_AGENTS:
            if blocked in ua:
                return JSONResponse(
                    status_code=403,
                    content={"detail": "Richiesta non consentita"},
                )

        if request.method in ("POST", "PUT", "PATCH"):
            content_length = request.headers.get("content-length")
            if content_length:
                try:
                    size = int(content_length)
                    if size > MAX_REQUEST_SIZE:
                        return JSONResponse(
                            status_code=413,
                            content={"detail": "Payload troppo grande"},
                        )
                except ValueError:
                    pass

        return await call_next(request)
