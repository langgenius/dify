from __future__ import annotations

import sys
from unittest.mock import MagicMock, patch

import pytest

from enterprise.telemetry.contracts import TelemetryCase, TelemetryEnvelope
from enterprise.telemetry.gateway import (
    CASE_ROUTING,
    CASE_TO_TRACE_TASK_NAME,
    PAYLOAD_SIZE_THRESHOLD_BYTES,
    TelemetryGateway,
    emit,
    get_gateway,
    is_gateway_enabled,
)


class TestIsGatewayEnabled:
    @pytest.mark.parametrize(
        ("env_value", "expected"),
        [
            ("true", True),
            ("True", True),
            ("TRUE", True),
            ("1", True),
            ("yes", True),
            ("YES", True),
            ("false", False),
            ("False", False),
            ("0", False),
            ("no", False),
            ("", False),
        ],
    )
    def test_feature_flag_values(self, env_value: str, expected: bool) -> None:
        with patch.dict("os.environ", {"ENTERPRISE_TELEMETRY_GATEWAY_ENABLED": env_value}):
            assert is_gateway_enabled() is expected

    def test_missing_env_var(self) -> None:
        with patch.dict("os.environ", {}, clear=True):
            assert is_gateway_enabled() is False


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
            assert CASE_ROUTING[case].signal_type == "trace", f"{case} should be trace"

    def test_metric_log_cases(self) -> None:
        metric_log_cases = [
            TelemetryCase.APP_CREATED,
            TelemetryCase.APP_UPDATED,
            TelemetryCase.APP_DELETED,
            TelemetryCase.FEEDBACK_CREATED,
            TelemetryCase.TOOL_EXECUTION,
            TelemetryCase.MODERATION_CHECK,
            TelemetryCase.SUGGESTED_QUESTION,
            TelemetryCase.DATASET_RETRIEVAL,
            TelemetryCase.GENERATE_NAME,
        ]
        for case in metric_log_cases:
            assert CASE_ROUTING[case].signal_type == "metric_log", f"{case} should be metric_log"

    def test_ce_eligible_cases(self) -> None:
        ce_eligible_cases = [TelemetryCase.WORKFLOW_RUN, TelemetryCase.MESSAGE_RUN]
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
        trace_cases = [c for c in TelemetryCase if CASE_ROUTING[c].signal_type == "trace"]
        for case in trace_cases:
            assert case in CASE_TO_TRACE_TASK_NAME, f"Missing TraceTaskName mapping for {case}"


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


