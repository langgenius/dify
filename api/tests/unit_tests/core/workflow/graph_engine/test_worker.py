import queue
from collections.abc import Generator
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from dify_graph.enums import BuiltinNodeTypes, WorkflowNodeExecutionStatus
from dify_graph.graph_engine.ready_queue import InMemoryReadyQueue
from dify_graph.graph_engine.worker import Worker
from dify_graph.graph_events import NodeRunFailedEvent, NodeRunStartedEvent


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
        node_type=BuiltinNodeTypes.LLM,
    )

    event = worker._build_fallback_failure_event(node, RuntimeError("boom"))

    assert event.start_at == fixed_time
    assert event.finished_at == fixed_time
    assert event.error == "boom"
    assert event.node_run_result.status == WorkflowNodeExecutionStatus.FAILED
    assert event.node_run_result.error == "boom"
    assert event.node_run_result.error_type == "RuntimeError"


def test_worker_fallback_failure_event_reuses_observed_start_time() -> None:
    start_at = datetime(2024, 1, 1, 12, 0, 0, tzinfo=UTC).replace(tzinfo=None)
    failure_time = start_at + timedelta(seconds=5)
    captured_events: list[NodeRunFailedEvent | NodeRunStartedEvent] = []

    class FakeNode:
        execution_id = "exec-1"
        id = "node-1"
        node_type = BuiltinNodeTypes.LLM

        def ensure_execution_id(self) -> str:
            return self.execution_id

        def run(self) -> Generator[NodeRunStartedEvent, None, None]:
            yield NodeRunStartedEvent(
                id=self.execution_id,
                node_id=self.id,
                node_type=self.node_type,
                node_title="LLM",
                start_at=start_at,
            )

    worker = Worker(
        ready_queue=MagicMock(),
        event_queue=MagicMock(),
        graph=MagicMock(nodes={"node-1": FakeNode()}),
        layers=[],
    )

    worker._ready_queue.get.side_effect = ["node-1"]

    def put_side_effect(event: NodeRunFailedEvent | NodeRunStartedEvent) -> None:
        captured_events.append(event)
        if len(captured_events) == 1:
            raise RuntimeError("queue boom")
        worker.stop()

    worker._event_queue.put.side_effect = put_side_effect

    with patch("dify_graph.graph_engine.worker.naive_utc_now", return_value=failure_time):
        worker.run()

    fallback_event = captured_events[-1]

    assert isinstance(fallback_event, NodeRunFailedEvent)
    assert fallback_event.start_at == start_at
    assert fallback_event.finished_at == failure_time
    assert fallback_event.error == "queue boom"
    assert fallback_event.node_run_result.status == WorkflowNodeExecutionStatus.FAILED


def test_worker_fallback_failure_event_ignores_nested_iteration_child_start_times() -> None:
    parent_start = datetime(2024, 1, 1, 12, 0, 0, tzinfo=UTC).replace(tzinfo=None)
    child_start = parent_start + timedelta(seconds=3)
    failure_time = parent_start + timedelta(seconds=5)
    captured_events: list[NodeRunFailedEvent | NodeRunStartedEvent] = []

    class FakeIterationNode:
        execution_id = "iteration-exec"
        id = "iteration-node"
        node_type = BuiltinNodeTypes.ITERATION

        def ensure_execution_id(self) -> str:
            return self.execution_id

        def run(self) -> Generator[NodeRunStartedEvent, None, None]:
            yield NodeRunStartedEvent(
                id=self.execution_id,
                node_id=self.id,
                node_type=self.node_type,
                node_title="Iteration",
                start_at=parent_start,
            )
            yield NodeRunStartedEvent(
                id="child-exec",
                node_id="child-node",
                node_type=BuiltinNodeTypes.LLM,
                node_title="LLM",
                start_at=child_start,
                in_iteration_id=self.id,
            )

    worker = Worker(
        ready_queue=MagicMock(),
        event_queue=MagicMock(),
        graph=MagicMock(nodes={"iteration-node": FakeIterationNode()}),
        layers=[],
    )

    worker._ready_queue.get.side_effect = ["iteration-node"]

    def put_side_effect(event: NodeRunFailedEvent | NodeRunStartedEvent) -> None:
        captured_events.append(event)
        if len(captured_events) == 2:
            raise RuntimeError("queue boom")
        worker.stop()

    worker._event_queue.put.side_effect = put_side_effect

    with patch("dify_graph.graph_engine.worker.naive_utc_now", return_value=failure_time):
        worker.run()

    fallback_event = captured_events[-1]

    assert isinstance(fallback_event, NodeRunFailedEvent)
    assert fallback_event.start_at == parent_start
    assert fallback_event.finished_at == failure_time
