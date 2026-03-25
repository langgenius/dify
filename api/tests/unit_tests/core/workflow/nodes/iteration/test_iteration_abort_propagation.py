from threading import Event
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from graphon.enums import WorkflowNodeExecutionStatus
from graphon.graph_events import GraphRunAbortedEvent
from graphon.model_runtime.entities.llm_entities import LLMUsage
from graphon.node_events import IterationFailedEvent, IterationStartedEvent, StreamCompletedEvent
from graphon.nodes.iteration.entities import ErrorHandleMode, IterationNodeData
from graphon.nodes.iteration.exc import ChildGraphAbortedError
from graphon.nodes.iteration.iteration_node import IterationNode
from tests.workflow_test_utils import build_test_variable_pool


def _usage_with_tokens(total_tokens: int) -> LLMUsage:
    usage = LLMUsage.empty_usage()
    usage.total_tokens = total_tokens
    return usage


class _AbortOnRequestGraphEngine:
    def __init__(self, *, index: int, total_tokens: int) -> None:
        variable_pool = build_test_variable_pool()
        variable_pool.add(["iteration-node", "index"], index)

        self.started = Event()
        self.abort_requested = Event()
        self.finished = Event()
        self.abort_reason: str | None = None
        self.graph_runtime_state = SimpleNamespace(
            variable_pool=variable_pool,
            llm_usage=_usage_with_tokens(total_tokens),
        )

    def request_abort(self, reason: str | None = None) -> None:
        self.abort_reason = reason
        self.abort_requested.set()

    def run(self):
        self.started.set()
        assert self.abort_requested.wait(1), "parallel sibling never received an abort request"
        self.finished.set()
        yield GraphRunAbortedEvent(reason=self.abort_reason)


def _build_immediate_abort_graph_engine(
    *,
    index: int,
    total_tokens: int,
    wait_before_abort: Event | None = None,
) -> SimpleNamespace:
    variable_pool = build_test_variable_pool()
    variable_pool.add(["iteration-node", "index"], index)

    started = Event()
    finished = Event()

    def run():
        started.set()
        if wait_before_abort is not None:
            assert wait_before_abort.wait(1), "parallel sibling never started"
        finished.set()
        yield GraphRunAbortedEvent(reason="quota exceeded")

    return SimpleNamespace(
        graph_runtime_state=SimpleNamespace(
            variable_pool=variable_pool,
            llm_usage=_usage_with_tokens(total_tokens),
        ),
        run=run,
        request_abort=lambda reason=None: None,
        started=started,
        finished=finished,
    )


def _build_iteration_node(
    *,
    error_handle_mode: ErrorHandleMode = ErrorHandleMode.TERMINATED,
    is_parallel: bool = False,
) -> IterationNode:
    node = IterationNode.__new__(IterationNode)
    node._node_id = "iteration-node"
    node._node_data = IterationNodeData(
        title="Iteration",
        iterator_selector=["start", "items"],
        output_selector=["iteration-node", "output"],
        start_node_id="child-start",
        is_parallel=is_parallel,
        parallel_nums=2,
        error_handle_mode=error_handle_mode,
    )

    variable_pool = build_test_variable_pool()
    variable_pool.add(["start", "items"], ["first", "second"])
    node.graph_runtime_state = SimpleNamespace(
        variable_pool=variable_pool,
        llm_usage=LLMUsage.empty_usage(),
    )
    return node


def test_run_single_iter_raises_child_graph_aborted_error_on_abort_event() -> None:
    node = _build_iteration_node()
    variable_pool = build_test_variable_pool()
    variable_pool.add(["iteration-node", "index"], 0)
    graph_engine = SimpleNamespace(
        run=lambda: iter([GraphRunAbortedEvent(reason="quota exceeded")]),
    )

    with pytest.raises(ChildGraphAbortedError, match="quota exceeded"):
        list(
            node._run_single_iter(
                variable_pool=variable_pool,
                outputs=[],
                graph_engine=graph_engine,
            )
        )


def test_iteration_run_fails_on_sequential_child_abort() -> None:
    node = _build_iteration_node(error_handle_mode=ErrorHandleMode.CONTINUE_ON_ERROR)
    graph_engine = SimpleNamespace(
        graph_runtime_state=SimpleNamespace(
            variable_pool=build_test_variable_pool(),
            llm_usage=LLMUsage.empty_usage(),
        )
    )
    node._create_graph_engine = MagicMock(return_value=graph_engine)
    node._run_single_iter = MagicMock(side_effect=ChildGraphAbortedError("quota exceeded"))

    events = list(node._run())

    assert isinstance(events[0], IterationStartedEvent)
    assert isinstance(events[-2], IterationFailedEvent)
    assert events[-2].error == "quota exceeded"
    assert isinstance(events[-1], StreamCompletedEvent)
    assert events[-1].node_run_result.status == WorkflowNodeExecutionStatus.FAILED
    assert events[-1].node_run_result.error == "quota exceeded"
    node._create_graph_engine.assert_called_once()
    node._run_single_iter.assert_called_once()


def test_iteration_run_merges_child_usage_before_failing_on_sequential_child_abort() -> None:
    node = _build_iteration_node(error_handle_mode=ErrorHandleMode.CONTINUE_ON_ERROR)
    graph_engine = SimpleNamespace(
        graph_runtime_state=SimpleNamespace(
            variable_pool=build_test_variable_pool(),
            llm_usage=_usage_with_tokens(7),
        )
    )
    node._create_graph_engine = MagicMock(return_value=graph_engine)
    node._run_single_iter = MagicMock(side_effect=ChildGraphAbortedError("quota exceeded"))

    events = list(node._run())

    assert isinstance(events[-1], StreamCompletedEvent)
    assert events[-1].node_run_result.llm_usage.total_tokens == 7
    assert node.graph_runtime_state.llm_usage.total_tokens == 7


@pytest.mark.parametrize(
    "error_handle_mode",
    [
        ErrorHandleMode.CONTINUE_ON_ERROR,
        ErrorHandleMode.REMOVE_ABNORMAL_OUTPUT,
    ],
)
def test_iteration_run_fails_on_parallel_child_abort_regardless_of_error_mode(
    error_handle_mode: ErrorHandleMode,
) -> None:
    node = _build_iteration_node(
        error_handle_mode=error_handle_mode,
        is_parallel=True,
    )
    blocking_engine = _AbortOnRequestGraphEngine(index=1, total_tokens=5)
    aborting_engine = _build_immediate_abort_graph_engine(
        index=0,
        total_tokens=3,
        wait_before_abort=blocking_engine.started,
    )
    node._create_graph_engine = MagicMock(
        side_effect=lambda index, item: {0: aborting_engine, 1: blocking_engine}[index]
    )

    events = list(node._run())

    assert isinstance(events[0], IterationStartedEvent)
    assert isinstance(events[-2], IterationFailedEvent)
    assert events[-2].error == "quota exceeded"
    assert isinstance(events[-1], StreamCompletedEvent)
    assert events[-1].node_run_result.status == WorkflowNodeExecutionStatus.FAILED
    assert events[-1].node_run_result.error == "quota exceeded"
    assert events[-1].node_run_result.llm_usage.total_tokens == 8
    assert node.graph_runtime_state.llm_usage.total_tokens == 8
    assert blocking_engine.started.is_set()
    assert blocking_engine.abort_requested.is_set()
    assert blocking_engine.finished.is_set()
    assert blocking_engine.abort_reason == "quota exceeded"
