from __future__ import annotations

import sys
from unittest.mock import MagicMock, patch

import pytest

from core.ops.entities.trace_entity import TraceTaskName
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


def _gateway_integration_node_event() -> DraftNodeExecutionTraceEvent:
    return DraftNodeExecutionTraceEvent(
        context=_GATEWAY_INTEGRATION_TRACE_CTX,
        payload=NodeExecutionPayload(node_execution_data={}),
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
        ),
    )


def _gateway_integration_app_created_event() -> AppCreatedEvent:
    return AppCreatedEvent(
        context=TelemetryContext(tenant_id="tenant-123"),
        payload=AppCreatedPayload(app_id="app-abc"),
    )


# ---------------------------------------------------------------------------
# Trace routing integration
# ---------------------------------------------------------------------------


class TestGatewayIntegrationTraceRouting:
    @pytest.fixture
    def mock_trace_manager(self) -> MagicMock:
        return MagicMock()

    def test_trace_event_routed_to_trace_manager(
        self,
        mock_trace_manager: MagicMock,
    ) -> None:
        with patch("core.telemetry.gateway.is_enterprise_telemetry_enabled", return_value=True):
            emit(_gateway_integration_prompt_event(), mock_trace_manager)
            mock_trace_manager.add_trace_task.assert_called_once()

    def test_enterprise_only_trace_dropped_when_ee_disabled(
        self,
        mock_trace_manager: MagicMock,
    ) -> None:
        with patch("core.telemetry.gateway.is_enterprise_telemetry_enabled", return_value=False):
            emit(_gateway_integration_node_event(), mock_trace_manager)
            mock_trace_manager.add_trace_task.assert_not_called()

    def test_enterprise_only_trace_routed_when_ee_enabled(
        self,
        mock_trace_manager: MagicMock,
    ) -> None:
        with patch("core.telemetry.gateway.is_enterprise_telemetry_enabled", return_value=True):
            emit(_gateway_integration_node_event(), mock_trace_manager)
            mock_trace_manager.add_trace_task.assert_called_once()


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
    @pytest.fixture
    def mock_trace_manager(self) -> MagicMock:
        return MagicMock()

    def test_draft_node_execution_not_ce_eligible(
        self,
        mock_trace_manager: MagicMock,
    ) -> None:
        with patch("core.telemetry.gateway.is_enterprise_telemetry_enabled", return_value=False):
            emit(_gateway_integration_node_event(), mock_trace_manager)
            mock_trace_manager.add_trace_task.assert_not_called()

    def test_prompt_generation_not_ce_eligible(
        self,
        mock_trace_manager: MagicMock,
    ) -> None:
        with patch("core.telemetry.gateway.is_enterprise_telemetry_enabled", return_value=False):
            emit(_gateway_integration_prompt_event(), mock_trace_manager)
            mock_trace_manager.add_trace_task.assert_not_called()


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
        assert ev.trace_task_name is TraceTaskName.DRAFT_NODE_EXECUTION_TRACE

    def test_prompt_generation_routing(self) -> None:
        ev = _gateway_prompt_event()
        assert ev.case == TelemetryCase.PROMPT_GENERATION
        assert ev.signal_type is SignalType.TRACE
        assert ev.ce_eligible is False
        assert ev.trace_task_name is TraceTaskName.PROMPT_GENERATION_TRACE

    def test_app_created_routing(self) -> None:
        ev = _gateway_app_created_event()
        assert ev.case == TelemetryCase.APP_CREATED
        assert ev.signal_type is SignalType.METRIC_LOG
        assert ev.ce_eligible is False
        assert ev.trace_task_name is None

    def test_all_events_satisfy_protocol(self) -> None:
        events: list[TelemetryEvent] = [_gateway_node_event(), _gateway_prompt_event(), _gateway_app_created_event()]
        for ev in events:
            assert isinstance(ev, TelemetryEvent)


# ---------------------------------------------------------------------------
# Trace routing
# ---------------------------------------------------------------------------


class TestGatewayTraceRouting:
    @pytest.fixture
    def mock_trace_manager(self) -> MagicMock:
        return MagicMock()

    @patch("core.telemetry.gateway.is_enterprise_telemetry_enabled", return_value=True)
    def test_trace_event_routes_to_trace_manager(
        self,
        mock_ee_enabled: MagicMock,
        mock_trace_manager: MagicMock,
    ) -> None:
        emit(_gateway_prompt_event(), mock_trace_manager)
        mock_trace_manager.add_trace_task.assert_called_once()

    @patch("core.telemetry.gateway.is_enterprise_telemetry_enabled", return_value=False)
    def test_enterprise_only_trace_dropped_when_ee_disabled(
        self,
        mock_ee_enabled: MagicMock,
        mock_trace_manager: MagicMock,
    ) -> None:
        emit(_gateway_node_event(), mock_trace_manager)
        mock_trace_manager.add_trace_task.assert_not_called()

    @patch("core.telemetry.gateway.is_enterprise_telemetry_enabled", return_value=True)
    def test_enterprise_only_trace_enqueued_when_ee_enabled(
        self,
        mock_ee_enabled: MagicMock,
        mock_trace_manager: MagicMock,
    ) -> None:
        emit(_gateway_node_event(), mock_trace_manager)
        mock_trace_manager.add_trace_task.assert_called_once()


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
