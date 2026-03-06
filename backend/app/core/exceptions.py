"""Custom exceptions and HTTP handlers."""

from fastapi import HTTPException


class AXShareException(HTTPException):
    """Base exception for AXSHARE API."""

    def __init__(self, status_code: int, detail: str, code: str | None = None):
        super().__init__(status_code=status_code, detail=detail)
        self.code = code