class TestTelemetryGatewayTraceRouting:
    @pytest.fixture
    def gateway(self) -> TelemetryGateway:
        return TelemetryGateway()

    @pytest.fixture
    def mock_trace_manager(self) -> MagicMock:
        return MagicMock()

    @patch("enterprise.telemetry.gateway.is_gateway_enabled", return_value=True)
    @patch("enterprise.telemetry.gateway._is_enterprise_telemetry_enabled", return_value=True)
    def test_trace_case_routes_to_trace_manager(
        self,
        _mock_ee_enabled: MagicMock,
        _mock_gateway_enabled: MagicMock,
        gateway: TelemetryGateway,
        mock_trace_manager: MagicMock,
        mock_ops_trace_manager: tuple[MagicMock, MagicMock],
    ) -> None:
        context = {"app_id": "app-123", "user_id": "user-456", "tenant_id": "tenant-789"}
        payload = {"workflow_run_id": "run-abc"}

        gateway.emit(TelemetryCase.WORKFLOW_RUN, context, payload, mock_trace_manager)

        mock_trace_manager.add_trace_task.assert_called_once()

    @patch("enterprise.telemetry.gateway.is_gateway_enabled", return_value=True)
    @patch("enterprise.telemetry.gateway._is_enterprise_telemetry_enabled", return_value=False)
    def test_ce_eligible_trace_enqueued_when_ee_disabled(
        self,
        _mock_ee_enabled: MagicMock,
        _mock_gateway_enabled: MagicMock,
        gateway: TelemetryGateway,
        mock_trace_manager: MagicMock,
        mock_ops_trace_manager: tuple[MagicMock, MagicMock],
    ) -> None:
        context = {"app_id": "app-123", "user_id": "user-456"}
        payload = {"workflow_run_id": "run-abc"}

        gateway.emit(TelemetryCase.WORKFLOW_RUN, context, payload, mock_trace_manager)

        mock_trace_manager.add_trace_task.assert_called_once()

    @patch("enterprise.telemetry.gateway.is_gateway_enabled", return_value=True)
    @patch("enterprise.telemetry.gateway._is_enterprise_telemetry_enabled", return_value=False)
    def test_enterprise_only_trace_dropped_when_ee_disabled(
        self,
        _mock_ee_enabled: MagicMock,
        _mock_gateway_enabled: MagicMock,
        gateway: TelemetryGateway,
        mock_trace_manager: MagicMock,
        mock_ops_trace_manager: tuple[MagicMock, MagicMock],
    ) -> None:
        context = {"app_id": "app-123", "user_id": "user-456"}
        payload = {"node_id": "node-abc"}

        gateway.emit(TelemetryCase.NODE_EXECUTION, context, payload, mock_trace_manager)

        mock_trace_manager.add_trace_task.assert_not_called()

    @patch("enterprise.telemetry.gateway.is_gateway_enabled", return_value=True)
    @patch("enterprise.telemetry.gateway._is_enterprise_telemetry_enabled", return_value=True)
    def test_enterprise_only_trace_enqueued_when_ee_enabled(
        self,
        _mock_ee_enabled: MagicMock,
        _mock_gateway_enabled: MagicMock,
        gateway: TelemetryGateway,
        mock_trace_manager: MagicMock,
        mock_ops_trace_manager: tuple[MagicMock, MagicMock],
    ) -> None:
        context = {"app_id": "app-123", "user_id": "user-456"}
        payload = {"node_id": "node-abc"}

        gateway.emit(TelemetryCase.NODE_EXECUTION, context, payload, mock_trace_manager)

        mock_trace_manager.add_trace_task.assert_called_once()


class TestTelemetryGatewayMetricLogRouting:
    @pytest.fixture
    def gateway(self) -> TelemetryGateway:
        return TelemetryGateway()

    @patch("enterprise.telemetry.gateway.is_gateway_enabled", return_value=True)
    @patch("tasks.enterprise_telemetry_task.process_enterprise_telemetry.delay")
    def test_metric_case_routes_to_celery_task(
        self,
        mock_delay: MagicMock,
        _mock_gateway_enabled: MagicMock,
        gateway: TelemetryGateway,
    ) -> None:
        context = {"tenant_id": "tenant-123"}
        payload = {"app_id": "app-abc", "name": "My App"}

        gateway.emit(TelemetryCase.APP_CREATED, context, payload)

        mock_delay.assert_called_once()
        envelope_json = mock_delay.call_args[0][0]
        envelope = TelemetryEnvelope.model_validate_json(envelope_json)
        assert envelope.case == TelemetryCase.APP_CREATED
        assert envelope.tenant_id == "tenant-123"
        assert envelope.payload["app_id"] == "app-abc"

    @patch("enterprise.telemetry.gateway.is_gateway_enabled", return_value=True)
    @patch("tasks.enterprise_telemetry_task.process_enterprise_telemetry.delay")
    def test_envelope_has_unique_event_id(
        self,
        mock_delay: MagicMock,
        _mock_gateway_enabled: MagicMock,
        gateway: TelemetryGateway,
    ) -> None:
        context = {"tenant_id": "tenant-123"}
        payload = {"app_id": "app-abc"}

        gateway.emit(TelemetryCase.APP_CREATED, context, payload)
        gateway.emit(TelemetryCase.APP_CREATED, context, payload)

        assert mock_delay.call_count == 2
        envelope1 = TelemetryEnvelope.model_validate_json(mock_delay.call_args_list[0][0][0])
        envelope2 = TelemetryEnvelope.model_validate_json(mock_delay.call_args_list[1][0][0])
        assert envelope1.event_id != envelope2.event_id


