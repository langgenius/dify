import logging
import threading
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from core.app.workflow.layers.llm_quota import LLMQuotaLayer
from core.errors.error import QuotaExceededError
from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionStatus
from graphon.graph_engine.entities.commands import CommandType
from graphon.graph_events import NodeRunSucceededEvent
from graphon.model_runtime.entities.llm_entities import LLMUsage
from graphon.node_events import NodeRunResult


def _build_succeeded_event(*, provider: str = "openai", model_name: str = "gpt-4o") -> NodeRunSucceededEvent:
    return NodeRunSucceededEvent(
        id="execution-id",
        node_id="llm-node-id",
        node_type=BuiltinNodeTypes.LLM,
        start_at=datetime.now(),
        node_run_result=NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs={
                "question": "hello",
                "model_provider": provider,
                "model_name": model_name,
            },
            llm_usage=LLMUsage.empty_usage(),
        ),
    )


def _build_public_model_identity(*, provider: str = "openai", model_name: str = "gpt-4o") -> SimpleNamespace:
    return SimpleNamespace(provider=provider, name=model_name)


def _build_node_data(*, model: SimpleNamespace | None = None) -> SimpleNamespace:
    return SimpleNamespace(
        error_strategy=None,
        retry_config=SimpleNamespace(retry_enabled=False),
        model=model,
    )


def _build_node(*, node_type: BuiltinNodeTypes = BuiltinNodeTypes.LLM) -> MagicMock:
    node = MagicMock()
    node.id = "node-id"
    node.execution_id = "execution-id"
    node.node_type = node_type
    node.node_data = _build_node_data(model=_build_public_model_identity())
    node.model_instance = SimpleNamespace(provider="stale-provider", model_name="stale-model")
    return node


class _RunnableQuotaNode:
    id = "node-id"
    execution_id = "execution-id"
    node_type = BuiltinNodeTypes.LLM
    title = "LLM node"

    def __init__(self, *, stop_event: threading.Event, node_data: SimpleNamespace | None = None) -> None:
        self.node_data = node_data or _build_node_data(model=_build_public_model_identity())
        self.graph_runtime_state = SimpleNamespace(stop_event=stop_event)
        self.original_run_called = False

    def _run(self) -> NodeRunResult:
        self.original_run_called = True
        return NodeRunResult(status=WorkflowNodeExecutionStatus.SUCCEEDED)


def test_deduct_quota_called_for_successful_llm_node() -> None:
    layer = LLMQuotaLayer(tenant_id="tenant-id")
    node = _build_node(node_type=BuiltinNodeTypes.LLM)
    result_event = _build_succeeded_event()

    with patch("core.app.workflow.layers.llm_quota.deduct_llm_quota_for_model", autospec=True) as mock_deduct:
        layer.on_node_run_end(node=node, error=None, result_event=result_event)

    mock_deduct.assert_called_once_with(
        tenant_id="tenant-id",
        provider="openai",
        model="gpt-4o",
        usage=result_event.node_run_result.llm_usage,
    )


def test_deduct_quota_called_for_question_classifier_node() -> None:
    layer = LLMQuotaLayer(tenant_id="tenant-id")
    node = _build_node(node_type=BuiltinNodeTypes.QUESTION_CLASSIFIER)
    result_event = _build_succeeded_event(provider="anthropic", model_name="claude-3-7-sonnet")

    with patch("core.app.workflow.layers.llm_quota.deduct_llm_quota_for_model", autospec=True) as mock_deduct:
        layer.on_node_run_end(node=node, error=None, result_event=result_event)

    mock_deduct.assert_called_once_with(
        tenant_id="tenant-id",
        provider="anthropic",
        model="claude-3-7-sonnet",
        usage=result_event.node_run_result.llm_usage,
    )


def test_non_llm_node_is_ignored() -> None:
    layer = LLMQuotaLayer(tenant_id="tenant-id")
    node = _build_node(node_type=BuiltinNodeTypes.START)
    result_event = _build_succeeded_event()

    with patch("core.app.workflow.layers.llm_quota.deduct_llm_quota_for_model", autospec=True) as mock_deduct:
        layer.on_node_run_end(node=node, error=None, result_event=result_event)

    mock_deduct.assert_not_called()


