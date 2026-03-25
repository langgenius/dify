from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from dify_graph.entities.graph_config import NodeConfigDictAdapter
from dify_graph.enums import WorkflowNodeExecutionStatus
from dify_graph.graph_events import GraphRunAbortedEvent
from dify_graph.model_runtime.entities.llm_entities import LLMUsage
from dify_graph.node_events import LoopFailedEvent, LoopStartedEvent, StreamCompletedEvent
from dify_graph.nodes.loop.entities import LoopNodeData
from dify_graph.nodes.loop.loop_node import LoopNode
from tests.workflow_test_utils import build_test_variable_pool


def _usage_with_tokens(total_tokens: int) -> LLMUsage:
    usage = LLMUsage.empty_usage()
    usage.total_tokens = total_tokens
    return usage


def test_extract_variable_selector_to_variable_mapping_validates_child_node_configs(monkeypatch) -> None:
    seen_configs: list[object] = []
    original_validate_python = NodeConfigDictAdapter.validate_python

    def record_validate_python(value: object):
        seen_configs.append(value)
        return original_validate_python(value)

    monkeypatch.setattr(NodeConfigDictAdapter, "validate_python", record_validate_python)

    child_node_config = {
        "id": "answer-node",
        "data": {
            "type": "answer",
            "title": "Answer",
            "answer": "",
            "loop_id": "loop-node",
        },
    }

    LoopNode._extract_variable_selector_to_variable_mapping(
        graph_config={
            "nodes": [
                {
                    "id": "loop-node",
                    "data": {
                        "type": "loop",
                        "title": "Loop",
                        "loop_count": 1,
                        "break_conditions": [],
                        "logical_operator": "and",
                    },
                },
                child_node_config,
            ],
            "edges": [],
        },
        node_id="loop-node",
        node_data=LoopNodeData(
            title="Loop",
            loop_count=1,
            break_conditions=[],
            logical_operator="and",
        ),
    )

    assert seen_configs == [child_node_config]


def test_run_single_loop_raises_on_child_abort_event() -> None:
    node = LoopNode.__new__(LoopNode)
    node._node_id = "loop-node"
    node._node_data = LoopNodeData(
        title="Loop",
        loop_count=1,
        break_conditions=[],
        logical_operator="and",
        start_node_id="child-start",
    )

    graph_engine = SimpleNamespace(
        run=lambda: iter([GraphRunAbortedEvent(reason="quota exceeded")]),
    )

    with pytest.raises(RuntimeError, match="quota exceeded"):
        list(node._run_single_loop(graph_engine=graph_engine, current_index=0))


def test_loop_run_fails_on_child_abort_and_stops_subsequent_rounds() -> None:
    node = LoopNode.__new__(LoopNode)
    node._node_id = "loop-node"
    node._node_data = LoopNodeData(
        title="Loop",
        loop_count=2,
        break_conditions=[],
        logical_operator="and",
        start_node_id="child-start",
    )
    node.graph_config = {"nodes": [], "edges": []}
    node.graph_runtime_state = SimpleNamespace(
        variable_pool=build_test_variable_pool(),
        llm_usage=LLMUsage.empty_usage(),
    )

    aborting_engine = SimpleNamespace(
        graph_runtime_state=SimpleNamespace(outputs={}, llm_usage=LLMUsage.empty_usage()),
    )
    create_graph_engine = MagicMock(return_value=aborting_engine)
    node._create_graph_engine = create_graph_engine
    node._run_single_loop = lambda *, graph_engine, current_index: (_ for _ in ()).throw(RuntimeError("quota exceeded"))

    events = list(node._run())

    assert isinstance(events[0], LoopStartedEvent)
    assert isinstance(events[1], LoopFailedEvent)
    assert events[1].error == "quota exceeded"
    assert isinstance(events[2], StreamCompletedEvent)
    assert events[2].node_run_result.status == WorkflowNodeExecutionStatus.FAILED
    assert events[2].node_run_result.error == "quota exceeded"
    create_graph_engine.assert_called_once()


def test_loop_run_merges_child_usage_before_failing_on_child_abort() -> None:
    node = LoopNode.__new__(LoopNode)
    node._node_id = "loop-node"
    node._node_data = LoopNodeData(
        title="Loop",
        loop_count=1,
        break_conditions=[],
        logical_operator="and",
        start_node_id="child-start",
    )
    node.graph_config = {"nodes": [], "edges": []}
    node.graph_runtime_state = SimpleNamespace(
        variable_pool=build_test_variable_pool(),
        llm_usage=LLMUsage.empty_usage(),
    )

    aborting_engine = SimpleNamespace(
        graph_runtime_state=SimpleNamespace(outputs={}, llm_usage=_usage_with_tokens(7)),
    )
    node._create_graph_engine = MagicMock(return_value=aborting_engine)
    node._run_single_loop = lambda *, graph_engine, current_index: (_ for _ in ()).throw(RuntimeError("quota exceeded"))

    events = list(node._run())

    assert isinstance(events[-1], StreamCompletedEvent)
    assert events[-1].node_run_result.llm_usage.total_tokens == 7
    assert node.graph_runtime_state.llm_usage.total_tokens == 7
