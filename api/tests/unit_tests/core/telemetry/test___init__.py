"""Unit tests for core.telemetry.emit() routing and enterprise-only filtering."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime

import pytest
from dify_trace_sdk.emitter import TraceScope
from dify_trace_sdk.events import DraftNodeExecuted, TraceCorrelation, TraceEvent

from core.telemetry import emit
from core.telemetry import gateway as gateway_module
from core.telemetry.events import DraftNodeExecutionTraceEvent, TelemetryContext

type _ScopeRequest = tuple[str, str | None, str | None, Mapping[str, object]]


@dataclass
class _TracePipeline:
    """Stands in for the bound trace pipeline: hands out scopes and records what they emit."""

    scope_requests: list[_ScopeRequest] = field(default_factory=list)
    events: list[TraceEvent] = field(default_factory=list)

    def create_scope(
        self, *, tenant_id: str, app_id: str | None, user_id: str | None, extras: Mapping[str, object]
    ) -> TraceScope:
        self.scope_requests.append((tenant_id, app_id, user_id, extras))
        return TraceScope(
            emitter=self,
            tenant_id=tenant_id,
            app_id=app_id,
            user_id=user_id,
            correlation=TraceCorrelation(external_trace_id=None, session_id=None, parent=None),
        )

    def emit(self, event: TraceEvent) -> None:
        self.events.append(event)


@pytest.fixture
def pipeline(monkeypatch: pytest.MonkeyPatch) -> _TracePipeline:
    pipeline = _TracePipeline()
    monkeypatch.setattr(gateway_module, "create_trace_scope_for_app", pipeline.create_scope)
    return pipeline


def _enable_enterprise_telemetry(monkeypatch: pytest.MonkeyPatch, enabled: bool) -> None:
    monkeypatch.setattr(gateway_module, "is_enterprise_telemetry_enabled", lambda: enabled)


def _draft_node_event(node_execution_data: dict[str, object]) -> DraftNodeExecutionTraceEvent:
    return DraftNodeExecutionTraceEvent(
        context=TelemetryContext(tenant_id="test-tenant", user_id="test-user", app_id="test-app"),
        payload={"node_execution_data": node_execution_data},
    )


class TestTelemetryEmit:
    def test_emit_enterprise_trace_reports_the_draft_node_execution(
        self, monkeypatch: pytest.MonkeyPatch, pipeline: _TracePipeline
    ) -> None:
        _enable_enterprise_telemetry(monkeypatch, True)

        emit(_draft_node_event({"node_id": "node-1", "status": "succeeded"}))

        assert pipeline.scope_requests == [("test-tenant", "test-app", "test-user", {})]
        (event,) = pipeline.events
        assert (event.tenant_id, event.app_id, event.user_id) == ("test-tenant", "test-app", "test-user")
        assert event.payload == DraftNodeExecuted(node_execution={"node_id": "node-1", "status": "succeeded"})

    def test_emit_makes_node_execution_values_json_safe(
        self, monkeypatch: pytest.MonkeyPatch, pipeline: _TracePipeline
    ) -> None:
        _enable_enterprise_telemetry(monkeypatch, True)
        created_at = datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)

        emit(_draft_node_event({"created_at": created_at, "elapsed_time": float("nan"), "node_inputs": {"q": 1}}))

        (event,) = pipeline.events
        assert event.payload == DraftNodeExecuted(
            node_execution={"created_at": str(created_at), "elapsed_time": "NaN", "node_inputs": {"q": 1}}
        )

    def test_emit_enterprise_only_trace_dropped_when_ee_disabled(
        self, monkeypatch: pytest.MonkeyPatch, pipeline: _TracePipeline
    ) -> None:
        _enable_enterprise_telemetry(monkeypatch, False)

        emit(_draft_node_event({}))

        assert pipeline.scope_requests == []
        assert pipeline.events == []

    def test_emit_drops_trace_without_a_workspace(
        self, monkeypatch: pytest.MonkeyPatch, pipeline: _TracePipeline
    ) -> None:
        _enable_enterprise_telemetry(monkeypatch, True)

        emit(
            DraftNodeExecutionTraceEvent(
                context=TelemetryContext(tenant_id=None, user_id="test-user", app_id="test-app"),
                payload={"node_execution_data": {}},
            )
        )

        assert pipeline.scope_requests == []
        assert pipeline.events == []