class TestTelemetryGatewayPayloadSizing:
    @pytest.fixture
    def gateway(self) -> TelemetryGateway:
        return TelemetryGateway()

    @patch("enterprise.telemetry.gateway.is_gateway_enabled", return_value=True)
    @patch("tasks.enterprise_telemetry_task.process_enterprise_telemetry.delay")
    def test_small_payload_inlined(
        self,
        mock_delay: MagicMock,
        _mock_gateway_enabled: MagicMock,
        gateway: TelemetryGateway,
    ) -> None:
        context = {"tenant_id": "tenant-123"}
        payload = {"key": "small_value"}

        gateway.emit(TelemetryCase.APP_CREATED, context, payload)

        envelope_json = mock_delay.call_args[0][0]
        envelope = TelemetryEnvelope.model_validate_json(envelope_json)
        assert envelope.payload == payload
        assert envelope.metadata is None

    @patch("enterprise.telemetry.gateway.is_gateway_enabled", return_value=True)
    @patch("enterprise.telemetry.gateway.storage")
    @patch("tasks.enterprise_telemetry_task.process_enterprise_telemetry.delay")
    def test_large_payload_stored(
        self,
        mock_delay: MagicMock,
        mock_storage: MagicMock,
        _mock_gateway_enabled: MagicMock,
        gateway: TelemetryGateway,
    ) -> None:
        context = {"tenant_id": "tenant-123"}
        large_value = "x" * (PAYLOAD_SIZE_THRESHOLD_BYTES + 1000)
        payload = {"key": large_value}

        gateway.emit(TelemetryCase.APP_CREATED, context, payload)

        mock_storage.save.assert_called_once()
        storage_key = mock_storage.save.call_args[0][0]
        assert storage_key.startswith("telemetry/tenant-123/")

        envelope_json = mock_delay.call_args[0][0]
        envelope = TelemetryEnvelope.model_validate_json(envelope_json)
        assert envelope.payload == {}
        assert envelope.metadata is not None
        assert envelope.metadata["payload_ref"] == storage_key

    @patch("enterprise.telemetry.gateway.is_gateway_enabled", return_value=True)
    @patch("enterprise.telemetry.gateway.storage")
    @patch("tasks.enterprise_telemetry_task.process_enterprise_telemetry.delay")
    def test_large_payload_fallback_on_storage_error(
        self,
        mock_delay: MagicMock,
        mock_storage: MagicMock,
        _mock_gateway_enabled: MagicMock,
        gateway: TelemetryGateway,
    ) -> None:
        mock_storage.save.side_effect = Exception("Storage failure")
        context = {"tenant_id": "tenant-123"}
        large_value = "x" * (PAYLOAD_SIZE_THRESHOLD_BYTES + 1000)
        payload = {"key": large_value}

        gateway.emit(TelemetryCase.APP_CREATED, context, payload)

        envelope_json = mock_delay.call_args[0][0]
        envelope = TelemetryEnvelope.model_validate_json(envelope_json)
        assert envelope.payload == payload
        assert envelope.metadata is None


class TestTelemetryGatewayFeatureFlag:
    @pytest.fixture
    def gateway(self) -> TelemetryGateway:
        return TelemetryGateway()

    @pytest.fixture
    def mock_trace_manager(self) -> MagicMock:
        return MagicMock()

    @patch("enterprise.telemetry.gateway.is_gateway_enabled", return_value=False)
    @patch("enterprise.telemetry.gateway._is_enterprise_telemetry_enabled", return_value=True)
    def test_legacy_path_used_when_flag_disabled(
        self,
        _mock_ee_enabled: MagicMock,
        _mock_gateway_enabled: MagicMock,
        gateway: TelemetryGateway,
        mock_trace_manager: MagicMock,
        mock_ops_trace_manager: tuple[MagicMock, MagicMock],
    ) -> None:
        context = {"app_id": "app-123", "user_id": "user-456"}
        payload = {"workflow_run_id": "run-abc"}

        gateway.emit(TelemetryCase.WORKFLOW_RUN, context, payload, mock_trace_manager)

        mock_trace_manager.add_trace_task.assert_called_once()

    @patch("enterprise.telemetry.gateway.is_gateway_enabled", return_value=False)
    @patch("tasks.enterprise_telemetry_task.process_enterprise_telemetry.delay")
    def test_metric_log_not_processed_via_legacy_path(
        self,
        mock_delay: MagicMock,
        _mock_gateway_enabled: MagicMock,
        gateway: TelemetryGateway,
    ) -> None:
        context = {"tenant_id": "tenant-123"}
        payload = {"app_id": "app-abc"}

        gateway.emit(TelemetryCase.APP_CREATED, context, payload)

        mock_delay.assert_not_called()


