import threading
from datetime import datetime
from unittest.mock import MagicMock, patch

from core.app.workflow.layers.llm_quota import LLMQuotaLayer
from core.errors.error import QuotaExceededError
from core.model_runtime.entities.llm_entities import LLMUsage
from core.workflow.enums import NodeType, WorkflowNodeExecutionStatus
from core.workflow.graph_engine.entities.commands import CommandType
from core.workflow.graph_events.node import NodeRunSucceededEvent
from core.workflow.node_events import NodeRunResult


def _build_succeeded_event() -> NodeRunSucceededEvent:
    return NodeRunSucceededEvent(
        id="execution-id",
        node_id="llm-node-id",
        node_type=NodeType.LLM,
        start_at=datetime.now(),
        node_run_result=NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs={"question": "hello"},
            llm_usage=LLMUsage.empty_usage(),
        ),
    )


def test_deduct_quota_called_for_successful_llm_node() -> None:
    layer = LLMQuotaLayer()
    node = MagicMock()
    node.id = "llm-node-id"
    node.execution_id = "execution-id"
    node.node_type = NodeType.LLM
    node.tenant_id = "tenant-id"
    node.model_instance = object()

    result_event = _build_succeeded_event()
    with patch("core.app.workflow.layers.llm_quota.deduct_llm_quota", autospec=True) as mock_deduct:
        layer.on_node_run_end(node=node, error=None, result_event=result_event)

    mock_deduct.assert_called_once_with(
        tenant_id="tenant-id",
        model_instance=node.model_instance,
        usage=result_event.node_run_result.llm_usage,
    )


def test_deduct_quota_called_for_question_classifier_node() -> None:
    layer = LLMQuotaLayer()
    node = MagicMock()
    node.id = "question-classifier-node-id"
    node.execution_id = "execution-id"
    node.node_type = NodeType.QUESTION_CLASSIFIER
    node.tenant_id = "tenant-id"
    node.model_instance = object()

    result_event = _build_succeeded_event()
    with patch("core.app.workflow.layers.llm_quota.deduct_llm_quota", autospec=True) as mock_deduct:
        layer.on_node_run_end(node=node, error=None, result_event=result_event)

    mock_deduct.assert_called_once_with(
        tenant_id="tenant-id",
        model_instance=node.model_instance,
        usage=result_event.node_run_result.llm_usage,
    )


def test_non_llm_node_is_ignored() -> None:
    layer = LLMQuotaLayer()
    node = MagicMock()
    node.id = "start-node-id"
    node.execution_id = "execution-id"
    node.node_type = NodeType.START
    node.tenant_id = "tenant-id"
    node._model_instance = object()

    result_event = _build_succeeded_event()
    with patch("core.app.workflow.layers.llm_quota.deduct_llm_quota", autospec=True) as mock_deduct:
        layer.on_node_run_end(node=node, error=None, result_event=result_event)

    mock_deduct.assert_not_called()


def test_quota_error_is_handled_in_layer() -> None:
    layer = LLMQuotaLayer()
    node = MagicMock()
    node.id = "llm-node-id"
    node.execution_id = "execution-id"
    node.node_type = NodeType.LLM
    node.tenant_id = "tenant-id"
    node.model_instance = object()

    result_event = _build_succeeded_event()
    with patch(
        "core.app.workflow.layers.llm_quota.deduct_llm_quota",
        autospec=True,
        side_effect=ValueError("quota exceeded"),
    ):
        layer.on_node_run_end(node=node, error=None, result_event=result_event)


def test_quota_deduction_exceeded_aborts_workflow_immediately() -> None:
    layer = LLMQuotaLayer()
    stop_event = threading.Event()
    layer.command_channel = MagicMock()

    node = MagicMock()
    node.id = "llm-node-id"
    node.execution_id = "execution-id"
    node.node_type = NodeType.LLM
    node.tenant_id = "tenant-id"
    node.model_instance = object()
    node.graph_runtime_state = MagicMock()
    node.graph_runtime_state.stop_event = stop_event

    result_event = _build_succeeded_event()
    with patch(
        "core.app.workflow.layers.llm_quota.deduct_llm_quota",
        autospec=True,
        side_effect=QuotaExceededError("No credits remaining"),
    ):
        layer.on_node_run_end(node=node, error=None, result_event=result_event)

    assert stop_event.is_set()
    layer.command_channel.send_command.assert_called_once()
    abort_command = layer.command_channel.send_command.call_args.args[0]
    assert abort_command.command_type == CommandType.ABORT
    assert abort_command.reason == "No credits remaining"


def test_quota_precheck_failure_aborts_workflow_immediately() -> None:
    layer = LLMQuotaLayer()
    stop_event = threading.Event()
    layer.command_channel = MagicMock()

    node = MagicMock()
    node.id = "llm-node-id"
    node.node_type = NodeType.LLM
    node.model_instance = object()
    node.graph_runtime_state = MagicMock()
    node.graph_runtime_state.stop_event = stop_event

    with patch(
        "core.app.workflow.layers.llm_quota.ensure_llm_quota_available",
        autospec=True,
        side_effect=QuotaExceededError("Model provider openai quota exceeded."),
    ):
        layer.on_node_run_start(node)

    assert stop_event.is_set()
    layer.command_channel.send_command.assert_called_once()
    abort_command = layer.command_channel.send_command.call_args.args[0]
    assert abort_command.command_type == CommandType.ABORT
    assert abort_command.reason == "Model provider openai quota exceeded."


def test_quota_precheck_passes_without_abort() -> None:
    layer = LLMQuotaLayer()
    stop_event = threading.Event()
    layer.command_channel = MagicMock()

    node = MagicMock()
    node.id = "llm-node-id"
    node.node_type = NodeType.LLM
    node.model_instance = object()
    node.graph_runtime_state = MagicMock()
    node.graph_runtime_state.stop_event = stop_event

    with patch("core.app.workflow.layers.llm_quota.ensure_llm_quota_available", autospec=True) as mock_check:
        layer.on_node_run_start(node)

    assert not stop_event.is_set()
    mock_check.assert_called_once_with(model_instance=node.model_instance)
    layer.command_channel.send_command.assert_not_called()
