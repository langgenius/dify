"""Normalized errors for the API-side KnowledgeFS integration."""

from __future__ import annotations


class KnowledgeFSError(Exception):
    """Base error raised by the local KnowledgeFS client boundary."""


class KnowledgeFSTransportError(KnowledgeFSError):
    """Raised when Dify cannot reach KnowledgeFS."""


class KnowledgeFSTimeoutError(KnowledgeFSTransportError):
    """Raised when a KnowledgeFS request exceeds its configured timeout."""


class KnowledgeFSHTTPError(KnowledgeFSTransportError):
    """Raised for a non-success KnowledgeFS HTTP response."""

    status_code: int
    detail: str | None

    def __init__(self, *, status_code: int, detail: str | None = None) -> None:
        self.status_code = status_code
        self.detail = detail
        super().__init__(f"KnowledgeFS returned HTTP {status_code}")


class KnowledgeFSValidationError(KnowledgeFSError):
    """Raised when a successful response violates the wire or request-tenant contract."""

    detail: object

    def __init__(self, *, detail: object) -> None:
        self.detail = detail
        super().__init__("KnowledgeFS response validation failed")


class KnowledgeFSConfigurationError(KnowledgeFSError):
    """Raised when KnowledgeFS configuration is incomplete or unsafe for the request tenant."""
