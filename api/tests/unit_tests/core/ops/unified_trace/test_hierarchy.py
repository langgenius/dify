from datetime import datetime, timedelta
from types import SimpleNamespace
from typing import cast

from core.ops.unified_trace.hierarchy import WorkflowExecutionLike, build_workflow_hierarchy, workflow_tool_parent_ids
from core.workflow.node_execution_process_data import (
    WORKFLOW_TOOL_INVOCATION_ID_KEY,
    WORKFLOW_TOOL_PARENT_EXECUTION_ID_KEY,
)


def execution(**overrides: object) -> WorkflowExecutionLike:
    values: dict[str, object] = {
        "id": "exec-1",
        "node_execution_id": None,
        "node_id": "node-1",
        "node_type": "tool",
        "predecessor_node_id": None,
        "iteration_id": None,
        "iteration_index": None,
        "loop_id": None,
        "loop_index": None,
        "created_at": datetime(2025, 1, 1),
        "elapsed_time": 1.0,
        "status": "succeeded",
        "metadata": {},
    }
    values.update(overrides)
    return cast(WorkflowExecutionLike, SimpleNamespace(**values))


def test_predecessor_becomes_parent_independent_of_repository_order() -> None:
    start = execution(id="exec-start", node_id="start")
    llm = execution(id="exec-llm", node_id="llm", predecessor_node_id="start")

    forward = build_workflow_hierarchy([start, llm])
    reverse = build_workflow_hierarchy([llm, start])

    assert forward.parent_by_execution_id == {"exec-llm": "exec-start"}
    assert reverse.parent_by_execution_id == forward.parent_by_execution_id


def test_repeated_graph_node_id_is_not_guessed_as_parent() -> None:
    first = execution(id="exec-a1", node_id="a")
    second = execution(id="exec-a2", node_id="a")
    child = execution(id="exec-b", node_id="b", predecessor_node_id="a")

    result = build_workflow_hierarchy([first, second, child])

    assert "exec-b" not in result.parent_by_execution_id


def test_iteration_child_is_parented_to_stable_wrapper() -> None:
    container = execution(id="iteration-exec", node_id="iteration", node_type="iteration")
    child = execution(id="child-exec", node_id="child", iteration_id="iteration", iteration_index=0)

    result = build_workflow_hierarchy([child, container])
    wrapper = result.wrapper_by_child_execution_id["child-exec"]

    assert wrapper.id == "iteration:iteration-exec:0"
    assert wrapper.parent_execution_id == "iteration-exec"
    assert result.parent_by_execution_id["child-exec"] == wrapper.id


def test_loop_wrapper_covers_child_times_and_failure() -> None:
    container = execution(id="loop-exec", node_id="loop", node_type="loop")
    first = execution(
        id="first",
        node_id="first-node",
        loop_id="loop",
        loop_index=2,
        created_at=datetime(2025, 1, 1, 0, 0, 1),
        elapsed_time=2,
    )
    second = execution(
        id="second",
        node_id="second-node",
        loop_id="loop",
        loop_index=2,
        created_at=datetime(2025, 1, 1, 0, 0, 2),
        elapsed_time=4,
        status="failed",
    )

    result = build_workflow_hierarchy([second, container, first])
    wrapper = result.wrappers[0]

    assert wrapper.id == "loop:loop-exec:2"
    assert wrapper.start_time == first.created_at
    assert wrapper.end_time == second.created_at + timedelta(seconds=4)
    assert wrapper.has_error is True
    assert wrapper.child_execution_ids == frozenset({"first", "second"})


def test_invalid_wrapper_indexes_do_not_create_wrappers() -> None:
    container = execution(id="loop-exec", node_id="loop", node_type="loop")
    negative = execution(id="negative", node_id="negative-node", loop_id="loop", loop_index=-1)
    boolean = execution(id="boolean", node_id="boolean-node", loop_id="loop", loop_index=True)

    result = build_workflow_hierarchy([container, negative, boolean])

    assert result.wrappers == ()


def test_cycle_edges_are_removed_deterministically() -> None:
    first = execution(id="a-exec", node_id="a", predecessor_node_id="b")
    second = execution(id="b-exec", node_id="b", predecessor_node_id="a")

    result = build_workflow_hierarchy([first, second])

    assert result.parent_by_execution_id == {}


def test_tool_invocations_keep_source_nodes_and_loop_wrappers_in_their_own_scope() -> None:
    nodes = [execution(id="root-start", node_id="start", workflow_id="root")]
    for invocation in ("first", "second"):
        nodes.append(
            execution(
                id=f"{invocation}-tool-row",
                node_execution_id=f"{invocation}-tool",
                node_id="tool",
                workflow_id="root",
            )
        )
        ownership = {
            WORKFLOW_TOOL_INVOCATION_ID_KEY: invocation,
            WORKFLOW_TOOL_PARENT_EXECUTION_ID_KEY: f"{invocation}-tool",
        }
        nodes.extend(
            [
                execution(id=f"{invocation}-start", node_id="start", workflow_id="source", process_data=ownership),
                execution(
                    id=f"{invocation}-loop",
                    node_id="loop",
                    workflow_id="source",
                    process_data=ownership,
                    node_type="loop",
                    predecessor_node_id="start",
                ),
                execution(
                    id=f"{invocation}-body",
                    node_id="body",
                    workflow_id="source",
                    process_data=ownership,
                    loop_id="loop",
                    loop_index=0,
                ),
            ]
        )

    hierarchy = build_workflow_hierarchy(list(reversed(nodes)))

    for invocation in ("first", "second"):
        parents = hierarchy.parent_by_execution_id
        assert parents[f"{invocation}-start"] == f"{invocation}-tool-row"
        assert parents[f"{invocation}-loop"] == f"{invocation}-start"
        assert parents[f"{invocation}-body"] == f"loop:{invocation}-loop:0"
    assert len(hierarchy.wrappers) == 2


def test_tool_parent_references_cannot_escape_the_loaded_trace_or_create_cycles() -> None:
    nodes = [
        execution(id="a", process_data={WORKFLOW_TOOL_PARENT_EXECUTION_ID_KEY: "b"}),
        execution(id="b", process_data={WORKFLOW_TOOL_PARENT_EXECUTION_ID_KEY: "a"}),
        execution(id="c", process_data={WORKFLOW_TOOL_PARENT_EXECUTION_ID_KEY: "another-run"}),
    ]

    assert workflow_tool_parent_ids(nodes) == {}
