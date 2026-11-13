"""Synchronous API-side wrapper around the public ``dify-agent`` client.

``dify-agent`` owns the cross-service DTOs and HTTP/SSE implementation. The API
backend keeps this thin wrapper so workflow code depends on a local protocol,
gets API-native errors, and can use a deterministic fake in tests without
creating another wire contract.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from typing import Protocol

from dify_agent.client import (
    DifyAgentClientError,
    DifyAgentHTTPError,
    DifyAgentStreamError,
    DifyAgentTimeoutError,
    DifyAgentValidationError,
)
from dify_agent.protocol import (
    CancelRunRequest,
    CancelRunResponse,
    CreateRunRequest,
    CreateRunResponse,
    RunCancelledEvent,
    RunEvent,
    RunStatusResponse,
)
from pydantic import ValidationError

from clients.agent_backend.errors import (
    AgentBackendError,
    AgentBackendHTTPError,
    AgentBackendStreamError,
    AgentBackendTransportError,
    AgentBackendValidationError,
    backend_error_detail,
    backend_reported_failure,
)

# The SDK uses status 422 for these local option checks as well as real HTTP rejections.
_LOCAL_VALIDATION_DETAILS = frozenset(
    {
        "request must be a CreateRunRequest",
        "max_reconnects must be non-negative",
        "reconnect_delay_seconds must be non-negative",
        "timeout_seconds must be non-negative",
        "poll_interval_seconds must be non-negative",
    }
)


class AgentBackendRunClient(Protocol):
    """Local boundary used by API workflow integrations to run Agent backend jobs."""

    def create_run(self, request: CreateRunRequest) -> CreateRunResponse:
        """Create one Agent backend run and return its accepted status."""

    def cancel_run(self, run_id: str, request: CancelRunRequest | None = None) -> CancelRunResponse:
        """Request explicit cancellation for one Agent backend run."""

    def cancel_run_and_wait(
        self,
        run_id: str,
        request: CancelRunRequest | None = None,
        *,
        after: str | None = None,
    ) -> RunCancelledEvent:
        """Request cancellation and wait for runner cleanup to finish."""

    def stream_events(
        self,
        run_id: str,
        *,
        after: str | None = None,
        should_stop: Callable[[], bool] | None = None,
    ) -> Iterator[RunEvent]:
        """Yield public ``dify-agent`` run events in stream order."""

    def wait_run(self, run_id: str, *, timeout_seconds: float | None = None) -> RunStatusResponse:
        """Wait for a run to reach a terminal status and return that status."""


class _DifyAgentSyncClient(Protocol):
    """Subset of ``dify_agent.client.Client`` used by the API wrapper."""

    def create_run_sync(self, request: CreateRunRequest) -> CreateRunResponse:
        """Create one run synchronously."""

    def cancel_run_sync(self, run_id: str, request: CancelRunRequest | None = None) -> CancelRunResponse:
        """Cancel one run synchronously."""

    def cancel_run_and_wait_sync(
        self,
        run_id: str,
        request: CancelRunRequest | None = None,
        *,
        after: str | None = None,
    ) -> RunCancelledEvent:
        """Cancel one run and wait for its terminal event synchronously."""

    def stream_events_sync(
        self,
        run_id: str,
        *,
        after: str | None = None,
        max_reconnects: int | None = None,
        timeout_seconds: float | None = None,
        should_stop: Callable[[], bool] | None = None,
    ) -> Iterator[RunEvent]:
        """Stream run events synchronously."""

    def wait_run_sync(self, run_id: str, *, timeout_seconds: float | None = None) -> RunStatusResponse:
        """Wait for terminal run status synchronously."""


class DifyAgentBackendRunClient:
    """Adapter from API sync call sites to ``dify_agent.client.Client`` sync methods."""

    client: _DifyAgentSyncClient

    def __init__(
        self,
        client: _DifyAgentSyncClient,
        *,
        stream_max_reconnects: int = 3,
    ) -> None:
        self.client = client
        self._stream_max_reconnects = stream_max_reconnects

    def create_run(self, request: CreateRunRequest) -> CreateRunResponse:
        """Create one run through ``POST /runs`` and normalize client exceptions."""
        try:
            return self.client.create_run_sync(request)
        except Exception as exc:
            raise _normalize_dify_agent_error(exc) from exc

    def cancel_run(self, run_id: str, request: CancelRunRequest | None = None) -> CancelRunResponse:
        """Cancel one run through ``POST /runs/{run_id}/cancel`` and normalize exceptions."""
        try:
            return self.client.cancel_run_sync(run_id, request=request)
        except Exception as exc:
            raise _normalize_dify_agent_error(exc, run_id=run_id) from exc

    def cancel_run_and_wait(
        self,
        run_id: str,
        request: CancelRunRequest | None = None,
        *,
        after: str | None = None,
    ) -> RunCancelledEvent:
        """Cancel one run, then wait for the cleanup-complete terminal event."""
        try:
            return self.client.cancel_run_and_wait_sync(run_id, request=request, after=after)
        except Exception as exc:
            raise _normalize_dify_agent_error(exc, run_id=run_id) from exc

    def stream_events(
        self,
        run_id: str,
        *,
        after: str | None = None,
        should_stop: Callable[[], bool] | None = None,
    ) -> Iterator[RunEvent]:
        """Stream run events from ``/events/sse`` with the wrapped client's reconnect policy."""
        try:
            yield from self.client.stream_events_sync(
                run_id,
                after=after,
                max_reconnects=self._stream_max_reconnects,
                should_stop=should_stop,
            )
        except Exception as exc:
            error = _normalize_dify_agent_error(exc, run_id=run_id)
            raise error from error.__cause__ or exc

    def wait_run(self, run_id: str, *, timeout_seconds: float | None = None) -> RunStatusResponse:
        """Poll run status until terminal state and normalize client exceptions."""
        try:
            return self.client.wait_run_sync(run_id, timeout_seconds=timeout_seconds)
        except Exception as exc:
            raise _normalize_dify_agent_error(exc, run_id=run_id) from exc


