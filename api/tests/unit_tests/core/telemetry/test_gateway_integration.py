from __future__ import annotations

import sys
from unittest.mock import MagicMock, patch

import pytest

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


def _node_event() -> DraftNodeExecutionTraceEvent:
    return DraftNodeExecutionTraceEvent(
        context=_TRACE_CTX,
        payload=NodeExecutionPayload(node_execution_data={}),
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
        ),
    )


def _app_created_event() -> AppCreatedEvent:
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
            emit(_prompt_event(), mock_trace_manager)
            mock_trace_manager.add_trace_task.assert_called_once()

    def test_enterprise_only_trace_dropped_when_ee_disabled(
        self,
        mock_trace_manager: MagicMock,
    ) -> None:
        with patch("core.telemetry.gateway.is_enterprise_telemetry_enabled", return_value=False):
            emit(_node_event(), mock_trace_manager)
            mock_trace_manager.add_trace_task.assert_not_called()

    def test_enterprise_only_trace_routed_when_ee_enabled(
        self,
        mock_trace_manager: MagicMock,
    ) -> None:
        with patch("core.telemetry.gateway.is_enterprise_telemetry_enabled", return_value=True):
            emit(_node_event(), mock_trace_manager)
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
    @pytest.fixture
    def mock_trace_manager(self) -> MagicMock:
        return MagicMock()

    def test_draft_node_execution_not_ce_eligible(
        self,
        mock_trace_manager: MagicMock,
    ) -> None:
        with patch("core.telemetry.gateway.is_enterprise_telemetry_enabled", return_value=False):
            emit(_node_event(), mock_trace_manager)
            mock_trace_manager.add_trace_task.assert_not_called()

    def test_prompt_generation_not_ce_eligible(
        self,
        mock_trace_manager: MagicMock,
    ) -> None:
        with patch("core.telemetry.gateway.is_enterprise_telemetry_enabled", return_value=False):
            emit(_prompt_event(), mock_trace_manager)
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