class TestTelemetryGatewayLegacyPath:
    @pytest.fixture
    def gateway(self) -> TelemetryGateway:
        return TelemetryGateway()

    @pytest.fixture
    def mock_trace_manager(self) -> MagicMock:
        return MagicMock()

    @patch("enterprise.telemetry.gateway.is_gateway_enabled", return_value=False)
    @patch("enterprise.telemetry.gateway._is_enterprise_telemetry_enabled", return_value=False)
    def test_legacy_ce_eligible_enqueued_when_ee_disabled(
        self,
        _mock_ee_enabled: MagicMock,
        _mock_gateway_enabled: MagicMock,
        gateway: TelemetryGateway,
        mock_trace_manager: MagicMock,
        mock_ops_trace_manager: tuple[MagicMock, MagicMock],
    ) -> None:
        context = {"app_id": "app-123", "user_id": "user-456"}
        payload = {"workflow_run_id": "run-abc"}

        gateway.emit(TelemetryCase.WORKFLOW_RUN, context, payload, mock_trace_manager)

        mock_trace_manager.add_trace_task.assert_called_once()

    @patch("enterprise.telemetry.gateway.is_gateway_enabled", return_value=False)
    @patch("enterprise.telemetry.gateway._is_enterprise_telemetry_enabled", return_value=False)
    def test_legacy_enterprise_only_dropped_when_ee_disabled(
        self,
        _mock_ee_enabled: MagicMock,
        _mock_gateway_enabled: MagicMock,
        gateway: TelemetryGateway,
        mock_trace_manager: MagicMock,
        mock_ops_trace_manager: tuple[MagicMock, MagicMock],
    ) -> None:
        context = {"app_id": "app-123", "user_id": "user-456"}
        payload = {"node_id": "node-abc"}

        gateway.emit(TelemetryCase.NODE_EXECUTION, context, payload, mock_trace_manager)

        mock_trace_manager.add_trace_task.assert_not_called()


class TestModuleLevelFunctions:
    def test_get_gateway_returns_singleton(self) -> None:
        gateway1 = get_gateway()
        gateway2 = get_gateway()
        assert gateway1 is gateway2

    @patch("enterprise.telemetry.gateway.is_gateway_enabled", return_value=True)
    @patch("enterprise.telemetry.gateway._is_enterprise_telemetry_enabled", return_value=True)
    def test_emit_function_uses_gateway(
        self,
        _mock_ee_enabled: MagicMock,
        _mock_gateway_enabled: MagicMock,
        mock_ops_trace_manager: tuple[MagicMock, MagicMock],
    ) -> None:
        mock_trace_manager = MagicMock()
        context = {"app_id": "app-123", "user_id": "user-456"}
        payload = {"workflow_run_id": "run-abc"}

        emit(TelemetryCase.WORKFLOW_RUN, context, payload, mock_trace_manager)

        mock_trace_manager.add_trace_task.assert_called_once()


class TestTraceTaskNameMapping:
    def test_workflow_run_mapping(self) -> None:
        assert CASE_TO_TRACE_TASK_NAME[TelemetryCase.WORKFLOW_RUN] == "workflow"

    def test_message_run_mapping(self) -> None:
        assert CASE_TO_TRACE_TASK_NAME[TelemetryCase.MESSAGE_RUN] == "message"

    def test_node_execution_mapping(self) -> None:
        assert CASE_TO_TRACE_TASK_NAME[TelemetryCase.NODE_EXECUTION] == "node_execution"

    def test_draft_node_execution_mapping(self) -> None:
        assert CASE_TO_TRACE_TASK_NAME[TelemetryCase.DRAFT_NODE_EXECUTION] == "draft_node_execution"

    def test_prompt_generation_mapping(self) -> None:
        assert CASE_TO_TRACE_TASK_NAME[TelemetryCase.PROMPT_GENERATION] == "prompt_generation"
