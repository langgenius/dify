from copy import deepcopy
from datetime import UTC, datetime
from typing import override

from core.workflow.iteration_container_handler import DifyIterationContainerHandler, _write_back_conversation_variable
from core.workflow.workflow_entry import WorkflowEntry
from graphon.engine.frame import FrameRegistry
from graphon.engine.layer import Layer
from graphon.engine_events import EngineEvent, GraphRunSucceededEvent, NodeRunVariableUpdatedEvent
from graphon.engine_events.node import NodeRunFailedEvent
from graphon.enums import BuiltinNodeTypes, ErrorHandleMode, WorkflowNodeExecutionStatus
from graphon.nodes.container_effects import ContainerNodeRunResult
from graphon.runtime import RuntimeState, VariablePool
from graphon.runtime.container_state import IterationFrameState, IterationRunState
from graphon.runtime.execution import ROOT_FRAME_ID
from graphon.variables.variables import StringVariable
from tests.helpers.workflow.mock_config import MockConfigBuilder
from tests.helpers.workflow.table_runner import WorkflowRunner

_QUERY = "ensure conversation variable syncs"


class _WriteParentOnConversationUpdate(Layer):
    """Model a parent-side update that happens after the iteration pool was copied."""

    def __init__(self, runtime_state: RuntimeState) -> None:
        super().__init__()
        self._parent_runtime_state = runtime_state

    @override
    def on_event(self, event: EngineEvent) -> None:
        if isinstance(event, NodeRunVariableUpdatedEvent) and tuple(event.variable.selector) == (
            "conversation",
            "answer",
        ):
            self._parent_runtime_state.variable_pool.add(("conversation", "other"), "fresh")


def _run_iteration_fixture(
    *, update_parent: bool = False, append: bool = False
) -> tuple[list[EngineEvent], RuntimeState]:
    runner = WorkflowRunner()
    fixture = deepcopy(runner.load_fixture("update-conversation-variable-in-iteration"))
    if append:
        fixture["workflow"]["conversation_variables"][0].update({"value_type": "array[string]", "value": []})
        nodes = {node["id"]: node for node in fixture["workflow"]["graph"]["nodes"]}
        nodes["1759032379989"]["data"]["iterator_input_type"] = "array[string]"
        nodes["1759032363865"]["data"]["outputs"]["result"]["type"] = "array[string]"
        nodes["1759032394460"]["data"]["items"][0].update(
            {
                "operation": "append",
                "write_mode": "append",
                "value": ["1759032379989", "item"],
            }
        )
    mock_config = (
        MockConfigBuilder()
        .with_node_output("1759032363865", {"result": ["a", "b", "c"] if append else [1]})
        .with_node_output("1759032476318", {"result": ""})
        .build()
    )
    graph, runtime_state = runner.create_graph_from_fixture(
        fixture_data=fixture,
        query=_QUERY,
        use_mock_factory=True,
        mock_config=mock_config,
    )
    runtime_state.variable_pool.add(("conversation", "other"), "stale")
    entry = WorkflowEntry(
        graph_config=fixture["workflow"]["graph"],
        graph=graph,
        call_depth=0,
        graph_runtime_state=runtime_state,
    )
    if update_parent:
        entry.graph_engine.add_layer(_WriteParentOnConversationUpdate(runtime_state))
    return list(entry.run()), runtime_state


def test_iteration_writes_conversation_variable_to_parent_pool() -> None:
    events, runtime_state = _run_iteration_fixture()

    success = next(event for event in events if isinstance(event, GraphRunSucceededEvent))
    assert success.outputs["answer"] == _QUERY
    answer = runtime_state.variable_pool.get(["conversation", "answer"])
    assert answer is not None
    assert answer.to_object() == _QUERY


def test_iteration_write_back_does_not_restore_unrelated_parent_values() -> None:
    events, runtime_state = _run_iteration_fixture(update_parent=True)

    success = next(event for event in events if isinstance(event, GraphRunSucceededEvent))
    assert success.outputs["answer"] == _QUERY
    other = runtime_state.variable_pool.get(["conversation", "other"])
    assert other is not None
    assert other.to_object() == "fresh"


def test_serial_iterations_accumulate_conversation_appends() -> None:
    events, runtime_state = _run_iteration_fixture(append=True)

    assert any(isinstance(event, GraphRunSucceededEvent) for event in events)
    answer = runtime_state.variable_pool.get(["conversation", "answer"])
    assert answer is not None
    assert answer.to_object() == ["a", "b", "c"]


