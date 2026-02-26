from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from core.model_runtime.entities.llm_entities import LLMUsage
from core.variables import SegmentType
from core.workflow.enums import NodeType, WorkflowNodeExecutionStatus
from core.workflow.graph_events import GraphRunFailedEvent, NodeRunSucceededEvent
from core.workflow.node_events import (
    LoopFailedEvent,
    LoopNextEvent,
    LoopStartedEvent,
    LoopSucceededEvent,
    NodeRunResult,
    StreamCompletedEvent,
)
from core.workflow.nodes.loop.entities import LoopCompletedReason, LoopNodeData, LoopVariableData
from core.workflow.nodes.loop.loop_node import LoopNode
from core.workflow.runtime import GraphRuntimeState, VariablePool
from factories.variable_factory import TypeMismatchError


@pytest.fixture
def loop_node() -> LoopNode:
    node = LoopNode.__new__(LoopNode)
    node._node_id = "loop_1"
    node._node_data = LoopNodeData(
        title="Loop",
        start_node_id="loop_start",
        loop_count=1,
        break_conditions=[],
        logical_operator="and",
        loop_variables=[],
        outputs={},
    )
    node.graph_runtime_state = GraphRuntimeState(variable_pool=VariablePool.empty(), start_at=0.0)
    node.graph_config = {"nodes": []}
    return node


def _usage(tokens: int) -> LLMUsage:
    usage = LLMUsage.empty_usage()
    usage.total_tokens = tokens
    usage.prompt_tokens = tokens
    return usage


def _node_event(node_type: NodeType, metadata: dict | None = None) -> NodeRunSucceededEvent:
    return NodeRunSucceededEvent(
        id="exec",
        node_id="node",
        node_type=node_type,
        start_at=datetime.utcnow(),
        node_run_result=NodeRunResult(metadata=metadata or {}),
    )


def test_loop_node_version():
    assert LoopNode.version() == "1"


def test_get_segment_for_constant_supports_basic_and_array_types():
    text_segment = LoopNode._get_segment_for_constant(SegmentType.STRING, "hello")
    array_segment = LoopNode._get_segment_for_constant(SegmentType.ARRAY_STRING, '["a","b"]')
    fallback_segment = LoopNode._get_segment_for_constant(SegmentType.ARRAY_NUMBER, {"unexpected": True})

    assert text_segment.value == "hello"
    assert array_segment.value == ["a", "b"]
    assert fallback_segment.value == []


def test_get_segment_for_constant_raises_for_unsupported_array_type():
    with pytest.raises(AssertionError, match="unreachable"):
        LoopNode._get_segment_for_constant(SegmentType.ARRAY_ANY, [])


def test_get_segment_for_constant_recovers_from_type_mismatch_with_json_string():
    expected_segment = MagicMock()

    with patch(
        "core.workflow.nodes.loop.loop_node.build_segment_with_type",
        side_effect=[TypeMismatchError(), expected_segment],
    ):
        result = LoopNode._get_segment_for_constant(SegmentType.ARRAY_NUMBER, "[1,2]")

    assert result is expected_segment


def test_get_segment_for_constant_re_raises_type_mismatch_for_non_string_values():
    with patch("core.workflow.nodes.loop.loop_node.build_segment_with_type", side_effect=TypeMismatchError()):
        with pytest.raises(TypeMismatchError):
            LoopNode._get_segment_for_constant(SegmentType.NUMBER, 1)


def test_extract_loop_node_ids_from_config():
    graph_config = {
        "nodes": [
            {"id": "a", "data": {"loop_id": "loop_1"}},
            {"id": "b", "data": {"loop_id": "loop_1"}},
            {"id": "c", "data": {"loop_id": "other"}},
        ]
    }

    loop_node_ids = LoopNode._extract_loop_node_ids_from_config(graph_config, "loop_1")

    assert loop_node_ids == {"a", "b"}


def test_clear_loop_subgraph_variables_removes_each_node_id(loop_node: LoopNode):
    remove = MagicMock()
    loop_node.graph_runtime_state = SimpleNamespace(variable_pool=SimpleNamespace(remove=remove))

    loop_node._clear_loop_subgraph_variables({"a", "b"})

    remove.assert_any_call(["a"])
    remove.assert_any_call(["b"])
    assert remove.call_count == 2


def test_append_loop_info_to_event_sets_metadata_when_absent(loop_node: LoopNode):
    event = _node_event(NodeType.CODE, metadata={})

    loop_node._append_loop_info_to_event(event=event, loop_run_index=2)

    assert event.in_loop_id == "loop_1"
    assert event.node_run_result.metadata["loop_id"] == "loop_1"
    assert event.node_run_result.metadata["loop_index"] == 2


def test_append_loop_info_to_event_keeps_existing_loop_metadata(loop_node: LoopNode):
    event = _node_event(NodeType.CODE, metadata={"loop_id": "existing", "completed_reason": "done"})

    loop_node._append_loop_info_to_event(event=event, loop_run_index=1)

    assert event.node_run_result.metadata["loop_id"] == "existing"
    assert "loop_index" not in event.node_run_result.metadata


