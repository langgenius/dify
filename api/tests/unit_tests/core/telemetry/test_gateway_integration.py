from __future__ import annotations

import sys
from unittest.mock import MagicMock, patch

import pytest

from core.telemetry import is_enterprise_telemetry_enabled
from enterprise.telemetry.contracts import TelemetryCase
from enterprise.telemetry.gateway import TelemetryGateway


class TestTelemetryCoreExports:
    def test_is_enterprise_telemetry_enabled_exported(self) -> None:
        from core.telemetry import is_enterprise_telemetry_enabled as exported_func

        assert callable(exported_func)


@pytest.fixture
def mock_ops_trace_manager():
    mock_module = MagicMock()
    mock_trace_task_class = MagicMock()
    mock_trace_task_class.return_value = MagicMock()
    mock_module.TraceTask = mock_trace_task_class
    mock_module.TraceQueueManager = MagicMock()

    mock_trace_entity = MagicMock()
    mock_trace_task_name = MagicMock()
    mock_trace_task_name.return_value = "workflow"
    mock_trace_entity.TraceTaskName = mock_trace_task_name

    with (
        patch.dict(sys.modules, {"core.ops.ops_trace_manager": mock_module}),
        patch.dict(sys.modules, {"core.ops.entities.trace_entity": mock_trace_entity}),
    ):
        yield mock_module, mock_trace_entity


class TestGatewayIntegrationTraceRouting:
    @pytest.fixture
    def gateway(self) -> TelemetryGateway:
        return TelemetryGateway()

    @pytest.fixture
    def mock_trace_manager(self) -> MagicMock:
        return MagicMock()

    @pytest.mark.usefixtures("mock_ops_trace_manager")
    def test_ce_eligible_trace_routed_to_trace_manager(
        self,
        gateway: TelemetryGateway,
        mock_trace_manager: MagicMock,
    ) -> None:
        with patch("enterprise.telemetry.gateway._is_enterprise_telemetry_enabled", return_value=True):
            context = {"app_id": "app-123", "user_id": "user-456", "tenant_id": "tenant-789"}
            payload = {"workflow_run_id": "run-abc"}

            gateway.emit(TelemetryCase.WORKFLOW_RUN, context, payload, mock_trace_manager)

            mock_trace_manager.add_trace_task.assert_called_once()

    @pytest.mark.usefixtures("mock_ops_trace_manager")
    def test_ce_eligible_trace_routed_when_ee_disabled(
        self,
        gateway: TelemetryGateway,
        mock_trace_manager: MagicMock,
    ) -> None:
        with patch("enterprise.telemetry.gateway._is_enterprise_telemetry_enabled", return_value=False):
            context = {"app_id": "app-123", "user_id": "user-456"}
            payload = {"workflow_run_id": "run-abc"}

            gateway.emit(TelemetryCase.WORKFLOW_RUN, context, payload, mock_trace_manager)

            mock_trace_manager.add_trace_task.assert_called_once()

    @pytest.mark.usefixtures("mock_ops_trace_manager")
    def test_enterprise_only_trace_dropped_when_ee_disabled(
        self,
        gateway: TelemetryGateway,
        mock_trace_manager: MagicMock,
    ) -> None:
        with patch("enterprise.telemetry.gateway._is_enterprise_telemetry_enabled", return_value=False):
            context = {"app_id": "app-123", "user_id": "user-456"}
            payload = {"node_id": "node-abc"}

            gateway.emit(TelemetryCase.NODE_EXECUTION, context, payload, mock_trace_manager)

            mock_trace_manager.add_trace_task.assert_not_called()

    @pytest.mark.usefixtures("mock_ops_trace_manager")
    def test_enterprise_only_trace_routed_when_ee_enabled(
        self,
        gateway: TelemetryGateway,
        mock_trace_manager: MagicMock,
    ) -> None:
        with patch("enterprise.telemetry.gateway._is_enterprise_telemetry_enabled", return_value=True):
            context = {"app_id": "app-123", "user_id": "user-456"}
            payload = {"node_id": "node-abc"}

            gateway.emit(TelemetryCase.NODE_EXECUTION, context, payload, mock_trace_manager)

            mock_trace_manager.add_trace_task.assert_called_once()