def test_non_conversation_update_stays_in_iteration_scope() -> None:
    selector = ("node", "result")
    current = StringVariable(selector=selector, name="result", value="new")
    previous = StringVariable(selector=selector, name="result", value="old")
    frame_pool = VariablePool()
    parent_pool = VariablePool()
    frame_pool.add(selector, current)
    parent_pool.add(selector, previous)

    _write_back_conversation_variable(frame_pool=frame_pool, parent_pool=parent_pool, variable=current)

    assert parent_pool.get_variable(selector) is previous


def test_write_back_does_not_create_an_undeclared_parent_variable() -> None:
    selector = ("conversation", "answer")
    current = StringVariable(selector=selector, name="answer", value="new")
    frame_pool = VariablePool()
    parent_pool = VariablePool()
    frame_pool.add(selector, current)

    _write_back_conversation_variable(frame_pool=frame_pool, parent_pool=parent_pool, variable=current)

    assert parent_pool.get_variable(selector) is None


def test_write_back_does_not_forward_a_stale_inner_copy() -> None:
    selector = ("conversation", "answer")
    inner_old = StringVariable(selector=selector, name="answer", value="inner-old")
    parent_old = StringVariable(selector=selector, name="answer", value="parent-old")
    update = StringVariable(selector=selector, name="answer", value="new")
    frame_pool = VariablePool()
    parent_pool = VariablePool()
    frame_pool.add(selector, inner_old)
    parent_pool.add(selector, parent_old)

    _write_back_conversation_variable(frame_pool=frame_pool, parent_pool=parent_pool, variable=update)

    assert parent_pool.get_variable(selector) is parent_old


def test_restore_and_failure_lifecycle_calls_reach_the_builtin_handler() -> None:
    fixture = WorkflowRunner().load_fixture("update-conversation-variable-in-iteration")
    graph, runtime_state = WorkflowRunner().create_graph_from_fixture(fixture_data=fixture, query=_QUERY)
    registry = FrameRegistry()
    registry.create(frame_id=ROOT_FRAME_ID, container_id="", graph=graph, state=runtime_state)
    now = datetime.now(UTC).replace(tzinfo=None)
    run_state = IterationRunState(
        invocation_id="iteration-invocation",
        frame_id=ROOT_FRAME_ID,
        node_id="1759032379989",
        started_at=now,
        items=(),
        root_node_id="1759032379989start",
        output_selector=("1759032476318", "result"),
        error_handle_mode=ErrorHandleMode.TERMINATED,
        flatten_output=False,
        parallel_nums=1,
    )
    runtime_state.put_container_run(run_state)
    child = registry.create_child(
        frame_id="iteration-frame",
        parent_frame_id=ROOT_FRAME_ID,
        container_id=run_state.node_id,
        root_node_id=run_state.root_node_id,
        variable_pool=runtime_state.variable_pool.model_copy(deep=True),
    )
    frame_state = IterationFrameState(
        frame_id="iteration-frame",
        parent_invocation_id=run_state.invocation_id,
        root_node_id=run_state.root_node_id,
        index=0,
        started_at=now,
        runtime_data=child.state.snapshot_frame(),
    )
    runtime_state.put_container_frame(frame_state)
    registry.remove(child.frame_id)
    handler = DifyIterationContainerHandler(registry)

    handler.restore_frame(frame_state)

    restored = registry["iteration-frame"]
    assert restored.graph.root_node.id == "1759032379989start"
    answer = restored.state.variable_pool.get(["conversation", "answer"])
    assert answer is not None
    assert answer.to_object() == ""
    event = NodeRunFailedEvent(
        id="failed-iteration-node",
        node_id="1759032394460",
        node_type=BuiltinNodeTypes.CODE,
        error="iteration failed",
        start_at=now,
        finished_at=now,
        node_run_result=ContainerNodeRunResult(
            status=WorkflowNodeExecutionStatus.FAILED,
            error="iteration failed",
            error_type="RuntimeError",
        ).to_node_run_result(),
    )
    handler.record_frame_failure(frame=restored, event=event)

    restored_frame_state = runtime_state.get_container_frame("iteration-frame")
    assert isinstance(restored_frame_state, IterationFrameState)
    assert restored_frame_state.errors == ("iteration failed",)
