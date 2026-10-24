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
    TelemetryEvent,
    TraceSignalEvent,
)
from core.telemetry.gateway import PAYLOAD_SIZE_THRESHOLD_BYTES, emit, is_enterprise_telemetry_enabled
from enterprise.telemetry.contracts import SignalType, TelemetryCase, TelemetryEnvelope


class TestTelemetryCoreExports:
    def test_is_enterprise_telemetry_enabled_exported(self) -> None:
        from core.telemetry.gateway import is_enterprise_telemetry_enabled as exported_func

        assert callable(exported_func)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_GATEWAY_INTEGRATION_TRACE_CTX = TelemetryContext(tenant_id="tenant-789", user_id="user-456", app_id="app-123")
_STARTED_AT = datetime(2026, 10, 1, 8, 0, 0, tzinfo=UTC)
_ENDED_AT = datetime(2026, 10, 1, 8, 0, 1, tzinfo=UTC)


def _gateway_integration_node_event() -> DraftNodeExecutionTraceEvent:
    return DraftNodeExecutionTraceEvent(
        context=_GATEWAY_INTEGRATION_TRACE_CTX,
        payload=NodeExecutionPayload(node_execution_data={"node_id": "node-1", "node_type": "llm"}),
    )


def _gateway_integration_prompt_event() -> PromptGenerationEvent:
    return PromptGenerationEvent(
        context=_GATEWAY_INTEGRATION_TRACE_CTX,
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
_TRACE_EVENTS = {
    "draft_node_execution": _gateway_integration_node_event,
    "prompt_generation": _gateway_integration_prompt_event,
}


def _gateway_integration_app_created_event() -> AppCreatedEvent:
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

        emit(_gateway_integration_prompt_event())

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
            emit(_gateway_integration_app_created_event())

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


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_GATEWAY_TRACE_CTX = TelemetryContext(tenant_id="tenant-789", user_id="user-456", app_id="app-123")
_METRIC_CTX = TelemetryContext(tenant_id="tenant-123")


def _gateway_node_event() -> DraftNodeExecutionTraceEvent:
    return DraftNodeExecutionTraceEvent(
        context=_GATEWAY_TRACE_CTX,
        payload=NodeExecutionPayload(node_execution_data={"key": "val"}),
    )


def _gateway_prompt_event() -> PromptGenerationEvent:
    return PromptGenerationEvent(
        context=_GATEWAY_TRACE_CTX,
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
            total_price=None,
            currency=None,
            error=None,
            started_at=datetime(2026, 10, 1, 8, 0, 0, tzinfo=UTC),
            ended_at=datetime(2026, 10, 1, 8, 0, 1, tzinfo=UTC),
        ),
    )


def _gateway_app_created_event(tenant_id: str = "tenant-123") -> AppCreatedEvent:
    return AppCreatedEvent(
        context=TelemetryContext(tenant_id=tenant_id),
        payload=AppCreatedPayload(app_id="app-abc", mode="chat"),
    )


# ---------------------------------------------------------------------------
# Event routing metadata
# ---------------------------------------------------------------------------


class TestEventRoutingMetadata:
    """Verify each event class declares correct routing fields."""

    def test_draft_node_execution_routing(self) -> None:
        ev = _gateway_node_event()
        assert ev.case == TelemetryCase.DRAFT_NODE_EXECUTION
        assert ev.signal_type is SignalType.TRACE
        assert ev.ce_eligible is False
        assert isinstance(ev, TraceSignalEvent)
        assert ev.trace_payload().kind == "draft_node_execution"

    def test_prompt_generation_routing(self) -> None:
        ev = _gateway_prompt_event()
        assert ev.case == TelemetryCase.PROMPT_GENERATION
        assert ev.signal_type is SignalType.TRACE
        assert ev.ce_eligible is False
        assert isinstance(ev, TraceSignalEvent)
        assert ev.trace_payload().kind == "prompt_generation"

    def test_app_created_routing(self) -> None:
        ev = _gateway_app_created_event()
        assert ev.case == TelemetryCase.APP_CREATED
        assert ev.signal_type is SignalType.METRIC_LOG
        assert ev.ce_eligible is False
        assert not isinstance(ev, TraceSignalEvent)

    def test_all_events_satisfy_protocol(self) -> None:
        events: list[TelemetryEvent] = [_gateway_node_event(), _gateway_prompt_event(), _gateway_app_created_event()]
        for ev in events:
            assert isinstance(ev, TelemetryEvent)


# ---------------------------------------------------------------------------
# Trace routing
# ---------------------------------------------------------------------------


