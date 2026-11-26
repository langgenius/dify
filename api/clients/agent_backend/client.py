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

from clients.agent_backend.errors import (
    AgentBackendError,
    AgentBackendHTTPError,
    AgentBackendStreamError,
    AgentBackendTimeoutError,
    AgentBackendTransportError,
    AgentBackendValidationError,
)


class AgentBackendRunClient(Protocol):
    """Local boundary used by API workflow integrations to run Agent backend jobs."""

    def create_run(self, request: CreateRunRequest, *, timeout_seconds: float | None = None) -> CreateRunResponse:
        """Submit one run under an optional total timeout and return its accepted status."""

    def cancel_run(self, run_id: str, request: CancelRunRequest | None = None) -> CancelRunResponse:
        """Request explicit cancellation for one Agent backend run."""

    def cancel_run_and_wait(
        self,
        run_id: str,
        request: CancelRunRequest | None = None,
        *,
        after: str | None = None,
        timeout_seconds: float | None = None,
    ) -> RunCancelledEvent:
        """Cancel and observe cleanup within the given total timeout, if supplied."""

    def stream_events(
        self,
        run_id: str,
        *,
        after: str | None = None,
        timeout_seconds: float | None = None,
        should_stop: Callable[[], bool] | None = None,
    ) -> Iterator[RunEvent]:
        """Yield ordered run events with an optional total timeout or stop callback."""

    def wait_run(self, run_id: str, *, timeout_seconds: float | None = None) -> RunStatusResponse:
        """Wait for a run to reach a terminal status and return that status."""


class _DifyAgentSyncClient(Protocol):
    """Subset of ``dify_agent.client.Client`` used by the API wrapper."""

    def create_run_sync(self, request: CreateRunRequest, *, timeout_seconds: float | None = None) -> CreateRunResponse:
        """Create one run synchronously under an optional total timeout."""

    def cancel_run_sync(self, run_id: str, request: CancelRunRequest | None = None) -> CancelRunResponse:
        """Cancel one run synchronously."""

    def cancel_run_and_wait_sync(
        self,
        run_id: str,
        request: CancelRunRequest | None = None,
        *,
        after: str | None = None,
        timeout_seconds: float | None = None,
    ) -> RunCancelledEvent:
        """Cancel and wait synchronously within an optional total timeout."""

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

    def create_run(self, request: CreateRunRequest, *, timeout_seconds: float | None = None) -> CreateRunResponse:
        """Create one run through ``POST /runs`` and normalize client exceptions."""
        try:
            return self.client.create_run_sync(request, timeout_seconds=timeout_seconds)
        except Exception as exc:
            raise _normalize_dify_agent_error(exc) from exc

    def cancel_run(self, run_id: str, request: CancelRunRequest | None = None) -> CancelRunResponse:
        """Cancel one run through ``POST /runs/{run_id}/cancel`` and normalize exceptions."""
        try:
            return self.client.cancel_run_sync(run_id, request=request)
        except Exception as exc:
            raise _normalize_dify_agent_error(exc) from exc

    def cancel_run_and_wait(
        self,
        run_id: str,
        request: CancelRunRequest | None = None,
        *,
        after: str | None = None,
        timeout_seconds: float | None = None,
    ) -> RunCancelledEvent:
        """Cancel and observe runner cleanup within the supplied total timeout."""
        try:
            return self.client.cancel_run_and_wait_sync(
                run_id, request=request, after=after, timeout_seconds=timeout_seconds
            )
        except Exception as exc:
            raise _normalize_dify_agent_error(exc) from exc

    def stream_events(
        self,
        run_id: str,
        *,
        after: str | None = None,
        timeout_seconds: float | None = None,
        should_stop: Callable[[], bool] | None = None,
    ) -> Iterator[RunEvent]:
        """Stream events under the client's reconnect policy and optional total deadline."""
        try:
            yield from self.client.stream_events_sync(
                run_id,
                after=after,
                max_reconnects=self._stream_max_reconnects,
                timeout_seconds=timeout_seconds,
                should_stop=should_stop,
            )
        except Exception as exc:
            raise _normalize_dify_agent_error(exc) from exc

    def wait_run(self, run_id: str, *, timeout_seconds: float | None = None) -> RunStatusResponse:
        """Poll run status until terminal state and normalize client exceptions."""
        try:
            return self.client.wait_run_sync(run_id, timeout_seconds=timeout_seconds)
        except Exception as exc:
            raise _normalize_dify_agent_error(exc) from exc


def _normalize_dify_agent_error(exc: Exception) -> AgentBackendError:
    """Map public ``dify-agent`` client errors to API-side integration errors."""
    match exc:
        case DifyAgentValidationError() as error:
            return AgentBackendValidationError(
                "Agent backend request or response validation failed", detail=error.detail
            )
        case DifyAgentHTTPError() as error:
            return AgentBackendHTTPError(
                f"Agent backend HTTP {error.status_code}",
                status_code=error.status_code,
                detail=error.detail,
            )
        case DifyAgentTimeoutError() as error:
            return AgentBackendTimeoutError(str(error))
        case DifyAgentStreamError() as error:
            return AgentBackendStreamError(str(error))
        case DifyAgentClientError() as error:
            return AgentBackendTransportError(str(error))
        case AgentBackendError() as error:
            return error
        case _:
            return AgentBackendTransportError(str(exc) or type(exc).__name__)
