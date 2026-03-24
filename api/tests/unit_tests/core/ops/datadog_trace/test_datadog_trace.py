from datetime import datetime
from unittest.mock import MagicMock

import pytest
from opentelemetry.trace import StatusCode

from core.ops.datadog_trace.client import DatadogTraceClient
from core.ops.datadog_trace.datadog_trace import (
    DatadogDataTrace,
    _datetime_to_ns,
    _workflow_node_status_to_otel_status,
)
from core.ops.entities.config_entity import DatadogConfig
from core.ops.entities.trace_entity import DatasetRetrievalTraceInfo, MessageTraceInfo, ToolTraceInfo, WorkflowTraceInfo
from dify_graph.entities.workflow_node_execution import WorkflowNodeExecutionStatus


@pytest.fixture
def datadog_trace(monkeypatch):
    mock_cls = MagicMock()
    mock_cls._compute_trace_id.side_effect = DatadogTraceClient._compute_trace_id
    monkeypatch.setattr("core.ops.datadog_trace.datadog_trace.DatadogTraceClient", mock_cls)
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
            "core.ops.datadog_trace.datadog_trace.DatadogSpanBuilder.build_workflow_node_attrs",
            mock_builder,
        )
        datadog_trace._process_workflow_nodes(trace_info, "workflow:wf-1", "message:msg-1")

        add_span_calls = datadog_trace.trace_client.add_span.call_args_list
        assert len(add_span_calls) == 2
        assert add_span_calls[0].kwargs["name"] == "node-1"
        assert add_span_calls[1].kwargs["name"] == "node-3"

    def test_tool_trace_and_retrieval_trace_skip_when_no_message_id(self, datadog_trace: DatadogDataTrace):
        datadog_trace.tool_trace(_build_tool_trace_info(message_id=None))
        datadog_trace.dataset_retrieval_trace(_build_retrieval_trace_info(message_id=None))

        datadog_trace.trace_client.add_span.assert_not_called()

    def test_datetime_to_ns_substitutes_now_for_none(self):
        before_ns = int(datetime.now().timestamp() * 1_000_000_000)
        result = _datetime_to_ns(None)
        after_ns = int(datetime.now().timestamp() * 1_000_000_000)

        assert before_ns <= result <= after_ns

    def test_span_contexts_parent_child_linking(self, datadog_trace: DatadogDataTrace):
        message_trace = _build_message_trace_info(message_id="msg-42")
        tool_trace = _build_tool_trace_info(message_id="msg-42")

        datadog_trace.message_trace(message_trace)
        datadog_trace.tool_trace(tool_trace)

        message_call = datadog_trace.trace_client.add_span.call_args_list[0]
        tool_call = datadog_trace.trace_client.add_span.call_args_list[1]

        assert message_call.kwargs["store_key"] == "message:msg-42"
        assert tool_call.kwargs["parent_key"] == "message:msg-42"

    def test_tool_before_message_uses_deterministic_trace_id(self, datadog_trace: DatadogDataTrace):
        tool_trace = _build_tool_trace_info(message_id="msg-99")
        message_trace = _build_message_trace_info(message_id="msg-99")
        expected_trace_id = DatadogTraceClient._compute_trace_id("message:msg-99")

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
