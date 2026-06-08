from __future__ import annotations

import sys
from unittest.mock import MagicMock, patch

import pytest

from core.ops.entities.trace_entity import TraceTaskName
from core.telemetry.gateway import (
    CASE_ROUTING,
    CASE_TO_TRACE_TASK,
    PAYLOAD_SIZE_THRESHOLD_BYTES,
    emit,
)
from enterprise.telemetry.contracts import SignalType, TelemetryCase, TelemetryEnvelope


class TestCaseRoutingTable:
    def test_all_cases_have_routing(self) -> None:
        for case in TelemetryCase:
            assert case in CASE_ROUTING, f"Missing routing for {case}"

    def test_trace_cases(self) -> None:
        trace_cases = [
            TelemetryCase.WORKFLOW_RUN,
            TelemetryCase.MESSAGE_RUN,
            TelemetryCase.NODE_EXECUTION,
            TelemetryCase.DRAFT_NODE_EXECUTION,
            TelemetryCase.PROMPT_GENERATION,
        ]
        for case in trace_cases:
            assert CASE_ROUTING[case].signal_type is SignalType.TRACE, f"{case} should be trace"

    def test_metric_log_cases(self) -> None:
        metric_log_cases = [
            TelemetryCase.APP_CREATED,
            TelemetryCase.APP_UPDATED,
            TelemetryCase.APP_DELETED,
            TelemetryCase.FEEDBACK_CREATED,
        ]
        for case in metric_log_cases:
            assert CASE_ROUTING[case].signal_type is SignalType.METRIC_LOG, f"{case} should be metric_log"

    def test_ce_eligible_cases(self) -> None:
        ce_eligible_cases = [
            TelemetryCase.WORKFLOW_RUN,
            TelemetryCase.MESSAGE_RUN,
            TelemetryCase.TOOL_EXECUTION,
            TelemetryCase.MODERATION_CHECK,
            TelemetryCase.SUGGESTED_QUESTION,
            TelemetryCase.DATASET_RETRIEVAL,
            TelemetryCase.GENERATE_NAME,
        ]
        for case in ce_eligible_cases:
            assert CASE_ROUTING[case].ce_eligible is True, f"{case} should be CE eligible"

    def test_enterprise_only_cases(self) -> None:
        enterprise_only_cases = [
            TelemetryCase.NODE_EXECUTION,
            TelemetryCase.DRAFT_NODE_EXECUTION,
            TelemetryCase.PROMPT_GENERATION,
        ]
        for case in enterprise_only_cases:
            assert CASE_ROUTING[case].ce_eligible is False, f"{case} should be enterprise-only"

    def test_trace_cases_have_task_name_mapping(self) -> None:
        trace_cases = [c for c in TelemetryCase if CASE_ROUTING[c].signal_type is SignalType.TRACE]
        for case in trace_cases:
            assert case in CASE_TO_TRACE_TASK, f"Missing TraceTaskName mapping for {case}"


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


class TestGatewayTraceRouting:
    @pytest.fixture
    def mock_trace_manager(self) -> MagicMock:
        return MagicMock()

    @patch("core.telemetry.gateway.is_enterprise_telemetry_enabled", return_value=True)
    def test_trace_case_routes_to_trace_manager(
        self,
        mock_ee_enabled: MagicMock,
        mock_trace_manager: MagicMock,
        mock_ops_trace_manager: tuple[MagicMock, MagicMock],
    ) -> None:
        context = {"app_id": "app-123", "user_id": "user-456", "tenant_id": "tenant-789"}
        payload = {"workflow_run_id": "run-abc"}

        emit(TelemetryCase.WORKFLOW_RUN, context, payload, mock_trace_manager)

        mock_trace_manager.add_trace_task.assert_called_once()

    @patch("core.telemetry.gateway.is_enterprise_telemetry_enabled", return_value=False)
    def test_ce_eligible_trace_enqueued_when_ee_disabled(
        self,
        mock_ee_enabled: MagicMock,
        mock_trace_manager: MagicMock,
        mock_ops_trace_manager: tuple[MagicMock, MagicMock],
    ) -> None:
        context = {"app_id": "app-123", "user_id": "user-456"}
        payload = {"workflow_run_id": "run-abc"}

        emit(TelemetryCase.WORKFLOW_RUN, context, payload, mock_trace_manager)

        mock_trace_manager.add_trace_task.assert_called_once()

    @patch("core.telemetry.gateway.is_enterprise_telemetry_enabled", return_value=False)
    def test_enterprise_only_trace_dropped_when_ee_disabled(
        self,
        mock_ee_enabled: MagicMock,
        mock_trace_manager: MagicMock,
        mock_ops_trace_manager: tuple[MagicMock, MagicMock],
    ) -> None:
        context = {"app_id": "app-123", "user_id": "user-456"}
        payload = {"node_id": "node-abc"}

        emit(TelemetryCase.NODE_EXECUTION, context, payload, mock_trace_manager)

        mock_trace_manager.add_trace_task.assert_not_called()

    @patch("core.telemetry.gateway.is_enterprise_telemetry_enabled", return_value=True)
    def test_enterprise_only_trace_enqueued_when_ee_enabled(
        self,
        mock_ee_enabled: MagicMock,
        mock_trace_manager: MagicMock,
        mock_ops_trace_manager: tuple[MagicMock, MagicMock],
    ) -> None:
        context = {"app_id": "app-123", "user_id": "user-456"}
        payload = {"node_id": "node-abc"}

        emit(TelemetryCase.NODE_EXECUTION, context, payload, mock_trace_manager)

        mock_trace_manager.add_trace_task.assert_called_once()


