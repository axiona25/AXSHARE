"""Audit log middleware — log automatico richieste per audit trail."""

import time
import structlog
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

logger = structlog.get_logger()


class AuditLogMiddleware(BaseHTTPMiddleware):
    """Registra metodo, path, IP e status per ogni richiesta (audit trail)."""

    async def dispatch(self, request: Request, call_next):
        start = time.monotonic()
        client_ip = request.client.host if request.client else "unknown"
        method = request.method
        path = request.url.path

        response: Response = await call_next(request)

        duration_ms = (time.monotonic() - start) * 1000
        logger.info(
            "request_audit",
            method=method,
            path=path,
            client_ip=client_ip,
            status_code=response.status_code,
            duration_ms=round(duration_ms, 2),
        )
        return response