def test_precheck_ignores_non_quota_node() -> None:
    layer = LLMQuotaLayer(tenant_id="tenant-id")
    node = _build_node(node_type=BuiltinNodeTypes.START)

    with patch("core.app.workflow.layers.llm_quota.ensure_llm_quota_available_for_model", autospec=True) as mock_check:
        layer.on_node_run_start(node)

    mock_check.assert_not_called()


def test_quota_error_is_handled_in_layer(caplog) -> None:
    layer = LLMQuotaLayer(tenant_id="tenant-id")
    stop_event = threading.Event()
    layer.command_channel = MagicMock()

    node = _build_node(node_type=BuiltinNodeTypes.LLM)
    node.graph_runtime_state = MagicMock()
    node.graph_runtime_state.stop_event = stop_event
    result_event = _build_succeeded_event()

    with (
        caplog.at_level(logging.ERROR, logger="core.app.workflow.layers.llm_quota"),
        patch(
            "core.app.workflow.layers.llm_quota.deduct_llm_quota_for_model",
            autospec=True,
            side_effect=ValueError("quota exceeded"),
        ) as mock_deduct,
    ):
        layer.on_node_run_end(node=node, error=None, result_event=result_event)

    mock_deduct.assert_called_once_with(
        tenant_id="tenant-id",
        provider="openai",
        model="gpt-4o",
        usage=result_event.node_run_result.llm_usage,
    )
    assert "LLM quota deduction failed, node_id=node-id" in caplog.text
    assert not stop_event.is_set()
    layer.command_channel.send_command.assert_not_called()


def test_send_abort_command_is_noop_without_channel_or_after_abort() -> None:
    layer = LLMQuotaLayer(tenant_id="tenant-id")

    layer._send_abort_command(reason="no channel")

    layer.command_channel = MagicMock()
    layer._abort_sent = True
    layer._send_abort_command(reason="already aborted")

    layer.command_channel.send_command.assert_not_called()


