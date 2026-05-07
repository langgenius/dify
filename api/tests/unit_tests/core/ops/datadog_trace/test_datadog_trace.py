from datetime import datetime
from unittest.mock import MagicMock

import pytest
from dify_trace_datadog import semconv
from dify_trace_datadog.client import DatadogTraceClient
from dify_trace_datadog.config import DatadogConfig
from dify_trace_datadog.datadog_trace import (
    DatadogDataTrace,
    _workflow_node_status_to_otel_status,
)
from opentelemetry.trace import StatusCode

from core.ops.entities.trace_entity import DatasetRetrievalTraceInfo, MessageTraceInfo, ToolTraceInfo, WorkflowTraceInfo
from graphon.enums import WorkflowNodeExecutionStatus


@pytest.fixture
def datadog_trace(monkeypatch):
    mock_cls = MagicMock()
    mock_cls.compute_trace_id.side_effect = DatadogTraceClient.compute_trace_id
    monkeypatch.setattr("dify_trace_datadog.datadog_trace.DatadogTraceClient", mock_cls)
    config = DatadogConfig(api_key="test-key", site="datadoghq.com", service_name="test")
    return DatadogDataTrace(config)


def _build_message_trace_info(message_id: str | None = "msg-1") -> MessageTraceInfo:
    return MessageTraceInfo(
        message_id=message_id,
        metadata={"conversation_id": "conv-1"},
        inputs="Hello",
        outputs="Hi",
        start_time=datetime.now(),
        end_time=datetime.now(),
        trace_id=None,
        conversation_model="chat",
        message_tokens=10,
        answer_tokens=5,
        total_tokens=15,
        file_list=[],
        message_file_data=None,
        conversation_mode="chat",
    )


def _build_workflow_trace_info(message_id: str | None = "msg-1") -> WorkflowTraceInfo:
    return WorkflowTraceInfo(
        message_id=message_id,
        metadata={"conversation_id": "conv-1", "app_id": "app-1"},
        inputs=None,
        outputs=None,
        start_time=datetime.now(),
        end_time=datetime.now(),
        trace_id=None,
        workflow_id="wf-1",
        tenant_id="tenant-1",
        workflow_run_id="run-1",
        workflow_run_elapsed_time=1,
        workflow_run_status="succeeded",
        workflow_run_inputs={"sys.query": "Hello"},
        workflow_run_outputs={"answer": "Hi"},
        workflow_run_version="1",
        total_tokens=0,
        file_list=[],
        query="Hello",
        conversation_id="conv-1",
        workflow_app_log_id=None,
    )


def _build_tool_trace_info(message_id: str | None = "msg-1") -> ToolTraceInfo:
    return ToolTraceInfo(
        message_id=message_id,
        metadata={},
        inputs=None,
        outputs=None,
        start_time=datetime.now(),
        end_time=datetime.now(),
        trace_id=None,
        tool_name="search",
        tool_inputs={"query": "hello"},
        tool_outputs="found",
        message_file_data=None,
        tool_config={},
        time_cost=0.1,
        tool_parameters={},
        file_url=None,
    )


def _build_retrieval_trace_info(message_id: str | None = "msg-1") -> DatasetRetrievalTraceInfo:
    return DatasetRetrievalTraceInfo(
        message_id=message_id,
        metadata={},
        inputs="hello",
        outputs=None,
        start_time=datetime.now(),
        end_time=datetime.now(),
        trace_id=None,
        documents=[],
    )


