from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import MagicMock

from core.workflow.enums import ErrorStrategy, NodeType, WorkflowNodeExecutionStatus
from core.workflow.graph_engine.error_handler import ErrorHandler
from core.workflow.graph_events import NodeRunExceptionEvent, NodeRunFailedEvent, NodeRunRetryEvent
from core.workflow.node_events import NodeRunResult


def _failed_event() -> NodeRunFailedEvent:
    return NodeRunFailedEvent(
        id="exec-1",
        node_id="node-1",
        node_type=NodeType.CODE,
        start_at=datetime.now(UTC),
        error="node failed",
        node_run_result=NodeRunResult(
            inputs={"x": 1},
            process_data={"trace": "yes"},
            error="details",
            error_type="ValueError",
        ),
    )


def _build_handler(node: SimpleNamespace, retry_count: int = 0) -> ErrorHandler:
    graph = SimpleNamespace(nodes={"node-1": node})
    graph_execution = MagicMock()
    graph_execution.get_or_create_node_execution.return_value = SimpleNamespace(retry_count=retry_count)
    return ErrorHandler(graph=graph, graph_execution=graph_execution)


def test_handle_node_failure_returns_retry_event_when_retries_available(monkeypatch) -> None:
    node = SimpleNamespace(
        retry=True,
        retry_config=SimpleNamespace(max_retries=2, retry_interval_seconds=0),
        error_strategy=None,
        default_value_dict={},
        title="Node 1",
    )
    handler = _build_handler(node, retry_count=0)
    monkeypatch.setattr("core.workflow.graph_engine.error_handler.time.sleep", lambda _: None)

    result = handler.handle_node_failure(_failed_event())

    assert isinstance(result, NodeRunRetryEvent)
    assert result.retry_index == 1


def test_handle_node_failure_aborts_when_no_strategy() -> None:
    node = SimpleNamespace(
        retry=False,
        retry_config=SimpleNamespace(max_retries=0, retry_interval_seconds=0),
        error_strategy=None,
        default_value_dict={},
        title="Node 1",
    )
    handler = _build_handler(node, retry_count=0)

    assert handler.handle_node_failure(_failed_event()) is None


def test_handle_node_failure_uses_fail_branch_strategy() -> None:
    node = SimpleNamespace(
        retry=False,
        retry_config=SimpleNamespace(max_retries=0, retry_interval_seconds=0),
        error_strategy=ErrorStrategy.FAIL_BRANCH,
        default_value_dict={},
        title="Node 1",
    )
    handler = _build_handler(node, retry_count=0)

    result = handler.handle_node_failure(_failed_event())

    assert isinstance(result, NodeRunExceptionEvent)
    assert result.node_run_result.status == WorkflowNodeExecutionStatus.EXCEPTION
    assert result.node_run_result.outputs["error_message"] == "details"
    assert result.node_run_result.edge_source_handle == "fail-branch"


def test_handle_node_failure_uses_default_value_strategy() -> None:
    node = SimpleNamespace(
        retry=False,
        retry_config=SimpleNamespace(max_retries=0, retry_interval_seconds=0),
        error_strategy=ErrorStrategy.DEFAULT_VALUE,
        default_value_dict={"fallback": 42},
        title="Node 1",
    )
    handler = _build_handler(node, retry_count=0)

    result = handler.handle_node_failure(_failed_event())

    assert isinstance(result, NodeRunExceptionEvent)
    assert result.node_run_result.status == WorkflowNodeExecutionStatus.EXCEPTION
    assert result.node_run_result.outputs["fallback"] == 42
    assert result.node_run_result.outputs["error_type"] == "ValueError"


def test_handle_retry_returns_none_when_retry_is_disabled_or_exhausted() -> None:
    event = _failed_event()

    no_retry_node = SimpleNamespace(
        retry=False,
        retry_config=SimpleNamespace(max_retries=0, retry_interval_seconds=0),
        error_strategy=None,
        default_value_dict={},
        title="Node 1",
    )
    exhausted_retry_node = SimpleNamespace(
        retry=True,
        retry_config=SimpleNamespace(max_retries=1, retry_interval_seconds=0),
        error_strategy=None,
        default_value_dict={},
        title="Node 1",
    )
    no_retry_handler = _build_handler(no_retry_node, retry_count=0)
    exhausted_handler = _build_handler(exhausted_retry_node, retry_count=1)

    assert no_retry_handler._handle_retry(event, retry_count=0) is None
    assert exhausted_handler._handle_retry(event, retry_count=1) is None
