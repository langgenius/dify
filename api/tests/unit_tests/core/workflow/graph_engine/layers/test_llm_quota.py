from datetime import datetime
from unittest.mock import MagicMock, patch

from core.app.workflow.layers.llm_quota import LLMQuotaLayer
from core.model_runtime.entities.llm_entities import LLMUsage
from core.workflow.enums import NodeType, WorkflowNodeExecutionStatus
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
    node._model_instance = object()

    result_event = _build_succeeded_event()
    with patch("core.app.workflow.layers.llm_quota.deduct_llm_quota", autospec=True) as mock_deduct:
        layer.on_node_run_end(node=node, error=None, result_event=result_event)

    mock_deduct.assert_called_once_with(
        tenant_id="tenant-id",
        model_instance=node._model_instance,
        usage=result_event.node_run_result.llm_usage,
    )


def test_deduct_quota_called_for_question_classifier_node() -> None:
    layer = LLMQuotaLayer()
    node = MagicMock()
    node.id = "question-classifier-node-id"
    node.execution_id = "execution-id"
    node.node_type = NodeType.QUESTION_CLASSIFIER
    node.tenant_id = "tenant-id"
    node._model_instance = object()

    result_event = _build_succeeded_event()
    with patch("core.app.workflow.layers.llm_quota.deduct_llm_quota", autospec=True) as mock_deduct:
        layer.on_node_run_end(node=node, error=None, result_event=result_event)

    mock_deduct.assert_called_once_with(
        tenant_id="tenant-id",
        model_instance=node._model_instance,
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
    node._model_instance = object()

    result_event = _build_succeeded_event()
    with patch(
        "core.app.workflow.layers.llm_quota.deduct_llm_quota",
        autospec=True,
        side_effect=ValueError("quota exceeded"),
    ):
        layer.on_node_run_end(node=node, error=None, result_event=result_event)
