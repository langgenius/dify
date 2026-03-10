import queue
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import MagicMock

from dify_graph.enums import NodeType, WorkflowNodeExecutionStatus
from dify_graph.graph_engine.ready_queue import InMemoryReadyQueue
from dify_graph.graph_engine.worker import Worker


def test_build_fallback_failure_event_uses_naive_utc_and_failed_node_run_result(mocker) -> None:
    fixed_time = datetime(2024, 1, 1, 12, 0, 0, tzinfo=UTC).replace(tzinfo=None)
    mocker.patch("dify_graph.graph_engine.worker.naive_utc_now", return_value=fixed_time)

    worker = Worker(
        ready_queue=InMemoryReadyQueue(),
        event_queue=queue.Queue(),
        graph=MagicMock(),
        layers=[],
    )
    node = SimpleNamespace(
        execution_id="exec-1",
        id="node-1",
        node_type=NodeType.LLM,
    )

    event = worker._build_fallback_failure_event(node, RuntimeError("boom"))

    assert event.start_at == fixed_time
    assert event.finished_at == fixed_time
    assert event.error == "boom"
    assert event.node_run_result.status == WorkflowNodeExecutionStatus.FAILED
    assert event.node_run_result.error == "boom"
    assert event.node_run_result.error_type == "RuntimeError"
