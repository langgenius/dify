"""Deterministic fake Agent backend client using public ``dify-agent`` events.

Tests should exercise the same ``RunEvent`` DTOs as the real HTTP client. This
fake therefore replaces the previous custom mock protocol instead of emulating a
separate ``agent-backend.v1`` event stream.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime
from enum import StrEnum

from agenton.compositor import CompositorSessionSnapshot
from dify_agent.protocol import (
    CancelRunRequest,
    CancelRunResponse,
    CreateRunRequest,
    CreateRunResponse,
    RunEvent,
    RunFailedEvent,
    RunFailedEventData,
    RunPausedEvent,
    RunPausedEventData,
    RunStartedEvent,
    RunStatusResponse,
    RunSucceededEvent,
    RunSucceededEventData,
)

_FIXED_TIME = datetime(2026, 1, 1, tzinfo=UTC)


class FakeAgentBackendScenario(StrEnum):
    """Deterministic fake scenarios for API-side integration tests."""

    SUCCESS = "success"
    FAILED = "failed"
    PAUSED = "paused"


class FakeAgentBackendRunClient:
    """In-memory implementation of ``AgentBackendRunClient`` for unit tests."""

    scenario: FakeAgentBackendScenario
    run_id: str
    request: CreateRunRequest | None

    def __init__(
        self,
        *,
        scenario: FakeAgentBackendScenario = FakeAgentBackendScenario.SUCCESS,
        run_id: str = "fake-run-1",
    ) -> None:
        self.scenario = scenario
        self.run_id = run_id
        self.request = None

    def create_run(self, request: CreateRunRequest) -> CreateRunResponse:
        """Record the request and return a deterministic accepted response."""
        self.request = request
        return CreateRunResponse(run_id=self.run_id, status="running")

    def cancel_run(self, run_id: str, request: CancelRunRequest | None = None) -> CancelRunResponse:
        """Return a deterministic cancellation response."""
        del request
        return CancelRunResponse(run_id=run_id, status="cancelled")

    def stream_events(self, run_id: str, *, after: str | None = None) -> Iterator[RunEvent]:
        """Yield the deterministic public ``RunEvent`` sequence for ``run_id``."""
        for event in self._events(run_id):
            if after is not None and event.id is not None and event.id <= after:
                continue
            yield event

    def wait_run(self, run_id: str, *, timeout_seconds: float | None = None) -> RunStatusResponse:
        """Return a deterministic terminal status; timeout is accepted for protocol parity."""
        del timeout_seconds
        match self.scenario:
            case FakeAgentBackendScenario.SUCCESS:
                return RunStatusResponse(
                    run_id=run_id,
                    status="succeeded",
                    created_at=_FIXED_TIME,
                    updated_at=_FIXED_TIME,
                )
            case FakeAgentBackendScenario.FAILED:
                return RunStatusResponse(
                    run_id=run_id,
                    status="failed",
                    created_at=_FIXED_TIME,
                    updated_at=_FIXED_TIME,
                    error="fake failure",
                )
            case FakeAgentBackendScenario.PAUSED:
                return RunStatusResponse(
                    run_id=run_id,
                    status="paused",
                    created_at=_FIXED_TIME,
                    updated_at=_FIXED_TIME,
                )

    def _events(self, run_id: str) -> tuple[RunEvent, ...]:
        match self.scenario:
            case FakeAgentBackendScenario.SUCCESS:
                return (
                    RunStartedEvent(id="1-0", run_id=run_id, created_at=_FIXED_TIME),
                    RunSucceededEvent(
                        id="2-0",
                        run_id=run_id,
                        created_at=_FIXED_TIME,
                        data=RunSucceededEventData(
                            output={"text": "hello agent"},
                            session_snapshot=CompositorSessionSnapshot(layers=[]),
                        ),
                    ),
                )
            case FakeAgentBackendScenario.FAILED:
                return (
                    RunStartedEvent(id="1-0", run_id=run_id, created_at=_FIXED_TIME),
                    RunFailedEvent(
                        id="2-0",
                        run_id=run_id,
                        created_at=_FIXED_TIME,
                        data=RunFailedEventData(error="fake failure", reason="unit_test"),
                    ),
                )
            case FakeAgentBackendScenario.PAUSED:
                return (
                    RunStartedEvent(id="1-0", run_id=run_id, created_at=_FIXED_TIME),
                    RunPausedEvent(
                        id="2-0",
                        run_id=run_id,
                        created_at=_FIXED_TIME,
                        data=RunPausedEventData(
                            reason="human_input_required",
                            message="Agent requested human input.",
                            session_snapshot=CompositorSessionSnapshot(layers=[]),
                        ),
                    ),
                )
