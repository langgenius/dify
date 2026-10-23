from __future__ import annotations

import sys
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import pytest
from dify_trace_sdk.emitter import TraceScope
from dify_trace_sdk.events import DraftNodeExecuted, PromptGenerated, TraceCorrelation, TraceEvent

from core.telemetry import gateway as gateway_module
from core.telemetry.events import (
    AppCreatedEvent,
    AppCreatedPayload,
    DraftNodeExecutionTraceEvent,
    NodeExecutionPayload,
    PromptGenerationEvent,
    PromptGenerationPayload,
    TelemetryContext,
)
from core.telemetry.gateway import emit, is_enterprise_telemetry_enabled
from enterprise.telemetry.contracts import TelemetryCase


class TestTelemetryCoreExports:
    def test_is_enterprise_telemetry_enabled_exported(self) -> None:
        from core.telemetry.gateway import is_enterprise_telemetry_enabled as exported_func

        assert callable(exported_func)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_TRACE_CTX = TelemetryContext(tenant_id="tenant-789", user_id="user-456", app_id="app-123")
_STARTED_AT = datetime(2026, 10, 1, 8, 0, 0, tzinfo=UTC)
_ENDED_AT = datetime(2026, 10, 1, 8, 0, 1, tzinfo=UTC)


def _node_event() -> DraftNodeExecutionTraceEvent:
    return DraftNodeExecutionTraceEvent(
        context=_TRACE_CTX,
        payload=NodeExecutionPayload(node_execution_data={"node_id": "node-1", "node_type": "llm"}),
    )


def _prompt_event() -> PromptGenerationEvent:
    return PromptGenerationEvent(
        context=_TRACE_CTX,
        payload=PromptGenerationPayload(
            tenant_id="tenant-789",
            operation_type="generate",
            instruction="test",
            generated_output="out",
            model_provider="openai",
            model_name="gpt-4",
            prompt_tokens=10,
            completion_tokens=5,
            total_tokens=15,
            latency=0.5,
            total_price=0.002,
            currency="USD",
            error=None,
            started_at=_STARTED_AT,
            ended_at=_ENDED_AT,
        ),
    )


_EXPECTED_PAYLOADS = {
    "draft_node_execution": DraftNodeExecuted(node_execution={"node_id": "node-1", "node_type": "llm"}),
    "prompt_generation": PromptGenerated(
        operation_type="generate",
        instruction="test",
        generated_output="out",
        model_provider="openai",
        model_name="gpt-4",
        prompt_tokens=10,
        completion_tokens=5,
        total_tokens=15,
        latency=0.5,
        total_price=0.002,
        currency="USD",
        error=None,
        started_at=_STARTED_AT,
        ended_at=_ENDED_AT,
    ),
}
_TRACE_EVENTS = {"draft_node_execution": _node_event, "prompt_generation": _prompt_event}


def _app_created_event() -> AppCreatedEvent:
    return AppCreatedEvent(
        context=TelemetryContext(tenant_id="tenant-123"),
        payload=AppCreatedPayload(app_id="app-abc"),
    )


@dataclass
class _TracePipeline:
    """Stands in for the bound trace pipeline: hands out scopes and records what they emit."""

    scope_requests: list[tuple[str, str | None, str | None, Mapping[str, object]]] = field(default_factory=list)
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
            correlation=TraceCorrelation(
                external_trace_id=None, session_id=None, parent_workflow_run_id=None, parent_node_execution_id=None
            ),
        )

    def emit(self, event: TraceEvent) -> None:
        self.events.append(event)


@pytest.fixture
def pipeline(monkeypatch: pytest.MonkeyPatch) -> _TracePipeline:
    pipeline = _TracePipeline()
    monkeypatch.setattr(gateway_module, "create_trace_scope_for_app", pipeline.create_scope)
    return pipeline


# ---------------------------------------------------------------------------
# Trace routing integration
# ---------------------------------------------------------------------------


class TestGatewayIntegrationTraceRouting:
    @pytest.mark.parametrize("kind", ["draft_node_execution", "prompt_generation"])
    def test_trace_event_routed_through_the_app_trace_scope(
        self, monkeypatch: pytest.MonkeyPatch, pipeline: _TracePipeline, kind: str
    ) -> None:
        monkeypatch.setattr(gateway_module, "is_enterprise_telemetry_enabled", lambda: True)

        emit(_TRACE_EVENTS[kind]())

        assert pipeline.scope_requests == [("tenant-789", "app-123", "user-456", {})]
        (event,) = pipeline.events
        assert (event.tenant_id, event.app_id, event.user_id) == ("tenant-789", "app-123", "user-456")
        assert event.payload == _EXPECTED_PAYLOADS[kind]

    def test_trace_event_without_a_consumer_is_dropped(self, monkeypatch: pytest.MonkeyPatch) -> None:
        requests: list[tuple[str, str | None, str | None, Mapping[str, object]]] = []

        def no_consumer(
            *, tenant_id: str, app_id: str | None, user_id: str | None, extras: Mapping[str, object]
        ) -> None:
            requests.append((tenant_id, app_id, user_id, extras))

        monkeypatch.setattr(gateway_module, "is_enterprise_telemetry_enabled", lambda: True)
        monkeypatch.setattr(gateway_module, "create_trace_scope_for_app", no_consumer)

        emit(_prompt_event())

        assert requests == [("tenant-789", "app-123", "user-456", {})]


# ---------------------------------------------------------------------------
# Metric/log routing integration
# ---------------------------------------------------------------------------


class TestGatewayIntegrationMetricRouting:
    @patch("core.telemetry.gateway.is_enterprise_telemetry_enabled", return_value=True)
    def test_metric_event_routes_to_celery_task(
        self,
        mock_ee_enabled: MagicMock,
    ) -> None:
        from enterprise.telemetry.contracts import TelemetryEnvelope

        with patch("tasks.enterprise_telemetry_task.process_enterprise_telemetry.delay") as mock_delay:
            emit(_app_created_event())

            mock_delay.assert_called_once()
            envelope_json = mock_delay.call_args[0][0]
            envelope = TelemetryEnvelope.model_validate_json(envelope_json)
            assert envelope.case == TelemetryCase.APP_CREATED
            assert envelope.tenant_id == "tenant-123"
            assert envelope.payload["app_id"] == "app-abc"


# ---------------------------------------------------------------------------
# CE eligibility integration
# ---------------------------------------------------------------------------


class TestGatewayIntegrationCEEligibility:
    @pytest.mark.parametrize("kind", ["draft_node_execution", "prompt_generation"])
    def test_enterprise_only_trace_dropped_when_ee_disabled(
        self, monkeypatch: pytest.MonkeyPatch, pipeline: _TracePipeline, kind: str
    ) -> None:
        monkeypatch.setattr(gateway_module, "is_enterprise_telemetry_enabled", lambda: False)

        emit(_TRACE_EVENTS[kind]())

        assert pipeline.scope_requests == []
        assert pipeline.events == []


# ---------------------------------------------------------------------------
# is_enterprise_telemetry_enabled
# ---------------------------------------------------------------------------


class TestIsEnterpriseTelemetryEnabled:
    def test_returns_false_when_exporter_import_fails(self) -> None:
        with patch.dict(sys.modules, {"enterprise.telemetry.exporter": None}):
            result = is_enterprise_telemetry_enabled()
            assert result is False

    def test_function_is_callable(self) -> None:
        assert callable(is_enterprise_telemetry_enabled)
