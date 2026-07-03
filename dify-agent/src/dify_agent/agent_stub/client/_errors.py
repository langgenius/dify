"""Shared client-safe exception types for Agent Stub transports."""

from __future__ import annotations


class AgentStubClientError(RuntimeError):
    """Base class for client-safe Agent Stub control-plane failures."""


class AgentStubHTTPError(AgentStubClientError):
    """Raised when the HTTP transport returns a non-success response."""

    status_code: int
    detail: object

    def __init__(self, status_code: int, detail: object) -> None:
        self.status_code = status_code
        self.detail = detail
        super().__init__(f"Agent Stub HTTP {status_code}: {detail}")


class AgentStubGRPCError(AgentStubClientError):
    """Raised when the gRPC transport returns a non-OK status."""

    status: str
    detail: str

    def __init__(self, status: str, detail: str) -> None:
        self.status = status
        self.detail = detail
        super().__init__(f"Agent Stub gRPC {status}: {detail}")


class AgentStubValidationError(AgentStubClientError):
    """Raised when request or response DTO validation fails."""


class AgentStubTransferError(AgentStubClientError):
    """Raised when a signed upload/download data-plane request fails."""


class AgentStubMissingGRPCDependencyError(AgentStubClientError):
    """Raised when the optional gRPC extra is required but unavailable."""


__all__ = [
    "AgentStubClientError",
    "AgentStubGRPCError",
    "AgentStubHTTPError",
    "AgentStubMissingGRPCDependencyError",
    "AgentStubTransferError",
    "AgentStubValidationError",
]