def _normalize_dify_agent_error(exc: Exception, *, run_id: str | None = None) -> AgentBackendError:
    """Map SDK failures, distinguishing HTTP rejections from local/DTO validation.

    SSE retries can hide a backend HTTP failure in either exception link. Recovering
    that failure preserves its status/code and installs the original HTTP cause.
    """
    match exc:
        case DifyAgentValidationError() as error:
            local_validation = isinstance(error.__cause__, ValidationError) or (
                isinstance(error.detail, str) and error.detail in _LOCAL_VALIDATION_DETAILS
            )
            if backend_reported_failure(error) and not local_validation:
                error_code, message = _normalized_http_detail(error)
                return AgentBackendValidationError(
                    message,
                    detail=error.detail,
                    run_id=run_id,
                    status_code=error.status_code,
                    error_code=error_code,
                )
            return AgentBackendValidationError(
                "Agent backend request or response validation failed", detail=error.detail, run_id=run_id
            )
        case DifyAgentHTTPError() as error:
            error_code, message = _normalized_http_detail(error)
            return AgentBackendHTTPError(
                message,
                status_code=error.status_code,
                detail=error.detail,
                error_code=error_code,
                run_id=run_id,
            )
        case DifyAgentTimeoutError() as error:
            return AgentBackendTransportError(str(error), run_id=run_id)
        case DifyAgentStreamError() as error:
            http_error = _stream_http_error(error)
            if http_error is not None:
                normalized = _normalize_dify_agent_error(http_error, run_id=run_id)
                normalized.__cause__ = http_error
                return normalized
            return AgentBackendStreamError(str(error), run_id=run_id)
        case DifyAgentClientError() as error:
            return AgentBackendTransportError(str(error), run_id=run_id)
        case AgentBackendError() as error:
            return error
        case _:
            return AgentBackendTransportError(str(exc) or type(exc).__name__, run_id=run_id)


def _normalized_http_detail(error: DifyAgentHTTPError) -> tuple[str | None, str]:
    """Keep an HTTP prefix and a backend-authored message, without echoing a fallback dict repr."""
    error_code, backend_message = backend_error_detail(error) if backend_reported_failure(error) else (None, "")
    message = f"Agent backend HTTP {error.status_code}"
    if backend_message and backend_message != str(error):
        message = f"{message}: {backend_message}"
    return error_code, message


def _stream_http_error(error: DifyAgentStreamError) -> DifyAgentHTTPError | None:
    """Find a backend HTTP rejection hidden by SDK retries, tolerating cycles in either link."""
    pending: list[BaseException] = [error]
    seen: set[int] = set()
    while pending:
        current = pending.pop()
        if id(current) not in seen:
            seen.add(id(current))
            if isinstance(current, DifyAgentHTTPError) and backend_reported_failure(current):
                return current
            pending.extend(link for link in (current.__context__, current.__cause__) if link is not None)
    return None