def test_run_single_loop_yields_events_and_sets_outputs(loop_node: LoopNode):
    loop_node._node_data.loop_variables = [
        LoopVariableData(label="counter", var_type=SegmentType.NUMBER, value_type="constant", value=1)
    ]
    loop_node.graph_runtime_state.variable_pool.add(["loop_1", "counter"], 42)

    graph_engine = SimpleNamespace(
        run=lambda: iter(
            [
                _node_event(NodeType.LOOP_START),
                _node_event(NodeType.CODE),
                _node_event(NodeType.LOOP_END),
            ]
        )
    )

    gen = loop_node._run_single_loop(graph_engine=graph_engine, current_index=0)
    yielded = list(gen)

    assert len(yielded) == 2
    assert yielded[0].node_type == NodeType.CODE
    assert yielded[1].node_type == NodeType.LOOP_END
    assert loop_node.node_data.outputs["counter"] == 42
    assert loop_node.node_data.outputs["loop_round"] == 1


def test_run_single_loop_raises_when_subgraph_fails(loop_node: LoopNode):
    graph_engine = SimpleNamespace(run=lambda: iter([GraphRunFailedEvent(error="boom")]))

    with pytest.raises(Exception, match="boom"):
        list(loop_node._run_single_loop(graph_engine=graph_engine, current_index=0))


def test_run_requires_start_node_id(loop_node: LoopNode):
    loop_node.node_data.start_node_id = None

    with pytest.raises(ValueError, match="start_node_id"):
        list(loop_node._run())


def test_run_success_emits_started_succeeded_and_stream_completed(loop_node: LoopNode):
    loop_node._node_data.loop_count = 1
    loop_node._node_data.outputs = {"existing": "ok"}
    loop_node._node_data.loop_variables = [
        LoopVariableData(label="n", var_type=SegmentType.NUMBER, value_type="constant", value=3),
        LoopVariableData(
            label="source_name", var_type=SegmentType.STRING, value_type="variable", value=["src", "name"]
        ),
    ]
    loop_node.graph_runtime_state.variable_pool.add(["src", "name"], "Alice")

    fake_engine = SimpleNamespace(
        graph_runtime_state=SimpleNamespace(outputs={"answer": "hello", "x": 1}, llm_usage=_usage(5))
    )

    def _fake_single_loop(*, graph_engine, current_index):
        if False:
            yield  # pragma: no cover
        return False

    loop_node._extract_loop_node_ids_from_config = MagicMock(return_value=set())
    loop_node._clear_loop_subgraph_variables = MagicMock()
    loop_node._create_graph_engine = MagicMock(return_value=fake_engine)
    loop_node._run_single_loop = _fake_single_loop

    events = list(loop_node._run())

    assert isinstance(events[0], LoopStartedEvent)
    assert isinstance(events[-2], LoopSucceededEvent)
    assert isinstance(events[-1], StreamCompletedEvent)
    assert events[-1].node_run_result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert loop_node.graph_runtime_state.get_output("answer") == "hello"
    assert loop_node.graph_runtime_state.get_output("x") == 1
    assert events[-2].metadata["loop_variable_map"]["0"] == {"n": 3, "source_name": "Alice"}


def test_run_handles_break_conditions_and_completes_without_iterations(loop_node: LoopNode):
    loop_node._node_data.loop_count = 2
    loop_node._node_data.break_conditions = [MagicMock()]

    condition_processor = MagicMock()
    condition_processor.process_conditions.return_value = (None, None, True)

    with patch("core.workflow.nodes.loop.loop_node.ConditionProcessor", return_value=condition_processor):
        events = list(loop_node._run())

    assert isinstance(events[0], LoopStartedEvent)
    assert isinstance(events[1], LoopSucceededEvent)
    assert events[1].steps == 0
    assert events[1].metadata["completed_reason"] == LoopCompletedReason.LOOP_BREAK


def test_run_emits_loop_next_between_iterations_and_concatenates_answers(loop_node: LoopNode):
    loop_node._node_data.loop_count = 2
    engines = [
        SimpleNamespace(graph_runtime_state=SimpleNamespace(outputs={"answer": "a"}, llm_usage=_usage(2))),
        SimpleNamespace(graph_runtime_state=SimpleNamespace(outputs={"answer": "b"}, llm_usage=_usage(3))),
    ]

    def _fake_single_loop(*, graph_engine, current_index):
        if False:
            yield  # pragma: no cover
        return current_index == 1

    loop_node._extract_loop_node_ids_from_config = MagicMock(return_value=set())
    loop_node._clear_loop_subgraph_variables = MagicMock()
    loop_node._create_graph_engine = MagicMock(side_effect=engines)
    loop_node._run_single_loop = _fake_single_loop

    events = list(loop_node._run())

    assert any(isinstance(event, LoopNextEvent) for event in events)
    assert loop_node.graph_runtime_state.get_output("answer") == "ab"
    assert isinstance(events[-1], StreamCompletedEvent)
    assert events[-1].node_run_result.metadata["total_tokens"] == 5