class TestGatewayIntegrationMetricRouting:
    @pytest.fixture
    def gateway(self) -> TelemetryGateway:
        return TelemetryGateway()

    def test_metric_case_routes_to_celery_task(
        self,
        gateway: TelemetryGateway,
    ) -> None:
        from enterprise.telemetry.contracts import TelemetryEnvelope

        with patch("tasks.enterprise_telemetry_task.process_enterprise_telemetry.delay") as mock_delay:
            context = {"tenant_id": "tenant-123"}
            payload = {"app_id": "app-abc", "name": "My App"}

            gateway.emit(TelemetryCase.APP_CREATED, context, payload)

            mock_delay.assert_called_once()
            envelope_json = mock_delay.call_args[0][0]
            envelope = TelemetryEnvelope.model_validate_json(envelope_json)
            assert envelope.case == TelemetryCase.APP_CREATED
            assert envelope.tenant_id == "tenant-123"
            assert envelope.payload["app_id"] == "app-abc"

    def test_tool_execution_metric_routed(
        self,
        gateway: TelemetryGateway,
    ) -> None:
        from enterprise.telemetry.contracts import TelemetryEnvelope

        with patch("tasks.enterprise_telemetry_task.process_enterprise_telemetry.delay") as mock_delay:
            context = {"tenant_id": "tenant-123", "app_id": "app-123"}
            payload = {"tool_name": "test_tool", "tool_inputs": {}, "tool_outputs": "result"}

            gateway.emit(TelemetryCase.TOOL_EXECUTION, context, payload)

            mock_delay.assert_called_once()
            envelope_json = mock_delay.call_args[0][0]
            envelope = TelemetryEnvelope.model_validate_json(envelope_json)
            assert envelope.case == TelemetryCase.TOOL_EXECUTION

    def test_moderation_check_metric_routed(
        self,
        gateway: TelemetryGateway,
    ) -> None:
        from enterprise.telemetry.contracts import TelemetryEnvelope

        with patch("tasks.enterprise_telemetry_task.process_enterprise_telemetry.delay") as mock_delay:
            context = {"tenant_id": "tenant-123", "app_id": "app-123"}
            payload = {"message_id": "msg-123", "moderation_result": {"flagged": False}}

            gateway.emit(TelemetryCase.MODERATION_CHECK, context, payload)

            mock_delay.assert_called_once()
            envelope_json = mock_delay.call_args[0][0]
            envelope = TelemetryEnvelope.model_validate_json(envelope_json)
            assert envelope.case == TelemetryCase.MODERATION_CHECK


class TestGatewayIntegrationCEEligibility:
    @pytest.fixture
    def gateway(self) -> TelemetryGateway:
        return TelemetryGateway()

    @pytest.fixture
    def mock_trace_manager(self) -> MagicMock:
        return MagicMock()

    @pytest.mark.usefixtures("mock_ops_trace_manager")
    def test_workflow_run_is_ce_eligible(
        self,
        gateway: TelemetryGateway,
        mock_trace_manager: MagicMock,
    ) -> None:
        with patch("enterprise.telemetry.gateway._is_enterprise_telemetry_enabled", return_value=False):
            context = {"app_id": "app-123", "user_id": "user-456"}
            payload = {"workflow_run_id": "run-abc"}

            gateway.emit(TelemetryCase.WORKFLOW_RUN, context, payload, mock_trace_manager)

            mock_trace_manager.add_trace_task.assert_called_once()

    @pytest.mark.usefixtures("mock_ops_trace_manager")
    def test_message_run_is_ce_eligible(
        self,
        gateway: TelemetryGateway,
        mock_trace_manager: MagicMock,
    ) -> None:
        with patch("enterprise.telemetry.gateway._is_enterprise_telemetry_enabled", return_value=False):
            context = {"app_id": "app-123", "user_id": "user-456"}
            payload = {"message_id": "msg-abc", "conversation_id": "conv-123"}

            gateway.emit(TelemetryCase.MESSAGE_RUN, context, payload, mock_trace_manager)

            mock_trace_manager.add_trace_task.assert_called_once()

    @pytest.mark.usefixtures("mock_ops_trace_manager")
    def test_node_execution_not_ce_eligible(
        self,
        gateway: TelemetryGateway,
        mock_trace_manager: MagicMock,
    ) -> None:
        with patch("enterprise.telemetry.gateway._is_enterprise_telemetry_enabled", return_value=False):
            context = {"app_id": "app-123", "user_id": "user-456"}
            payload = {"node_id": "node-abc"}

            gateway.emit(TelemetryCase.NODE_EXECUTION, context, payload, mock_trace_manager)

            mock_trace_manager.add_trace_task.assert_not_called()

    @pytest.mark.usefixtures("mock_ops_trace_manager")
    def test_draft_node_execution_not_ce_eligible(
        self,
        gateway: TelemetryGateway,
        mock_trace_manager: MagicMock,
    ) -> None:
        with patch("enterprise.telemetry.gateway._is_enterprise_telemetry_enabled", return_value=False):
            context = {"app_id": "app-123", "user_id": "user-456"}
            payload = {"node_execution_data": {}}

            gateway.emit(TelemetryCase.DRAFT_NODE_EXECUTION, context, payload, mock_trace_manager)

            mock_trace_manager.add_trace_task.assert_not_called()

    @pytest.mark.usefixtures("mock_ops_trace_manager")
    def test_prompt_generation_not_ce_eligible(
        self,
        gateway: TelemetryGateway,
        mock_trace_manager: MagicMock,
    ) -> None:
        with patch("enterprise.telemetry.gateway._is_enterprise_telemetry_enabled", return_value=False):
            context = {"app_id": "app-123", "user_id": "user-456", "tenant_id": "tenant-789"}
            payload = {"operation_type": "generate", "instruction": "test"}

            gateway.emit(TelemetryCase.PROMPT_GENERATION, context, payload, mock_trace_manager)

            mock_trace_manager.add_trace_task.assert_not_called()


class TestIsEnterpriseTelemetryEnabled:
    def test_returns_false_when_exporter_import_fails(self) -> None:
        with patch.dict(sys.modules, {"enterprise.telemetry.exporter": None}):
            result = is_enterprise_telemetry_enabled()
            assert result is False

    def test_function_is_callable(self) -> None:
        assert callable(is_enterprise_telemetry_enabled)
