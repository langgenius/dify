from datetime import datetime, timedelta
from types import SimpleNamespace

from core.ops.unified_trace.hierarchy import build_workflow_hierarchy


def execution(**overrides):
    values = {
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
    return SimpleNamespace(**values)


def test_predecessor_becomes_parent_independent_of_repository_order():
    start = execution(id="exec-start", node_id="start")
    llm = execution(id="exec-llm", node_id="llm", predecessor_node_id="start")

    forward = build_workflow_hierarchy([start, llm])
    reverse = build_workflow_hierarchy([llm, start])

    assert forward.parent_by_execution_id == {"exec-llm": "exec-start"}
    assert reverse.parent_by_execution_id == forward.parent_by_execution_id


def test_repeated_graph_node_id_is_not_guessed_as_parent():
    first = execution(id="exec-a1", node_id="a")
    second = execution(id="exec-a2", node_id="a")
    child = execution(id="exec-b", node_id="b", predecessor_node_id="a")

    result = build_workflow_hierarchy([first, second, child])

    assert "exec-b" not in result.parent_by_execution_id


def test_iteration_child_is_parented_to_stable_wrapper():
    container = execution(id="iteration-exec", node_id="iteration", node_type="iteration")
    child = execution(id="child-exec", node_id="child", iteration_id="iteration", iteration_index=0)

    result = build_workflow_hierarchy([child, container])
    wrapper = result.wrapper_by_child_execution_id["child-exec"]

    assert wrapper.id == "iteration:iteration-exec:0"
    assert wrapper.parent_execution_id == "iteration-exec"
    assert result.parent_by_execution_id["child-exec"] == wrapper.id


def test_loop_wrapper_covers_child_times_and_failure():
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


def test_invalid_wrapper_indexes_do_not_create_wrappers():
    container = execution(id="loop-exec", node_id="loop", node_type="loop")
    negative = execution(id="negative", node_id="negative-node", loop_id="loop", loop_index=-1)
    boolean = execution(id="boolean", node_id="boolean-node", loop_id="loop", loop_index=True)

    result = build_workflow_hierarchy([container, negative, boolean])

    assert result.wrappers == ()


def test_cycle_edges_are_removed_deterministically():
    first = execution(id="a-exec", node_id="a", predecessor_node_id="b")
    second = execution(id="b-exec", node_id="b", predecessor_node_id="a")

    result = build_workflow_hierarchy([first, second])

    assert result.parent_by_execution_id == {}