def test_run_failure_path_emits_loop_failed_and_failed_stream(loop_node: LoopNode):
    loop_node._node_data.loop_count = 1
    loop_node._create_graph_engine = MagicMock(side_effect=RuntimeError("create failed"))
    loop_node._extract_loop_node_ids_from_config = MagicMock(return_value=set())
    loop_node._clear_loop_subgraph_variables = MagicMock()

    events = list(loop_node._run())

    assert isinstance(events[0], LoopStartedEvent)
    assert isinstance(events[1], LoopFailedEvent)
    assert isinstance(events[2], StreamCompletedEvent)
    assert events[2].node_run_result.status == WorkflowNodeExecutionStatus.FAILED
    assert "create failed" in events[2].node_run_result.error


def test_extract_variable_selector_to_variable_mapping_filters_loop_internal_selectors(monkeypatch):
    class _DummyCodeNode:
        @classmethod
        def extract_variable_selector_to_variable_mapping(cls, *, graph_config, config):
            _ = (graph_config, config)
            return {"#external#": ["start", "query"], "#loop_inner#": ["loop_1", "temp"], "#from_sub2#": ["sub2", "x"]}

    class _DummyToolNode:
        @classmethod
        def extract_variable_selector_to_variable_mapping(cls, *, graph_config, config):
            _ = (graph_config, config)
            raise NotImplementedError

    monkeypatch.setattr(
        "core.workflow.nodes.node_mapping.NODE_TYPE_CLASSES_MAPPING",
        {
            NodeType.CODE: {"1": _DummyCodeNode},
            NodeType.TOOL: {"1": _DummyToolNode},
        },
    )

    graph_config = {
        "nodes": [
            {"id": "sub1", "data": {"type": "code", "version": "1", "loop_id": "loop_1"}},
            {"id": "sub2", "data": {"type": "tool", "version": "1", "loop_id": "loop_1"}},
            {"id": "outside", "data": {"type": "code", "version": "1"}},
        ]
    }
    node_data = {
        "title": "Loop",
        "loop_count": 1,
        "break_conditions": [],
        "logical_operator": "and",
        "loop_variables": [
            {"label": "v", "var_type": "string", "value_type": "variable", "value": ["conversation", "item"]}
        ],
    }

    mapping = LoopNode._extract_variable_selector_to_variable_mapping(
        graph_config=graph_config,
        node_id="loop_1",
        node_data=node_data,
    )

    assert mapping["sub1.#external#"] == ["start", "query"]
    assert mapping["loop_1.v"] == ["conversation", "item"]
    assert "sub1.#loop_inner#" not in mapping
    assert "sub1.#from_sub2#" not in mapping


def test_create_graph_engine_builds_subgraph_with_runtime_copy(loop_node: LoopNode):
    loop_node.tenant_id = "tenant"
    loop_node.app_id = "app"
    loop_node.workflow_id = "workflow"
    loop_node.graph_config = {"nodes": []}
    loop_node.user_id = "user"
    loop_node.user_from = SimpleNamespace(value="account")
    loop_node.invoke_from = SimpleNamespace(value="debugger")
    loop_node.workflow_call_depth = 0

    fake_graph_init_params = object()
    fake_runtime_state = object()
    fake_node_factory = object()
    fake_graph = object()
    fake_channel = object()
    fake_config = object()
    fake_engine = object()

    with (
        patch("core.workflow.entities.GraphInitParams", return_value=fake_graph_init_params) as graph_init_params_cls,
        patch("core.workflow.runtime.GraphRuntimeState", return_value=fake_runtime_state) as runtime_state_cls,
        patch("core.app.workflow.node_factory.DifyNodeFactory", return_value=fake_node_factory) as node_factory_cls,
        patch("core.workflow.graph.Graph.init", return_value=fake_graph) as graph_init_fn,
        patch("core.workflow.graph_engine.command_channels.InMemoryChannel", return_value=fake_channel) as channel_cls,
        patch("core.workflow.graph_engine.GraphEngineConfig", return_value=fake_config) as engine_config_cls,
        patch("core.workflow.graph_engine.GraphEngine", return_value=fake_engine) as graph_engine_cls,
    ):
        result = loop_node._create_graph_engine(start_at=datetime(2025, 1, 1, 0, 0, 0), root_node_id="loop_start")

    assert result is fake_engine
    graph_init_params_cls.assert_called_once()
    runtime_state_cls.assert_called_once()
    node_factory_cls.assert_called_once_with(
        graph_init_params=fake_graph_init_params, graph_runtime_state=fake_runtime_state
    )
    graph_init_fn.assert_called_once_with(
        graph_config=loop_node.graph_config, node_factory=fake_node_factory, root_node_id="loop_start"
    )
    channel_cls.assert_called_once()
    engine_config_cls.assert_called_once()
    graph_engine_cls.assert_called_once()