class TestWorkflowNodeProcessing:
    """Verify workflow node iteration is resilient and correctly correlated."""

    def test_bad_node_does_not_stop_remaining_nodes(self, datadog_trace: DatadogDataTrace, monkeypatch):
        trace_info = MagicMock(spec=WorkflowTraceInfo)
        trace_info.workflow_run_id = "wf-1"
        nodes = []
        for node_id in ("node-1", "node-2", "node-3"):
            node = MagicMock()
            node.id = node_id
            node.title = node_id
            node.node_type = "generic"
            node.created_at = datetime.now()
            node.finished_at = datetime.now()
            node.status = WorkflowNodeExecutionStatus.SUCCEEDED
            node.error = None
            nodes.append(node)

        datadog_trace._get_workflow_node_executions = MagicMock(return_value=nodes)  # type: ignore[method-assign]

        mock_builder = MagicMock(side_effect=[{"node": 1}, RuntimeError("boom"), {"node": 3}])
        monkeypatch.setattr(
            "dify_trace_datadog.span_builder.build_workflow_node_attrs",
            mock_builder,
        )
        trace_id = DatadogTraceClient.compute_trace_id("message:msg-1")
        datadog_trace._process_workflow_nodes(trace_info, "workflow:wf-1", trace_id)

        add_span_calls = datadog_trace.trace_client.add_span.call_args_list
        assert len(add_span_calls) == 2
        assert add_span_calls[0].kwargs["name"] == "node-1"
        assert add_span_calls[0].kwargs["store_key"] == "node:node-1"
        assert add_span_calls[1].kwargs["name"] == "node-3"
        assert add_span_calls[1].kwargs["store_key"] == "node:node-3"

    def test_tool_trace_and_retrieval_trace_skip_when_no_message_id(self, datadog_trace: DatadogDataTrace):
        datadog_trace.tool_trace(_build_tool_trace_info(message_id=None))
        datadog_trace.dataset_retrieval_trace(_build_retrieval_trace_info(message_id=None))

        datadog_trace.trace_client.add_span.assert_not_called()

    @pytest.mark.parametrize(
        ("site", "expected_url"),
        [
            ("datadoghq.com", "https://app.datadoghq.com/llm/traces"),
            ("datadoghq.eu", "https://app.datadoghq.eu/llm/traces"),
            ("us5.datadoghq.com", "https://us5.datadoghq.com/llm/traces"),
        ],
    )
    def test_project_url_uses_datadog_app_site(self, site: str, expected_url: str):
        client = DatadogTraceClient(api_key="test-key", site=site, service_name="test")

        assert client.get_project_url() == expected_url

    @pytest.mark.parametrize(
        ("site", "expected_endpoint"),
        [
            ("datadoghq.com", "https://otlp.datadoghq.com/v1/traces"),
            ("us5.datadoghq.com", "https://otlp.us5.datadoghq.com/v1/traces"),
            ("us6.datadoghq.com", "https://otlp.us6.datadoghq.com/v1/traces"),
        ],
    )
    def test_trace_endpoint_uses_datadog_otlp_host(self, site: str, expected_endpoint: str):
        client = DatadogTraceClient(api_key="test-key", site=site, service_name="test")

        assert client.endpoint == expected_endpoint

    @pytest.mark.parametrize(
        ("site", "expected_url"),
        [
            ("datadoghq.com", "https://api.datadoghq.com/api/v1/validate"),
            ("us5.datadoghq.com", "https://api.us5.datadoghq.com/api/v1/validate"),
        ],
    )
    def test_api_check_uses_datadog_api_host(self, site: str, expected_url: str, monkeypatch):
        get = MagicMock(return_value=MagicMock(status_code=200))
        monkeypatch.setattr("dify_trace_datadog.client.httpx.get", get)
        client = DatadogTraceClient(api_key="test-key", site=site, service_name="test")

        assert client.api_check()
        get.assert_called_once_with(
            expected_url,
            headers={"DD-API-KEY": "test-key"},
            timeout=10,
        )

    def test_span_contexts_parent_child_linking(self, datadog_trace: DatadogDataTrace):
        message_trace = _build_message_trace_info(message_id="msg-42")
        tool_trace = _build_tool_trace_info(message_id="msg-42")

        datadog_trace.message_trace(message_trace)
        datadog_trace.tool_trace(tool_trace)

        message_call = datadog_trace.trace_client.add_span.call_args_list[0]
        tool_call = datadog_trace.trace_client.add_span.call_args_list[1]

        assert message_call.kwargs["store_key"] == "message:msg-42"
        assert tool_call.kwargs["parent_key"] == "message:msg-42"

    def test_workflow_with_message_id_is_parented_to_message(self, datadog_trace: DatadogDataTrace):
        trace_info = _build_workflow_trace_info(message_id="msg-42")
        datadog_trace._process_workflow_nodes = MagicMock()  # type: ignore[method-assign]

        datadog_trace.workflow_trace(trace_info)

        workflow_call = datadog_trace.trace_client.add_span.call_args
        assert workflow_call.kwargs["trace_id"] == DatadogTraceClient.compute_trace_id("message:msg-42")
        assert workflow_call.kwargs["store_key"] == "workflow:run-1"
        assert workflow_call.kwargs["parent_key"] == "message:msg-42"

    def test_external_trace_id_controls_trace_correlation(self, datadog_trace: DatadogDataTrace):
        message_trace = _build_message_trace_info(message_id="msg-42")
        tool_trace = _build_tool_trace_info(message_id="msg-42")
        message_trace.trace_id = "external-trace"
        tool_trace.trace_id = "external-trace"
        expected_trace_id = DatadogTraceClient.compute_trace_id("trace:external-trace")

        datadog_trace.message_trace(message_trace)
        datadog_trace.tool_trace(tool_trace)

        message_call = datadog_trace.trace_client.add_span.call_args_list[0]
        tool_call = datadog_trace.trace_client.add_span.call_args_list[1]
        assert message_call.kwargs["trace_id"] == expected_trace_id
        assert tool_call.kwargs["trace_id"] == expected_trace_id
        assert tool_call.kwargs["parent_key"] == "message:msg-42"

    def test_nested_workflow_uses_parent_context(self, datadog_trace: DatadogDataTrace):
        trace_info = _build_workflow_trace_info(message_id=None)
        trace_info.metadata["parent_trace_context"] = {
            "parent_workflow_run_id": "parent-run",
            "parent_node_execution_id": "parent-node",
        }
        datadog_trace._process_workflow_nodes = MagicMock()  # type: ignore[method-assign]

        datadog_trace.workflow_trace(trace_info)

        workflow_call = datadog_trace.trace_client.add_span.call_args
        assert workflow_call.kwargs["trace_id"] == DatadogTraceClient.compute_trace_id("workflow:parent-run")
        assert workflow_call.kwargs["parent_key"] == "node:parent-node"
        assert workflow_call.kwargs["store_key"] == "workflow:run-1"

    def test_message_span_name_uses_operation_name(self, datadog_trace: DatadogDataTrace, monkeypatch):
        monkeypatch.setattr(
            "dify_trace_datadog.span_builder.build_message_attrs",
            MagicMock(return_value={semconv.OPERATION_NAME: "completion"}),
        )
        message_trace = _build_message_trace_info(message_id="msg-42")
        message_trace.conversation_mode = "completion"

        datadog_trace.message_trace(message_trace)

        message_call = datadog_trace.trace_client.add_span.call_args
        assert message_call.kwargs["name"] == "completion"

    def test_tool_before_message_uses_deterministic_trace_id(self, datadog_trace: DatadogDataTrace):
        tool_trace = _build_tool_trace_info(message_id="msg-99")
        message_trace = _build_message_trace_info(message_id="msg-99")
        expected_trace_id = DatadogTraceClient.compute_trace_id("message:msg-99")

        datadog_trace.tool_trace(tool_trace)
        datadog_trace.message_trace(message_trace)

        tool_call = datadog_trace.trace_client.add_span.call_args_list[0]
        message_call = datadog_trace.trace_client.add_span.call_args_list[1]

        assert tool_call.kwargs["trace_id"] == expected_trace_id
        assert tool_call.kwargs["parent_key"] == "message:msg-99"
        assert message_call.kwargs["trace_id"] == expected_trace_id
        assert message_call.kwargs["store_key"] == "message:msg-99"

    @pytest.mark.parametrize(
        ("status", "error", "expected_code", "expected_description"),
        [
            (WorkflowNodeExecutionStatus.SUCCEEDED, None, StatusCode.OK, None),
            (WorkflowNodeExecutionStatus.FAILED, "bad node", StatusCode.ERROR, "bad node"),
            (WorkflowNodeExecutionStatus.RUNNING, None, StatusCode.UNSET, None),
        ],
    )
    def test_node_status_mapping(self, status, error, expected_code, expected_description):
        node = MagicMock()
        node.status = status
        node.error = error

        result = _workflow_node_status_to_otel_status(node)

        assert result.status_code is expected_code
        assert result.description == expected_description

    def test_get_workflow_node_executions_uses_repository_workflow_execution_api(
        self, datadog_trace: DatadogDataTrace, monkeypatch
    ):
        trace_info = _build_workflow_trace_info(message_id=None)
        repository = MagicMock()
        repository.get_by_workflow_execution.return_value = ["node-1"]
        factory = MagicMock()
        factory.create_workflow_node_execution_repository.return_value = repository
        monkeypatch.setattr("dify_trace_datadog.datadog_trace.DifyCoreRepositoryFactory", factory)
        datadog_trace.get_service_account_with_tenant = MagicMock(return_value=MagicMock())  # type: ignore[method-assign]
        datadog_trace._session_factory = MagicMock()

        result = datadog_trace._get_workflow_node_executions(trace_info)

        assert result == ["node-1"]
        repository.get_by_workflow_execution.assert_called_once_with(workflow_execution_id="run-1")
