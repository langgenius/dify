"""API-side errors for the Dify Agent backend integration.

The wire protocol and low-level HTTP behaviour are owned by ``dify-agent``.
This module only normalizes those client errors into the API backend's boundary
so workflow/node code does not depend directly on transport-specific exception
classes.
"""

from __future__ import annotations

from http import HTTPStatus
from typing import Any

from dify_agent.client import DifyAgentHTTPError
from dify_agent.protocol import RunFailureType


def backend_reported_failure(exc: DifyAgentHTTPError) -> bool:
    """Whether the backend itself reported the failure.

    ``DifyAgentValidationError`` is a ``DifyAgentHTTPError`` that the client also
    raises when a *successful* response fails DTO validation. Those carry a 2xx
    status and a Pydantic error list, not a backend-authored error envelope.
    """
    return exc.status_code >= HTTPStatus.BAD_REQUEST


def backend_error_detail(
    exc: DifyAgentHTTPError,
    *,
    default_code: str = "agent_backend_error",
) -> tuple[str, str]:
    """Split an Agent backend HTTP error into the code and message the backend itself sent."""
    detail = exc.detail
    if isinstance(detail, dict):
        code = detail.get("code")
        message = detail.get("message")
        return (
            code if isinstance(code, str) and code else default_code,
            message if isinstance(message, str) and message else str(exc),
        )
    return default_code, str(detail)


class AgentBackendError(Exception):
    """Base error for API-side Agent backend integration failures."""


class AgentBackendRequestBuildError(AgentBackendError):
    """Raised when Dify product/workflow state cannot be mapped to a run request."""


class AgentBackendTransportError(AgentBackendError):
    """Raised for timeout or request-level failures talking to Agent backend."""


class AgentBackendHTTPError(AgentBackendTransportError):
    """Raised for Agent backend HTTP errors after status/detail normalization."""

    status_code: int
    detail: object

    def __init__(self, message: str, *, status_code: int, detail: object) -> None:
        self.status_code = status_code
        self.detail = detail
        super().__init__(message)


class AgentBackendValidationError(AgentBackendError):
    """Raised for local request validation or Agent backend 422 responses."""

    detail: object

    def __init__(self, message: str, *, detail: object) -> None:
        self.detail = detail
        super().__init__(message)


class AgentBackendStreamError(AgentBackendError):
    """Raised when an Agent backend event stream is malformed or exhausted."""


class AgentBackendRunFailedError(AgentBackendError):
    """Raised by callers that choose to translate a terminal failed run into an exception."""

    run_id: str
    detail: Any
    error_type: RunFailureType | None
    reason: str | None
    source_event_id: str | None

    def __init__(
        self,
        run_id: str,
        detail: Any,
        *,
        message: str | None = None,
        error_type: RunFailureType | None = None,
        reason: str | None = None,
        source_event_id: str | None = None,
    ) -> None:
        self.run_id = run_id
        self.detail = detail
        self.error_type = error_type
        self.reason = reason
        self.source_event_id = source_event_id
        display_message = message or f"Agent backend run failed: {run_id}"
        super().__init__(f"{display_message} (agent_run_id={run_id})")
