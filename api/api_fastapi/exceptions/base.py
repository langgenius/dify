"""Base exception contract for API v2 routes using the legacy error envelope."""

from __future__ import annotations

from libs.exception import BaseHTTPException


class APIError(BaseHTTPException):
    """Compatibility alias for route-facing API v2 HTTP exceptions."""
