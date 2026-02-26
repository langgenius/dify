from __future__ import annotations

from types import SimpleNamespace

from core.workflow.runtime import GraphRuntimeState, VariablePool
from core.workflow.runtime.read_only_wrappers import ReadOnlyGraphRuntimeStateWrapper, ReadOnlyVariablePoolWrapper


def test_read_only_variable_pool_wrapper_returns_copies() -> None:
    variable_pool = VariablePool.empty()
    variable_pool.add(("node-1", "payload"), {"nested": [1]})
    wrapper = ReadOnlyVariablePoolWrapper(variable_pool)

    segment = wrapper.get(("node-1", "payload"))
    assert segment is not None
    segment.value["nested"].append(2)
    assert variable_pool.get(("node-1", "payload")).value == {"nested": [1]}

    assert wrapper.get_all_by_node("missing-node") == {}
    by_node = wrapper.get_all_by_node("node-1")
    by_prefix = wrapper.get_by_prefix("node-1")
    assert by_node["payload"] == {"nested": [1]}
    assert by_prefix["payload"] == {"nested": [1]}


def test_read_only_graph_runtime_state_wrapper_exposes_read_only_views() -> None:
    variable_pool = VariablePool.empty()
    variable_pool.add(("node-1", "value"), "hello")
    state = GraphRuntimeState(variable_pool=variable_pool, start_at=12.3)
    state.total_tokens = 7
    state.node_run_steps = 5
    state.set_output("answer", {"text": "hello"})
    state._graph_execution = SimpleNamespace(exceptions_count=2, dumps=lambda: "{}")
    wrapper = ReadOnlyGraphRuntimeStateWrapper(state)

    assert wrapper.system_variable is not None
    assert wrapper.variable_pool.get(("node-1", "value")).value == "hello"
    assert wrapper.start_at == 12.3
    assert wrapper.total_tokens == 7
    assert wrapper.llm_usage.total_tokens == 0
    assert wrapper.node_run_steps == 5
    assert wrapper.ready_queue_size == 0
    assert wrapper.exceptions_count == 2
    assert wrapper.get_output("answer") == {"text": "hello"}
    assert isinstance(wrapper.dumps(), str)

    copied_outputs = wrapper.outputs
    copied_outputs["answer"]["text"] = "changed"
    assert wrapper.get_output("answer") == {"text": "hello"}