class TestGatewayMetricLogRouting:
    @patch("core.telemetry.gateway.is_enterprise_telemetry_enabled", return_value=True)
    @patch("tasks.enterprise_telemetry_task.process_enterprise_telemetry.delay")
    def test_metric_case_routes_to_celery_task(
        self,
        mock_delay: MagicMock,
        mock_ee_enabled: MagicMock,
    ) -> None:
        context = {"tenant_id": "tenant-123"}
        payload = {"app_id": "app-abc", "name": "My App"}

        emit(TelemetryCase.APP_CREATED, context, payload)

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
        context = {"tenant_id": "tenant-123"}
        payload = {"app_id": "app-abc"}

        emit(TelemetryCase.APP_CREATED, context, payload)
        emit(TelemetryCase.APP_CREATED, context, payload)

        assert mock_delay.call_count == 2
        envelope1 = TelemetryEnvelope.model_validate_json(mock_delay.call_args_list[0][0][0])
        envelope2 = TelemetryEnvelope.model_validate_json(mock_delay.call_args_list[1][0][0])
        assert envelope1.event_id != envelope2.event_id


class TestGatewayPayloadSizing:
    @patch("core.telemetry.gateway.is_enterprise_telemetry_enabled", return_value=True)
    @patch("tasks.enterprise_telemetry_task.process_enterprise_telemetry.delay")
    def test_small_payload_inlined(
        self,
        mock_delay: MagicMock,
        mock_ee_enabled: MagicMock,
    ) -> None:
        context = {"tenant_id": "tenant-123"}
        payload = {"key": "small_value"}

        emit(TelemetryCase.APP_CREATED, context, payload)

        envelope_json = mock_delay.call_args[0][0]
        envelope = TelemetryEnvelope.model_validate_json(envelope_json)
        assert envelope.payload == payload
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
        context = {"tenant_id": "tenant-123"}
        large_value = "x" * (PAYLOAD_SIZE_THRESHOLD_BYTES + 1000)
        payload = {"key": large_value}

        emit(TelemetryCase.APP_CREATED, context, payload)

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
        context = {"tenant_id": "tenant-123"}
        large_value = "x" * (PAYLOAD_SIZE_THRESHOLD_BYTES + 1000)
        payload = {"key": large_value}

        emit(TelemetryCase.APP_CREATED, context, payload)

        envelope_json = mock_delay.call_args[0][0]
        envelope = TelemetryEnvelope.model_validate_json(envelope_json)
        assert envelope.payload == payload
        assert envelope.metadata is None


class TestTraceTaskNameMapping:
    def test_workflow_run_mapping(self) -> None:
        assert CASE_TO_TRACE_TASK[TelemetryCase.WORKFLOW_RUN] is TraceTaskName.WORKFLOW_TRACE

    def test_message_run_mapping(self) -> None:
        assert CASE_TO_TRACE_TASK[TelemetryCase.MESSAGE_RUN] is TraceTaskName.MESSAGE_TRACE

    def test_node_execution_mapping(self) -> None:
        assert CASE_TO_TRACE_TASK[TelemetryCase.NODE_EXECUTION] is TraceTaskName.NODE_EXECUTION_TRACE

    def test_draft_node_execution_mapping(self) -> None:
        assert CASE_TO_TRACE_TASK[TelemetryCase.DRAFT_NODE_EXECUTION] is TraceTaskName.DRAFT_NODE_EXECUTION_TRACE

    def test_prompt_generation_mapping(self) -> None:
        assert CASE_TO_TRACE_TASK[TelemetryCase.PROMPT_GENERATION] is TraceTaskName.PROMPT_GENERATION_TRACE
