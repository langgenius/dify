from __future__ import annotations

from unittest.mock import MagicMock, patch

from core.telemetry.events import (
    AppCreatedEvent,
    AppCreatedPayload,
    DraftNodeExecutionTraceEvent,
    NodeExecutionPayload,
    PromptGenerationEvent,
    PromptGenerationPayload,
    TelemetryContext,
    TelemetryEvent,
)
from core.telemetry.gateway import emit
from enterprise.telemetry.contracts import SignalType, TelemetryCase, TelemetryEnvelope

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _node_event() -> DraftNodeExecutionTraceEvent:
    return DraftNodeExecutionTraceEvent(
        context=TelemetryContext(tenant_id="tenant-789", user_id="user-456", app_id="app-123"),
        payload=NodeExecutionPayload(node_execution_data={"key": "val"}),
    )


def _prompt_event() -> PromptGenerationEvent:
    return PromptGenerationEvent(
        context=TelemetryContext(tenant_id="tenant-789", user_id="user-456", app_id="app-123"),
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
        ),
    )


def _app_created_event(tenant_id: str = "tenant-123") -> AppCreatedEvent:
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
        ev = _node_event()
        assert ev.case == TelemetryCase.DRAFT_NODE_EXECUTION
        assert ev.signal_type is SignalType.TRACE
        assert ev.ce_eligible is False

    def test_prompt_generation_routing(self) -> None:
        ev = _prompt_event()
        assert ev.case == TelemetryCase.PROMPT_GENERATION
        assert ev.signal_type is SignalType.TRACE
        assert ev.ce_eligible is False

    def test_app_created_routing(self) -> None:
        ev = _app_created_event()
        assert ev.case == TelemetryCase.APP_CREATED
        assert ev.signal_type is SignalType.METRIC_LOG
        assert ev.ce_eligible is False

    def test_all_events_satisfy_protocol(self) -> None:
        events: list[TelemetryEvent] = [_node_event(), _prompt_event(), _app_created_event()]
        for ev in events:
            assert isinstance(ev, TelemetryEvent)


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
        emit(_app_created_event())

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
        emit(_app_created_event())
        emit(_app_created_event())

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
        emit(_app_created_event())

        envelope_json = mock_delay.call_args[0][0]
        envelope = TelemetryEnvelope.model_validate_json(envelope_json)
        assert envelope.payload["app_id"] == "app-abc"
        assert envelope.metadata is None

    @patch("core.telemetry.gateway.is_enterprise_telemetry_enabled", return_value=True)
    @patch("extensions.ext_storage.storage")
    @patch("tasks.enterprise_telemetry_task.process_enterprise_telemetry.delay")
    def test_large_payload_stored(
        self,
        mock_delay: MagicMock,
        mock_storage: MagicMock,
        mock_ee_enabled: MagicMock,
    ) -> None:
        large_value = "x" * (1048576 + 1000)
        ev = AppCreatedEvent(
            context=TelemetryContext(tenant_id="tenant-123"),
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
    @patch("extensions.ext_storage.storage")
    @patch("tasks.enterprise_telemetry_task.process_enterprise_telemetry.delay")
    def test_large_payload_fallback_on_storage_error(
        self,
        mock_delay: MagicMock,
        mock_storage: MagicMock,
        mock_ee_enabled: MagicMock,
    ) -> None:
        mock_storage.save.side_effect = Exception("Storage failure")
        large_value = "x" * (1048576 + 1000)
        ev = AppCreatedEvent(
            context=TelemetryContext(tenant_id="tenant-123"),
            payload=AppCreatedPayload(app_id=large_value),
        )
        emit(ev)

        envelope_json = mock_delay.call_args[0][0]
        envelope = TelemetryEnvelope.model_validate_json(envelope_json)
        assert envelope.payload["app_id"] == large_value
        assert envelope.metadata is None
