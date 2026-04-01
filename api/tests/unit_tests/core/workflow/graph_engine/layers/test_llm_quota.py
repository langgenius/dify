import threading
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionStatus
from graphon.graph_engine.entities.commands import CommandType
from graphon.graph_events import NodeRunSucceededEvent
from graphon.model_runtime.entities.llm_entities import LLMUsage
from graphon.node_events import NodeRunResult

from core.app.entities.app_invoke_entities import DifyRunContext, InvokeFrom, UserFrom
from core.app.workflow.layers.llm_quota import LLMQuotaLayer
from core.errors.error import QuotaExceededError
from core.model_manager import ModelInstance


def _build_dify_context() -> DifyRunContext:
    return DifyRunContext(
        tenant_id="tenant-id",
        app_id="app-id",
        user_id="user-id",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
    )


def _build_succeeded_event() -> NodeRunSucceededEvent:
    return NodeRunSucceededEvent(
        id="execution-id",
        node_id="llm-node-id",
        node_type=BuiltinNodeTypes.LLM,
        start_at=datetime.now(),
        node_run_result=NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs={"question": "hello"},
            llm_usage=LLMUsage.empty_usage(),
        ),
    )


def _build_wrapped_model_instance() -> tuple[SimpleNamespace, ModelInstance]:
    raw_model_instance = ModelInstance.__new__(ModelInstance)
    return SimpleNamespace(_model_instance=raw_model_instance), raw_model_instance


def test_deduct_quota_called_for_successful_llm_node() -> None:
    layer = LLMQuotaLayer()
    node = MagicMock()
    node.id = "llm-node-id"
    node.execution_id = "execution-id"
    node.node_type = BuiltinNodeTypes.LLM
    node.tenant_id = "tenant-id"
    node.require_run_context_value.return_value = _build_dify_context()
    node.model_instance, raw_model_instance = _build_wrapped_model_instance()

    result_event = _build_succeeded_event()
    with patch("core.app.workflow.layers.llm_quota.deduct_llm_quota", autospec=True) as mock_deduct:
        layer.on_node_run_end(node=node, error=None, result_event=result_event)

    mock_deduct.assert_called_once_with(
        tenant_id="tenant-id",
        model_instance=raw_model_instance,
        usage=result_event.node_run_result.llm_usage,
    )


def test_deduct_quota_called_for_question_classifier_node() -> None:
    layer = LLMQuotaLayer()
    node = MagicMock()
    node.id = "question-classifier-node-id"
    node.execution_id = "execution-id"
    node.node_type = BuiltinNodeTypes.QUESTION_CLASSIFIER
    node.tenant_id = "tenant-id"
    node.require_run_context_value.return_value = _build_dify_context()
    node.model_instance, raw_model_instance = _build_wrapped_model_instance()

    result_event = _build_succeeded_event()
    with patch("core.app.workflow.layers.llm_quota.deduct_llm_quota", autospec=True) as mock_deduct:
        layer.on_node_run_end(node=node, error=None, result_event=result_event)

    mock_deduct.assert_called_once_with(
        tenant_id="tenant-id",
        model_instance=raw_model_instance,
        usage=result_event.node_run_result.llm_usage,
    )


def test_non_llm_node_is_ignored() -> None:
    layer = LLMQuotaLayer()
    node = MagicMock()
    node.id = "start-node-id"
    node.execution_id = "execution-id"
    node.node_type = BuiltinNodeTypes.START
    node.tenant_id = "tenant-id"
    node.require_run_context_value.return_value = _build_dify_context()
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
    node.node_type = BuiltinNodeTypes.LLM
    node.tenant_id = "tenant-id"
    node.require_run_context_value.return_value = _build_dify_context()
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
    node.node_type = BuiltinNodeTypes.LLM
    node.tenant_id = "tenant-id"
    node.require_run_context_value.return_value = _build_dify_context()
    node.model_instance, _ = _build_wrapped_model_instance()
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
    node.node_type = BuiltinNodeTypes.LLM
    node.model_instance, _ = _build_wrapped_model_instance()
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
    node.node_type = BuiltinNodeTypes.LLM
    node.model_instance, raw_model_instance = _build_wrapped_model_instance()
    node.graph_runtime_state = MagicMock()
    node.graph_runtime_state.stop_event = stop_event

    with patch("core.app.workflow.layers.llm_quota.ensure_llm_quota_available", autospec=True) as mock_check:
        layer.on_node_run_start(node)

    assert not stop_event.is_set()
    mock_check.assert_called_once_with(model_instance=raw_model_instance)
    layer.command_channel.send_command.assert_not_called()
