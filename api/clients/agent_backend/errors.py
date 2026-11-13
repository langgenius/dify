"""API-side errors for the Dify Agent backend integration.

The wire protocol and low-level HTTP behaviour are owned by ``dify-agent``.
This module only normalizes those client errors into the API backend's boundary
so app/workflow code does not depend directly on transport-specific exception
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
    """API-side integration failure, with optional runtime correlation metadata."""

    def __init__(self, message: str, *, run_id: str | None = None, reason: str | None = None) -> None:
        """Keep the message and any known run/reason available across error translation."""
        super().__init__(message)
        self.run_id = run_id
        self.reason = reason


class AgentBackendRequestBuildError(AgentBackendError):
    """Raised when Dify product/workflow state cannot be mapped to a run request."""


class AgentBackendTransportError(AgentBackendError):
    """Raised for timeout or request-level failures talking to Agent backend."""


class AgentBackendHTTPError(AgentBackendTransportError):
    """Raised for Agent backend HTTP errors after status/detail normalization."""

    status_code: int
    detail: object

    def __init__(
        self,
        message: str,
        *,
        status_code: int,
        detail: object,
        error_code: str | None = None,
        run_id: str | None = None,
    ) -> None:
        """Retain the backend status/detail and optional code/run for response conversion."""
        self.status_code = status_code
        self.detail = detail
        self.error_code = error_code
        super().__init__(message, run_id=run_id)


class AgentBackendValidationError(AgentBackendError):
    """Local protocol validation or a backend rejection, retaining HTTP metadata only for the latter."""

    detail: object

    def __init__(
        self,
        message: str,
        *,
        detail: object,
        run_id: str | None = None,
        status_code: int | None = None,
        error_code: str | None = None,
    ) -> None:
        """Keep validation detail and any known run; local validation leaves HTTP metadata unset."""
        self.detail = detail
        self.status_code = status_code
        self.error_code = error_code
        super().__init__(message, run_id=run_id)


class AgentBackendStreamError(AgentBackendError):
    """Raised when an Agent backend event stream is malformed or exhausted."""


class AgentBackendRunFailedError(AgentBackendError):
    """Raised by callers that choose to translate a terminal failed run into an exception."""

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
        """Preserve terminal failure metadata and include the required run in the display message."""
        self.detail = detail
        self.error_type = error_type
        self.source_event_id = source_event_id
        display_message = message or f"Agent backend run failed: {run_id}"
        super().__init__(f"{display_message} (agent_run_id={run_id})", run_id=run_id, reason=reason)