def test_quota_deduction_exceeded_aborts_workflow_immediately() -> None:
    layer = LLMQuotaLayer(tenant_id="tenant-id")
    stop_event = threading.Event()
    layer.command_channel = MagicMock()

    node = _build_node(node_type=BuiltinNodeTypes.LLM)
    node.graph_runtime_state = MagicMock()
    node.graph_runtime_state.stop_event = stop_event

    result_event = _build_succeeded_event()
    with patch(
        "core.app.workflow.layers.llm_quota.deduct_llm_quota_for_model",
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
    layer = LLMQuotaLayer(tenant_id="tenant-id")
    stop_event = threading.Event()
    layer.command_channel = MagicMock()

    node = _build_node(node_type=BuiltinNodeTypes.LLM)
    node.graph_runtime_state = MagicMock()
    node.graph_runtime_state.stop_event = stop_event

    with patch(
        "core.app.workflow.layers.llm_quota.ensure_llm_quota_available_for_model",
        autospec=True,
        side_effect=QuotaExceededError("Model provider openai quota exceeded."),
    ):
        layer.on_node_run_start(node)

    assert stop_event.is_set()
    layer.command_channel.send_command.assert_called_once()
    abort_command = layer.command_channel.send_command.call_args.args[0]
    assert abort_command.command_type == CommandType.ABORT
    assert abort_command.reason == "Model provider openai quota exceeded."


def test_quota_precheck_failure_blocks_current_node_run() -> None:
    layer = LLMQuotaLayer(tenant_id="tenant-id")
    stop_event = threading.Event()
    layer.command_channel = MagicMock()

    node = _RunnableQuotaNode(stop_event=stop_event)

    with patch(
        "core.app.workflow.layers.llm_quota.ensure_llm_quota_available_for_model",
        autospec=True,
        side_effect=QuotaExceededError("Model provider openai quota exceeded."),
    ):
        layer.on_node_run_start(node)

    result = node._run()
    assert not node.original_run_called
    assert result.status == WorkflowNodeExecutionStatus.FAILED
    assert result.error == "Model provider openai quota exceeded."
    assert result.error_type == QuotaExceededError.__name__


def test_missing_model_identity_blocks_current_node_run() -> None:
    layer = LLMQuotaLayer(tenant_id="tenant-id")
    stop_event = threading.Event()
    layer.command_channel = MagicMock()

    node = _RunnableQuotaNode(stop_event=stop_event, node_data=_build_node_data())

    with patch("core.app.workflow.layers.llm_quota.ensure_llm_quota_available_for_model", autospec=True) as mock_check:
        layer.on_node_run_start(node)

    result = node._run()
    assert not node.original_run_called
    assert result.status == WorkflowNodeExecutionStatus.FAILED
    assert result.error == "LLM quota check requires public node model identity before execution."
    assert result.error_type == "LLMQuotaIdentityError"
    mock_check.assert_not_called()


def test_quota_precheck_passes_without_abort() -> None:
    layer = LLMQuotaLayer(tenant_id="tenant-id")
    stop_event = threading.Event()
    layer.command_channel = MagicMock()

    node = _build_node(node_type=BuiltinNodeTypes.LLM)
    node.graph_runtime_state = MagicMock()
    node.graph_runtime_state.stop_event = stop_event

    with patch("core.app.workflow.layers.llm_quota.ensure_llm_quota_available_for_model", autospec=True) as mock_check:
        layer.on_node_run_start(node)

    assert not stop_event.is_set()
    mock_check.assert_called_once_with(
        tenant_id="tenant-id",
        provider="openai",
        model="gpt-4o",
    )
    layer.command_channel.send_command.assert_not_called()


def test_precheck_reads_model_identity_from_data_when_node_data_is_absent() -> None:
    layer = LLMQuotaLayer(tenant_id="tenant-id")
    node = SimpleNamespace(
        id="node-id",
        node_type=BuiltinNodeTypes.LLM,
        data=_build_node_data(model=_build_public_model_identity(provider="anthropic", model_name="claude")),
    )

    with patch("core.app.workflow.layers.llm_quota.ensure_llm_quota_available_for_model", autospec=True) as mock_check:
        layer.on_node_run_start(node)

    mock_check.assert_called_once_with(
        tenant_id="tenant-id",
        provider="anthropic",
        model="claude",
    )


def test_precheck_rejects_invalid_public_model_identity() -> None:
    layer = LLMQuotaLayer(tenant_id="tenant-id")
    stop_event = threading.Event()
    layer.command_channel = MagicMock()

    node = _build_node(node_type=BuiltinNodeTypes.LLM)
    node.node_data = _build_node_data(model=_build_public_model_identity(provider="", model_name="gpt-4o"))
    node.graph_runtime_state = MagicMock()
    node.graph_runtime_state.stop_event = stop_event

    with patch("core.app.workflow.layers.llm_quota.ensure_llm_quota_available_for_model", autospec=True) as mock_check:
        layer.on_node_run_start(node)

    assert stop_event.is_set()
    mock_check.assert_not_called()
    layer.command_channel.send_command.assert_called_once()


def test_precheck_requires_public_node_model_config() -> None:
    layer = LLMQuotaLayer(tenant_id="tenant-id")
    stop_event = threading.Event()
    layer.command_channel = MagicMock()

    node = _build_node(node_type=BuiltinNodeTypes.LLM)
    node.node_data = _build_node_data()
    node.graph_runtime_state = MagicMock()
    node.graph_runtime_state.stop_event = stop_event

    with patch("core.app.workflow.layers.llm_quota.ensure_llm_quota_available_for_model", autospec=True) as mock_check:
        layer.on_node_run_start(node)

    assert stop_event.is_set()
    mock_check.assert_not_called()
    layer.command_channel.send_command.assert_called_once()
    abort_command = layer.command_channel.send_command.call_args.args[0]
    assert abort_command.command_type == CommandType.ABORT
    assert abort_command.reason == "LLM quota check requires public node model identity before execution."


def test_deduction_requires_public_event_model_identity() -> None:
    layer = LLMQuotaLayer(tenant_id="tenant-id")
    stop_event = threading.Event()
    layer.command_channel = MagicMock()

    node = _build_node(node_type=BuiltinNodeTypes.LLM)
    node.graph_runtime_state = MagicMock()
    node.graph_runtime_state.stop_event = stop_event
    result_event = _build_succeeded_event()
    result_event.node_run_result.inputs = {"question": "hello"}

    with patch("core.app.workflow.layers.llm_quota.deduct_llm_quota_for_model", autospec=True) as mock_deduct:
        layer.on_node_run_end(node=node, error=None, result_event=result_event)

    assert stop_event.is_set()
    mock_deduct.assert_not_called()
    layer.command_channel.send_command.assert_called_once()
    abort_command = layer.command_channel.send_command.call_args.args[0]
    assert abort_command.command_type == CommandType.ABORT
    assert abort_command.reason == "LLM quota deduction requires model identity in the node result event."
