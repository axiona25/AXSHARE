"""Handler eccezioni custom per FastAPI."""

from typing import Any, Dict, Optional

import structlog
from fastapi import Request, status
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.config import get_settings

logger = structlog.get_logger()

# ExceptionGroup (PEP 654) non eredita da Exception, quindi va gestito esplicitamente
try:
    from exceptiongroup import ExceptionGroup  # backport Python 3.9/3.10
except ImportError:
    ExceptionGroup = getattr(__builtins__, "ExceptionGroup", None)  # Python 3.11+


def get_cors_headers(origin: Optional[str]) -> Dict[str, str]:
    """Header CORS per risposte di errore (riusabile da middleware ed exception handler).
    Coerente con allow_credentials=True: valorizza Access-Control-Allow-Origin e Credentials.
    """
    settings = get_settings()
    allowed = getattr(settings, "allowed_origins", []) or ["http://localhost:3000"]
    allow_origin = origin if origin and origin in allowed else (allowed[0] if allowed else "*")
    return {
        "Access-Control-Allow-Origin": allow_origin,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE",
        "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Request-ID",
        "Vary": "Origin",
    }


def _cors_headers(origin: Optional[str]) -> Dict[str, str]:
    """Alias per retrocompatibilità negli handler."""
    return get_cors_headers(origin)


async def http_exception_handler(
    request: Request, exc: StarletteHTTPException
) -> JSONResponse:
    """Log e risposta JSON per eccezioni HTTP."""
    logger.warning(
        "http_exception",
        path=request.url.path,
        status_code=exc.status_code,
        detail=exc.detail,
    )
    origin = request.headers.get("origin")
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
        headers=_cors_headers(origin),
    )


async def validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    """Risposta 422 per errori di validazione Pydantic."""
    origin = request.headers.get("origin")
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": exc.errors()},
        headers=_cors_headers(origin),
    )


async def generic_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Cattura eccezioni non gestite, logga e restituisce 500 con header CORS."""
    logger.exception(
        "unhandled_exception",
        path=request.url.path,
        method=request.method,
        error=str(exc),
    )
    origin = request.headers.get("origin")
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "Errore interno del server"},
        headers=_cors_headers(origin),
    )


async def exception_group_handler(request: Request, exc: Any) -> JSONResponse:
    """Cattura ExceptionGroup (es. da TaskGroup/anyio) e logga la prima sub-eccezione."""
    first = exc.exceptions[0] if getattr(exc, "exceptions", None) else exc
    logger.exception(
        "exception_group",
        path=request.url.path,
        method=request.method,
        error=str(first),
        sub_count=len(getattr(exc, "exceptions", ())),
    )
    origin = request.headers.get("origin")
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "Errore interno del server"},
        headers=_cors_headers(origin),
    )


def register_exception_handlers(app):
    """Registra gli exception handler sull'app FastAPI."""
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    if ExceptionGroup is not None:
        app.add_exception_handler(ExceptionGroup, exception_group_handler)
    app.add_exception_handler(Exception, generic_exception_handler)