class TestGatewayTraceRouting:
    def test_trace_event_routes_through_the_app_trace_scope(
        self, monkeypatch: pytest.MonkeyPatch, pipeline: _TracePipeline
    ) -> None:
        monkeypatch.setattr(gateway_module, "is_enterprise_telemetry_enabled", lambda: True)

        emit(_gateway_prompt_event())

        assert pipeline.scope_requests == [("tenant-789", "app-123", "user-456", {})]
        (event,) = pipeline.events
        assert (event.tenant_id, event.app_id, event.user_id) == ("tenant-789", "app-123", "user-456")
        assert event.payload == _gateway_prompt_event().trace_payload()

    def test_enterprise_only_trace_dropped_when_ee_disabled(
        self, monkeypatch: pytest.MonkeyPatch, pipeline: _TracePipeline
    ) -> None:
        monkeypatch.setattr(gateway_module, "is_enterprise_telemetry_enabled", lambda: False)

        emit(_gateway_node_event())

        assert pipeline.events == []

    def test_enterprise_only_trace_emitted_when_ee_enabled(
        self, monkeypatch: pytest.MonkeyPatch, pipeline: _TracePipeline
    ) -> None:
        monkeypatch.setattr(gateway_module, "is_enterprise_telemetry_enabled", lambda: True)

        emit(_gateway_node_event())

        assert pipeline.scope_requests == [("tenant-789", "app-123", "user-456", {})]
        (event,) = pipeline.events
        assert event.payload == _gateway_node_event().trace_payload()


# ---------------------------------------------------------------------------
# Metric/log routing
# ---------------------------------------------------------------------------


class TestGatewayMetricLogRouting:
    @patch("core.telemetry.gateway.is_enterprise_telemetry_enabled", return_value=True)
    @patch("tasks.enterprise_telemetry_task.process_enterprise_telemetry.delay")
    def test_metric_event_routes_to_celery_task(
        self,
        mock_delay: MagicMock,
        mock_ee_enabled: MagicMock,
    ) -> None:
        emit(_gateway_app_created_event())

        mock_delay.assert_called_once()
        envelope_json = mock_delay.call_args[0][0]
        envelope = TelemetryEnvelope.model_validate_json(envelope_json)
        assert envelope.case == TelemetryCase.APP_CREATED
        assert envelope.tenant_id == "tenant-123"
        assert envelope.payload["app_id"] == "app-abc"

    @patch("core.telemetry.gateway.is_enterprise_telemetry_enabled", return_value=True)
    @patch("tasks.enterprise_telemetry_task.process_enterprise_telemetry.delay")
    def test_envelope_has_unique_event_id(
        self,
        mock_delay: MagicMock,
        mock_ee_enabled: MagicMock,
    ) -> None:
        emit(_gateway_app_created_event())
        emit(_gateway_app_created_event())

        assert mock_delay.call_count == 2
        envelope1 = TelemetryEnvelope.model_validate_json(mock_delay.call_args_list[0][0][0])
        envelope2 = TelemetryEnvelope.model_validate_json(mock_delay.call_args_list[1][0][0])
        assert envelope1.event_id != envelope2.event_id


# ---------------------------------------------------------------------------
# Payload sizing
# ---------------------------------------------------------------------------


class TestGatewayPayloadSizing:
    @patch("core.telemetry.gateway.is_enterprise_telemetry_enabled", return_value=True)
    @patch("tasks.enterprise_telemetry_task.process_enterprise_telemetry.delay")
    def test_small_payload_inlined(
        self,
        mock_delay: MagicMock,
        mock_ee_enabled: MagicMock,
    ) -> None:
        emit(_gateway_app_created_event())

        envelope_json = mock_delay.call_args[0][0]
        envelope = TelemetryEnvelope.model_validate_json(envelope_json)
        assert envelope.payload["app_id"] == "app-abc"
        assert envelope.metadata is None

    @patch("core.telemetry.gateway.is_enterprise_telemetry_enabled", return_value=True)
    @patch("core.telemetry.gateway.storage")
    @patch("tasks.enterprise_telemetry_task.process_enterprise_telemetry.delay")
    def test_large_payload_stored(
        self,
        mock_delay: MagicMock,
        mock_storage: MagicMock,
        mock_ee_enabled: MagicMock,
    ) -> None:
        large_value = "x" * (PAYLOAD_SIZE_THRESHOLD_BYTES + 1000)
        ev = AppCreatedEvent(
            context=_METRIC_CTX,
            payload=AppCreatedPayload(app_id=large_value),
        )
        emit(ev)

        mock_storage.save.assert_called_once()
        storage_key = mock_storage.save.call_args[0][0]
        assert storage_key.startswith("telemetry/tenant-123/")

        envelope_json = mock_delay.call_args[0][0]
        envelope = TelemetryEnvelope.model_validate_json(envelope_json)
        assert envelope.payload == {}
        assert envelope.metadata is not None
        assert envelope.metadata["payload_ref"] == storage_key

    @patch("core.telemetry.gateway.is_enterprise_telemetry_enabled", return_value=True)
    @patch("core.telemetry.gateway.storage")
    @patch("tasks.enterprise_telemetry_task.process_enterprise_telemetry.delay")
    def test_large_payload_fallback_on_storage_error(
        self,
        mock_delay: MagicMock,
        mock_storage: MagicMock,
        mock_ee_enabled: MagicMock,
    ) -> None:
        mock_storage.save.side_effect = Exception("Storage failure")
        large_value = "x" * (PAYLOAD_SIZE_THRESHOLD_BYTES + 1000)
        ev = AppCreatedEvent(
            context=_METRIC_CTX,
            payload=AppCreatedPayload(app_id=large_value),
        )
        emit(ev)

        envelope_json = mock_delay.call_args[0][0]
        envelope = TelemetryEnvelope.model_validate_json(envelope_json)
        assert envelope.payload["app_id"] == large_value
        assert envelope.metadata is None
